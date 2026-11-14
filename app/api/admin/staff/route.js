import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {newOpaqueToken,hashToken} from '../../../../lib/staff-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
export const runtime='nodejs';export const dynamic='force-dynamic';
const PERMISSIONS=['dashboard.view','properties.manage','inspections.view','inspections.manage','clients.view','clients.manage','payments.review','contacts.view','contacts.manage','media.manage','homepage.manage','staff.manage','audit.view','settings.manage'];
const ROLES=['administrator','moderator'];
const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
async function selectedTenant(pool,requested){
 const id=String(requested||'');
 const validId=id!==''&&Number.isSafeInteger(Number(id))&&Number(id)>0;\n const q=validId
  ?await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE id=$1',[id])
  :await pool.query("SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");
 if(!q.rowCount)throw new Error('Company workspace not found.');
 return q.rows[0];
}
async function audit(pool,tenantId,action,targetType,targetId,details={}){
 await pool.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details,tenant_id) VALUES('super_admin','master-admin',$1,$2,$3,$4::jsonb,$5)",[action,targetType,targetId,JSON.stringify(details),tenantId]);
}
export async function GET(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const p=getDatabasePool();await ensureSiteTenants(p);const url=new URL(req.url),tenant=await selectedTenant(p,url.searchParams.get('tenantId'));
  const [staff,events,defaults,companies]=await Promise.all([
   p.query("SELECT s.id,s.tenant_id,s.full_name,s.email,s.role,s.status,s.invited_by,s.created_at,s.updated_at,s.last_login_at,COALESCE((SELECT json_agg(json_build_object('permission_key',a.permission_key,'enabled',a.enabled) ORDER BY a.permission_key) FROM public.staff_account_permissions a WHERE a.staff_id=s.id),'[]'::json) permissions FROM public.staff_accounts s WHERE s.tenant_id=$1 AND s.role <> 'super_admin' ORDER BY s.created_at DESC",[tenant.id]),
   p.query('SELECT id,tenant_id,actor_type,actor_email,action,target_type,target_id,details,created_at FROM public.staff_audit_events WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenant.id]),
   p.query("SELECT role,permission_key,enabled FROM public.staff_role_permissions ORDER BY role,permission_key"),
   p.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')
  ]);
  return NextResponse.json({staff:staff.rows,events:events.rows,rolePermissions:defaults.rows,permissionCatalog:PERMISSIONS,tenants:companies.rows,tenant,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Staff admin GET',e.code||e.message);return NextResponse.json({error:'Could not load staff management data.'},{status:500});}
}
export async function POST(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body.'},{status:400})}
 try{
  const p=getDatabasePool();await ensureSiteTenants(p);const tenant=await selectedTenant(p,d.tenant_id);
  if(d.action==='resend'){
   const id=clean(d.id,50);if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid staff ID.'},{status:400});
   const token=newOpaqueToken(),tokenHash=hashToken(token),base=process.env.NEXT_PUBLIC_SITE_URL||req.nextUrl.origin;
   const inviteUrl=new URL('/staff/accept',base);inviteUrl.searchParams.set('token',token);
   const client=await p.connect();
   try{
    await client.query('BEGIN');
    const prior=await client.query('SELECT id,full_name,email,role,status,password_hash FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,tenant.id]);
    if(!prior.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Staff account not found in this company.'},{status:404});}
    const staff=prior.rows[0];
    if(staff.role==='super_admin'||staff.status!=='invited'||staff.password_hash){await client.query('ROLLBACK');return NextResponse.json({error:'Only an unaccepted staff invitation can receive a replacement link.'},{status:409});}
    const updated=await client.query("UPDATE public.staff_accounts SET invitation_token_hash=$2,invitation_expires_at=now()+interval '48 hours',updated_at=now() WHERE id=$1 RETURNING id,full_name,email,role,status,invitation_expires_at",[id,tokenHash]);
    await client.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details,tenant_id) VALUES('super_admin','master-admin','staff.invitation_resent','staff',$1,$2::jsonb,$3)",[id,JSON.stringify({email:staff.email,expiresAt:updated.rows[0].invitation_expires_at}),tenant.id]);
    await client.query('COMMIT');
    return NextResponse.json({staff:updated.rows[0],emailSent:false,message:'A fresh one-time invitation link is ready to share. The previous link is now invalid.',invitationUrl:inviteUrl.toString()});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  const full_name=clean(d.full_name,140),email=clean(d.email,254).toLowerCase(),role=clean(d.role,30);
  if(full_name.length<2||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)||!ROLES.includes(role))return NextResponse.json({error:'Enter a valid name, email and staff role.'},{status:400});
  const token=newOpaqueToken(),tokenHash=hashToken(token),base=process.env.NEXT_PUBLIC_SITE_URL||req.nextUrl.origin;
  const inviteUrl=new URL('/staff/accept',base);inviteUrl.searchParams.set('token',token);
  const r=await p.query("INSERT INTO public.staff_accounts(tenant_id,full_name,email,email_normalized,role,status,invited_by,invitation_token_hash,invitation_expires_at) VALUES($1,$2,$3,$3,$4,'invited','master-admin',$5,now()+interval '48 hours') RETURNING id,tenant_id,full_name,email,role,status,created_at,invitation_expires_at",[tenant.id,full_name,email,role,tokenHash]);
  await audit(p,tenant.id,'staff.invited','staff',r.rows[0].id,{email,role,expiresAt:r.rows[0].invitation_expires_at});
  return NextResponse.json({staff:r.rows[0],emailSent:false,message:'Staff invitation created for '+tenant.display_name+'. Share the secure invitation link with the employee.',invitationUrl:inviteUrl.toString()},{status:201});
 }catch(e){if(e.code==='23505')return NextResponse.json({error:'A staff account with that email already exists.'},{status:409});console.error('Staff admin POST',e.code||e.message);return NextResponse.json({error:'Could not create staff invitation.'},{status:500});}
}
export async function PATCH(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body.'},{status:400})}
 const id=clean(d.id,50);
 if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid staff ID.'},{status:400});
 if(d.status!==undefined&&!['invited','active','suspended','revoked'].includes(d.status))return NextResponse.json({error:'Invalid staff status.'},{status:400});
 if(d.role!==undefined&&!ROLES.includes(d.role))return NextResponse.json({error:'Invalid role.'},{status:400});
 if(d.permissions!==undefined&&(!Array.isArray(d.permissions)||d.permissions.some(x=>!x||!PERMISSIONS.includes(x.key)||typeof x.enabled!=='boolean')||new Set(d.permissions.map(x=>x.key)).size!==d.permissions.length))return NextResponse.json({error:'Invalid permission settings.'},{status:400});
 if(d.status===undefined&&d.role===undefined&&d.permissions===undefined)return NextResponse.json({error:'No staff changes were supplied.'},{status:400});
 const p=getDatabasePool(),client=await p.connect();
 try{
  await ensureSiteTenants(p);const tenant=await selectedTenant(p,d.tenant_id);
  await client.query('BEGIN');
  const prior=await client.query('SELECT id,email,role,status FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,tenant.id]);
  if(!prior.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Staff account not found in this company.'},{status:404});}
  const current=prior.rows[0];
  if(current.role==='super_admin'){await client.query('ROLLBACK');return NextResponse.json({error:'The master Super Admin account is protected.'},{status:403});}
  if(d.status==='active'&&current.status!=='active'){await client.query('ROLLBACK');return NextResponse.json({error:'Staff accounts can only become active by accepting a valid invitation and setting a password.'},{status:409});}
  if(d.status!==undefined&&d.status!==current.status){
   await client.query('UPDATE public.staff_accounts SET status=$2,updated_at=now() WHERE id=$1',[id,d.status]);
   if(['suspended','revoked'].includes(d.status))await client.query('UPDATE public.staff_sessions SET revoked_at=now() WHERE staff_id=$1 AND revoked_at IS NULL',[id]);
   await audit(client,tenant.id,'staff.status_changed','staff',id,{from:current.status,to:d.status,email:current.email});
  }
  if(d.role!==undefined&&d.role!==current.role){await client.query('UPDATE public.staff_accounts SET role=$2,updated_at=now() WHERE id=$1',[id,d.role]);await audit(client,tenant.id,'staff.role_changed','staff',id,{from:current.role,to:d.role,email:current.email});}
  if(d.permissions!==undefined){
   for(const x of d.permissions)await client.query("INSERT INTO public.staff_account_permissions(staff_id,permission_key,enabled,granted_by,updated_at) VALUES($1,$2,$3,'master-admin',now()) ON CONFLICT(staff_id,permission_key) DO UPDATE SET enabled=EXCLUDED.enabled,granted_by=EXCLUDED.granted_by,updated_at=now()",[id,x.key,x.enabled]);
   await audit(client,tenant.id,'staff.permissions_changed','staff',id,{permissions:d.permissions});
  }
  const out=await client.query("SELECT s.id,s.tenant_id,s.full_name,s.email,s.role,s.status,s.created_at,s.last_login_at,COALESCE((SELECT json_agg(json_build_object('permission_key',a.permission_key,'enabled',a.enabled) ORDER BY a.permission_key) FROM public.staff_account_permissions a WHERE a.staff_id=s.id),'[]'::json) permissions FROM public.staff_accounts s WHERE s.id=$1 AND s.tenant_id=$2",[id,tenant.id]);
  await client.query('COMMIT');return NextResponse.json({staff:out.rows[0]},{headers:{'Cache-Control':'no-store'}});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Staff admin PATCH',e.code||e.message);return NextResponse.json({error:'Could not update staff account.'},{status:500});}
 finally{client.release();}
}
