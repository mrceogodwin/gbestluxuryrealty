import { NextResponse } from 'next/server';
import { randomInt,createHash } from 'node:crypto';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const digest=v=>createHash('sha256').update(v).digest('hex');
export async function POST(req){
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const d=await req.json(),email=String(d?.email||'').trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:'Enter a valid email.'},{status:400});
  const pool=getDatabasePool(),q=await pool.query("SELECT id FROM public.staff_accounts WHERE email_normalized=$1 AND status='active' LIMIT 1",[email]);
  if(q.rowCount){
   const recent=await pool.query("SELECT 1 FROM public.staff_login_codes WHERE staff_id=$1 AND created_at>now()-interval '60 seconds' LIMIT 1",[q.rows[0].id]);
   if(!recent.rowCount){
    const secret=process.env.STAFF_AUTH_SECRET;
    if(!secret||!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)throw new Error('Staff authentication or email is not configured.');
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    await pool.query("UPDATE public.staff_login_codes SET consumed_at=now() WHERE staff_id=$1 AND consumed_at IS NULL",[q.rows[0].id]);
    const saved=await pool.query("INSERT INTO public.staff_login_codes(staff_id,code_hash,expires_at) VALUES($1,$2,now()+interval '10 minutes') RETURNING id",[q.rows[0].id,digest(email+':'+code+':'+secret)]);
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[email],subject:'Your G-BEST staff sign-in code',html:'<p>Your staff sign-in code is:</p><h1>'+code+'</h1><p>It expires in 10 minutes. Never share it.</p>'})});
    if(!response.ok){await pool.query("UPDATE public.staff_login_codes SET consumed_at=now() WHERE id=$1",[saved.rows[0].id]);throw new Error('Email delivery failed.');}
   }
  }
  return NextResponse.json({ok:true,message:'If the address is an active staff account, a sign-in code has been sent.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Staff sign-in request failed',e.message);return NextResponse.json({error:'Unable to send a staff sign-in code.'},{status:503});}
}
