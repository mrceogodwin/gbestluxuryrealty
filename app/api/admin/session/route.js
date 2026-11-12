import {NextResponse} from 'next/server';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {createAdminSessionToken,validSessionToken,revokeAdminSession,ADMIN_COOKIE} from '../../../../lib/admin-auth';
import {getDatabasePool} from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const options={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:2*60*60};
function sameSecret(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
function attemptKeys(req){
 const raw=req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-real-ip')||'';
 let ip=raw.split(',')[0]?.trim()||'unknown';if(ip.startsWith('[')&&ip.endsWith(']'))ip=ip.slice(1,-1);
 if(!isIP(ip))ip='unknown';
 const key=value=>createHmac('sha256',process.env.ADMIN_SECRET).update(value).digest('hex');
 return [key('super-admin:ip:'+ip)];
}
async function recordFailures(pool,keys){
 await pool.query(`INSERT INTO public.staff_login_attempts(attempt_key,failed_attempts,window_started_at,locked_until,updated_at)
 VALUES($1,1,now(),NULL,now())
 ON CONFLICT(attempt_key) DO UPDATE SET
 failed_attempts=CASE WHEN staff_login_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE staff_login_attempts.failed_attempts+1 END,
 window_started_at=CASE WHEN staff_login_attempts.window_started_at<now()-interval '15 minutes' THEN now() ELSE staff_login_attempts.window_started_at END,
 locked_until=CASE WHEN (CASE WHEN staff_login_attempts.window_started_at<now()-interval '15 minutes' THEN 1 ELSE staff_login_attempts.failed_attempts+1 END)>=5 THEN now()+interval '15 minutes' ELSE NULL END,
 updated_at=now()`,[keys]);
}
export async function GET(req){const token=req.cookies.get(ADMIN_COOKIE)?.value;return NextResponse.json({authenticated:await validSessionToken(token)},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 if(!process.env.ADMIN_SECRET)return NextResponse.json({error:'Admin access is not configured.'},{status:503});
 let body;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid login request.'},{status:400})}
 try{
  const pool=getDatabasePool(),keys=attemptKeys(req);
  const locked=await pool.query('SELECT 1 FROM public.staff_login_attempts WHERE attempt_key=ANY($1::text[]) AND locked_until>now() LIMIT 1',[keys]);
  if(locked.rowCount)return NextResponse.json({error:'Too many unsuccessful sign-in attempts. Try again in 15 minutes.'},{status:429});
  if(!sameSecret(body?.secret,process.env.ADMIN_SECRET)){
   await recordFailures(pool,keys);
   const after=await pool.query('SELECT 1 FROM public.staff_login_attempts WHERE attempt_key=ANY($1::text[]) AND locked_until>now() LIMIT 1',[keys]);
   return NextResponse.json({error:after.rowCount?'Too many unsuccessful sign-in attempts. Try again in 15 minutes.':'The admin access key is incorrect.'},{status:after.rowCount?429:401});
  }
  await pool.query('DELETE FROM public.staff_login_attempts WHERE attempt_key=ANY($1::text[])',[keys]);
  const rawIp=req.headers.get('x-vercel-forwarded-for')||req.headers.get('x-real-ip')||'';const ip=rawIp.split(',')[0]?.trim()||'unknown';const ipHash=createHmac('sha256',process.env.ADMIN_SECRET).update('session-ip:'+ip).digest('hex');
  const token=await createAdminSessionToken({userAgent:req.headers.get('user-agent'),ipHash});
  await pool.query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin','master-admin','admin.login','session',NULL,'{}'::jsonb)");
  const response=NextResponse.json({ok:true,expiresIn:options.maxAge});
  response.cookies.set(ADMIN_COOKIE,token,options);return response;
 }catch(e){console.error('Admin login',e.code||e.message);return NextResponse.json({error:'Admin sign-in is temporarily unavailable.'},{status:500});}
}
export async function DELETE(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 const token=req.cookies.get(ADMIN_COOKIE)?.value;
 try{await revokeAdminSession(token);await getDatabasePool().query("INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('super_admin','master-admin','admin.logout','session',NULL,'{}'::jsonb)");}catch(e){console.error('Admin logout',e.code||e.message)}
 const response=NextResponse.json({ok:true});response.cookies.set(ADMIN_COOKIE,'',{...options,maxAge:0});return response;
}
