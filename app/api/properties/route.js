import { NextResponse } from 'next/server';
import { Pool } from 'pg';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=globalThis.__gbestPublicPool||(globalThis.__gbestPublicPool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}}));
export async function GET(){
 if(!process.env.DATABASE_URL)return NextResponse.json({properties:[],source:'demo'},{headers:{'Cache-Control':'no-store'}});
 try{
  const q=await pool.query(`SELECT id,slug,title,location,state,property_type,price,beds,baths,size,image_url,description,video_url FROM public.properties WHERE status='published' ORDER BY updated_at DESC,id DESC`);
  const properties=q.rows.map(x=>({...x,id:String(x.id),name:x.title,loc:x.location+(x.state?', '+x.state:''),type:x.property_type,img:x.image_url,desc:x.description||'',beds:Number(x.beds||0),baths:Number(x.baths||0),size:x.size||'',price:x.price||'Price on request'}));
  return NextResponse.json({properties,source:'database'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Public properties GET failed',e.code||e.message);return NextResponse.json({error:'Could not load published properties.'},{status:500,headers:{'Cache-Control':'no-store'}})}
}