import { NextResponse } from 'next/server';
import { ensureHomepageTables } from '../../../lib/homepage-cms';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 if(!process.env.DATABASE_URL)return NextResponse.json({sections:{}},{headers:{'Cache-Control':'no-store'}});
 try{const pool=await ensureHomepageTables();const q=await pool.query('SELECT section_key,published_content FROM public.homepage_sections ORDER BY sort_order');const sections=Object.fromEntries(q.rows.map(x=>[x.section_key,x.published_content||{}]));return NextResponse.json({sections},{headers:{'Cache-Control':'no-store'}});}
 catch(e){console.error('Homepage CMS public read failed',e.code||e.message);return NextResponse.json({error:'Could not load homepage content.'},{status:500,headers:{'Cache-Control':'no-store'}});}
}