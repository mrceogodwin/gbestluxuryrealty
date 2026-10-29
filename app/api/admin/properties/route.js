import { NextResponse } from 'next/server';
import { Pool } from 'pg';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const pool=globalThis.__gbestPool||(globalThis.__gbestPool=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,ssl:{rejectUnauthorized:true}}));
function authorized(req){const secret=process.env.ADMIN_SECRET;return Boolean(secret)&&req.headers.get('authorization')==='Bearer '+secret;}
async function ensureTable(){await pool.query(`CREATE TABLE IF NOT EXISTS public.properties(
 id BIGSERIAL PRIMARY KEY,
 slug TEXT UNIQUE NOT NULL,
 title TEXT NOT NULL,
 location TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT '',
 property_type TEXT NOT NULL,
 price TEXT NOT NULL DEFAULT 'Price on request',
 beds INTEGER NOT NULL DEFAULT 0,
 baths INTEGER NOT NULL DEFAULT 0,
 size TEXT NOT NULL DEFAULT '',
 image_url TEXT NOT NULL DEFAULT '',
 video_url TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);await pool.query(`ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS slug TEXT, ADD COLUMN IF NOT EXISTS title TEXT, ADD COLUMN IF NOT EXISTS location TEXT, ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS property_type TEXT, ADD COLUMN IF NOT EXISTS price TEXT NOT NULL DEFAULT 'Price on request', ADD COLUMN IF NOT EXISTS beds INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS baths INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS size TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft', ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);await pool.query(`UPDATE public.properties SET title=COALESCE(NULLIF(title,''),'Property listing '||id::text),location=COALESCE(location,''),property_type=COALESCE(NULLIF(property_type,''),'Other'),slug=COALESCE(NULLIF(slug,''),trim(both '-' from regexp_replace(lower(COALESCE(NULLIF(title,''),'property-'||id::text)),'[^a-z0-9]+','-','g'))||'-'||id::text) WHERE slug IS NULL OR slug='' OR title IS NULL OR title='' OR location IS NULL OR property_type IS NULL OR property_type=''`);const idType=await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='properties' AND column_name='id'");if(idType.rows[0]?.data_type==='text')await pool.query("ALTER TABLE public.properties ALTER COLUMN id SET DEFAULT ('gb-' || gen_random_uuid()::text)");await pool.query("ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_status_check");await pool.query("ALTER TABLE public.properties ADD CONSTRAINT properties_status_check CHECK (status IN ('draft','published','archived','available','reserved','sold','rented'))");await pool.query(`ALTER TABLE public.properties ALTER COLUMN price_label SET DEFAULT 'Price on request', ALTER COLUMN images SET DEFAULT '{}'::text[]`);await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS properties_slug_unique_idx ON public.properties(slug)');}
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
function validate(d,partial=false){
 const out={};
 const fields={title:120,location:180,state:80,property_type:60,price:100,size:60,image_url:1000,video_url:1000,description:2000,status:20,slug:140};
 for(const [k,n] of Object.entries(fields))if(d[k]!==undefined)out[k]=clean(d[k],n);
 for(const k of ['beds','baths'])if(d[k]!==undefined){const v=Number(d[k]);if(!Number.isInteger(v)||v<0||v>100)throw new Error('Bedrooms and bathrooms must be whole numbers from 0 to 100.');out[k]=v;}
 if(!partial){for(const k of ['title','location','property_type'])if(!out[k])throw new Error('Title, location and property type are required.');out.slug=out.slug||out.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');out.price=out.price||'Price on request';out.status=out.status||'draft';}
 for(const k of ['image_url','video_url'])if(out[k]&&!/^https:\/\//i.test(out[k]))throw new Error(k+' must use an HTTPS URL.');
 if(out.status&&!['draft','published','archived'].includes(out.status))throw new Error('Invalid listing status.');
 if(out.slug&&!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.slug))throw new Error('Slug may contain lowercase letters, numbers and hyphens.');
 return out;
}
export async function GET(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{await ensureTable();const q=await pool.query('SELECT * FROM public.properties ORDER BY updated_at DESC,id DESC');return NextResponse.json({properties:q.rows},{headers:{'Cache-Control':'no-store'}})}catch(e){console.error('Properties admin GET failed',e.code||e.message);return NextResponse.json({error:'Could not load property listings.'},{status:500})}
}
export async function POST(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const d=validate(await req.json());await ensureTable();d.price_label=d.price||'Price on request';d.size_label=d.size||null;d.bedrooms=d.beds??null;d.bathrooms=d.baths??null;d.images=d.image_url?[d.image_url]:[];const keys=Object.keys(d);const vals=keys.map(k=>d[k]);const sql=`INSERT INTO public.properties(${keys.join(',')}) VALUES(${keys.map((_,i)=>'catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not create listing.'},{status:e.message?400:500})}
}
export async function PATCH(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});const d=validate(body,true);delete d.id;if(d.price!==undefined)d.price_label=d.price;if(d.size!==undefined)d.size_label=d.size||null;if(d.beds!==undefined)d.bedrooms=d.beds;if(d.baths!==undefined)d.bathrooms=d.baths;if(d.image_url!==undefined)d.images=d.image_url?[d.image_url]:[];const keys=Object.keys(d);if(!keys.length)return NextResponse.json({error:'No listing fields supplied.'},{status:400});await ensureTable();const q=await pool.query(`UPDATE public.properties SET ${keys.map((k,i)=>k+'=if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({property:q.rows[0]},{headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not update listing.'},{status:e.message?400:500})}
}
export async function DELETE(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});await ensureTable();const q=await pool.query('DELETE FROM public.properties WHERE id=$1 RETURNING id',[id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({ok:true,id})}catch(e){console.error('Properties admin DELETE failed',e.code||e.message);return NextResponse.json({error:'Could not delete listing.'},{status:500})}
}+(i+1)).join(',')}) RETURNING *`;const q=await pool.query(sql,vals);return NextResponse.json({property:q.rows[0]},{status:201,headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not create listing.'},{status:e.message?400:500})}
}
export async function PATCH(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});const d=validate(body,true);delete d.id;const keys=Object.keys(d);if(!keys.length)return NextResponse.json({error:'No listing fields supplied.'},{status:400});await ensureTable();const q=await pool.query(`UPDATE public.properties SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now() WHERE id=$${keys.length+1} RETURNING *`,[...keys.map(k=>d[k]),id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({property:q.rows[0]},{headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not update listing.'},{status:e.message?400:500})}
}
export async function DELETE(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});await ensureTable();const q=await pool.query('DELETE FROM public.properties WHERE id=$1 RETURNING id',[id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({ok:true,id})}catch(e){console.error('Properties admin DELETE failed',e.code||e.message);return NextResponse.json({error:'Could not delete listing.'},{status:500})}
}+(i+1)).join(',')},updated_at=now() WHERE id=${keys.length+1} RETURNING *`,[...keys.map(k=>d[k]),id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({property:q.rows[0]},{headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not update listing.'},{status:e.message?400:500})}
}
export async function DELETE(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});await ensureTable();const q=await pool.query('DELETE FROM public.properties WHERE id=$1 RETURNING id',[id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({ok:true,id})}catch(e){console.error('Properties admin DELETE failed',e.code||e.message);return NextResponse.json({error:'Could not delete listing.'},{status:500})}
}+(i+1)).join(',')}) RETURNING *`;const q=await pool.query(sql,vals);return NextResponse.json({property:q.rows[0]},{status:201,headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not create listing.'},{status:e.message?400:500})}
}
export async function PATCH(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});const d=validate(body,true);delete d.id;const keys=Object.keys(d);if(!keys.length)return NextResponse.json({error:'No listing fields supplied.'},{status:400});await ensureTable();const q=await pool.query(`UPDATE public.properties SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now() WHERE id=$${keys.length+1} RETURNING *`,[...keys.map(k=>d[k]),id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({property:q.rows[0]},{headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not update listing.'},{status:e.message?400:500})}
}
export async function DELETE(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=String(body.id??'').trim();if(!id||id.length>100)return NextResponse.json({error:'Valid listing ID required.'},{status:400});await ensureTable();const q=await pool.query('DELETE FROM public.properties WHERE id=$1 RETURNING id',[id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({ok:true,id})}catch(e){console.error('Properties admin DELETE failed',e.code||e.message);return NextResponse.json({error:'Could not delete listing.'},{status:500})}
}