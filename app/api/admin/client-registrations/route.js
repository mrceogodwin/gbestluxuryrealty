import { NextResponse } from 'next/server';
import { AwsClient } from 'aws4fetch';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const safe=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));
function auth(req){return Boolean(process.env.ADMIN_SECRET)&&req.headers.get('authorization')==='Bearer '+process.env.ADMIN_SECRET;}
function storage(){const e=process.env;if(!e.AWS_ACCESS_KEY_ID||!e.AWS_SECRET_ACCESS_KEY||!e.AWS_ENDPOINT_URL_S3)throw new Error('Private receipt storage is not configured.');return {client:new AwsClient({accessKeyId:e.AWS_ACCESS_KEY_ID,secretAccessKey:e.AWS_SECRET_ACCESS_KEY,service:'s3',region:e.AWS_REGION||'eu-central-1'}),endpoint:e.AWS_ENDPOINT_URL_S3.replace(/\/$/,'')};}
async function receiptUrl(key){const {client,endpoint}=storage();const url=endpoint+'/payment-receipts/'+key.split('/').map(encodeURIComponent).join('/');const signed=await client.sign(url,{method:'GET',aws:{signQuery:true},headers:{}});return signed.url;}
export async function GET(req){
 if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const q=await getDatabasePool().query(`SELECT r.id AS registration_id,r.full_name,r.email,r.phone,r.payment_status,r.client_status,r.created_at AS registered_at,p.id AS payment_id,p.amount_kobo,p.bank_reference,p.transfer_date,p.receipt_object_key,p.receipt_mime_type,p.receipt_size_bytes,p.status AS submission_status,p.submitted_at,p.reviewed_at,p.reviewed_by,p.review_note FROM public.client_registrations r LEFT JOIN LATERAL (SELECT * FROM public.registration_payment_submissions x WHERE x.registration_id=r.id ORDER BY x.submitted_at DESC LIMIT 1) p ON true ORDER BY r.created_at DESC LIMIT 200`);
  const registrations=await Promise.all(q.rows.map(async row=>({...row,receipt_url:row.receipt_object_key?await receiptUrl(row.receipt_object_key):null,amount_naira:Number(row.amount_kobo||0)/100})));
  return NextResponse.json({registrations},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Admin registrations list failed',e.code||e.message);return NextResponse.json({error:'Could not load registrations.'},{status:500});}
}
export async function PATCH(req){
 if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 let d;try{d=await req.json();}catch{return NextResponse.json({error:'Invalid JSON.'},{status:400});}
 const id=String(d?.payment_id||''),action=String(d?.action||''),note=String(d?.note||'').trim().slice(0,1000);
 if(!/^[0-9a-f-]{36}$/i.test(id)||!['approve','reject'].includes(action))return NextResponse.json({error:'Invalid review action.'},{status:400});
 const pool=getDatabasePool(),db=await pool.connect();
 try{
  await db.query('BEGIN');
  const q=await db.query(`SELECT p.id,p.registration_id,p.status,r.email,r.full_name FROM public.registration_payment_submissions p JOIN public.client_registrations r ON r.id=p.registration_id WHERE p.id=$1 FOR UPDATE OF p,r`,[id]);
  if(!q.rowCount){await db.query('ROLLBACK');return NextResponse.json({error:'Payment submission not found.'},{status:404});}
  const row=q.rows[0];
  if(row.status!=='pending'){await db.query('ROLLBACK');return NextResponse.json({error:'This payment has already been reviewed.'},{status:409});}
  const status=action==='approve'?'approved':'rejected';
  await db.query(`UPDATE public.registration_payment_submissions SET status=$2,reviewed_at=now(),reviewed_by=$3,review_note=$4 WHERE id=$1`,[id,status,process.env.ADMIN_EMAIL||'Super Admin',note||null]);
  await db.query(`UPDATE public.client_registrations SET payment_status=$2,client_status=$3,approved_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,approved_by=CASE WHEN $2='approved' THEN $4 ELSE NULL END,admin_note=$5,updated_at=now() WHERE id=$1`,[row.registration_id,status,action==='approve'?'active':'rejected',process.env.ADMIN_EMAIL||'Super Admin',note||null]);
  await db.query(`INSERT INTO public.registration_payment_events(registration_id,payment_submission_id,event_type,actor,note) VALUES($1,$2,$3,$4,$5)`,[row.registration_id,id,'payment_'+status,process.env.ADMIN_EMAIL||'Super Admin',note||null]);
  await db.query('COMMIT');
  let emailSent=false;
  if(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL){
   const message=action==='approve'?'Your G-BEST registration payment has been verified. Your client registration is now active.':'Your G-BEST payment submission was not approved. Please contact our team for assistance.';
   try{const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[row.email],subject:action==='approve'?'G-BEST registration approved':'G-BEST payment review update',html:'<p>Hello '+safe(row.full_name)+',</p><p>'+safe(message)+'</p>'+(note?'<p>Admin note: '+safe(note)+'</p>':'')})});emailSent=response.ok;if(!response.ok)console.error('Payment decision email failed',response.status);}catch(e){console.error('Payment decision email failed',e.message);}
  }
  return NextResponse.json({ok:true,status,emailSent},{headers:{'Cache-Control':'no-store'}});
 }catch(e){await db.query('ROLLBACK');console.error('Payment review failed',e.code||e.message);return NextResponse.json({error:'Could not save payment decision.'},{status:500});}finally{db.release();}
}