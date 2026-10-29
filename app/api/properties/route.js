import { NextResponse } from 'next/server';
import { Pool } from 'pg';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=globalThis.__gbestPublicPool||(globalThis.__gbestPublicPool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}}));
export async function GET(){
 if(!process.env.DATABASE_URL)return NextResponse.json({properties:[],source:'demo'},{headers:{'Cache-Control':'no-store'}});
 try{
  await pool.query(`CREATE TABLE IF NOT EXISTS public.properties(
   id BIGSERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, location TEXT NOT NULL,
   state TEXT NOT NULL DEFAULT '', property_type TEXT NOT NULL, price TEXT NOT NULL DEFAULT 'Price on request',
   beds INTEGER NOT NULL DEFAULT 0, baths INTEGER NOT NULL DEFAULT 0, size TEXT NOT NULL DEFAULT '',
   image_url TEXT NOT NULL DEFAULT '', video_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
   status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
   created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // Upgrade tables created by earlier app versions; CREATE TABLE IF NOT EXISTS alone does not add columns.
  await pool.query(`ALTER TABLE public.properties
   ADD COLUMN IF NOT EXISTS slug TEXT,
   ADD COLUMN IF NOT EXISTS title TEXT,
   ADD COLUMN IF NOT EXISTS location TEXT,
   ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '',
   ADD COLUMN IF NOT EXISTS property_type TEXT,
   ADD COLUMN IF NOT EXISTS price TEXT NOT NULL DEFAULT 'Price on request',
   ADD COLUMN IF NOT EXISTS beds INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS baths INTEGER NOT NULL DEFAULT 0,
   ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '',
   ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '',
   ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '',
   ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
   ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft',
   ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
   ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await pool.query(`UPDATE public.properties SET
   title=COALESCE(NULLIF(title,''),'Property listing '||id::text),
   location=COALESCE(location,''),
   property_type=COALESCE(NULLIF(property_type,''),'Other'),
   slug=COALESCE(NULLIF(slug,''),trim(both '-' from regexp_replace(lower(COALESCE(NULLIF(title,''),'property-'||id::text)),'[^a-z0-9]+','-','g'))||'-'||id::text)
   WHERE slug IS NULL OR slug='' OR title IS NULL OR title='' OR location IS NULL OR property_type IS NULL OR property_type=''`);
  // Existing production schema uses text IDs and legacy status values.
  const idType=await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='properties' AND column_name='id'");if(idType.rows[0]?.data_type==='text')await pool.query("ALTER TABLE public.properties ALTER COLUMN id SET DEFAULT ('gb-' || gen_random_uuid()::text)");
  await pool.query("ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_status_check");
  await pool.query("ALTER TABLE public.properties ADD CONSTRAINT properties_status_check CHECK (status IN ('draft','published','archived','available','reserved','sold','rented'))");
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS properties_slug_unique_idx ON public.properties(slug)');
  const q=await pool.query(`SELECT id,slug,title,location,state,property_type,COALESCE(NULLIF(price,''),price_label,'Price on request') AS price,CASE WHEN COALESCE(beds,0)=0 THEN COALESCE(bedrooms,0) ELSE beds END AS beds,CASE WHEN COALESCE(baths,0)=0 THEN COALESCE(bathrooms,0) ELSE baths END AS baths,COALESCE(NULLIF(size,''),size_label,'') AS size,COALESCE(NULLIF(image_url,''),images[1],'') AS image_url,description,video_url FROM public.properties WHERE status IN ('published','available') ORDER BY updated_at DESC,id DESC`);
  const properties=q.rows.map(x=>({...x,id:String(x.id),name:x.title,loc:x.location+(x.state?', '+x.state:''),type:x.property_type,img:x.image_url,desc:x.description||'',beds:Number(x.beds||0),baths:Number(x.baths||0),size:x.size||'',price:x.price||'Price on request'}));
  return NextResponse.json({properties,source:'database'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Public properties GET failed',e.code||e.message);return NextResponse.json({error:'Could not load published properties.'},{status:500,headers:{'Cache-Control':'no-store'}})}
}