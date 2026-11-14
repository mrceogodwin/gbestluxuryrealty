import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const propertyCode=id=>{const value=String(id??'');if(/^\\d+$/.test(value))return 'GB-'+value.padStart(8,'0');return 'GB-'+value.replace(/[^a-z0-9]/gi,'').toUpperCase().slice(-8).padStart(8,'0');};
class ValidationError extends Error {}
async function readBody(req){try{const body=await req.json();if(!body||typeof body!=='object'||Array.isArray(body))throw new ValidationError('Request body must be an object.');return body;}catch(e){if(e instanceof ValidationError)throw e;throw new ValidationError('Invalid JSON body.');}}
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
function validate(d,partial=false){const out={};const fields={title:120,location:180,state:80,property_type:60,price:100,size:60,image_url:1000,video_url:1000,description:2000,status:20,slug:140};for(const [k,n] of Object.entries(fields))if(d[k]!==undefined)out[k]=clean(d[k],n);if(d.images!==undefined){if(!Array.isArray(d.images)||d.images.length>30)throw new ValidationError('Property gallery must contain up to 30 images.');out.images=d.images.map(x=>clean(x,1200)).filter(Boolean);if(out.images.some(x=>!/^https:\\/\\//i.test(x)))throw new ValidationError('Gallery images must use HTTPS URLs.');}for(const k of ['beds','baths'])if(d[k]!==undefined){const v=Number(d[k]);if(!Number.isInteger(v)||v<0||v>100)throw new ValidationError('Bedrooms and bathrooms must be whole numbers from 0 to 100.');out[k]=v;}if(!partial){for(const k of ['title','location','property_type'])if(!out[k])throw new ValidationError('Title, location and property type are required.');out.slug=out.slug||out.title.toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');out.price=out.price||'Price on request';out.status=out.status||'draft';}for(const k of ['image_url','video_url'])if(out[k]&&!/^https:\\/\\//i.test(out[k]))throw new ValidationError(k+' must use an HTTPS URL.');if(out.status&&!['draft','published','archived','available','reserved','sold','rented'].includes(out.status))throw new ValidationError('Invalid listing status.');if(out.slug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.slug))throw new ValidationError('Slug may contain lowercase letters, numbers and hyphens.');return out;}
function withLegacyFields(d){if(d.price!==undefined)d.price_label=d.price;if(d.size!==undefined)d.size_label=d.size||null;if(d.beds!==undefined)d.bedrooms=d.beds;if(d.baths!==undefined)d.bathrooms=d.baths;if(d.images!==undefined){d.image_url=d.images[0]||'';}else if(d.image_url!==undefined)d.images=d.image_url?[d.image_url]:[];return d;}
function errorResponse(e,operation){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});const validation=e instanceof ValidationError;console.error(operation,e.code||e.message);return NextResponse.json({error:validation?e.message:'Could not process listing. Check the database connection and server logs.'},{status:validation?400:500});}
async function targetTenant(pool,req,requested){
 await ensureSiteTenants(pool);
 const admin=await isAdminRequest(req);
 let id=requested;
 if(!admin){const q=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");id=q.rows[0]?.id;}
 else if(id===undefined||id===null||id===''){const q=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");id=q.rows[0]?.id;}
 const tenantId=Number(id);
 if(!Number.isSafeInteger(tenantId)||tenantId<1)throw new ValidationError('Choose a valid company workspace.');
 const q=await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE id=$1',[tenantId]);
 if(!q.rowCount)throw new ValidationError('Company workspace not found.');
 return {tenant:q.rows[0],admin};
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,'properties.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const pool=getDatabasePool(),admin=await isAdminRequest(req),url=new URL(req.url);
  const {tenant}=await targetTenant(pool,req,url.searchParams.get('tenantId')||undefined);
  const q=await pool.query('SELECT p.*,t.tenant_key,t.display_name AS tenant_name FROM public.properties p JOIN public.site_tenants t ON t.id=p.tenant_id WHERE p.tenant_id=$1 ORDER BY p.updated_at DESC,p.id DESC',[tenant.id]);
  const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[tenant];
  return NextResponse.json({properties:q.rows.map(x=>({...x,property_code:propertyCode(x.id)})),tenants,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e,'Properties admin GET failed');}
}
export async function POST(req){
 if(!await authorizeAdminRequest(req,'properties.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await readBody(req),{tenant}=await targetTenant(getDatabasePool(),req,body.tenant_id);
  const d=withLegacyFields(validate(body));const pool=getDatabasePool();const keys=['tenant_id',...Object.keys(d)];const values=[tenant.id,...Object.values(d)];const placeholders=keys.map((_,i)=>'$'+(i+1));
  const q=await pool.query('INSERT INTO public.properties('+keys.join(',')+') VALUES('+placeholders.join(',')+') RETURNING *',values);
  return NextResponse.json({property:{...q.rows[0],property_code:propertyCode(q.rows[0].id)}},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e,'Properties admin POST failed');}
}
export async function PATCH(req){
 if(!await authorizeAdminRequest(req,'properties.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await readBody(req),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});
  delete body.id;const pool=getDatabasePool(),admin=await isAdminRequest(req);
  const existing=await pool.query('SELECT tenant_id FROM public.properties WHERE id=$1',[id]);if(!existing.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});
  const {tenant}=await targetTenant(pool,req,body.tenant_id??existing.rows[0].tenant_id);
  if(!admin&&Number(existing.rows[0].tenant_id)!==Number(tenant.id))return NextResponse.json({error:'You cannot edit another company’s listing.'},{status:403});
  const d=withLegacyFields(validate(body,true));delete d.tenant_id;
  const keys=Object.keys(d);if(!keys.length&&Number(existing.rows[0].tenant_id)===Number(tenant.id))return NextResponse.json({error:'No listing fields supplied.'},{status:400});
  const sets=keys.map((k,i)=>k+'=$'+(i+1));sets.push('tenant_id=$'+(keys.length+1),'updated_at=now()');
  const q=await pool.query('UPDATE public.properties SET '+sets.join(',')+' WHERE id=$'+(keys.length+2)+' RETURNING *',[...keys.map(k=>d[k]),tenant.id,id]);
  if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});
  return NextResponse.json({property:{...q.rows[0],property_code:propertyCode(q.rows[0].id)}},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return errorResponse(e,'Properties admin PATCH failed');}
}
export async function DELETE(req){
 if(!await authorizeAdminRequest(req,'properties.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await readBody(req),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});
  const pool=getDatabasePool(),existing=await pool.query('SELECT tenant_id FROM public.properties WHERE id=$1',[id]);if(!existing.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});
  const {tenant}=await targetTenant(pool,req,body.tenant_id??existing.rows[0].tenant_id);
  if(Number(existing.rows[0].tenant_id)!==Number(tenant.id))return NextResponse.json({error:'Listing does not belong to the selected company.'},{status:404});
  const q=await pool.query("UPDATE public.properties SET status='archived',updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,status,tenant_id",[id,tenant.id]);
  if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});
  return NextResponse.json({ok:true,...q.rows[0],message:'Listing archived. Its record and historical references have been preserved.'});
 }catch(e){return errorResponse(e,'Properties admin DELETE failed');}
}
