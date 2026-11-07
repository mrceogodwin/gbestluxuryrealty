import {NextResponse} from 'next/server';
import {createHmac,createHash,randomUUID} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const ENDPOINT='https://br-small-flower-b9ct7l1l.storage.c-7.eu-central-1.aws.neon.tech';
const REGION='eu-central-1',BUCKET='property-media';
const auth=req=>Boolean(process.env.ADMIN_SECRET)&&req.headers.get('authorization')==='Bearer '+process.env.ADMIN_SECRET;
const hex=b=>Buffer.from(b).toString('hex');
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
function signingKey(secret,date){const d=createHmac('sha256',Buffer.from('AWS4'+secret)).update(day).digest();const a=d;const b=createHmac('sha256',a).update(REGION).digest();const c=createHmac('sha256',b).update('s3').digest();return createHmac('sha256',c).update('aws4_request').digest();}
function signedUpload(key,type){
 const id=process.env.NEON_STORAGE_ACCESS_KEY_ID,secret=process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
 if(!id||!secret)throw new Error('Storage upload is not configured. Add NEON_STORAGE_ACCESS_KEY_ID and NEON_STORAGE_SECRET_ACCESS_KEY to the Vercel project environment before uploading files.');
 const now=new Date(),amz=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=amz.slice(0,8),scope=day+'/'+REGION+'/s3/aws4_request';
 const path='/'+BUCKET+'/'+key.split('/').map(enc).join('/');
 const params={'X-Amz-Algorithm':'AWS4-HMAC-SHA256','X-Amz-Credential':id+'/'+scope,'X-Amz-Date':amz,'X-Amz-Expires':'600','X-Amz-SignedHeaders':'content-type;host'};
 const query=Object.keys(params).sort().map(k=>enc(k)+'='+enc(params[k])).join('&');
 const canonical=['PUT',path,query,'content-type:'+type+'\nhost:'+new URL(ENDPOINT).host,'content-type;host','UNSIGNED-PAYLOAD'].join('\n');
 const toSign=['AWS4-HMAC-SHA256',amz,scope,hex(createHash('sha256').update(canonical).digest())].join('\n');
 const signature=hex(createHmac('sha256',signingKey(secret,day)).update(toSign).digest());
 return {url:ENDPOINT+path+'?'+query+'&X-Amz-Signature='+signature,method:'PUT',headers:{'Content-Type':type},publicUrl:ENDPOINT+path};
}
async function ensure(){const p=getDatabasePool();await p.query(`CREATE TABLE IF NOT EXISTS public.admin_media_assets(id bigserial primary key,object_key text unique not null,public_url text not null,file_name text not null,mime_type text not null,file_size bigint not null,alt_text text not null default '',created_at timestamptz not null default now())`);return p;}
export async function GET(req){if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{const p=await ensure();const q=await p.query('SELECT id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at FROM public.admin_media_assets ORDER BY created_at DESC LIMIT 500');return NextResponse.json({assets:q.rows},{headers:{'Cache-Control':'no-store'}})}catch(e){console.error('Media library GET',e.message);return NextResponse.json({error:'Could not load media library.'},{status:500})}}
export async function POST(req){if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{const b=await req.json();const p=await ensure();if(b.action==='presign'){const name=String(b.fileName||'image').replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,120);const type=String(b.mimeType||'');const size=Number(b.fileSize);if(!/^image\/(jpeg|png|webp|avif|gif)$/.test(type))return NextResponse.json({error:'Choose a JPG, PNG, WebP, AVIF or GIF image.'},{status:400});if(!Number.isFinite(size)||size<1||size>15*1024*1024)return NextResponse.json({error:'Images must be 15 MB or smaller.'},{status:400});const key='uploads/'+Date.now()+'-'+randomUUID()+'-'+name;return NextResponse.json({upload:signedUpload(key,type),objectKey:key})}
 if(b.action==='complete'){const key=String(b.objectKey||'');if(!/^uploads\/[a-zA-Z0-9._/-]{1,220}$/.test(key))return NextResponse.json({error:'Invalid media key.'},{status:400});const url=ENDPOINT+'/'+BUCKET+'/'+key;const q=await p.query('INSERT INTO public.admin_media_assets(object_key,public_url,file_name,mime_type,file_size,alt_text) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(object_key) DO UPDATE SET alt_text=EXCLUDED.alt_text RETURNING id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at',[key,url,String(b.fileName||'image').slice(0,160),String(b.mimeType||'image/jpeg'),Number(b.fileSize)||0,String(b.altText||'').slice(0,300)]);return NextResponse.json({asset:q.rows[0]},{status:201})}
 return NextResponse.json({error:'Unknown media action.'},{status:400})}catch(e){console.error('Media library POST',e.message);return NextResponse.json({error:e.message.includes('not configured')?e.message:'Could not process media upload.'},{status:e.message.includes('not configured')?503:500})}}
export async function DELETE(req){if(!auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{const b=await req.json();const p=await ensure();const id=Number(b.id);if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid media item required.'},{status:400});const q=await p.query('DELETE FROM public.admin_media_assets WHERE id=$1 RETURNING id,object_key',[id]);if(!q.rowCount)return NextResponse.json({error:'Media item not found.'},{status:404});return NextResponse.json({ok:true,objectKey:q.rows[0].object_key,message:'Library record deleted. The stored object is retained until storage deletion is configured.'})}catch(e){console.error('Media library DELETE',e.message);return NextResponse.json({error:'Could not delete media record.'},{status:500})}}
