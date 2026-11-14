import {NextResponse} from 'next/server';
import {S3Client,PutObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {randomUUID} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function storage(){
 const endpoint=process.env.NEON_STORAGE_ENDPOINT;
 const region=process.env.NEON_STORAGE_REGION;
 const bucket=process.env.NEON_STORAGE_BUCKET;
 const accessKeyId=process.env.NEON_STORAGE_ACCESS_KEY_ID;
 const secretAccessKey=process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
 if(!endpoint||!region||!bucket||!accessKeyId||!secretAccessKey)throw new Error('Neon media storage is not configured for this preview deployment.');
 return {s3:new S3Client({region,endpoint,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}}),bucket,endpoint};
}
const publicUrl=(endpoint,bucket,key)=>(process.env.NEON_STORAGE_PUBLIC_BASE_URL||endpoint.replace(/\/$/,'')+'/'+bucket).replace(/\/$/,'')+'/'+key.split('/').map(encodeURIComponent).join('/');
async function ensure(){
 const pool=getDatabasePool();
 await pool.query(`CREATE TABLE IF NOT EXISTS public.admin_media_assets(id bigserial primary key,object_key text unique not null,public_url text not null,file_name text not null,mime_type text not null,file_size bigint not null,alt_text text not null default '',created_at timestamptz not null default now())`);
 return pool;
}
function mediaPolicy(type){
 const image=/^image\/(jpeg|png|webp|avif|gif)$/.test(type);
 const audio=/^audio\/(mpeg|mp3|wav|ogg|mp4|webm)$/.test(type);
 return image?{kind:'image',max:15*1024*1024}:audio?{kind:'audio',max:25*1024*1024}:null;
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const pool=await ensure();
  const q=await pool.query('SELECT id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at FROM public.admin_media_assets ORDER BY created_at DESC LIMIT 500');
  return NextResponse.json({assets:q.rows},{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  console.error('Media library GET',e.name||e.message);
  return NextResponse.json({error:'Could not load the media library.'},{status:500});
 }
}
export async function POST(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json();
  const {s3,bucket,endpoint}=storage();
  const pool=await ensure();
  if(body.action==='presign'){
   const name=String(body.fileName||'media').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100)||'media';
   const type=String(body.mimeType||'');
   const size=Number(body.fileSize);
   const policy=mediaPolicy(type);
   if(!policy)return NextResponse.json({error:'Choose a supported image or audio file.'},{status:400});
   if(!Number.isSafeInteger(size)||size<1||size>policy.max)return NextResponse.json({error:policy.kind==='audio'?'Audio files must be 25 MB or smaller.':'Images must be 15 MB or smaller.'},{status:400});
   const key='website/'+Date.now()+'-'+randomUUID()+'-'+name;
   const uploadUrl=await getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:type}),{expiresIn:300});
   return NextResponse.json({upload:{url:uploadUrl,headers:{'Content-Type':type}},objectKey:key,publicUrl:publicUrl(endpoint,bucket,key)});
  }
  if(body.action==='complete'){
   const key=String(body.objectKey||'');
   if(!key.startsWith('website/')||key.includes('..')||key.length>1024)return NextResponse.json({error:'Invalid media key.'},{status:400});
   const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
   const type=String(head.ContentType||'').toLowerCase();
   const policy=mediaPolicy(type);
   const actualSize=Number(head.ContentLength||0);
   if(!policy)return NextResponse.json({error:'The uploaded object is not a supported image or audio file.'},{status:400});
   if(!Number.isSafeInteger(actualSize)||actualSize<1||actualSize>policy.max)return NextResponse.json({error:'The uploaded file exceeds its allowed size.'},{status:413});
   const q=await pool.query('INSERT INTO public.admin_media_assets(object_key,public_url,file_name,mime_type,file_size,alt_text) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(object_key) DO UPDATE SET alt_text=EXCLUDED.alt_text RETURNING id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at',[key,publicUrl(endpoint,bucket,key),String(body.fileName||'media').slice(0,160),type,actualSize,String(body.altText||'').slice(0,300)]);
   return NextResponse.json({asset:q.rows[0]},{status:201});
  }
  return NextResponse.json({error:'Unknown media action.'},{status:400});
 }catch(e){
  console.error('Media library POST',e.name||e.message);
  const unavailable=String(e.message||'').includes('not configured');
  return NextResponse.json({error:unavailable?e.message:'Could not process the media operation.'},{status:unavailable?503:500});
 }
}
export async function PATCH(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json();
  const id=Number(body.id),altText=String(body.altText??'').trim().slice(0,300);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid media item required.'},{status:400});
  const pool=await ensure();
  const q=await pool.query('UPDATE public.admin_media_assets SET alt_text=$2 WHERE id=$1 RETURNING id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at',[id,altText]);
  if(!q.rowCount)return NextResponse.json({error:'Media item not found.'},{status:404});
  return NextResponse.json({asset:q.rows[0],message:'Media description saved.'});
 }catch(e){
  console.error('Media library PATCH',e.code||e.message);
  return NextResponse.json({error:'Could not update media description.'},{status:500});
 }
}
export async function DELETE(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json(),id=Number(body.id);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid media item required.'},{status:400});
  const {s3,bucket}=storage();
  const pool=await ensure();
  const q=await pool.query('SELECT object_key FROM public.admin_media_assets WHERE id=$1',[id]);
  if(!q.rowCount)return NextResponse.json({error:'Media item not found.'},{status:404});
  await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:q.rows[0].object_key}));
  await pool.query('DELETE FROM public.admin_media_assets WHERE id=$1',[id]);
  return NextResponse.json({ok:true,message:'Media item removed.'});
 }catch(e){
  console.error('Media library DELETE',e.name||e.message);
  return NextResponse.json({error:'Could not delete this media item.'},{status:500});
 }
}
