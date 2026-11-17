import {NextResponse} from 'next/server';
import {S3Client,PutObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {randomUUID} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
function storage(){
 const endpoint=process.env.NEON_STORAGE_ENDPOINT,region=process.env.NEON_STORAGE_REGION,bucket=process.env.NEON_STORAGE_BUCKET;
 const accessKeyId=process.env.NEON_STORAGE_ACCESS_KEY_ID,secretAccessKey=process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
 if(!endpoint||!region||!bucket||!accessKeyId||!secretAccessKey)throw new Error('Neon media storage is not configured for this preview deployment.');
 return {s3:new S3Client({region,endpoint,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}}),bucket,endpoint};
}
const publicUrl=(endpoint,bucket,key)=>(process.env.NEON_STORAGE_PUBLIC_BASE_URL||endpoint.replace(/\/$/,'')+'/'+bucket).replace(/\/$/,'')+'/'+key.split('/').map(encodeURIComponent).join('/');
async function ensure(){
 // Schema is provisioned by database migrations; request handlers must never run DDL.
 return getDatabasePool();
}
async function chooseTenant(req,pool,requested){
 const admin=await isAdminRequest(req);let id=requested;
 if(!admin){const staff=await getStaffSession(req);id=staff?.tenant_id;}
 else if(id===undefined||id===null||id===''){const owner=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");id=owner.rows[0]?.id;}
 if(!Number.isSafeInteger(Number(id))||Number(id)<1)throw new Error('Choose a valid company workspace.');
 const q=await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE id=$1',[id]);
 if(!q.rowCount||q.rows[0].status!=='active')throw new Error('Company workspace is unavailable.');
 return {tenant:q.rows[0],admin};
}
function mediaPolicy(type){
 const image=/^image\/(jpeg|png|webp|avif|gif)$/.test(type),audio=/^audio\/(mpeg|mp3|wav|ogg|mp4|webm)$/.test(type);
 return image?{kind:'image',max:15*1024*1024}:audio?{kind:'audio',max:25*1024*1024}:null;
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const pool=await ensure(),url=new URL(req.url),{tenant,admin}=await chooseTenant(req,pool,url.searchParams.get('tenantId'));
  const q=await pool.query('SELECT id,tenant_id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at FROM public.admin_media_assets WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 500',[tenant.id]);
  const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[];
  return NextResponse.json({assets:q.rows,tenants,tenant,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Media library GET',e.name||e.message);return NextResponse.json({error:'Could not load the media library.'},{status:500});}
}
export async function POST(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json(),pool=await ensure(),{tenant}=await chooseTenant(req,pool,body.tenant_id);
  const {s3,bucket,endpoint}=storage(),prefix='website/'+tenant.id+'/';
  if(body.action==='presign'){
   const name=String(body.fileName||'media').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100)||'media';
   const type=String(body.mimeType||''),size=Number(body.fileSize),policy=mediaPolicy(type);
   if(!policy)return NextResponse.json({error:'Choose a supported image or audio file.'},{status:400});
   if(!Number.isSafeInteger(size)||size<1||size>policy.max)return NextResponse.json({error:policy.kind==='audio'?'Audio files must be 25 MB or smaller.':'Images must be 15 MB or smaller.'},{status:400});
   const key=prefix+Date.now()+'-'+randomUUID()+'-'+name;
   const uploadUrl=await getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:type}),{expiresIn:300});
   return NextResponse.json({upload:{url:uploadUrl,headers:{'Content-Type':type}},objectKey:key,publicUrl:publicUrl(endpoint,bucket,key),tenant_id:tenant.id});
  }
  if(body.action==='complete'){
   const key=String(body.objectKey||'');
   if(!key.startsWith(prefix)||key.includes('..')||key.length>1024)return NextResponse.json({error:'Invalid media key for this company workspace.'},{status:400});
   const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key})),type=String(head.ContentType||'').toLowerCase(),policy=mediaPolicy(type),actualSize=Number(head.ContentLength||0);
   if(!policy)return NextResponse.json({error:'The uploaded object is not a supported image or audio file.'},{status:400});
   if(!Number.isSafeInteger(actualSize)||actualSize<1||actualSize>policy.max)return NextResponse.json({error:'The uploaded file exceeds its allowed size.'},{status:413});
   const q=await pool.query('INSERT INTO public.admin_media_assets(tenant_id,object_key,public_url,file_name,mime_type,file_size,alt_text) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(object_key) DO UPDATE SET alt_text=EXCLUDED.alt_text WHERE public.admin_media_assets.tenant_id=EXCLUDED.tenant_id RETURNING id,tenant_id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at',[tenant.id,key,publicUrl(endpoint,bucket,key),String(body.fileName||'media').slice(0,160),type,actualSize,String(body.altText||'').slice(0,300)]);
   if(!q.rowCount)return NextResponse.json({error:'This media object is already registered to another workspace.'},{status:409});
   return NextResponse.json({asset:q.rows[0]},{status:201});
  }
  return NextResponse.json({error:'Unknown media action.'},{status:400});
 }catch(e){console.error('Media library POST',e.name||e.message);const unavailable=String(e.message||'').includes('not configured');return NextResponse.json({error:unavailable?e.message:'Could not process the media operation.'},{status:unavailable?503:500});}
}
export async function PATCH(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json(),id=Number(body.id),altText=String(body.altText??'').trim().slice(0,300),pool=await ensure(),{tenant}=await chooseTenant(req,pool,body.tenant_id);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid media item required.'},{status:400});
  const q=await pool.query('UPDATE public.admin_media_assets SET alt_text=$2 WHERE id=$1 AND tenant_id=$3 RETURNING id,tenant_id,object_key,public_url,file_name,mime_type,file_size,alt_text,created_at',[id,altText,tenant.id]);
  if(!q.rowCount)return NextResponse.json({error:'Media item not found in this company workspace.'},{status:404});
  return NextResponse.json({asset:q.rows[0],message:'Media description saved.'});
 }catch(e){console.error('Media library PATCH',e.code||e.message);return NextResponse.json({error:'Could not update media description.'},{status:500});}
}
export async function DELETE(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const body=await req.json(),id=Number(body.id),pool=await ensure(),{tenant}=await chooseTenant(req,pool,body.tenant_id);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Valid media item required.'},{status:400});
  const {s3,bucket}=storage(),q=await pool.query('SELECT object_key FROM public.admin_media_assets WHERE id=$1 AND tenant_id=$2',[id,tenant.id]);
  if(!q.rowCount)return NextResponse.json({error:'Media item not found in this company workspace.'},{status:404});
  await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:q.rows[0].object_key}));
  await pool.query('DELETE FROM public.admin_media_assets WHERE id=$1 AND tenant_id=$2',[id,tenant.id]);
  return NextResponse.json({ok:true,message:'Media item removed.'});
 }catch(e){console.error('Media library DELETE',e.name||e.message);return NextResponse.json({error:'Could not delete this media item.'},{status:500});}
}
