import { NextResponse } from 'next/server';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function POST(req){
 const db=await getDatabasePool().connect();
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const d=await req.json(),email=String(d?.email||'').trim().toLowerCase(),code=String(d?.code||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{6}$/.test(code))return NextResponse.json({error:'Enter your email and the six-digit code.'},{status:400});
  const secret=process.env.CLIENT_AUTH_SECRET||process.env.ADMIN_SECRET;
  if(!secret)return NextResponse.json({error:'Client sign-in is not configured.'},{status:503});
  await db.query('BEGIN');
  const q=await db.query("SELECT c.id,c.code_hash,c.expires_at,c.attempts,r.id AS registration_id FROM public.client_login_codes c JOIN public.client_registrations r ON r.id=c.registration_id WHERE r.email_normalized=$1 AND r.payment_status='approved' AND r.client_status='active' AND c.consumed_at IS NULL ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c",[email]);
  if(!q.rowCount){await db.query('ROLLBACK');return NextResponse.json({error:'That code is invalid or expired. Request a new code.'},{status:401});}
  const row=q.rows[0],expected=Buffer.from(row.code_hash,'hex'),actual=Buffer.from(digest(email+':'+code+':'+secret),'hex');
  if(row.attempts>=5||new Date(row.expires_at).getTime()<Date.now()||expected.length!==actual.length||!timingSafeEqual(expected,actual)){
   await db.query('UPDATE public.client_login_codes SET attempts=LEAST(attempts+1,5),consumed_at=CASE WHEN attempts>=4 OR expires_at<=now() THEN now() ELSE consumed_at END WHERE id=$1',[row.id]);
   await db.query('COMMIT');
   return NextResponse.json({error:'That code is invalid or expired. Request a new code.'},{status:401});
  }
  await db.query('UPDATE public.client_login_codes SET consumed_at=now() WHERE id=$1',[row.id]);
  const token=randomBytes(32).toString('base64url');
  await db.query("INSERT INTO public.client_sessions(registration_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",[row.registration_id,digest(token)]);
  await db.query('COMMIT');
  const response=NextResponse.json({ok:true,message:'You are signed in. You can now request an inspection.'},{headers:{'Cache-Control':'no-store'}});
  response.cookies.set('gbest_client_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:7*24*60*60});
  return response;
 }catch(e){try{await db.query('ROLLBACK');}catch{}console.error('Client code verification failed',e.code||e.message);return NextResponse.json({error:'Unable to verify your code right now.'},{status:503});}finally{db.release();}
}
