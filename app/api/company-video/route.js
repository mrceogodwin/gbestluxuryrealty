import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',pool=getDatabasePool(),tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({video:null},{headers:{'Cache-Control':'no-store'}});
  const q=await pool.query('SELECT video_url,title,description,updated_at FROM public.company_profile_video_tenants WHERE tenant_id=$1',[tenant.id]);
  return NextResponse.json({video:q.rows[0]||null},{headers:{'Cache-Control':'no-store'}});
 }catch(e){if(e.code==='42P01')return NextResponse.json({video:null},{headers:{'Cache-Control':'no-store'}});console.error('Public company video GET',e.code||e.message);return NextResponse.json({error:'Could not load company video.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
