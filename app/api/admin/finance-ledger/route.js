import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function context(req){
 if(!await isAdminRequest(req))return {error:NextResponse.json({error:'Super Admin authentication is required.'},{status:403})};
 const host=req.headers.get('x-forwarded-host')||req.headers.get('host');
 const pool=getDatabasePool(),tenant=host?await resolveSiteTenant(pool,host):null;
 if(!tenant)return {error:NextResponse.json({error:'Workspace not found for this domain.'},{status:404})};
 const staff=await getStaffSession(req);
 if(staff&&Number(staff.tenant_id)!==Number(tenant.id))return {error:NextResponse.json({error:'Your staff account does not belong to this workspace.'},{status:403})};
 return {pool,tenant,staff};
}
export async function GET(req){
 const c=await context(req);if(c.error)return c.error;
 try{
  const {pool,tenant}=c,id=tenant.id;
  const [rows,totals,monthly,properties]=await Promise.all([
   pool.query(`SELECT l.id,l.entry_type,l.category,l.description,l.amount::text,l.currency,l.reference,l.entry_date,l.recorded_by,l.created_at,l.property_id,l.approval_status,l.approved_by,l.approved_at,l.approval_note,
    (SELECT COALESCE(json_agg(json_build_object('action',a.action,'actor',a.actor,'old_status',a.old_status,'new_status',a.new_status,'note',a.note,'created_at',a.created_at) ORDER BY a.created_at DESC),'[]'::json)
     FROM public.finance_ledger_audit a WHERE a.ledger_id=l.id AND a.tenant_id=l.tenant_id) AS audit_history
    FROM public.finance_ledger l WHERE l.tenant_id=$1 ORDER BY l.entry_date DESC,l.created_at DESC LIMIT 500`,[id]),
   pool.query(`SELECT currency,COALESCE(SUM(amount) FILTER(WHERE entry_type='income' AND approval_status='approved'),0)::numeric(14,2)::text AS income,
    COALESCE(SUM(amount) FILTER(WHERE entry_type='expense' AND approval_status='approved'),0)::numeric(14,2)::text AS expenses,
    COUNT(*)::int AS entries,COUNT(*) FILTER(WHERE approval_status='pending')::int AS pending
    FROM public.finance_ledger WHERE tenant_id=$1 GROUP BY currency ORDER BY currency`,[id]),
   pool.query(`SELECT to_char(date_trunc('month',entry_date),'YYYY-MM') AS month,currency,
    COALESCE(SUM(amount) FILTER(WHERE entry_type='income' AND approval_status='approved'),0)::numeric(14,2)::text AS income,
    COALESCE(SUM(amount) FILTER(WHERE entry_type='expense' AND approval_status='approved'),0)::numeric(14,2)::text AS expenses,
    COUNT(*) FILTER(WHERE approval_status='approved')::int AS entries
    FROM public.finance_ledger WHERE tenant_id=$1 AND entry_date>=date_trunc('month',CURRENT_DATE)-interval '11 months'
    GROUP BY date_trunc('month',entry_date),currency ORDER BY 1,2`,[id]),
   pool.query('SELECT id,title FROM public.properties WHERE tenant_id=$1 ORDER BY title LIMIT 500',[id])
  ]);
  return NextResponse.json({entries:rows.rows,currencyTotals:totals.rows,monthly:monthly.rows,properties:properties.rows,tenant:{id:tenant.id,name:tenant.display_name}},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Finance ledger GET',e.code||e.message);return NextResponse.json({error:'Could not load finance records.'},{status:500});}
}
export async function POST(req){
 const c=await context(req);if(c.error)return c.error;
 try{
  const {pool,tenant,staff}=c,d=await req.json(),type=String(d.entry_type||''),category=String(d.category||'').trim().slice(0,80),description=String(d.description||'').trim().slice(0,500),amount=Number(d.amount),currency=String(d.currency||'NGN').toUpperCase(),reference=String(d.reference||'').trim().slice(0,120),date=String(d.entry_date||''),propertyId=d.property_id||null;
  if(!['income','expense'].includes(type)||!category||!description||!Number.isFinite(amount)||amount<=0||amount>999999999999||!['NGN','USD','GBP','EUR'].includes(currency)||!/^(20\\d{2})-(0[1-9]|1[0-2])-([0-2]\\d|3[01])$/.test(date)||(propertyId&&!/^[0-9a-f-]{36}$/i.test(propertyId)))return NextResponse.json({error:'Enter valid transaction details.'},{status:400});
  if(propertyId){const p=await pool.query('SELECT 1 FROM public.properties WHERE id=$1 AND tenant_id=$2',[propertyId,tenant.id]);if(!p.rowCount)return NextResponse.json({error:'Selected property does not belong to this workspace.'},{status:400});}
  const actor=staff?.email||'super-admin',client=await pool.connect();let entry;
  try{
   await client.query('BEGIN');
   const r=await client.query(`INSERT INTO public.finance_ledger(tenant_id,entry_type,category,description,amount,currency,reference,entry_date,property_id,approval_status,recorded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
    RETURNING id,entry_type,category,description,amount::text,currency,reference,entry_date,property_id,approval_status,recorded_by,created_at`,
    [tenant.id,type,category,description,amount,currency,reference||null,date,propertyId,actor]);
   entry=r.rows[0];
   await client.query("INSERT INTO public.finance_ledger_audit(tenant_id,ledger_id,action,actor,new_status) VALUES($1,$2,'created',$3,'pending')",[tenant.id,entry.id,actor]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  return NextResponse.json({entry},{status:201});
 }catch(e){console.error('Finance ledger POST',e.code||e.message);return NextResponse.json({error:'Could not save finance entry.'},{status:500});}
}
export async function PATCH(req){
 const c=await context(req);if(c.error)return c.error;
 try{
  const {pool,tenant,staff}=c,d=await req.json(),id=String(d.id||''),status=String(d.approval_status||''),note=String(d.approval_note||'').trim().slice(0,500);
  if(!/^[0-9a-f-]{36}$/i.test(id)||!['approved','rejected'].includes(status))return NextResponse.json({error:'Invalid approval decision.'},{status:400});
  const actor=staff?.email||'super-admin',client=await pool.connect();let result;
  try{
   await client.query('BEGIN');
   const before=await client.query('SELECT approval_status FROM public.finance_ledger WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,tenant.id]);
   if(!before.rowCount||before.rows[0].approval_status!=='pending'){await client.query('ROLLBACK');return NextResponse.json({error:'Entry not found or already reviewed in this workspace.'},{status:409});}
   result=await client.query("UPDATE public.finance_ledger SET approval_status=$3,approved_by=$4,approved_at=now(),approval_note=$5 WHERE id=$1 AND tenant_id=$2 RETURNING id,approval_status,approved_by,approved_at",[id,tenant.id,status,actor,note||null]);
   await client.query("INSERT INTO public.finance_ledger_audit(tenant_id,ledger_id,action,actor,old_status,new_status,note) VALUES($1,$2,'reviewed',$3,'pending',$4,$5)",[tenant.id,id,actor,status,note||null]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  return NextResponse.json({entry:result.rows[0]});
 }catch(e){console.error('Finance ledger PATCH',e.code||e.message);return NextResponse.json({error:'Could not review finance entry.'},{status:500});}
}
