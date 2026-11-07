import { NextResponse } from 'next/server';
import { ensureHomepageTables } from '../../../../lib/homepage-cms';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import {isAdminRequest} from '../../../../lib/admin-auth';
const allowed=new Set(['eyebrow','title','description','buttonText','buttonUrl','imageUrl','videoUrl','extraText','visible','imageAlt','mobileImageUrl','imagePosition','layout','alignment','backgroundColor','textColor','accentColor','overlayOpacity','padding','slides','autoplay','autoplayInterval','transition','showArrows','showDots','columns','itemsPerView']);
function cleanContent(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Section content must be an object.');
 const out={};
 for(const [key,val] of Object.entries(value)){
  if(!allowed.has(key))continue;
  if(['visible','autoplay','showArrows','showDots'].includes(key)){out[key]=Boolean(val);continue;}
  if(['overlayOpacity','autoplayInterval','columns','itemsPerView'].includes(key)){const n=Number(val);if(!Number.isFinite(n)||n<0||n>10000)throw new Error('Invalid numeric setting: '+key);out[key]=n;continue;}
  if(key==='slides'){if(!Array.isArray(val)||val.length>30)throw new Error('Carousel slides must be a list of up to 30 items.');out.slides=val.slice(0,30).map((slide)=>{if(!slide||typeof slide!=='object'||Array.isArray(slide))throw new Error('Each slide must be an object.');const clean={};for(const k of ['eyebrow','title','description','imageUrl','imageAlt','buttonText','buttonUrl'])if(typeof slide[k]==='string')clean[k]=slide[k].trim().slice(0,1200);if(clean.imageUrl&&!/^https:\/\//i.test(clean.imageUrl))throw new Error('Slide images must use HTTPS URLs.');if(clean.buttonUrl&&!/^(https:\/\/|\/|#)/i.test(clean.buttonUrl))throw new Error('Slide buttons must use HTTPS URLs or local paths.');return clean;});continue;}
  if(typeof val!=='string')throw new Error('Content fields must be text.');
  const max=key==='description'||key==='extraText'?4000:['imageUrl','videoUrl','buttonUrl','mobileImageUrl'].includes(key)?1200:500;
  out[key]=val.trim().slice(0,max);
  if(['imageUrl','videoUrl','mobileImageUrl'].includes(key)&&out[key]&&!/^https:\/\//i.test(out[key]))throw new Error(key+' must use an HTTPS URL.');
  if(key==='buttonUrl'&&out[key]&&!/^(https:\/\/|\/|#)/i.test(out[key]))throw new Error('Button links must be HTTPS URLs or local paths.');
 }
 return out;
}
export async function GET(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const pool=await ensureHomepageTables();const url=new URL(req.url);const historyKey=url.searchParams.get('history');if(historyKey){if(!/^[a-z_]{2,60}$/.test(historyKey))return NextResponse.json({error:'Invalid homepage section.'},{status:400});const revisions=await pool.query('SELECT id,section_key,content,action,changed_at FROM public.homepage_section_revisions WHERE section_key=$1 ORDER BY changed_at DESC,id DESC LIMIT 50',[historyKey]);return NextResponse.json({revisions:revisions.rows},{headers:{'Cache-Control':'no-store'}});}const q=await pool.query('SELECT section_key,label,sort_order,draft_content,published_content,updated_at,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes FROM public.homepage_sections ORDER BY sort_order');return NextResponse.json({sections:q.rows},{headers:{'Cache-Control':'no-store'}});}
 catch(e){console.error('Homepage CMS admin GET failed',e.code||e.message);return NextResponse.json({error:'Could not load homepage controls.'},{status:500});}
}
export async function PATCH(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json();const key=String(body.sectionKey||'').trim();if(!/^[a-z_]{2,60}$/.test(key))return NextResponse.json({error:'Invalid homepage section.'},{status:400});const content=cleanContent(body.content);const pool=await ensureHomepageTables();const q=await pool.query('UPDATE public.homepage_sections SET draft_content=draft_content || $2::jsonb,updated_at=now() WHERE section_key=$1 RETURNING section_key,label,draft_content,published_content,updated_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[key,JSON.stringify(content)]);if(!q.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});return NextResponse.json({section:q.rows[0],message:'Draft saved. Public homepage is unchanged until you publish.'},{headers:{'Cache-Control':'no-store'}});}
 catch(e){const validation=!e.code;console.error('Homepage CMS draft save failed',e.code||e.message);return NextResponse.json({error:validation?e.message:'Could not save homepage draft.'},{status:validation?400:500});}
}
export async function POST(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await req.json();const key=String(body.sectionKey||'').trim();const action=String(body.action||'');
  if(!/^[a-z_]{2,60}$/.test(key)||!['publish','discard','restore'].includes(action))return NextResponse.json({error:'Invalid homepage action.'},{status:400});
  const pool=await ensureHomepageTables();
  if(action==='restore'){
   const revisionId=Number(body.revisionId);if(!Number.isSafeInteger(revisionId)||revisionId<1)return NextResponse.json({error:'Invalid revision.'},{status:400});
   const client=await pool.connect();try{await client.query('BEGIN');const revision=await client.query('SELECT content FROM public.homepage_section_revisions WHERE id=$1 AND section_key=$2',[revisionId,key]);if(!revision.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Revision not found.'},{status:404});}const current=await client.query('SELECT published_content FROM public.homepage_sections WHERE section_key=$1 FOR UPDATE',[key]);if(!current.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Homepage section not found.'},{status:404});}await client.query('INSERT INTO public.homepage_section_revisions(section_key,content,action) VALUES($1,$2::jsonb,$3)',[key,JSON.stringify(current.rows[0].published_content||{}),'before_restore']);const restored=await client.query('UPDATE public.homepage_sections SET draft_content=$2::jsonb,published_content=$2::jsonb,published_at=now(),updated_at=now() WHERE section_key=$1 RETURNING section_key,label,draft_content,published_content,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[key,JSON.stringify(revision.rows[0].content||{})]);await client.query('COMMIT');return NextResponse.json({section:restored.rows[0],message:'Previous version restored and published.'},{headers:{'Cache-Control':'no-store'}});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  if(action==='publish'){
   const q=await pool.query('SELECT section_key,published_content FROM public.homepage_sections WHERE section_key=$1',[key]);
   if(!q.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});
   const client=await pool.connect();
   try{await client.query('BEGIN');await client.query('INSERT INTO public.homepage_section_revisions(section_key,content,action) VALUES($1,$2::jsonb,$3)',[key,JSON.stringify(q.rows[0].published_content||{}),'before_publish']);const updated=await client.query('UPDATE public.homepage_sections SET published_content=draft_content,published_at=now(),updated_at=now() WHERE section_key=$1 RETURNING section_key,label,draft_content,published_content,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[key]);await client.query('COMMIT');return NextResponse.json({section:updated.rows[0],message:'Homepage section published.'},{headers:{'Cache-Control':'no-store'}});}
   catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  const q=await pool.query('UPDATE public.homepage_sections SET draft_content=published_content,updated_at=now() WHERE section_key=$1 RETURNING section_key,label,draft_content,published_content,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[key]);
  if(!q.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});
  return NextResponse.json({section:q.rows[0],message:'Draft changes discarded.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Homepage CMS action failed',e.code||e.message);return NextResponse.json({error:'Could not complete homepage action.'},{status:500});}
}