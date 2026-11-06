import { NextResponse } from 'next/server';
import { createHash, randomInt } from 'node:crypto';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const digest=value=>createHash('sha256').update(value).digest('hex');
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function send(to,code){
 if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)throw new Error('Email service is not configured.');
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[to],subject:'Your G-BEST client sign-in code',html:'<p>Your G-BEST sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">'+safe(code)+'</p><p>It expires in 10 minutes. Do not share it with anyone.</p>'})});
 if(!r.ok)throw new Error('Email delivery failed');
}
export async function POST(req){
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const d=await req.json(),email=String(d?.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:'Enter a valid email address.'},{status:400});
  const pool=getDatabasePool();
  const q=await pool.query("SELECT id FROM public.client_registrations WHERE email_normalized=$1 AND payment_status='approved' AND client_status='active' LIMIT 1",[email]);
  // Return the same response whether or not the email belongs to an active client.
  if(q.rowCount){
   const recent=await pool.query("SELECT 1 FROM public.client_login_codes WHERE registration_id=$1 AND created_at>now()-interval '60 seconds' LIMIT 1",[q.rows[0].id]);
   if(!recent.rowCount){
    const code=String(randomInt(0,1000000)).padStart(6,'0'),secret=process.env.CLIENT_AUTH_SECRET||process.env.ADMIN_SECRET;
    if(!secret)throw new Error('Client authentication secret is not configured.');
    await pool.query("UPDATE public.client_login_codes SET consumed_at=now() WHERE registration_id=$1 AND consumed_at IS NULL",[q.rows[0].id]);
    const saved=await pool.query("INSERT INTO public.client_login_codes(registration_id,code_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes') RETURNING id",[q.rows[0].id,digest(email+':'+code+':'+secret)]);
    try{await send(email,code);}catch(e){await pool.query("UPDATE public.client_login_codes SET consumed_at=now() WHERE id=$1",[saved.rows[0].id]);throw e;}
   }
  }
  return NextResponse.json({ok:true,message:'If this email belongs to an approved G-BEST client, a sign-in code has been sent.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Client sign-in code request failed',e.message);return NextResponse.json({error:'Unable to send a sign-in code right now.'},{status:503});}
}
