import { NextResponse } from 'next/server';
import { ensureHomepageTables } from '../../../../lib/homepage-cms';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {ensureTenantHomepageTables} from '../../../../lib/tenant-homepage';
import {cleanTenantBrand} from '../../../../lib/site-tenants';
const allowed=new Set(['eyebrow','title','description','buttonText','buttonUrl','imageUrl','videoUrl','extraText','visible','imageAlt','logoUrl','logoAlt','mobileImageUrl','imagePosition','layout','alignment','fontFamily','backgroundColor','textColor','accentColor','overlayOpacity','padding','slides','autoplay','autoplayInterval','transition','showArrows','showDots','columns','itemsPerView','cards','videoUrls','siteName','tagline','primaryColor','pageBackgroundColor','buttonRadius','seoTitle','seoDescription','seoImage','faviconUrl','navigationItems','footerLinks','sectionOrder','audioUrl','audioTitle','audioEnabled','audioLoop','audioVolume','propertyTypes','propertyIdLabel','nameLabel','phoneLabel','emailLabel','dateLabel','timeLabel','messageLabel','consentText','propertyIdPlaceholder','namePlaceholder','phonePlaceholder','emailPlaceholder','dateHelp','timeHelp']);
function cleanContent(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Section content must be an object.');
 const out={};
 for(const [key,val] of Object.entries(value)){
  if(!allowed.has(key))continue;
  if(['visible','autoplay','showArrows','showDots','audioEnabled','audioLoop'].includes(key)){out[key]=Boolean(val);continue;}
  if(['overlayOpacity','autoplayInterval','columns','itemsPerView','buttonRadius','audioVolume'].includes(key)){const n=Number(val);const max=key==='buttonRadius'?40:key==='audioVolume'?1:10000;if(!Number.isFinite(n)||n<0||n>max)throw new Error('Invalid numeric setting: '+key);out[key]=n;continue;}
  if(key==='cards'){if(!Array.isArray(val)||val.length>12)throw new Error('Cards must be a list of up to 12 items.');out.cards=val.map(card=>{if(!card||typeof card!=='object'||Array.isArray(card))throw new Error('Each card must be an object.');const item={};for(const field of ['eyebrow','title','description','imageAlt','buttonText','buttonUrl'])if(typeof card[field]==='string')item[field]=card[field].trim().slice(0,field==='description'?2000:500);if(typeof card.imageUrl==='string'){item.imageUrl=card.imageUrl.trim().slice(0,1200);if(item.imageUrl&&!/^https:\/\//i.test(item.imageUrl))throw new Error('Card images must use HTTPS URLs.');}if(item.buttonUrl&&!/^(https:\/\/|\/|#)/i.test(item.buttonUrl))throw new Error('Card links must be HTTPS URLs or local paths.');return item;});continue;}
  if(key==='videoUrls'){if(!Array.isArray(val)||val.length>20)throw new Error('Add up to 20 social video URLs.');out.videoUrls=val.map(x=>String(x||'').trim().slice(0,1200)).filter(Boolean);if(out.videoUrls.some(x=>!/^https:\/\//i.test(x)))throw new Error('Video URLs must use HTTPS.');continue;}
  if(key==='propertyTypes'){if(!Array.isArray(val)||val.length>30)throw new Error('Add up to 30 property types.');out.propertyTypes=[...new Set(val.map(x=>String(x||'').trim().slice(0,80)).filter(Boolean))];if(!out.propertyTypes.length)throw new Error('At least one property type is required.');continue;}
  if(key==='sectionOrder'){if(!Array.isArray(val)||val.length>60)throw new Error('Invalid section order.');out.sectionOrder=val.map(x=>String(x||'').trim()).filter(x=>/^[a-z_]{2,60}$/.test(x)).slice(0,60);continue;}
  if(key==='navigationItems'||key==='footerLinks'){if(!Array.isArray(val)||val.length>20)throw new Error('Navigation and footer links support up to 20 items.');out[key]=val.map(item=>{if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Each link must be an object.');const title=String(item.title||'').trim().slice(0,100),url=String(item.buttonUrl||'').trim().slice(0,500);if(!title||!url||! /^(https:\/\/|\/|#)/i.test(url))throw new Error('Each link needs a label and a valid HTTPS or local destination.');return {title,buttonUrl:url};});continue;}
  if(key==='slides'){if(!Array.isArray(val)||val.length>30)throw new Error('Carousel slides must be a list of up to 30 items.');out.slides=val.slice(0,30).map((slide)=>{if(!slide||typeof slide!=='object'||Array.isArray(slide))throw new Error('Each slide must be an object.');const clean={};for(const k of ['eyebrow','title','description','imageUrl','imageAlt','buttonText','buttonUrl'])if(typeof slide[k]==='string')clean[k]=slide[k].trim().slice(0,1200);if(clean.imageUrl&&!/^https:\/\//i.test(clean.imageUrl))throw new Error('Slide images must use HTTPS URLs.');if(clean.buttonUrl&&!/^(https:\/\/|\/|#)/i.test(clean.buttonUrl))throw new Error('Slide buttons must use HTTPS URLs or local paths.');return clean;});continue;}
  if(typeof val!=='string')throw new Error('Content fields must be text.');
  const max=key==='description'||key==='extraText'?4000:['imageUrl','videoUrl','buttonUrl','mobileImageUrl','logoUrl'].includes(key)?1200:500;
  out[key]=val.trim().slice(0,max);
  if(['imageUrl','videoUrl','mobileImageUrl','logoUrl','seoImage','faviconUrl','audioUrl'].includes(key)&&out[key]&&!/^https:\/\//i.test(out[key]))throw new Error(key+' must use an HTTPS URL.');
  if(['siteName','tagline','seoTitle','seoDescription','audioTitle','logoAlt','fontFamily'].includes(key)&&out[key].length===0&&['siteName','seoTitle'].includes(key))throw new Error(key+' cannot be empty.');
  if(key==='buttonUrl'&&out[key]&&!/^(https:\/\/|\/|#)/i.test(out[key]))throw new Error('Button links must be HTTPS URLs or local paths.');
 }
 return out;
}
async function chooseTenant(req,pool,requested){
 const admin=await isAdminRequest(req);let id=requested;
 if(!admin){const staff=await getStaffSession(req);id=staff?.tenant_id;}
 else if(id===undefined||id===null||id===''){const owner=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");id=owner.rows[0]?.id;}
 if(!Number.isSafeInteger(Number(id))||Number(id)<1)throw new Error('Choose a valid company workspace.');
 const q=await pool.query("SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE id=$1",[id]);
 if(!q.rowCount||q.rows[0].status!=='active')throw new Error('Company workspace is unavailable.');
 await ensureTenantHomepageTables(pool,q.rows[0].id);
 return {tenant:q.rows[0],admin};
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,'homepage.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const pool=await ensureHomepageTables(),url=new URL(req.url),{tenant,admin}=await chooseTenant(req,pool,url.searchParams.get('tenantId'));
  const historyKey=url.searchParams.get('history');
  if(historyKey){
   if(!/^[a-z_]{2,60}$/.test(historyKey))return NextResponse.json({error:'Invalid homepage section.'},{status:400});
   const revisions=await pool.query('SELECT id,section_key,content,action,changed_at FROM public.homepage_tenant_section_revisions WHERE tenant_id=$1 AND section_key=$2 ORDER BY changed_at DESC,id DESC LIMIT 50',[tenant.id,historyKey]);
   return NextResponse.json({revisions:revisions.rows,tenant,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});
  }
  const q=await pool.query('SELECT tenant_id,section_key,label,sort_order,draft_content,published_content,updated_at,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes FROM public.homepage_tenant_sections WHERE tenant_id=$1 ORDER BY sort_order',[tenant.id]);
  const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[];
  return NextResponse.json({sections:q.rows,tenant,tenants,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Homepage CMS admin GET failed',e.code||e.message);return NextResponse.json({error:'Could not load homepage controls.'},{status:500});}
}
// site_audio remains editable by tenant homepage managers; only site_settings needs settings.manage.
export async function PATCH(req){
 if(!await authorizeAdminRequest(req,'homepage.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await req.json(),key=String(body.sectionKey||'').trim();
  if(!/^[a-z_]{2,60}$/.test(key))return NextResponse.json({error:'Invalid homepage section.'},{status:400});
  const pool=await ensureHomepageTables(),{tenant,admin}=await chooseTenant(req,pool,body.tenant_id);
  if(key==='site_settings'&&!admin&&!await authorizeAdminRequest(req,'settings.manage'))return NextResponse.json({error:'Company brand settings require the settings.manage permission.'},{status:403});
  const content=cleanContent(body.content);
  const q=await pool.query('UPDATE public.homepage_tenant_sections SET draft_content=draft_content || $3::jsonb,updated_at=now() WHERE tenant_id=$1 AND section_key=$2 RETURNING tenant_id,section_key,label,draft_content,published_content,updated_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[tenant.id,key,JSON.stringify(content)]);
  if(!q.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});
  return NextResponse.json({section:q.rows[0],message:'Draft saved. Public homepage is unchanged until you publish.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){const validation=!e.code;console.error('Homepage CMS draft save failed',e.code||e.message);return NextResponse.json({error:validation?e.message:'Could not save homepage draft.'},{status:validation?400:500});}
}
export async function POST(req){
 if(!await authorizeAdminRequest(req,'homepage.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await req.json(),key=String(body.sectionKey||'').trim(),action=String(body.action||'');
  if(!/^[a-z_]{2,60}$/.test(key)||!['publish','discard','restore'].includes(action))return NextResponse.json({error:'Invalid homepage action.'},{status:400});
  const pool=await ensureHomepageTables(),{tenant,admin}=await chooseTenant(req,pool,body.tenant_id);
  if(key==='site_settings'&&!admin&&!await authorizeAdminRequest(req,'settings.manage'))return NextResponse.json({error:'Company brand settings require the settings.manage permission.'},{status:403});
  if(action==='restore'){
   const revisionId=Number(body.revisionId);if(!Number.isSafeInteger(revisionId)||revisionId<1)return NextResponse.json({error:'Invalid revision.'},{status:400});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const revision=await client.query('SELECT content FROM public.homepage_tenant_section_revisions WHERE tenant_id=$1 AND id=$2 AND section_key=$3',[tenant.id,revisionId,key]);
    if(!revision.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Revision not found.'},{status:404});}
    const current=await client.query('SELECT published_content FROM public.homepage_tenant_sections WHERE tenant_id=$1 AND section_key=$2 FOR UPDATE',[tenant.id,key]);
    if(!current.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Homepage section not found.'},{status:404});}
    await client.query('INSERT INTO public.homepage_tenant_section_revisions(tenant_id,section_key,content,action) VALUES($1,$2,$3::jsonb,$4)',[tenant.id,key,JSON.stringify(current.rows[0].published_content||{}),'before_restore']);
    const restored=await client.query('UPDATE public.homepage_tenant_sections SET draft_content=$3::jsonb,published_content=$3::jsonb,published_at=now(),updated_at=now() WHERE tenant_id=$1 AND section_key=$2 RETURNING tenant_id,section_key,label,draft_content,published_content,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[tenant.id,key,JSON.stringify(revision.rows[0].content||{})]);
    if(key==='site_settings'){const brand=cleanTenantBrand(restored.rows[0].published_content||{});await client.query('UPDATE public.site_tenants SET brand_config=brand_config || $2::jsonb,updated_at=now() WHERE id=$1',[tenant.id,JSON.stringify(brand)]);}
    await client.query('COMMIT');return NextResponse.json({section:restored.rows[0],message:'Previous version restored and published.'},{headers:{'Cache-Control':'no-store'}});
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  if(action==='publish'){
   const current=await pool.query('SELECT section_key,published_content FROM public.homepage_tenant_sections WHERE tenant_id=$1 AND section_key=$2',[tenant.id,key]);
   if(!current.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    await client.query('INSERT INTO public.homepage_tenant_section_revisions(tenant_id,section_key,content,action) VALUES($1,$2,$3::jsonb,$4)',[tenant.id,key,JSON.stringify(current.rows[0].published_content||{}),'before_publish']);
    const updated=await client.query('UPDATE public.homepage_tenant_sections SET published_content=draft_content,published_at=now(),updated_at=now() WHERE tenant_id=$1 AND section_key=$2 RETURNING tenant_id,section_key,label,draft_content,published_content,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[tenant.id,key]);
    if(key==='site_settings'){const brand=cleanTenantBrand(updated.rows[0].published_content||{});await client.query('UPDATE public.site_tenants SET brand_config=brand_config || $2::jsonb,updated_at=now() WHERE id=$1',[tenant.id,JSON.stringify(brand)]);}
    await client.query('COMMIT');return NextResponse.json({section:updated.rows[0],message:'Homepage section published.'},{headers:{'Cache-Control':'no-store'}});
   }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  const discarded=await pool.query('UPDATE public.homepage_tenant_sections SET draft_content=published_content,updated_at=now() WHERE tenant_id=$1 AND section_key=$2 RETURNING tenant_id,section_key,label,draft_content,published_content,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[tenant.id,key]);
  if(!discarded.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});
  return NextResponse.json({section:discarded.rows[0],message:'Draft changes discarded.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Homepage CMS action failed',e.code||e.message);return NextResponse.json({error:'Could not complete homepage action.'},{status:500});}
}
