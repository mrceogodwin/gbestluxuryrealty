import {NextResponse} from 'next/server';
import {createHmac} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {hashToken,verifyPassword,newOpaqueToken,STAFF_COOKIE,STAFF_SESSION_SECONDS,staffCookieOptions,getStaffSession} from '../../../../lib/staff-auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
const MAX_FAILURES=5, WINDOW_MINUTES=15, LOCK_MINUTES=15;
function loginAttemptKey(req,email){
 const ip=req.headers.get('x-real-ip')||req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
 const secret=process.env.ADMIN_SECRET||process.env.DATABASE_URL;
 if(!secret)throw new Error('Missing server secret for login rate limiting');
 return createHmac('sha256',secret).update(email+'|'+ip).digest('hex');
}
export async function GET(req){try{const staff=await getStaffSession(req);if(!staff)return NextResponse.json({authenticated:false,staff:null},{headers:{'Cache-Control':'no-store'}});const q=await getDatabasePool().query(`SELECT rp.permission_key FROM public.staff_role_permissions rp WHERE rp.role=$1 AND rp.enabled=true AND NOT EXISTS(SELECT 1 FROM public.staff_account_permissions ap WHERE ap.staff_id=$2 AND ap.permission_key=rp.permission_key) UNION SELECT permission_key FROM public.staff_account_permissions WHERE staff_id=$2 AND enabled=true`,[staff.role,staff.id]);return NextResponse.json({authenticated:true,staff:{id:staff.id,full_name:staff.full_name,email:staff.email,role:staff.role,permissions:q.rows.map(x=>x.permission_key)}},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({authenticated:false,staff:null},{headers:{'Cache-Control':'no-store'}})}}
export async function POST(req){
 if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 let body;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid login request.'},{status:400})}
 const email=String(body?.email||'').trim().toLowerCase(),password=String(body?.password||'');
 if(email.length>254||password.length>128||!email||!password)return NextResponse.json({error:'Enter your work email and password.'},{status:400});
 try{
  const p=getDatabasePool(),attemptKey=loginAttemptKey(req,email);
  const limit=await p.query(`SELECT failed_attempts,locked_until>now() AS locked FROM public.staff_login_attempts WHERE attempt_key=$1`,[attemptKey]);
  if(limit.rows[0]?.locked)return NextResponse.json({error:'Too many unsuccessful sign-in attempts. Try again in 15 minutes.'},{status:429});
  const q=await p.query(`SELECT id,full_name,email,role,status,password_hash FROM public.staff_accounts WHERE email_normalized=$1 LIMIT 1`,[email]),staff=q.rows[0];
  const valid=!!staff&&staff.status==='active'&&!!staff.password_hash&&await verifyPassword(password,staff.password_hash);
  if(!valid){
   const attempts=await p.query(`INSERT INTO public.staff_login_attempts(attempt_key,failed_attempts,window_started_at,locked_until,updated_at)
    VALUES($1,1,now(),NULL,now())
    ON CONFLICT(attempt_key) DO UPDATE SET
      failed_attempts=CASE WHEN public.staff_login_attempts.window_started_at<now()-interval '${WINDOW_MINUTES} minutes' THEN 1 ELSE public.staff_login_attempts.failed_attempts+1 END,
      window_started_at=CASE WHEN public.staff_login_attempts.window_started_at<now()-interval '${WINDOW_MINUTES} minutes' THEN now() ELSE public.staff_login_attempts.window_started_at END,
      locked_until=CASE WHEN (CASE WHEN public.staff_login_attempts.window_started_at<now()-interval '${WINDOW_MINUTES} minutes' THEN 1 ELSE public.staff_login_attempts.failed_attempts+1 END)>=$2 THEN now()+interval '${LOCK_MINUTES} minutes' ELSE NULL END,
      updated_at=now()
    RETURNING failed_attempts,locked_until`,[attemptKey,MAX_FAILURES]);
   const locked=!!attempts.rows[0]?.locked_until;
   return NextResponse.json({error:locked?'Too many unsuccessful sign-in attempts. Try again in 15 minutes.':'Email or password is incorrect.'},{status:locked?429:401});
  }
  await p.query('DELETE FROM public.staff_login_attempts WHERE attempt_key=$1',[attemptKey]);
  const token=newOpaqueToken();
  await p.query(`INSERT INTO public.staff_sessions(staff_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')`,[staff.id,hashToken(token)]);
  await p.query('UPDATE public.staff_accounts SET last_login_at=now(),updated_at=now() WHERE id=$1',[staff.id]);
  await p.query(`INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES($1,$2,'staff.login','staff',$3,'{}'::jsonb)`,[staff.role,staff.email,staff.id]);
  const response=NextResponse.json({ok:true,staff:{id:staff.id,full_name:staff.full_name,email:staff.email,role:staff.role},expiresIn:STAFF_SESSION_SECONDS});
  response.cookies.set(STAFF_COOKIE,token,staffCookieOptions);return response;
 }catch(e){console.error('Staff login',e.code||e.message);return NextResponse.json({error:'Staff sign-in is temporarily unavailable.'},{status:500});}
}
export async function DELETE(req){
 const token=req.cookies.get(STAFF_COOKIE)?.value;
 if(token){try{await getDatabasePool().query('UPDATE public.staff_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hashToken(token)]);}catch(e){console.error('Staff logout',e.code||e.message)}}
 const response=NextResponse.json({ok:true});response.cookies.set(STAFF_COOKIE,'',{...staffCookieOptions,maxAge:0});return response;
}