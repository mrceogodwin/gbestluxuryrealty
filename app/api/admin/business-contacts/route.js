import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function tenantFor(req){
 const host=req.headers.get('x-forwarded-host')||req.headers.get('host');
 return host?resolveSiteTenant(getDatabasePool(),host):null;
}
export async function GET(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Super Admin authentication is required.'},{status:403});
 try{
  const tenant=await tenantFor(req);if(!tenant)return NextResponse.json({error:'Workspace not found for this domain.'},{status:404});
  const q=await getDatabasePool().query(`SELECT id,full_name,email,phone,subject,message,status,admin_note,created_at,updated_at
   FROM public.business_contact_submissions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 300`,[tenant.id]);
  return NextResponse.json({submissions:q.rows,tenant:{id:tenant.id,name:tenant.display_name}},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Business contacts admin GET failed',e.code||e.message);return NextResponse.json({error:'Could not load business contacts.'},{status:500});}
}
export async function PATCH(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Super Admin authentication is required.'},{status:403});
 try{
  const tenant=await tenantFor(req);if(!tenant)return NextResponse.json({error:'Workspace not found for this domain.'},{status:404});
  const d=await req.json(),id=String(d?.id||''),status=String(d?.status||''),note=String(d?.admin_note||'').trim().slice(0,2000);
  if(!/^[0-9a-f-]{36}$/i.test(id)||!['new','in_progress','responded','closed'].includes(status))return NextResponse.json({error:'Invalid contact update.'},{status:400});
  const q=await getDatabasePool().query('UPDATE public.business_contact_submissions SET status=$3,admin_note=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,status,admin_note,updated_at',[id,tenant.id,status,note||null]);
  if(!q.rowCount)return NextResponse.json({error:'Contact message not found in this workspace.'},{status:404});
  return NextResponse.json({ok:true,submission:q.rows[0]},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Business contacts admin PATCH failed',e.code||e.message);return NextResponse.json({error:'Could not update contact message.'},{status:500});}
}
