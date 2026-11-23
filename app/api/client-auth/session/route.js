import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {resolveSiteTenant} from '../../../../lib/site-tenants';

export const runtime='nodejs';
export const dynamic='force-dynamic';

const COOKIE='gbest_client_session';
const unauthenticated=()=>NextResponse.json(
  {authenticated:false,client:null},
  {headers:{'Cache-Control':'no-store','Pragma':'no-cache'}}
);

export async function GET(req){
  try{
    const token=req.cookies.get(COOKIE)?.value;
    if(!token||token.length<32||token.length>128)return unauthenticated();

    const pool=getDatabasePool();
    const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';
    const tenant=await resolveSiteTenant(pool,host);
    if(!tenant)return unauthenticated();

    const tokenHash=createHash('sha256').update(token).digest('hex');
    const result=await pool.query(`SELECT r.id,r.client_id,r.full_name,r.email,r.phone,r.registration_intent,r.payment_status
      FROM public.client_sessions s
      JOIN public.client_registrations r ON r.id=s.registration_id
      WHERE s.token_hash=$1
        AND s.revoked_at IS NULL
        AND s.expires_at>now()
        AND r.tenant_id=$2
        AND r.payment_status IN ('approved','not_required','pending','rejected')
        AND r.client_status='active'
      LIMIT 1`,[tokenHash,tenant.id]);

    if(!result.rowCount){
      const response=unauthenticated();
      response.cookies.set(COOKIE,'',{
        httpOnly:true,
        secure:process.env.NODE_ENV==='production',
        sameSite:'lax',
        path:'/',
        maxAge:0
      });
      return response;
    }

    const client=result.rows[0];
    return NextResponse.json({
      authenticated:true,
      client:{
        id:String(client.id),
        clientId:client.client_id||null,
        fullName:client.full_name,
        phone:client.phone||'',
        email:client.email,
        registrationIntent:client.registration_intent,
        paymentStatus:client.payment_status
      }
    },{headers:{'Cache-Control':'no-store','Pragma':'no-cache'}});
  }catch(error){
    console.error('Client session lookup failed',error.code||'DB_ERROR',error.message);
    return NextResponse.json(
      {error:'We could not verify your client session. Please try again.'},
      {status:503,headers:{'Cache-Control':'no-store','Pragma':'no-cache'}}
    );
  }
}
