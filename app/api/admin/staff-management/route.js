import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import { requireStaff } from '../../../../lib/staff-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const KEYS=['clients.view','payments.review','inspections.view','inspections.manage','properties.manage','content.manage','legal.publish'];
async function gate(req){
 const a=await requireStaff(req,'staff.manage');
 if(!a.ok)return {error:NextResponse.json({error:a.error},{status:a.status})};
 if(a.staff.role!=='super_admin')return {error:NextResponse.json({error:'Only the Super Admin can manage staff accounts.'},{status:403})};
 return a;
}
export async function GET(req){
 const a=await gate(req);if(a.error)return a.error;
 try{
  const q=await getDatabasePool().query(`SELECT s.id,s.full_name,s.email,s.role,s.status,s.created_at,s.last_login_at,
   COALESCE(jsonb_object_agg(p.permission_key,p.enabled) FILTER(WHERE p.permission_key IS NOT NULL),'{}'::jsonb) AS permission_overrides
   FROM public.staff_accounts s LEFT JOIN public.staff_account_permissions p ON p.staff_id=s.id GROUP BY s.id ORDER BY s.created_at DESC`);
  return NextResponse.json({staff:q.rows,permissions:KEYS},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Staff list failed',e.code||e.message);return NextResponse.json({error:'Could not load staff accounts.'},{status:500});}
}
export async function POST(req){
 const a=await gate(req);if(a.error)return a.error;
 let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid JSON.'},{status:400});}
 const name=String(d?.full_name||'').trim().slice(0,120),email=String(d?.email||'').trim().toLowerCase(),role=String(d?.role||'');
 const perms=d?.permissions&&typeof d.permissions==='object'&&!Array.isArray(d.permissions)?d.permissions:{};
 if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['administrator','moderator'].includes(role))return NextResponse.json({error:'Enter a valid name, email and staff role.'},{status:400});
 if(Object.entries(perms).some(([k,v])=>!KEYS.includes(k)||typeof v!=='boolean'))return NextResponse.json({error:'Invalid permission override.'},{status:400});
 const db=await getDatabasePool().connect();
 try{
  await db.query('BEGIN');
  const q=await db.query(`INSERT INTO public.staff_accounts(full_name,email,email_normalized,role,status,invited_by) VALUES($1,$2,$3,$4,'active',$5) RETURNING id,full_name,email,role,status,created_at`,[name,email,email,role,a.staff.email]);
  for(const [key,enabled] of Object.entries(perms))await db.query('INSERT INTO public.staff_account_permissions(staff_id,permission_key,enabled,granted_by) VALUES($1,$2,$3,$4)',[q.rows[0].id,key,enabled,a.staff.email]);
  await db.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin',$1,'staff.created','staff_account',$2,$3::jsonb)",[a.staff.email,q.rows[0].id,JSON.stringify({role,permissionKeys:Object.keys(perms)})]);
  await db.query('COMMIT');return NextResponse.json({ok:true,staff:q.rows[0]},{status:201});
 }catch(e){await db.query('ROLLBACK');if(e.code==='23505')return NextResponse.json({error:'A staff account already exists for this email.'},{status:409});console.error('Staff create failed',e.code||e.message);return NextResponse.json({error:'Could not create staff account.'},{status:500});}
 finally{db.release();}
}
export async function PATCH(req){
 const a=await gate(req);if(a.error)return a.error;
 let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid JSON.'},{status:400});}
 const id=String(d?.id||''),role=d?.role,status=d?.status,perms=d?.permissions;
 if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid staff account.'},{status:400});
 if(role!==undefined&&!['administrator','moderator'].includes(role))return NextResponse.json({error:'Only Administrator or Moderator can be assigned.'},{status:400});
 if(status!==undefined&&!['active','suspended','revoked'].includes(status))return NextResponse.json({error:'Invalid staff status.'},{status:400});
 if(perms!==undefined&&(!perms||typeof perms!=='object'||Array.isArray(perms)||Object.entries(perms).some(([k,v])=>!KEYS.includes(k)||typeof v!=='boolean')))return NextResponse.json({error:'Invalid permission overrides.'},{status:400});
 const db=await getDatabasePool().connect();
 try{
  await db.query('BEGIN');
  const q=await db.query('SELECT id,email,role,status FROM public.staff_accounts WHERE id=$1 FOR UPDATE',[id]);
  if(!q.rowCount){await db.query('ROLLBACK');return NextResponse.json({error:'Staff account not found.'},{status:404});}
  if(q.rows[0].role==='super_admin'){await db.query('ROLLBACK');return NextResponse.json({error:'The Super Admin account is protected.'},{status:403});}
  if(id===a.staff.staff_id&&status&&status!=='active'){await db.query('ROLLBACK');return NextResponse.json({error:'You cannot suspend or revoke your own account.'},{status:400});}
  const nextRole=role||q.rows[0].role,nextStatus=status||q.rows[0].status;
  await db.query('UPDATE public.staff_accounts SET role=$2,status=$3,updated_at=now() WHERE id=$1',[id,nextRole,nextStatus]);
  if(perms!==undefined)for(const [key,enabled] of Object.entries(perms))await db.query(`INSERT INTO public.staff_account_permissions(staff_id,permission_key,enabled,granted_by,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(staff_id,permission_key) DO UPDATE SET enabled=EXCLUDED.enabled,granted_by=EXCLUDED.granted_by,updated_at=now()`,[id,key,enabled,a.staff.email]);
  await db.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin',$1,'staff.updated','staff_account',$2,$3::jsonb)",[a.staff.email,id,JSON.stringify({role:nextRole,status:nextStatus,permissionKeys:perms?Object.keys(perms):[]})]);
  await db.query('COMMIT');return NextResponse.json({ok:true});
 }catch(e){await db.query('ROLLBACK');console.error('Staff update failed',e.code||e.message);return NextResponse.json({error:'Could not update staff account.'},{status:500});}
 finally{db.release();}
}
