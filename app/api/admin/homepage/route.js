import { NextResponse } from 'next/server';
import { ensureHomepageTables } from '../../../../lib/homepage-cms';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const auth=req=>Boolean(process.env.ADMIN_SECRET)&&req.headers.get('authorization')==='Bearer '+process.env.ADMIN_SECRET;
const allowed=new Set(['eyebrow','title','description','buttonText','buttonUrl','imageUrl','videoUrl','extraText','visible']);
function cleanContent(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Section content must be an object.');
 const out={};
 for(const [key,val] of Object.entries(value)){
  if(!allowed.has(key))continue;
  if(key==='visible'){out.visible=Boolean(val);continue;}
  if(typeof val!=='string')throw new Error('Content fields must be text.');
  const max=key==='description'||key==='extraText'?4000:key==='imageUrl'||key==='videoUrl'||key==='buttonUrl'?1200:300;
  out[key]=val.trim().slice(0,max);
  if(['imageUrl','videoUrl'].includes(key)&&out[key]&&!/^https:\/\//i.test(out[key]))throw new Error(key+' must use an HTTPS URL.');
  if(key==='buttonUrl'&&out[key]&&!/^(https:\/\/|\/|#)/i.test(out[key]))throw new Error('Button links must be HTTPS URLs or local paths.');
 }
 return out;
}
export async function GET(req){
 if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const pool=await ensureHomepageTables();const q=await pool.query('SELECT section_key,label,sort_order,draft_content,published_content,updated_at,published_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes FROM public.homepage_sections ORDER BY sort_order');return NextResponse.json({sections:q.rows},{headers:{'Cache-Control':'no-store'}});}
 catch(e){console.error('Homepage CMS admin GET failed',e.code||e.message);return NextResponse.json({error:'Could not load homepage controls.'},{status:500});}
}
export async function PATCH(req){
 if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json();const key=String(body.sectionKey||'').trim();if(!/^[a-z_]{2,60}$/.test(key))return NextResponse.json({error:'Invalid homepage section.'},{status:400});const content=cleanContent(body.content);const pool=await ensureHomepageTables();const q=await pool.query('UPDATE public.homepage_sections SET draft_content=draft_content || $2::jsonb,updated_at=now() WHERE section_key=$1 RETURNING section_key,label,draft_content,published_content,updated_at,(draft_content IS DISTINCT FROM published_content) AS has_unpublished_changes',[key,JSON.stringify(content)]);if(!q.rowCount)return NextResponse.json({error:'Homepage section not found.'},{status:404});return NextResponse.json({section:q.rows[0],message:'Draft saved. Public homepage is unchanged until you publish.'},{headers:{'Cache-Control':'no-store'}});}
 catch(e){const validation=!e.code;console.error('Homepage CMS draft save failed',e.code||e.message);return NextResponse.json({error:validation?e.message:'Could not save homepage draft.'},{status:validation?400:500});}
}
export async function POST(req){
 if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{
  const body=await req.json();const key=String(body.sectionKey||'').trim();const action=String(body.action||'');
  if(!/^[a-z_]{2,60}$/.test(key)||!['publish','discard'].includes(action))return NextResponse.json({error:'Invalid homepage action.'},{status:400});
  const pool=await ensureHomepageTables();
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