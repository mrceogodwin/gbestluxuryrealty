import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { queueInspectionEmails, deliverInspectionEmails } from '../../../lib/inspection-email-outbox';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=globalThis.__gbestPool||(globalThis.__gbestPool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}}));
const times=['09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00'];
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function POST(req){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'Booking is temporarily unavailable.'},{status:503});
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  let d;try{d=await req.json()}catch{return NextResponse.json({error:'Invalid request body. Send valid JSON and try again.'},{status:400});}
  if(!d||typeof d!=='object'||Array.isArray(d))return NextResponse.json({error:'Invalid request body.'},{status:400});
  const name=String(d.name||'').trim(),contact=String(d.contact||'').trim(),email=String(d.clientEmail||'').trim(),date=String(d.preferredDate||''),time=String(d.preferredTime||''),pid=String(d.propertyId||''),message=String(d.message||'').trim();
  if(name.length<2||name.length>120||contact.length<5||contact.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!times.includes(time)||!/^(?:gb-00[1-8]|[1-9][0-9]*|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(pid)||message.length>2000)return NextResponse.json({error:'Check your details and choose a valid inspection time.'},{status:400});
  const when=new Date(date+'T'+time+':00+01:00');if(Number.isNaN(when.getTime())||when.toISOString().slice(0,10)!==date||when.getTime()<Date.now())return NextResponse.json({error:'Choose a future date and time.'},{status:400});
  // Demo cards are for presentation only and must never create real inspection records.
  if(/^gb-00[1-8]$/.test(pid))return NextResponse.json({error:'This is a sample property, not a live listing. Please choose a published property before requesting an inspection.'},{status:400});
  let propertyLabel=pid;
  const listing=await pool.query("SELECT id,title FROM public.properties WHERE status IN ('published','available') AND (id::text=$1 OR slug=$1) LIMIT 1",[pid]);
  if(!listing.rowCount)return NextResponse.json({error:'That property is no longer available. Refresh the listings and try again.'},{status:400});
  propertyLabel=listing.rows[0].title;
  const q=await pool.query("INSERT INTO public.inspection_requests(full_name,contact,client_email,preferred_date,preferred_time,preference,duration_minutes,property_id,message,status,client_timezone) VALUES($1,$2,$3,$4::date,$5::time,'physical_inspection',30,$6,$7,'pending','Africa/Lagos') RETURNING id",[name,contact,email,date,time,pid,message]);
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