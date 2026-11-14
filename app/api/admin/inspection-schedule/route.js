import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {getSchedule,ZONE,validClock} from '../../../../lib/inspection-schedule';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
import {getStaffSession} from '../../../../lib/staff-auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function chooseTenant(req,pool,requested){
 await ensureSiteTenants(pool);
 const admin=await isAdminRequest(req);let id=requested;
 if(!admin){const staff=await getStaffSession(req);id=staff?.tenant_id;}else if(id===undefined||id===null||id===''){const owner=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");id=owner.rows[0]?.id;}
 if(!/^\\d+$/.test(String(id||'')))throw new Error('Choose a valid company workspace.');
 const q=await pool.query('SELECT id,tenant_key,display_name FROM public.site_tenants WHERE id=$1',[id]);
 if(!q.rowCount)throw new Error('Company workspace not found.');
 return {tenant:q.rows[0],admin};
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,['inspections.view','inspections.manage']))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const pool=getDatabasePool(),url=new URL(req.url),{tenant,admin}=await chooseTenant(req,pool,url.searchParams.get('tenantId'));const settings=await getSchedule(tenant.id);const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[];return NextResponse.json({settings,tenant,tenants,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});}
 catch(e){console.error('Schedule settings GET failed',e.message);return NextResponse.json({error:e.message||'Could not load schedule settings.'},{status:400});}
}
export async function PUT(req){
 if(!await authorizeAdminRequest(req,'inspections.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const d=await req.json(),pool=getDatabasePool(),{tenant}=await chooseTenant(req,pool,d.tenant_id);
  const workingDays=[...new Set((Array.isArray(d.workingDays)?d.workingDays:[]).map(Number))].sort();
  const blockedDates=[...new Set((Array.isArray(d.blockedDates)?d.blockedDates:[]).map(String))];
  const settings={timezone:ZONE,workingDays,startTime:String(d.startTime||''),endTime:String(d.endTime||''),slotMinutes:Number(d.slotMinutes),blockedDates};
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  if(!workingDays.length||workingDays.some(x=>!Number.isInteger(x)||x<1||x>6)||!validClock(settings.startTime)||!validClock(settings.endTime)||minutes(settings.endTime)<=minutes(settings.startTime)||![15,30,60].includes(settings.slotMinutes)||blockedDates.length>180||blockedDates.some(x=>!/^\\d{4}-\\d{2}-\\d{2}$/.test(x)))return NextResponse.json({error:'Check working days, opening hours, slot length and blocked dates.'},{status:400});
  await pool.query("CREATE TABLE IF NOT EXISTS public.inspection_schedule_tenant_settings (tenant_id bigint PRIMARY KEY REFERENCES public.site_tenants(id) ON DELETE RESTRICT,settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
  await pool.query('INSERT INTO public.inspection_schedule_tenant_settings(tenant_id,settings) VALUES($1,$2::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()',[tenant.id,JSON.stringify(settings)]);
  return NextResponse.json({ok:true,settings,tenant},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Schedule settings save failed',e.message);return NextResponse.json({error:e.message||'Could not save inspection schedule.'},{status:400});}
}
