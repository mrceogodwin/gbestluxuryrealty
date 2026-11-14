import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {ensureSiteTenants,normalizeHostname,cleanTenantBrand} from '../../../../lib/site-tenants';
import {ensureHomepageTables} from '../../../../lib/homepage-cms';
import {ensureTenantHomepageTables} from '../../../../lib/tenant-homepage';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function admin(req){return isAdminRequest(req)}
export async function GET(req){
 if(!await admin(req))return NextResponse.json({error:'Super Admin access required.'},{status:403});
 try{const pool=getDatabasePool();await ensureSiteTenants(pool);const q=await pool.query('SELECT id,tenant_key,display_name,primary_domain,status,brand_config,created_at,updated_at FROM public.site_tenants ORDER BY created_at ASC');return NextResponse.json({companies:q.rows},{headers:{'Cache-Control':'no-store'}});}
 catch(e){console.error('Company registry GET',e.code||e.message);return NextResponse.json({error:'Could not load companies.'},{status:500});}
}
export async function POST(req){
 if(!await admin(req))return NextResponse.json({error:'Super Admin access required.'},{status:403});
 try{
  const body=await req.json(),key=String(body.tenantKey||'').trim().toLowerCase(),name=String(body.displayName||'').trim().slice(0,120),domain=normalizeHostname(body.primaryDomain),brand=cleanTenantBrand(body.brandConfig||{siteName:name});
  if(!/^[a-z][a-z0-9-]{1,38}$/.test(key))return NextResponse.json({error:'Company key must be 2–39 lowercase letters, numbers or hyphens.'},{status:400});
  if(!name)return NextResponse.json({error:'Company name is required.'},{status:400});
  if(!domain)return NextResponse.json({error:'A valid primary domain is required.'},{status:400});
  if(key==='gbest')return NextResponse.json({error:'The default G-BEST company already exists.'},{status:409});
  const pool=getDatabasePool();await ensureSiteTenants(pool);
  const q=await pool.query('INSERT INTO public.site_tenants(tenant_key,display_name,primary_domain,brand_config) VALUES($1,$2,$3,$4::jsonb) RETURNING id,tenant_key,display_name,primary_domain,status,brand_config,created_at,updated_at',[key,name,domain,JSON.stringify(brand)]);
  await ensureHomepageTables();await ensureTenantHomepageTables(pool,q.rows[0].id);
  return NextResponse.json({company:q.rows[0],message:'Company workspace created.'},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){
  if(e.code==='23505')return NextResponse.json({error:'That company key or domain is already registered.'},{status:409});
  const validation=!e.code;console.error('Company registry POST',e.code||e.message);return NextResponse.json({error:validation?e.message:'Could not create company workspace.'},{status:validation?400:500});
 }
}
export async function PATCH(req){
 if(!await admin(req))return NextResponse.json({error:'Super Admin access required.'},{status:403});
 try{
  const body=await req.json(),id=Number(body.id);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid company is required.'},{status:400});
  const pool=getDatabasePool();await ensureSiteTenants(pool);
  const current=await pool.query('SELECT * FROM public.site_tenants WHERE id=$1',[id]);
  if(!current.rowCount)return NextResponse.json({error:'Company not found.'},{status:404});
  const old=current.rows[0],name=body.displayName===undefined?old.display_name:String(body.displayName).trim().slice(0,120);
  const domain=body.primaryDomain===undefined?old.primary_domain:normalizeHostname(body.primaryDomain);
  const status=body.status===undefined?old.status:String(body.status);
  if(!name)return NextResponse.json({error:'Company name is required.'},{status:400});
  if(!domain)return NextResponse.json({error:'A valid primary domain is required.'},{status:400});
  if(!['active','suspended'].includes(status))return NextResponse.json({error:'Invalid company status.'},{status:400});
  const brand=body.brandConfig===undefined?old.brand_config: {...old.brand_config,...cleanTenantBrand(body.brandConfig)};
  if(body.displayName!==undefined&&body.brandConfig===undefined)brand.siteName=name;
  const q=await pool.query('UPDATE public.site_tenants SET display_name=$2,primary_domain=$3,status=$4,brand_config=$5::jsonb,updated_at=now() WHERE id=$1 RETURNING id,tenant_key,display_name,primary_domain,status,brand_config,created_at,updated_at',[id,name,domain,status,JSON.stringify(brand)]);
  await ensureHomepageTables();await ensureTenantHomepageTables(pool,id);
  await pool.query(`UPDATE public.homepage_tenant_sections SET draft_content=draft_content || $2::jsonb,published_content=published_content || $2::jsonb,updated_at=now() WHERE tenant_id=$1 AND section_key='site_settings'`,[id,JSON.stringify(brand)]);
  return NextResponse.json({company:q.rows[0],message:'Company settings saved.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  if(e.code==='23505')return NextResponse.json({error:'That domain is already assigned to another company.'},{status:409});
  const validation=!e.code;console.error('Company registry PATCH',e.code||e.message);return NextResponse.json({error:validation?e.message:'Could not update company.'},{status:validation?400:500});
 }
}
