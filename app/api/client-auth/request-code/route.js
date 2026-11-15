import {NextResponse} from 'next/server';
import {createHash,createHmac,randomInt} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {ensureSiteTenants,resolveSiteTenant} from '../../../../lib/site-tenants';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='gbest_client_session';
const TTL_MINUTES=10;
const SECRET=()=>process.env.CLIENT_AUTH_SECRET||process.env.AUTH_SECRET||'';
const digest=value=>createHmac('sha256',SECRET()).update(value).digest('hex');
const normalize=value=>String(value||'').trim().toLowerCase();
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function schema(pool){
 await ensureSiteTenants(pool);
 await pool.query(`CREATE TABLE IF NOT EXISTS public.client_auth_challenges(
  id bigserial PRIMARY KEY,registration_id text NOT NULL,tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,code_hash text NOT NULL,attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS client_auth_challenges_email_created_idx ON public.client_auth_challenges(email_normalized,created_at DESC)');
 await pool.query(`CREATE TABLE IF NOT EXISTS public.client_sessions(
  id bigserial PRIMARY KEY,registration_id text NOT NULL,token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
 )`);
 await pool.query('ALTER TABLE public.client_sessions ADD COLUMN IF NOT EXISTS registration_id text');
 await pool.query('ALTER TABLE public.client_sessions ADD COLUMN IF NOT EXISTS token_hash text');
 await pool.query('ALTER TABLE public.client_sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz');
 await pool.query('ALTER TABLE public.client_sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz');
 await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS client_sessions_token_hash_uidx ON public.client_sessions(token_hash)');
}
async function sendCode(email,code,name){
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)throw new Error('Email delivery is not configured.');
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[email],subject:'Your G-BEST client sign-in code',html:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#17251d"><p>Hello '+safe(name)+',</p><h1 style="letter-spacing:8px;font-size:34px">'+code+'</h1><p>This code expires in 10 minutes and can only be used once.</p><p>If you did not request this code, you can ignore this email.</p><p>G-BEST Luxury Realty</p></div>'})});
 if(!response.ok)throw new Error('Email delivery failed: '+response.status);
}
export async function POST(req){
 try{
  if(!SECRET())return NextResponse.json({error:'Client sign-in is temporarily unavailable.'},{status:503});
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const body=await req.json().catch(()=>null),email=normalize(body?.email);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return NextResponse.json({error:'Enter a valid email address.'},{status:400});
  const pool=getDatabasePool();await schema(pool);
  const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({message:'If an eligible client account matches that email, a sign-in code will be sent.'},{headers:{'Cache-Control':'no-store'}});
  const ip=(req.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,64);
  const rate=await pool.query(`SELECT count(*) FILTER(WHERE email_normalized=$1 AND created_at>now()-interval '15 minutes')::int AS email_count,
    count(*) FILTER(WHERE created_at>now()-interval '15 minutes' AND $2<>'' AND client_ip=$2)::int AS ip_count,
    max(created_at) FILTER(WHERE email_normalized=$1) AS last_email_request
    FROM public.client_auth_challenges`,[email,ip]);
  if(rate.rows[0].email_count>=4||rate.rows[0].ip_count>=12||(rate.rows[0].last_email_request&&Date.now()-new Date(rate.rows[0].last_email_request).getTime()<60000))
   return NextResponse.json({error:'Please wait before requesting another code.'},{status:429});
  const client=await pool.connect();
  let registration;
  try{
   await client.query('BEGIN');
   const found=await client.query(`SELECT id,full_name,email FROM public.client_registrations
    WHERE lower(email)= $1 AND tenant_id=$2 AND payment_status='approved' AND client_status='active'
    ORDER BY updated_at DESC,created_at DESC LIMIT 1 FOR UPDATE`,[email,tenant.id]);
   if(found.rowCount){
    registration=found.rows[0];
    await client.query('UPDATE public.client_auth_challenges SET used_at=now() WHERE registration_id=$1 AND used_at IS NULL',[String(registration.id)]);
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    await client.query(`INSERT INTO public.client_auth_challenges(registration_id,tenant_id,email_normalized,code_hash,expires_at,client_ip)
      VALUES($1,$2,$3,$4,now()+($5 * interval '1 minute'),$6)`,[String(registration.id),tenant.id,email,digest(code),TTL_MINUTES,ip]);
    registration.code=code;
   }
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  if(registration?.code){
   try{await sendCode(email,registration.code,registration.full_name);}
   catch(e){console.error('Client OTP email failed',e.message);await pool.query('UPDATE public.client_auth_challenges SET used_at=now() WHERE registration_id=$1 AND used_at IS NULL',[String(registration.id)]);return NextResponse.json({error:'We could not send your sign-in code. Please try again shortly.'},{status:503});}
  }
  return NextResponse.json({message:'If an eligible client account matches that email, a sign-in code will be sent.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Client sign-in code request failed',e.code||e.message);return NextResponse.json({error:'Client sign-in is temporarily unavailable.'},{status:503});}
}
