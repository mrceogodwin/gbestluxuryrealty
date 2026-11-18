import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getDatabasePool } from '../../../lib/db';
import { queueInspectionEmails, deliverInspectionEmails } from '../../../lib/inspection-email-outbox';
import {getSchedule,slotIsAvailable,validClock} from '../../../lib/inspection-schedule';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';

const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function POST(req){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'Booking is temporarily unavailable.'},{status:503});
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body. Send valid JSON and try again.'},{status:400});}
  if(!d||typeof d!=='object'||Array.isArray(d))return NextResponse.json({error:'Invalid request body.'},{status:400});
  let name=String(d.name||'').trim(),contact=String(d.contact||'').trim();const email=String(d.clientEmail||'').trim(),date=String(d.preferredDate||''),time=String(d.preferredTime||''),pid=String(d.propertyId||'').trim().toUpperCase(),message=String(d.message||'').trim();
  if(name.length<2||name.length>120||contact.length<5||contact.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!validClock(time)||!/^GB-[A-Z0-9]{8}$/.test(pid)||message.length>2000)return NextResponse.json({error:'Check your details and choose a valid inspection time.'},{status:400});
  const pool=getDatabasePool();const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';const tenant=await resolveSiteTenant(pool,host);if(!tenant)return NextResponse.json({error:'This domain is not connected to an active company workspace.'},{status:404});
  const when=new Date(date+'T'+time+':00+01:00');const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(Number.isNaN(when.getTime())||when.toISOString().slice(0,10)!==date||when.getTime()<Date.now())return NextResponse.json({error:'Choose a future date and time.'},{status:400});const schedule=await getSchedule(tenant.id);let slotAvailable=false;try{slotAvailable=await slotIsAvailable(date,time,schedule,undefined,tenant.id)}catch(e){return NextResponse.json({error:e.message||'Could not verify inspection availability. Please try again later.'},{status:503})}if(!slotAvailable)return NextResponse.json({error:'That date or time is not available in this company’s current schedule. Please choose one of the available slots.'},{status:409});
  // Demo cards are for presentation only and must never create real inspection records.
  if(/^GB-00[1-8]$/.test(pid))return NextResponse.json({error:'This is a sample property, not a live listing. Please choose a published property before requesting an inspection.'},{status:400});
  // Require a real, active client session as well as manual payment approval.
  // A submitted email address alone must never authorize an inspection booking.
  const sessionToken=req.cookies.get('gbest_client_session')?.value;
  if(!sessionToken)return NextResponse.json({error:'Please sign in with your approved G-BEST client account before booking an inspection.'},{status:401});
  const session=await pool.query("SELECT r.id,r.email,r.full_name,r.phone FROM public.client_sessions s JOIN public.client_registrations r ON r.id::text=s.registration_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND r.payment_status='approved' AND r.client_status='active' AND r.tenant_id=$2 LIMIT 1",[createHash('sha256').update(sessionToken).digest('hex'),tenant.id]);
  if(!session.rowCount)return NextResponse.json({error:'Your client session is expired or your registration/payment is not approved. Please sign in again after approval.'},{status:401});
  if(session.rows[0].email.toLowerCase()!==email.toLowerCase())return NextResponse.json({error:'The booking email must match your approved client account.'},{status:403});
  // Identity and contact details must come from the approved registration, never the browser payload.
  name=String(session.rows[0].full_name||'').trim();
  contact=String(session.rows[0].phone||'').trim();
  if(name.length<2||name.length>120||contact.length<5||contact.length>160)return NextResponse.json({error:'Your approved client profile is missing a valid name or phone number. Contact G-BEST to update it before booking.'},{status:409});
  const registration={rows:[{id:session.rows[0].id}]};
  let propertyLabel=pid;
  const listing=await pool.query(`SELECT id,title,description FROM public.properties
    WHERE tenant_id=$2 AND status IN ('published','available')
      AND ('GB-' || CASE
        WHEN id::text ~ '^[0-9]+$' THEN lpad(id::text,8,'0')
        ELSE right(upper(replace(id::text,'-','')),8)
      END)=$1
    LIMIT 1`,[pid,tenant.id]);
  if(!listing.rowCount)return NextResponse.json({error:'That property is no longer available. Refresh the listings and try again.'},{status:400});
  if(/sample showcase listing|illustrative|design preview/i.test(String(listing.rows[0].description||'')))return NextResponse.json({error:'This is a demonstration listing and cannot be booked. Please choose a verified G-BEST property.'},{status:400});
  propertyLabel=listing.rows[0].title;
  const client=await pool.connect();
  let q;
  try {
   await client.query('BEGIN');
   // Serialize requests for the same local date and start time, then re-check
   // the full interval inside the transaction before inserting.
   await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('inspection-booking'))",[date]);
   const duration=Number(schedule.slotMinutes);
   const overlap=await client.query(`SELECT 1 FROM public.inspection_requests
     WHERE tenant_id=$4 AND preferred_date=$1::date AND status IN ('pending','confirmed')
       AND preferred_time < ($2::time + ($3 * interval '1 minute'))
       AND (preferred_time + (COALESCE(duration_minutes,30) * interval '1 minute')) > $2::time
     LIMIT 1`,[date,time,duration,tenant.id]);
   if(overlap.rowCount) {
    await client.query('ROLLBACK');
    return NextResponse.json({error:'That inspection slot has just been taken. Please choose another available time.'},{status:409});
   }
   q=await client.query("INSERT INTO public.inspection_requests(tenant_id,full_name,contact,client_email,preferred_date,preferred_time,preference,duration_minutes,property_id,message,status,client_timezone,client_registration_id) VALUES($1,$2,$3,$4,$5::date,$6::time,'physical_inspection',$7,$8,$9,'pending','Africa/Lagos',$10) RETURNING id",[tenant.id,name,contact,email,date,time,duration,String(listing.rows[0].id),message,registration.rows[0].id]);
   await client.query('COMMIT');
  } catch(insertError) {
   await client.query('ROLLBACK').catch(()=>{});
   throw insertError;
  } finally { client.release(); }
  const warnings=[];
  let emailResult={sent:0,failed:0,skipped:0};
  try {
   await queueInspectionEmails([
    {requestId:q.rows[0].id,type:'admin',to:process.env.ADMIN_EMAIL,subject:'New inspection request — '+name,html:'<p>New physical inspection request from '+safe(name)+' ('+safe(contact)+').</p><p>Property: '+safe(propertyLabel)+'<br/>Requested slot: '+safe(date)+' '+safe(time)+' WAT</p><p>Status: pending admin approval.</p>'},
    {requestId:q.rows[0].id,type:'client',to:email,subject:'We received your G-BEST inspection request',html:'<p>Hello '+safe(name)+',</p><p>We received your physical inspection request for '+safe(propertyLabel)+' on '+safe(date)+' at '+safe(time)+' WAT.</p><p>This is a request only and is not yet confirmed. Our team will contact you after review.</p>'}
   ]);
   emailResult=await deliverInspectionEmails(q.rows[0].id);
   if(emailResult.failed||emailResult.skipped)warnings.push('One or more emails are queued for retry.');
  } catch(notificationError) {
   console.error('Inspection request saved but email queueing failed',notificationError.code||notificationError.message);
   warnings.push('Your inspection request was saved, but email notifications could not be queued. Please contact our team if you do not hear back.');
  }
  return NextResponse.json({ok:true,requestId:q.rows[0].id,status:'pending',email:emailResult,warnings},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('inspection API failure',e.code||e.message);if(e.code==='23505')return NextResponse.json({error:'That slot is already held by another request. Please choose another.'},{status:409});return NextResponse.json({error:'Unable to submit right now. Please try again.'},{status:500});}
}