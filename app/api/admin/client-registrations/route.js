import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {sendClientRegistrationEmail,escapeHtml} from '../../../../lib/client-registration-email';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
import {getStaffSession} from '../../../../lib/staff-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function tenantFor(req,pool,requested){
 await ensureSiteTenants(pool);
 const admin=await isAdminRequest(req);let id=requested;
 if(!admin){const staff=await getStaffSession(req);id=staff?.tenant_id;}else if(!id){const owner=await pool.query('SELECT id FROM public.site_tenants WHERE tenant_key=$1 LIMIT 1',['gbest']);id=owner.rows[0]?.id;}
 if(!/^\d+$/.test(String(id||'')))throw new Error('Choose a valid company workspace.');
 const q=await pool.query('SELECT id FROM public.site_tenants WHERE id=$1',[id]);
 if(!q.rowCount)throw new Error('Company workspace not found.');
 return {id:Number(q.rows[0].id),admin};
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,['clients.view','clients.manage','payments.review']))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const pool=getDatabasePool();await ensureSiteTenants(pool);
  const url=new URL(req.url),{id,admin}=await tenantFor(req,pool,url.searchParams.get('tenantId'));
  const q=await pool.query(`SELECT id,tenant_id,surname,other_names,address,email,phone,nationality,state_of_origin,lga,occupation,property_type,price_range,preferred_location,property_description,terms_accepted,fee_amount,payment_reference,receipt_name,receipt_type,payment_status,admin_note,created_at,
   COALESCE((SELECT json_agg(json_build_object('old_status',a.old_status,'new_status',a.new_status,'admin_note',a.admin_note,'changed_at',a.changed_at) ORDER BY a.changed_at DESC) FROM public.client_registration_audit a WHERE a.registration_id=public.client_registrations.id),'[]'::json) AS audit_history
   FROM public.client_registrations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 200`,[id]);
  const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[];
  return NextResponse.json({registrations:q.rows,tenants,activeTenantId:id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Client registrations admin GET',e.code||e.message);return NextResponse.json({error:e.message||'Could not load registrations'},{status:400});}
}
export async function PATCH(req){
 if(!await authorizeAdminRequest(req,'payments.review'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const d=await req.json();
  if(!/^[0-9a-f-]{36}$/i.test(String(d.id||''))||!['approved','rejected'].includes(d.payment_status))return NextResponse.json({error:'Invalid payment decision'},{status:400});
  const note=String(d.admin_note||'').trim().slice(0,1000),pool=getDatabasePool();await ensureSiteTenants(pool);
  const admin=await isAdminRequest(req),staff=admin?null:await getStaffSession(req),dbClient=await pool.connect();let q;
  try{
   await dbClient.query('BEGIN');
   const before=await dbClient.query('SELECT payment_status,client_status,registration_intent,tenant_id FROM public.client_registrations WHERE id=$1 FOR UPDATE',[d.id]);
   if(!before.rowCount){await dbClient.query('ROLLBACK');return NextResponse.json({error:'Registration not found'},{status:404});}
   if(!admin){
    if(Number(before.rows[0].tenant_id)!==Number(staff?.tenant_id)){await dbClient.query('ROLLBACK');return NextResponse.json({error:'You cannot review another company’s registration.'},{status:403});}
   }
   if(before.rows[0].payment_status!=='pending'){await dbClient.query('ROLLBACK');return NextResponse.json({error:'This registration has already been reviewed. Refresh the record; payment decisions cannot be overwritten.'},{status:409});}
   q=await dbClient.query(`UPDATE public.client_registrations SET payment_status=$2,client_status=CASE WHEN $2='approved' OR $5='active' THEN 'active' ELSE 'pending' END,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,approved_by=CASE WHEN $2='approved' THEN $4 ELSE NULL END,admin_note=$3,updated_at=now() WHERE id=$1 RETURNING id,tenant_id,client_id,payment_status,client_status,admin_note,updated_at`,[d.id,d.payment_status,note,admin?'master-admin':(staff?.email||'staff'),before.rows[0].client_status]);
   await dbClient.query('INSERT INTO public.client_registration_audit(registration_id,old_status,new_status,admin_note) VALUES($1,$2,$3,$4)',[d.id,before.rows[0].payment_status,d.payment_status,note]);
   await dbClient.query('COMMIT');
  }catch(txError){await dbClient.query('ROLLBACK').catch(()=>{});throw txError;}finally{dbClient.release();}
  const person=await pool.query('SELECT surname,other_names,email FROM public.client_registrations WHERE id=$1',[d.id]);
  const client=person.rows[0],approved=d.payment_status==='approved';
  const subject=approved?'Your G-BEST registration payment has been verified':'Update on your G-BEST registration payment';
  const body=approved?'Your bank transfer has been verified and your client registration is approved. You may now request property inspections using this same email address. Inspection requests remain subject to appointment confirmation.':'Our team could not approve the submitted payment at this time. Please contact G-BEST Luxury Realty with your transfer reference for clarification before making another payment.';
  const email=await sendClientRegistrationEmail({to:client.email,subject,html:'<p>Hello '+escapeHtml(client.surname+' '+client.other_names)+',</p><p>'+escapeHtml(body)+'</p><p>G-BEST Luxury Realty</p>'});
  return NextResponse.json({ok:true,registration:q.rows[0],emailSent:email.sent,warnings:email.sent?[]:['The payment decision was saved, but the client notification email could not be sent.']},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Client registration decision failed',e.code||e.message);return NextResponse.json({error:'Could not update payment status'},{status:500});}
}
