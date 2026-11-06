import { NextResponse } from 'next/server';
import { AwsClient } from 'aws4fetch';
import { randomUUID } from 'node:crypto';
import { getDatabasePool } from '../../../../lib/db';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_BYTES=5*1024*1024;
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'};
function storage(){
 const e=process.env;
 if(!e.AWS_ACCESS_KEY_ID||!e.AWS_SECRET_ACCESS_KEY||!e.AWS_ENDPOINT_URL_S3)throw new Error('Private receipt storage is not configured.');
 return {client:new AwsClient({accessKeyId:e.AWS_ACCESS_KEY_ID,secretAccessKey:e.AWS_SECRET_ACCESS_KEY,service:'s3',region:e.AWS_REGION||'eu-central-1'}),endpoint:e.AWS_ENDPOINT_URL_S3.replace(/\/$/,'')};
}
function validFile(type,b){
 if(type==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
 if(type==='image/png')return b.length>8&&b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71;
 if(type==='image/webp')return String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
 if(type==='application/pdf')return String.fromCharCode(...b.slice(0,5))==='%PDF-';
 return false;
}
const clean=(v,n)=>String(v??'').trim().slice(0,n);
async function sendEmail(to,subject,html){
 if(!to||!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)return false;
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[to],subject,html})});
 if(!r.ok)throw new Error('Email delivery failed: '+r.status);
 return true;
}
export async function POST(req){
 let key=null;
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const form=await req.formData();
  const name=clean(form.get('full_name'),120),email=clean(form.get('email'),254).toLowerCase(),phone=clean(form.get('phone'),40);
  const reference=clean(form.get('bank_reference'),100),transferDate=clean(form.get('transfer_date'),10);
  const file=form.get('receipt');
  if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||phone.length<7||reference.length<3||!/^\d{4}-\d{2}-\d{2}$/.test(transferDate))return NextResponse.json({error:'Complete your name, valid email, phone, transfer reference and transfer date.'},{status:400});
  if(!file||typeof file.arrayBuffer!=='function')return NextResponse.json({error:'Upload your payment receipt.'},{status:400});
  const mime=String(file.type||'').toLowerCase(),ext=TYPES[mime];
  if(!ext||file.size<1||file.size>MAX_BYTES)return NextResponse.json({error:'Receipt must be JPG, PNG, WebP or PDF, up to 5 MB.'},{status:400});
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(!validFile(mime,bytes))return NextResponse.json({error:'Receipt file content does not match its file type.'},{status:400});
  const pool=getDatabasePool();
  const {client,endpoint}=storage();
  const id=randomUUID(); key='registrations/'+id+'/'+randomUUID()+'.'+ext;
  const uploaded=await client.fetch(endpoint+'/payment-receipts/'+key.split('/').map(encodeURIComponent).join('/'),{method:'PUT',headers:{'content-type':mime},body:bytes});
  if(!uploaded.ok)throw new Error('Receipt upload failed: '+uploaded.status);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const reg=await db.query(`INSERT INTO public.client_registrations(full_name,email,email_normalized,phone,payment_status,client_status) VALUES($1,$2,$3,$4,'submitted','pending') RETURNING id`,[name,email,email,phone]);
   await db.query(`INSERT INTO public.registration_payment_submissions(registration_id,amount_kobo,bank_reference,transfer_date,receipt_object_key,receipt_mime_type,receipt_size_bytes) VALUES($1,1500000,$2,$3::date,$4,$5,$6)`,[reg.rows[0].id,reference,transferDate,key,mime,file.size]);
   await db.query(`INSERT INTO public.registration_payment_events(registration_id,event_type,actor,note) VALUES($1,'payment_submitted','client',$2)`,[reg.rows[0].id,'Receipt submitted; awaiting manual verification.']);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
  const html='<p>New G-BEST client registration and manual payment receipt submitted.</p><p><b>Client:</b> '+name+'<br/><b>Email:</b> '+email+'<br/><b>Phone:</b> '+phone+'<br/><b>Amount:</b> ₦15,000<br/><b>Transfer reference:</b> '+reference+'<br/><b>Transfer date:</b> '+transferDate+'</p><p>Open the Super Admin dashboard to review the receipt. Payment remains pending until verified.</p>';
  let adminNotified=false,clientNotified=false;
  try{adminNotified=await sendEmail(process.env.ADMIN_EMAIL,'G-BEST: payment receipt awaiting verification',html);}catch(e){console.error('Registration admin email failed',e.message);}
  try{clientNotified=await sendEmail(email,'G-BEST received your registration submission','<p>Hello '+name+',</p><p>We received your registration and payment receipt. Your status is pending manual verification. Uploading a receipt is not payment approval.</p>');}catch(e){console.error('Registration client email failed',e.message);}
  return NextResponse.json({ok:true,status:'pending',message:'Registration submitted. Your payment is awaiting manual verification.',adminNotified,clientNotified},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){
  if(key){try{const {client,endpoint}=storage();await client.fetch(endpoint+'/payment-receipts/'+key.split('/').map(encodeURIComponent).join('/'),{method:'DELETE'});}catch{}}
  if(e.code==='23505')return NextResponse.json({error:'This email or bank transfer reference has already been submitted. Contact G-BEST if you believe this is an error.'},{status:409});
  console.error('Client registration submission failed',e.code||e.message);
  return NextResponse.json({error:'We could not submit your registration. Please try again or contact G-BEST.'},{status:500});
 }
}