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
)`);}
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
 try{const d=validate(await req.json());await ensureTable();const keys=Object.keys(d);const vals=keys.map(k=>d[k]);const sql=`INSERT INTO public.properties(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`;const q=await pool.query(sql,vals);return NextResponse.json({property:q.rows[0]},{status:201,headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not create listing.'},{status:e.message?400:500})}
}
export async function PATCH(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=Number(body.id);if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid listing ID required.'},{status:400});const d=validate(body,true);delete d.id;const keys=Object.keys(d);if(!keys.length)return NextResponse.json({error:'No listing fields supplied.'},{status:400});await ensureTable();const q=await pool.query(`UPDATE public.properties SET ${keys.map((k,i)=>k+'=$'+(i+1)).join(',')},updated_at=now() WHERE id=$${keys.length+1} RETURNING *`,[...keys.map(k=>d[k]),id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({property:q.rows[0]},{headers:{'Cache-Control':'no-store'}})}catch(e){if(e.code==='23505')return NextResponse.json({error:'That listing slug already exists.'},{status:409});return NextResponse.json({error:e.message||'Could not update listing.'},{status:e.message?400:500})}
}
export async function DELETE(req){
 if(!authorized(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 if(!process.env.DATABASE_URL)return NextResponse.json({error:'Database is not configured'},{status:503});
 try{const body=await req.json(),id=Number(body.id);if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid listing ID required.'},{status:400});await ensureTable();const q=await pool.query('DELETE FROM public.properties WHERE id=$1 RETURNING id',[id]);if(!q.rowCount)return NextResponse.json({error:'Listing not found.'},{status:404});return NextResponse.json({ok:true,id})}catch(e){console.error('Properties admin DELETE failed',e.code||e.message);return NextResponse.json({error:'Could not delete listing.'},{status:500})}
}