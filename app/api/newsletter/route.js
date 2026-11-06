import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req){
 try{
  if(!process.env.DATABASE_URL)return NextResponse.json({error:'Subscriptions are temporarily unavailable. Please try again later.'},{status:503});
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  let body;try{body=await req.json()}catch{return NextResponse.json({error:'Please submit a valid email address.'},{status:400});}
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request.'},{status:400});
  const email=String(body.email||'').trim().toLowerCase();
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:'Enter a valid email address.'},{status:400});
  if(body.consent!=='yes')return NextResponse.json({error:'Please confirm your consent to receive email updates.'},{status:400});
  const pool=getDatabasePool();
  await pool.query(`CREATE TABLE IF NOT EXISTS public.newsletter_subscriptions(
   id bigserial PRIMARY KEY,
   email text NOT NULL,
   email_normalized text NOT NULL UNIQUE,
   consent boolean NOT NULL DEFAULT false,
   consent_text text NOT NULL,
   source text NOT NULL DEFAULT 'homepage',
   subscribed_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now(),
   unsubscribed_at timestamptz
  )`);
  const result=await pool.query(`INSERT INTO public.newsletter_subscriptions(email,email_normalized,consent,consent_text,source)
   VALUES($1,$2,true,$3,'homepage')
   ON CONFLICT(email_normalized) DO UPDATE SET
    email=EXCLUDED.email,consent=true,consent_text=EXCLUDED.consent_text,
    updated_at=now(),unsubscribed_at=NULL
   RETURNING (xmax=0) AS inserted`,
   [email,email,'I agree to receive G-BEST property listings, market updates and company news by email. I understand I can unsubscribe at any time.']);
  const alreadySubscribed=!result.rows[0].inserted;
  return NextResponse.json({ok:true,alreadySubscribed},{status:200,headers:{'Cache-Control':'no-store'}});
 }catch(error){console.error('Newsletter subscription failed',error.code||error.message);return NextResponse.json({error:'We could not save your subscription. Please try again later.'},{status:500});}
}
