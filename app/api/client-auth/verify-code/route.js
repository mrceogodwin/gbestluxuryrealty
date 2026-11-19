import {NextResponse} from 'next/server';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {ensureSiteTenants,resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='gbest_client_session';
const SECRET=()=>process.env.CLIENT_AUTH_SECRET||'';
const digest=value=>createHmac('sha256',SECRET()).update(value).digest('hex');
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
export async function POST(req){
 try{
  if(!SECRET())return NextResponse.json({error:'Client sign-in is temporarily unavailable.'},{status:503});
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const body=await req.json().catch(()=>null),email=String(body?.email||'').trim().toLowerCase(),code=String(body?.code||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{6}$/.test(code))return NextResponse.json({error:'Enter your email and six-digit code.'},{status:400});
  const pool=getDatabasePool();
  const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'That code is invalid or expired. Request a new one.'},{status:400});
  const client=await pool.connect();let registrationId;
  try{
   await client.query('BEGIN');
   const q=await client.query(`SELECT c.id,c.registration_id,c.code_hash,c.attempts,c.expires_at,r.email
    FROM public.client_auth_challenges c JOIN public.client_registrations r ON r.id::text=c.registration_id
    WHERE c.email_normalized=$1 AND c.tenant_id=$2 AND c.used_at IS NULL
    ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c`,[email,tenant.id]);
   if(!q.rowCount||new Date(q.rows[0].expires_at).getTime()<=Date.now()||q.rows[0].attempts>=5){
    if(q.rowCount)await client.query('UPDATE public.client_auth_challenges SET used_at=now() WHERE id=$1',[q.rows[0].id]);
    await client.query('COMMIT');return NextResponse.json({error:'That code is invalid or expired. Request a new one.'},{status:400});
   }
   const challenge=q.rows[0];
   if(!equal(challenge.code_hash,digest(code))){
    const attempts=challenge.attempts+1;
    await client.query('UPDATE public.client_auth_challenges SET attempts=$2,used_at=CASE WHEN $2>=5 THEN now() ELSE used_at END WHERE id=$1',[challenge.id,attempts]);
    await client.query('COMMIT');return NextResponse.json({error:'That code is invalid or expired. Request a new one.'},{status:400});
   }
   const eligible=await client.query(`SELECT id FROM public.client_registrations WHERE id::text=$1 AND tenant_id=$2 AND lower(email)=$3 AND payment_status IN ('approved','not_required','pending','rejected') AND client_status='active' LIMIT 1`,[challenge.registration_id,tenant.id,email]);
   if(!eligible.rowCount){await client.query('UPDATE public.client_auth_challenges SET used_at=now() WHERE id=$1',[challenge.id]);await client.query('COMMIT');return NextResponse.json({error:'That code is invalid or expired. Request a new one.'},{status:400});}
   await client.query('UPDATE public.client_auth_challenges SET used_at=now() WHERE id=$1',[challenge.id]);
   registrationId=String(challenge.registration_id);
   await client.query('UPDATE public.client_sessions SET revoked_at=now() WHERE registration_id=$1 AND revoked_at IS NULL',[registrationId]);
   const token=randomBytes(32).toString('base64url');
   await client.query(`INSERT INTO public.client_sessions(registration_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')`,[registrationId,createHash('sha256').update(token).digest('hex')]);
   await client.query('COMMIT');
   const response=NextResponse.json({ok:true,message:'You are signed in. You can now request an inspection.'},{headers:{'Cache-Control':'no-store'}});
   response.cookies.set(COOKIE,token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:30*24*60*60});
   return response;
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }catch(e){console.error('Client OTP verification failed',e.code||e.message);return NextResponse.json({error:'Client sign-in is temporarily unavailable.'},{status:503});}
}
