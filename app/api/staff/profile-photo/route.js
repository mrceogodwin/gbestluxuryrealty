import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX_BYTES=5*1024*1024;
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'};
export async function POST(req){
 const admin=await isAdminRequest(req);
 const staff=admin?null:await getStaffSession(req);
 if(!admin&&(!staff||!await authorizeAdminRequest(req,'staff.manage')))return NextResponse.json({error:'You are not authorized to update this staff profile.'},{status:403});
 try{
  const form=await req.formData(),file=form.get('photo');
  if(!file||typeof file.arrayBuffer!=='function')return NextResponse.json({error:'Choose a profile photo to upload.'},{status:400});
  const ext=TYPES[file.type];if(!ext)return NextResponse.json({error:'Use a JPG, PNG, WebP or AVIF image.'},{status:415});
  if(file.size<1||file.size>MAX_BYTES)return NextResponse.json({error:'Profile photos must be smaller than 5 MB.'},{status:413});
  const id=String(form.get('staffId')||staff?.id||'');
  if(!/^[0-9a-f-]{36}$/i.test(id)||(!admin&&id!==staff.id))return NextResponse.json({error:'Invalid staff account.'},{status:400});
  const bucket=process.env.S3_BUCKET_NAME||process.env.AWS_S3_BUCKET;
  const region=process.env.AWS_REGION||'auto';
  const endpoint=process.env.S3_ENDPOINT||process.env.AWS_ENDPOINT_URL_S3;
  const accessKeyId=process.env.AWS_ACCESS_KEY_ID,secretAccessKey=process.env.AWS_SECRET_ACCESS_KEY;
  const publicBase=process.env.S3_PUBLIC_URL||process.env.AWS_S3_PUBLIC_URL;
  if(!bucket||!accessKeyId||!secretAccessKey||!publicBase)return NextResponse.json({error:'Profile photo storage is not configured yet. Please contact the site administrator.'},{status:503});
  const s3=new S3Client({region,endpoint,forcePathStyle:!!endpoint,credentials:{accessKeyId,secretAccessKey}});
  const key='staff-avatars/'+id+'/'+randomUUID()+'.'+ext;
  const bytes=Buffer.from(await file.arrayBuffer());
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:file.type,CacheControl:'public, max-age=31536000, immutable'}));
  const base=publicBase.replace(/\/$/,'');
  const url=base+'/'+key.split('/').map(encodeURIComponent).join('/');
  const p=getDatabasePool();await ensureSiteTenants(p);
  const values=admin?[url,id]:[url,id,staff.tenant_id];
  const updated=admin
   ?await p.query('UPDATE public.staff_accounts SET avatar_url=$1,updated_at=now() WHERE id=$2 AND role<>\'super_admin\' RETURNING id,avatar_url',[...values])
   :await p.query('UPDATE public.staff_accounts SET avatar_url=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING id,avatar_url',values);
  if(!updated.rowCount)return NextResponse.json({error:'Staff account not found.'},{status:404});
  return NextResponse.json({ok:true,avatar_url:updated.rows[0].avatar_url});
 }catch(e){console.error('Staff profile photo upload',e.code||e.message);return NextResponse.json({error:'Could not upload the profile photo. Please try again.'},{status:500});}
}
