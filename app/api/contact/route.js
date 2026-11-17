import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function ensureTable(pool){await pool.query(`CREATE TABLE IF NOT EXISTS public.business_contact_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 full_name varchar(120) NOT NULL,
 email varchar(254) NOT NULL,
 phone varchar(40),
 subject varchar(160) NOT NULL,
 message text NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','responded','closed')),
 admin_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
)`);await pool.query('CREATE INDEX IF NOT EXISTS business_contact_submissions_created_idx ON public.business_contact_submissions(created_at DESC)');await pool.query('CREATE INDEX IF NOT EXISTS business_contact_submissions_status_idx ON public.business_contact_submissions(status,created_at DESC)');}
export async function POST(req){
 try{
  const origin=req.headers.get('origin'),host=req.headers.get('x-forwarded-host')||req.headers.get('host');
  if(!origin||!host||new URL(origin).host!==host)return NextResponse.json({error:'Request origin could not be verified.'},{status:403});
  if(Number(req.headers.get('content-length')||0)>12000)return NextResponse.json({error:'Message is too large.'},{status:413});
  const d=await req.json();
  if(String(d?.website||'').trim())return NextResponse.json({ok:true,message:'Thank you. Your message has been received.'});
  const name=String(d?.name||'').trim(),email=String(d?.email||'').trim().toLowerCase(),phone=String(d?.phone||'').trim(),subject=String(d?.subject||'').trim(),message=String(d?.message||'').trim();
  if(name.length<2||name.length>120)return NextResponse.json({error:'Enter your full name.'},{status:400});
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:'Enter a valid email address.'},{status:400});
  if(phone.length>40||subject.length<3||subject.length>160||message.length<10||message.length>5000)return NextResponse.json({error:'Please check the subject, phone number and message length.'},{status:400});
  const pool=getDatabasePool();await ensureTable(pool);
  const q=await pool.query('INSERT INTO public.business_contact_submissions(full_name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',[name,email,phone||null,subject,message]);
  return NextResponse.json({ok:true,id:q.rows[0].id,message:'Thank you. Your message has been delivered to the G-BEST team.'},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Public business contact submission failed',e.code||e.message);return NextResponse.json({error:'Contact messages are temporarily unavailable. Please try again later.'},{status:503});}
}
