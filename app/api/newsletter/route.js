import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request){
 try{
  const origin=request.headers.get('origin'),host=request.headers.get('x-forwarded-host')||request.headers.get('host');
  if(!origin||!host||new URL(origin).host!==host)return NextResponse.json({error:'Request origin could not be verified.'},{status:403});
  if(Number(request.headers.get('content-length')||0)>4096)return NextResponse.json({error:'Request is too large.'},{status:413});
  const email=String((await request.json())?.email||'').trim().toLowerCase();
  if(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return NextResponse.json({error:'Enter a valid email address.'},{status:400});
  const pool=getDatabasePool(),tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'This website workspace is not available.'},{status:404});
  await pool.query(`INSERT INTO public.newsletter_subscribers(tenant_id,email,email_normalized,source,subscribed_at,updated_at)
   VALUES($1,$2,$3,'homepage',NOW(),NOW())
   ON CONFLICT(tenant_id,email_normalized) DO UPDATE SET unsubscribed_at=NULL,updated_at=NOW(),email=EXCLUDED.email`,[tenant.id,email,email]);
  return NextResponse.json({ok:true,message:'You’re subscribed. Watch your inbox for '+tenant.display_name+' updates.'},{headers:{'Cache-Control':'no-store'}});
 }catch(error){console.error('Newsletter subscription failed:',error.code||error.message);return NextResponse.json({error:'Subscriptions are temporarily unavailable. Please try again later.'},{status:503});}
}
