import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {newOpaqueToken,hashToken} from '../../../../lib/staff-auth';
import {sendClientRegistrationEmail,escapeHtml} from '../../../../lib/client-registration-email';
export const runtime='nodejs';export const dynamic='force-dynamic';
const PERMISSIONS=['dashboard.view','properties.manage','inspections.view','inspections.manage','clients.view','clients.manage','payments.review','media.manage','homepage.manage','staff.manage','audit.view','settings.manage'];
const roles=['administrator','moderator'];
const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
async function audit(pool,action,targetType,targetId,details={}){await pool.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin','master-admin',$1,$2,$3,$4::jsonb)",[action,targetType,targetId,JSON.stringify(details)]);}
export async function GET(req){if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{const p=getDatabasePool();const [staff,events,defaults]=await Promise.all([p.query("SELECT s.id,s.full_name,s.email,s.role,s.status,s.invited_by,s.created_at,s.updated_at,s.last_login_at,COALESCE((SELECT json_agg(json_build_object('permission_key',a.permission_key,'enabled',a.enabled) ORDER BY a.permission_key) FROM public.staff_account_permissions a WHERE a.staff_id=s.id),'[]'::json) permissions FROM public.staff_accounts s WHERE s.role <> 'super_admin' ORDER BY s.created_at DESC"),p.query("SELECT id,actor_type,actor_email,action,target_type,target_id,details,created_at FROM public.staff_audit_events ORDER BY created_at DESC LIMIT 100"),p.query("SELECT role,permission_key,enabled FROM public.staff_role_permissions ORDER BY role,permission_key")]);return NextResponse.json({staff:staff.rows,events:events.rows,rolePermissions:defaults.rows,permissionCatalog:PERMISSIONS},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error('Staff admin GET',e.code||e.message);return NextResponse.json({error:'Could not load staff management data.'},{status:500});}}
export async function POST(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body.'},{status:400})}
 const full_name=clean(d.full_name,140),email=clean(d.email,254).toLowerCase(),role=clean(d.role,30);
 if(full_name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!roles.includes(role))return NextResponse.json({error:'Enter a valid name, email and staff role.'},{status:400});
 const token=newOpaqueToken(),tokenHash=hashToken(token),base=process.env.NEXT_PUBLIC_SITE_URL||req.nextUrl.origin;
 const inviteUrl=new URL('/staff/accept',base);inviteUrl.searchParams.set('token',token);
 try{
  const p=getDatabasePool();
  const r=await p.query("INSERT INTO public.staff_accounts(full_name,email,email_normalized,role,status,invited_by,invitation_token_hash,invitation_expires_at) VALUES($1,$2,$2,$3,'invited','master-admin',$4,now()+interval '48 hours') RETURNING id,full_name,email,role,status,created_at,invitation_expires_at",[full_name,email,role,tokenHash]);
  await audit(p,'staff.invited','staff',r.rows[0].id,{email,role,expiresAt:r.rows[0].invitation_expires_at});
  const html='<p>Hello '+escapeHtml(full_name)+',</p><p>You have been invited to access G-BEST Luxury Realty operations as '+escapeHtml(role)+'.</p><p><a href="'+escapeHtml(inviteUrl.toString())+'">Accept your invitation and set your password</a></p><p>This secure invitation expires in 48 hours and can only be used once.</p>';
  const delivery=await sendClientRegistrationEmail({to:email,subject:'Your G-BEST staff invitation',html});
  return NextResponse.json({staff:r.rows[0],emailSent:delivery.sent,message:delivery.sent?'Invitation created and email sent.':'Invitation created, but email delivery is not configured or failed. Share this one-time link securely with the invited person.',...(!delivery.sent?{invitationUrl:inviteUrl.toString()}:{} )},{status:201});
 }catch(e){if(e.code==='23505')return NextResponse.json({error:'A staff account with that email already exists.'},{status:409});console.error('Staff admin POST',e.code||e.message);return NextResponse.json({error:'Could not create staff invitation.'},{status:500});}
}
export async function PATCH(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body.'},{status:400})}
 const id=clean(d.id,50);
 if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid staff ID.'},{status:400});
 if(d.status!==undefined&&!['invited','active','suspended','revoked'].includes(d.status))return NextResponse.json({error:'Invalid staff status.'},{status:400});
 if(d.role!==undefined&&!roles.includes(d.role))return NextResponse.json({error:'Invalid role.'},{status:400});
 if(d.permissions!==undefined&&(!Array.isArray(d.permissions)||d.permissions.some(x=>!x||!PERMISSIONS.includes(x.key)||typeof x.enabled!=='boolean')||new Set(d.permissions.map(x=>x.key)).size!==d.permissions.length))return NextResponse.json({error:'Invalid permission settings.'},{status:400});
 if(d.status===undefined&&d.role===undefined&&d.permissions===undefined)return NextResponse.json({error:'No staff changes were supplied.'},{status:400});
 const p=getDatabasePool(),client=await p.connect();
 try{
  await client.query('BEGIN');
  const prior=await client.query('SELECT id,email,role,status FROM public.staff_accounts WHERE id=$1 FOR UPDATE',[id]);
  if(!prior.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Staff account not found.'},{status:404});}
  const current=prior.rows[0];
  if(current.role==='super_admin'){await client.query('ROLLBACK');return NextResponse.json({error:'The master super-admin account is protected and cannot be changed here.'},{status:403});}
  if(d.status==='active'&&current.status!=='active'){await client.query('ROLLBACK');return NextResponse.json({error:'Staff accounts can only become active by accepting a valid invitation and setting a password.'},{status:409});}
  if(d.status!==undefined&&d.status!==current.status){await client.query('UPDATE public.staff_accounts SET status=$2,updated_at=now() WHERE id=$1',[id,d.status]);if(['suspended','revoked'].includes(d.status)){await client.query('UPDATE public.staff_sessions SET revoked_at=now() WHERE staff_id=$1 AND revoked_at IS NULL',[id]);}await client.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin','master-admin','staff.status_changed','staff',$1,$2::jsonb)",[id,JSON.stringify({from:current.status,to:d.status,email:current.email})]);}
  if(d.role!==undefined&&d.role!==current.role){await client.query('UPDATE public.staff_accounts SET role=$2,updated_at=now() WHERE id=$1',[id,d.role]);await client.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin','master-admin','staff.role_changed','staff',$1,$2::jsonb)",[id,JSON.stringify({from:current.role,to:d.role,email:current.email})]);}
  if(d.permissions!==undefined){for(const x of d.permissions){await client.query("INSERT INTO public.staff_account_permissions(staff_id,permission_key,enabled,granted_by,updated_at) VALUES($1,$2,$3,'master-admin',now()) ON CONFLICT(staff_id,permission_key) DO UPDATE SET enabled=EXCLUDED.enabled,granted_by=EXCLUDED.granted_by,updated_at=now()",[id,x.key,x.enabled]);}await client.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin','master-admin','staff.permissions_changed','staff',$1,$2::jsonb)",[id,JSON.stringify({permissions:d.permissions})]);}
  const out=await client.query("SELECT s.id,s.full_name,s.email,s.role,s.status,s.created_at,s.last_login_at,COALESCE((SELECT json_agg(json_build_object('permission_key',a.permission_key,'enabled',a.enabled) ORDER BY a.permission_key) FROM public.staff_account_permissions a WHERE a.staff_id=s.id),'[]'::json) permissions FROM public.staff_accounts s WHERE s.id=$1",[id]);
  await client.query('COMMIT');
  return NextResponse.json({staff:out.rows[0]},{headers:{'Cache-Control':'no-store'}});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Staff admin PATCH',e.code||e.message);return NextResponse.json({error:'Could not update staff account.'},{status:500});}
 finally{client.release();}
}
