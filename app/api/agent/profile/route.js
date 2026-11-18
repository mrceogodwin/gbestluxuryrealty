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
  const q=await pool.query("SELECT published_content->>'agentAvatarUrl' AS avatar_url FROM public.homepage_tenant_sections WHERE tenant_id=$1 AND section_key='site_settings' LIMIT 1",[tenant.id]);
  const avatarUrl=String(q.rows[0]?.avatar_url||'');
  if(avatarUrl&&!/^https:\/\//i.test(avatarUrl))return NextResponse.json({avatarUrl:''},{headers:{'Cache-Control':'no-store'}});
  return NextResponse.json({avatarUrl},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Agent profile load failed',e.code||e.message);return NextResponse.json({avatarUrl:''},{headers:{'Cache-Control':'no-store'}});}
}