import { NextResponse } from 'next/server';
import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const digest=v=>createHash('sha256').update(v).digest('hex');
export async function POST(req){
 const db=await getDatabasePool().connect();
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const d=await req.json(),email=String(d?.email||'').trim().toLowerCase(),code=String(d?.code||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||! /^\d{6}$/.test(code))return NextResponse.json({error:'Enter your email and six-digit code.'},{status:400});
  const secret=process.env.STAFF_AUTH_SECRET||process.env.ADMIN_SECRET;
  if(!secret)return NextResponse.json({error:'Staff sign-in is not configured.'},{status:503});
  await db.query('BEGIN');
  const q=await db.query("SELECT c.id,c.code_hash,c.expires_at,c.attempts,a.id AS staff_id,a.role FROM public.staff_login_codes c JOIN public.staff_accounts a ON a.id=c.staff_id WHERE a.email_normalized=$1 AND a.status='active' AND c.consumed_at IS NULL ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c",[email]);
  if(!q.rowCount){await db.query('ROLLBACK');return NextResponse.json({error:'That code is invalid or expired.'},{status:401});}
  const row=q.rows[0],expected=Buffer.from(row.code_hash,'hex'),actual=Buffer.from(digest(email+':'+code+':'+secret),'hex');
  if(row.attempts>=5||new Date(row.expires_at).getTime()<Date.now()||expected.length!==actual.length||!timingSafeEqual(expected,actual)){
   await db.query("UPDATE public.staff_login_codes SET attempts=LEAST(attempts+1,5),consumed_at=CASE WHEN attempts>=4 OR expires_at<=now() THEN now() ELSE consumed_at END WHERE id=$1",[row.id]);
   await db.query('COMMIT');return NextResponse.json({error:'That code is invalid or expired.'},{status:401});
  }
  await db.query('UPDATE public.staff_login_codes SET consumed_at=now() WHERE id=$1',[row.id]);
  const token=randomBytes(32).toString('base64url');
  await db.query("INSERT INTO public.staff_sessions(staff_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",[row.staff_id,digest(token)]);
  await db.query("UPDATE public.staff_accounts SET last_login_at=now(),updated_at=now() WHERE id=$1",[row.staff_id]);
  await db.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id) SELECT role,email,'staff.login','staff_account',id::text FROM public.staff_accounts WHERE id=$1",[row.staff_id]);
  await db.query('COMMIT');
  const response=NextResponse.json({ok:true,role:row.role},{headers:{'Cache-Control':'no-store'}});
  response.cookies.set('gbest_staff_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:8*60*60});
  return response;
 }catch(e){try{await db.query('ROLLBACK')}catch{}console.error('Staff code verification failed',e.code||e.message);return NextResponse.json({error:'Unable to verify staff sign-in.'},{status:503});}
 finally{db.release();}
}
