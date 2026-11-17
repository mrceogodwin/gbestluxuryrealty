import {NextResponse} from 'next/server';
import {ensureHomepageTables} from '../../../lib/homepage-cms';
import {resolveSiteTenant} from '../../../lib/site-tenants';
import {getDatabasePool} from '../../../lib/db';
import {ensureTenantHomepageTables} from '../../../lib/tenant-homepage';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 if(!process.env.DATABASE_URL)return NextResponse.json({sections:{}},{headers:{'Cache-Control':'no-store'}});
 try{
  const pool=await ensureHomepageTables();
  const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';
  const tenant=await resolveSiteTenant(getDatabasePool(),host);
  if(!tenant)return NextResponse.json({error:'This domain is not connected to an active company workspace.'},{status:404,headers:{'Cache-Control':'no-store'}});
  await ensureTenantHomepageTables(pool,tenant.id);
  const q=await pool.query('SELECT section_key,published_content FROM public.homepage_tenant_sections WHERE tenant_id=$1 ORDER BY sort_order',[tenant.id]);
  const sections=Object.fromEntries(q.rows.map(x=>[x.section_key,x.published_content||{}]));
  sections.site_settings={...(tenant.brand_config||{}),...(sections.site_settings||{}),siteName:sections.site_settings?.siteName||tenant.brand_config?.siteName||tenant.display_name};
  return NextResponse.json({tenant:{key:tenant.tenant_key,name:tenant.display_name},sections},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Homepage CMS public read failed',e.code||e.message);return NextResponse.json({error:'Could not load homepage content.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}
