import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../lib/db';
import {getSchedule,slotIsAvailable,validClock} from '../../../lib/inspection-schedule';
export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(req){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'Booking is temporarily unavailable.'},{status:503});
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body. Send valid JSON and try again.'},{status:400});}
  if(!d||typeof d!=='object'||Array.isArray(d))return NextResponse.json({error:'Invalid request body.'},{status:400});
  const name=String(d.name||'').trim(),contact=String(d.contact||'').trim(),email=String(d.clientEmail||'').trim(),date=String(d.preferredDate||''),time=String(d.preferredTime||''),pid=String(d.propertyId||'').trim().toUpperCase(),message=String(d.message||'').trim();
  if(name.length<2||name.length>120||contact.length<5||contact.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!validClock(time)||!/^GB-[A-Z0-9]{8}$/.test(pid)||message.length>2000)return NextResponse.json({error:'Check your details and choose a valid inspection time.'},{status:400});
  const when=new Date(date+'T'+time+':00+01:00');const weekday=new Date(date+'T12:00:00Z').getUTCDay();if(Number.isNaN(when.getTime())||when.toISOString().slice(0,10)!==date||when.getTime()<Date.now())return NextResponse.json({error:'Choose a future date and time.'},{status:400});const schedule=await getSchedule();let slotAvailable=false;try{slotAvailable=await slotIsAvailable(date,time,schedule)}catch(e){return NextResponse.json({error:e.message||'Could not verify G-BEST availability. Please try again later.'},{status:503})}if(!slotAvailable)return NextResponse.json({error:'That date or time is not available in G-BEST’s current schedule. Please choose one of the available slots.'},{status:409});
  // Demo cards are for presentation only and must never create real inspection records.
  if(/^GB-00[1-8]$/.test(pid))return NextResponse.json({error:'This is a sample property, not a live listing. Please choose a published property before requesting an inspection.'},{status:400});
  const pool=getDatabasePool();
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
  return NextResponse.json({ok:true,requestId:q.rows[0].id,status:'pending',message:'Inspection request received. It is now in the Super Admin booking inbox and is awaiting review.'},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('inspection API failure',e.code||e.message);if(e.code==='23505')return NextResponse.json({error:'That slot is already held by another request. Please choose another.'},{status:409});return NextResponse.json({error:'Unable to submit right now. Please try again.'},{status:500});}
}