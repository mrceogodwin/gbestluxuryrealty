import { NextResponse } from 'next/server';
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import { getDatabasePool } from '../../../lib/db';
import { queueInspectionEmails, deliverInspectionEmails } from '../../../lib/inspection-email-outbox';
import {getSchedule,slotIsAvailable,validClock} from '../../../lib/inspection-schedule';
export const runtime='nodejs';
export const dynamic='force-dynamic';

const RATE_WINDOW_MINUTES=15,IP_LIMIT=8,EMAIL_LIMIT=4;
function rateKey(scope,value){const secret=process.env.ADMIN_SECRET||process.env.DATABASE_URL;if(!secret)throw new Error('Rate limiting is not configured.');return createHmac('sha256',secret).update(scope+':'+value).digest('hex');}
async function consumeBookingLimit(pool,key,limit){
 await pool.query("CREATE TABLE IF NOT EXISTS public.inspection_booking_rate_limits(attempt_key text PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,window_started_at timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now())");
 const q=await pool.query("INSERT INTO public.inspection_booking_rate_limits AS booking_limit(attempt_key,attempts,window_started_at,blocked_until,updated_at) VALUES($1,1,now(),NULL,now()) ON CONFLICT(attempt_key) DO UPDATE SET attempts=CASE WHEN booking_limit.window_started_at<now()-($3 * interval '1 minute') THEN 1 ELSE booking_limit.attempts+1 END,window_started_at=CASE WHEN booking_limit.window_started_at<now()-($3 * interval '1 minute') THEN now() ELSE booking_limit.window_started_at END,blocked_until=CASE WHEN (CASE WHEN booking_limit.window_started_at<now()-($3 * interval '1 minute') THEN 1 ELSE booking_limit.attempts+1 END)>$2 THEN now()+interval '15 minutes' ELSE NULL END,updated_at=now() RETURNING attempts,blocked_until",[key,limit,RATE_WINDOW_MINUTES]);
 return Boolean(q.rows[0]?.blocked_until);
}
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function POST(req){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'Booking is temporarily unavailable.'},{status:503});
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body. Send valid JSON and try again.'},{status:400});}
  if(!d||typeof d!=='object'||Array.isArray(d))return NextResponse.json({error:'Invalid request body.'},{status:400});
  const name=String(d.name||'').trim(),contact=String(d.contact||'').trim(),email=String(d.clientEmail||'').trim(),date=String(d.preferredDate||''),time=String(d.preferredTime||''),pid=String(d.propertyId||'').trim().toUpperCase(),message=String(d.message||'').trim();
  if(name.length<2||name.length>120||contact.length<5||contact.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!validClock(time)||!/^GB-[A-Z0-9]{8}$/.test(pid)||message.length>2000)return NextResponse.json({error:'Check your details and choose a valid inspection time.'},{status:400});
  const when=new Date(date+'T'+time+':00+01:00');const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(Number.isNaN(when.getTime())||when.toISOString().slice(0,10)!==date||when.getTime()<Date.now())return NextResponse.json({error:'Choose a future date and time.'},{status:400});const schedule=await getSchedule();let slotAvailable=false;try{slotAvailable=await slotIsAvailable(date,time,schedule)}catch(e){return NextResponse.json({error:e.message||'Could not verify G-BEST availability. Please try again later.'},{status:503})}if(!slotAvailable)return NextResponse.json({error:'That date or time is not available in G-BEST’s current schedule. Please choose one of the available slots.'},{status:409});
  // Demo cards are for presentation only and must never create real inspection records.
  if(/^GB-00[1-8]$/.test(pid))return NextResponse.json({error:'This is a sample property, not a live listing. Please choose a published property before requesting an inspection.'},{status:400});
  const pool=getDatabasePool();
  const forwarded=req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-real-ip')||'';
  let ip=forwarded.split(',')[0]?.trim()||'unknown';
  if(ip.startsWith('[')&&ip.endsWith(']'))ip=ip.slice(1,-1);
  if(!isIP(ip))ip='unknown';
  const ipKey=rateKey('inspection-ip',ip),emailKey=rateKey('inspection-email',email.toLowerCase());
  if(await consumeBookingLimit(pool,ipKey,IP_LIMIT)||await consumeBookingLimit(pool,emailKey,EMAIL_LIMIT))return NextResponse.json({error:'Too many inspection requests. Please wait before trying again.'},{status:429});
  // Only clients whose manual bank transfer has been checked and approved
  // by G-BEST staff may request an inspection.
  const registrationTable=await pool.query("SELECT to_regclass('public.client_registrations') AS table_name");
  if(!registrationTable.rows[0]?.table_name)return NextResponse.json({error:'Complete client registration and payment verification before requesting an inspection.'},{status:403});
  const registration=await pool.query("SELECT id,payment_status FROM public.client_registrations WHERE lower(email)=lower($1) ORDER BY updated_at DESC,created_at DESC LIMIT 1",[email]);
  if(!registration.rowCount||registration.rows[0].payment_status!=='approved')return NextResponse.json({error:'Your client registration or payment is not yet approved. Please complete registration and wait for G-BEST to verify your bank transfer before booking an inspection.'},{status:403});
  let propertyLabel=pid;
  const listing=await pool.query(`SELECT id,title FROM public.properties
    WHERE status IN ('published','available')
      AND ('GB-' || CASE
        WHEN id::text ~ '^[0-9]+$' THEN lpad(id::text,8,'0')
        ELSE right(upper(replace(id::text,'-','')),8)
      END)=$1
    LIMIT 1`,[pid]);
  if(!listing.rowCount)return NextResponse.json({error:'That property is no longer available. Refresh the listings and try again.'},{status:400});
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
     WHERE preferred_date=$1::date AND status IN ('pending','confirmed')
       AND preferred_time < ($2::time + ($3 * interval '1 minute'))
       AND (preferred_time + (COALESCE(duration_minutes,30) * interval '1 minute')) > $2::time
     LIMIT 1`,[date,time,duration]);
   if(overlap.rowCount) {
    await client.query('ROLLBACK');
    return NextResponse.json({error:'That inspection slot has just been taken. Please choose another available time.'},{status:409});
   }
   q=await client.query("INSERT INTO public.inspection_requests(full_name,contact,client_email,preferred_date,preferred_time,preference,duration_minutes,property_id,message,status,client_timezone) VALUES($1,$2,$3,$4::date,$5::time,'physical_inspection',$6,$7,$8,'pending','Africa/Lagos') RETURNING id",[name,contact,email,date,time,duration,String(listing.rows[0].id),message]);
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