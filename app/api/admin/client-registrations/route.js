import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import { sendClientRegistrationEmail, escapeHtml } from '../../../../lib/client-registration-email';
export const runtime='nodejs'; export const dynamic='force-dynamic';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession,hasStaffPermission} from '../../../../lib/staff-auth';
async function ready(pool){await pool.query(`CREATE TABLE IF NOT EXISTS public.client_registrations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), surname varchar(100) NOT NULL, other_names varchar(160) NOT NULL,
 address text NOT NULL,email varchar(254) NOT NULL,phone varchar(40) NOT NULL,nationality varchar(80) NOT NULL,
 state_of_origin varchar(100) NOT NULL,lga varchar(100) NOT NULL,occupation varchar(120) NOT NULL,
 property_type varchar(100) NOT NULL,price_range varchar(160) NOT NULL,preferred_location varchar(180) NOT NULL,
 property_description text,terms_accepted boolean NOT NULL DEFAULT false,fee_amount numeric(12,2),payment_reference varchar(120),
 receipt_name varchar(255),receipt_type varchar(100),receipt_data bytea,payment_status varchar(24) NOT NULL DEFAULT 'pending',
 admin_note text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`);await pool.query(`ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS full_name varchar(260), ADD COLUMN IF NOT EXISTS client_id varchar(40), ADD COLUMN IF NOT EXISTS email_normalized varchar(254), ADD COLUMN IF NOT EXISTS registration_fee_kobo bigint, ADD COLUMN IF NOT EXISTS client_status varchar(24) NOT NULL DEFAULT 'pending', ADD COLUMN IF NOT EXISTS approved_at timestamptz, ADD COLUMN IF NOT EXISTS approved_by varchar(120), ADD COLUMN IF NOT EXISTS fee_amount numeric(12,2), ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);await pool.query(`CREATE TABLE IF NOT EXISTS public.client_registration_audit (id bigserial PRIMARY KEY,registration_id uuid NOT NULL REFERENCES public.client_registrations(id) ON DELETE CASCADE,old_status varchar(24),new_status varchar(24) NOT NULL,admin_note text,actor_type varchar(24) NOT NULL DEFAULT 'legacy_unknown',actor_email varchar(254) NOT NULL DEFAULT 'unknown',actor_staff_id uuid,changed_at timestamptz NOT NULL DEFAULT now())`);await pool.query(`ALTER TABLE public.client_registration_audit ADD COLUMN IF NOT EXISTS actor_type varchar(24) NOT NULL DEFAULT 'legacy_unknown', ADD COLUMN IF NOT EXISTS actor_email varchar(254) NOT NULL DEFAULT 'unknown', ADD COLUMN IF NOT EXISTS actor_staff_id uuid`);await pool.query(`ALTER TABLE public.client_registrations ALTER COLUMN approved_by TYPE varchar(254)`);}
export async function GET(req){
 let staff=null;
 const isSuperAdmin=await isAdminRequest(req);
 if(!isSuperAdmin){
  staff=await getStaffSession(req);
  if(!staff)return NextResponse.json({error:'Unauthorized'},{status:401});
 }
 try{
  const canReviewPayments=!isSuperAdmin&&await hasStaffPermission(staff,'payments.review');
  const canViewClientProfiles=isSuperAdmin||(await hasStaffPermission(staff,'clients.view'))||(await hasStaffPermission(staff,'clients.manage'));
  if(!isSuperAdmin&&!canReviewPayments&&!canViewClientProfiles)return NextResponse.json({error:'Unauthorized'},{status:401});
  const pool=getDatabasePool();await ready(pool);
  const auditSelect=`COALESCE((SELECT json_agg(json_build_object('old_status',a.old_status,'new_status',a.new_status,'admin_note',a.admin_note,'actor_type',a.actor_type,'actor_email',a.actor_email,'changed_at',a.changed_at) ORDER BY a.changed_at DESC) FROM public.client_registration_audit a WHERE a.registration_id=public.client_registrations.id),'[]'::json) AS audit_history`;
  const canViewPaymentDetails=isSuperAdmin||canReviewPayments;
  const fields=isSuperAdmin
   ? `id,surname,other_names,address,email,phone,nationality,state_of_origin,lga,occupation,property_type,price_range,preferred_location,property_description,terms_accepted,fee_amount,payment_reference,receipt_name,receipt_type,payment_status,admin_note,approved_by,approved_at,created_at,${auditSelect}`
   : canReviewPayments
     ? `id,COALESCE(full_name,concat_ws(' ',surname,other_names)) AS full_name,surname,other_names,email,fee_amount,payment_reference,receipt_name,receipt_type,payment_status,admin_note,approved_by,approved_at,created_at,${auditSelect}`
     : `id,surname,other_names,address,email,phone,nationality,state_of_origin,lga,occupation,property_type,price_range,preferred_location,property_description,terms_accepted,created_at`;
  const q=await pool.query(`SELECT ${fields} FROM public.client_registrations ORDER BY created_at DESC LIMIT 200`);
  return NextResponse.json({registrations:q.rows,canReviewPayments:canViewPaymentDetails,paymentReviewerView:!isSuperAdmin&&canReviewPayments},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Client registrations admin GET',e.code||e.message);return NextResponse.json({error:'Could not load registrations'},{status:500});}
}
export async function PATCH(req){if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin'},{status:403});if(!await authorizeAdminRequest(req,'payments.review'))return NextResponse.json({error:'Unauthorized'},{status:401});try{const d=await req.json();if(!/^[0-9a-f-]{36}$/i.test(String(d.id||''))||!['approved','rejected'].includes(d.payment_status))return NextResponse.json({error:'Invalid payment decision'},{status:400});const note=String(d.admin_note||'').trim().slice(0,1000);const isSuperAdmin=await isAdminRequest(req);const staff=isSuperAdmin?null:await getStaffSession(req);if(!isSuperAdmin&&!staff)return NextResponse.json({error:'Unauthorized'},{status:401});const actorType=isSuperAdmin?'super_admin':'staff';const actorEmail=staff?.email||'master-admin';const actorStaffId=staff?.id||null;const pool=getDatabasePool();await ready(pool);const dbClient=await pool.connect();let q;try{await dbClient.query('BEGIN');const before=await dbClient.query('SELECT payment_status FROM public.client_registrations WHERE id=$1 FOR UPDATE',[d.id]);if(!before.rowCount){await dbClient.query('ROLLBACK');return NextResponse.json({error:'Registration not found'},{status:404});}if(before.rows[0].payment_status!=='pending'){await dbClient.query('ROLLBACK');return NextResponse.json({error:'This registration has already been reviewed. Refresh the record; payment decisions cannot be overwritten.'},{status:409});}q=await dbClient.query(`UPDATE public.client_registrations SET payment_status=$2,client_status=CASE WHEN $2='approved' THEN 'active' ELSE 'pending' END,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,approved_by=CASE WHEN $2='approved' THEN $4 ELSE NULL END,admin_note=$3,updated_at=now() WHERE id=$1 RETURNING id,client_id,payment_status,client_status,admin_note,approved_by,approved_at,updated_at`,[d.id,d.payment_status,note,actorEmail]);await dbClient.query('INSERT INTO public.client_registration_audit(registration_id,old_status,new_status,admin_note,actor_type,actor_email,actor_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[d.id,before.rows[0].payment_status,d.payment_status,note,actorType,actorEmail,actorStaffId]);await dbClient.query('COMMIT');}catch(txError){await dbClient.query('ROLLBACK').catch(()=>{});throw txError;}finally{dbClient.release();}
const person=await pool.query('SELECT surname,other_names,email FROM public.client_registrations WHERE id=$1',[d.id]);
const client=person.rows[0];
const approved=d.payment_status==='approved';
const subject=approved?'Your G-BEST registration payment has been verified':'Update on your G-BEST registration payment';
const body=approved?'Your bank transfer has been verified and your client registration is approved. You may now request property inspections using this same email address. Inspection requests remain subject to appointment confirmation.':'Our team could not approve the submitted payment at this time. Please contact G-BEST Luxury Realty with your transfer reference for clarification before making another payment.';
const email=await sendClientRegistrationEmail({to:client.email,subject,html:'<p>Hello '+escapeHtml(client.surname+' '+client.other_names)+',</p><p>'+escapeHtml(body)+'</p><p>G-BEST Luxury Realty</p>'});
return NextResponse.json({ok:true,registration:q.rows[0],emailSent:email.sent,warnings:email.sent?[]:['The payment decision was saved, but the client notification email could not be sent.']},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error('Client registration decision failed',e.code||e.message);return NextResponse.json({error:'Could not update payment status'},{status:500});}}
