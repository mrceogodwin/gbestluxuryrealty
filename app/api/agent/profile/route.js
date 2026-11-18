import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const pool=getDatabasePool(),host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';
  const tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({avatarUrl:''},{headers:{'Cache-Control':'no-store'}});
  const avatarUrl=String(tenant.brand_config?.agentAvatarUrl||'');
  if(avatarUrl&&!/^https:\/\//i.test(avatarUrl))return NextResponse.json({avatarUrl:''},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({avatarUrl},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Agent profile load failed',e.code||e.message);return NextResponse.json({avatarUrl:''},{headers:{'Cache-Control':'no-store'}});}
}