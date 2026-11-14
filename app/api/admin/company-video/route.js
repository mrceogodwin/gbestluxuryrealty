import {NextResponse} from 'next/server';
import {S3Client,PutObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {randomUUID} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
export const runtime='nodejs';export const dynamic='force-dynamic';
function storage(){
 const endpoint=process.env.NEON_STORAGE_ENDPOINT,region=process.env.NEON_STORAGE_REGION,bucket=process.env.NEON_STORAGE_BUCKET;
 const accessKeyId=process.env.NEON_STORAGE_ACCESS_KEY_ID,secretAccessKey=process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
 if(!endpoint||!region||!bucket||!accessKeyId||!secretAccessKey)throw new Error('Neon media storage is not configured.');
 return {s3:new S3Client({region,endpoint,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}}),bucket,endpoint};
}
const publicUrl=(endpoint,bucket,key)=>(process.env.NEON_STORAGE_PUBLIC_BASE_URL||endpoint.replace(/\/$/,'')+'/'+bucket).replace(/\/$/,'')+'/'+key.split('/').map(encodeURIComponent).join('/');
async function context(req,requested){
 const p=getDatabasePool();await ensureSiteTenants(p);const admin=await isAdminRequest(req);let id=requested;
 if(!admin){const staff=await getStaffSession(req);id=staff?.tenant_id;}
 else if(id===undefined||id===null||id===''){const owner=await p.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");id=owner.rows[0]?.id;}
 if(!Number.isSafeInteger(Number(id))||Number(id)<1)throw new Error('Choose a valid company workspace.');
 const q=await p.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE id=$1',[id]);
 if(!q.rowCount||q.rows[0].status!=='active')throw new Error('Company workspace is unavailable.');
 return {pool:p,tenant:q.rows[0],admin};
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const url=new URL(req.url),{pool,tenant,admin}=await context(req,url.searchParams.get('tenantId'));
  const q=await pool.query('SELECT video_url,title,description,file_name,mime_type,file_size,updated_at FROM public.company_profile_video_tenants WHERE tenant_id=$1',[tenant.id]);
  const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[];
  return NextResponse.json({video:q.rows[0]||null,tenant,tenants,activeTenantId:tenant.id},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Company video admin GET',e.code||e.message);return NextResponse.json({error:'Could not load company video settings.'},{status:500});}
}
export async function POST(req){
 if(!await authorizeAdminRequest(req,'media.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const b=await req.json(),{pool,tenant}=await context(req,b.tenant_id),{s3,bucket,endpoint}=storage(),prefix='company-video/'+tenant.id+'/';
  if(b.action==='presign'){
   const type=String(b.mimeType||''),size=Number(b.fileSize);
   if(!['video/mp4','video/webm','video/quicktime'].includes(type))return NextResponse.json({error:'Upload an MP4, WebM or MOV video.'},{status:400});
   if(!Number.isSafeInteger(size)||size<1||size>200*1024*1024)return NextResponse.json({error:'Company video must be 200 MB or smaller.'},{status:400});
   const name=String(b.fileName||'company-video').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100)||'company-video',key=prefix+Date.now()+'-'+randomUUID()+'-'+name;
   const url=await getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:type}),{expiresIn:600});
   return NextResponse.json({upload:{url,headers:{'Content-Type':type}},objectKey:key,tenant_id:tenant.id});
  }
  if(b.action==='complete'){
   const key=String(b.objectKey||'');
   if(!key.startsWith(prefix)||key.includes('..')||key.length>1024)return NextResponse.json({error:'Invalid video key for this company workspace.'},{status:400});
   const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key})),type=String(head.ContentType||'');
   if(!['video/mp4','video/webm','video/quicktime'].includes(type))return NextResponse.json({error:'The uploaded file is not a supported video.'},{status:400});
   const url=publicUrl(endpoint,bucket,key),title=String(b.title||'Company Featured Property Film').trim().slice(0,180)||'Company Featured Property Film',description=String(b.description||'').trim().slice(0,1200),fileName=String(b.fileName||'company-video').slice(0,255),size=Number(head.ContentLength||b.fileSize)||0;
   const q=await pool.query(`INSERT INTO public.company_profile_video_tenants(tenant_id,video_url,title,description,file_name,mime_type,file_size,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(tenant_id) DO UPDATE SET video_url=EXCLUDED.video_url,title=EXCLUDED.title,description=EXCLUDED.description,file_name=EXCLUDED.file_name,mime_type=EXCLUDED.mime_type,file_size=EXCLUDED.file_size,updated_at=now()
    RETURNING video_url,title,description,file_name,mime_type,file_size,updated_at`,[tenant.id,url,title,description,fileName,type,size]);
   return NextResponse.json({video:q.rows[0],message:'Company video uploaded and published.'},{status:201});
  }
  return NextResponse.json({error:'Unknown video action.'},{status:400});
 }catch(e){console.error('Company video admin POST',e.code||e.message);const unavailable=String(e.message||'').includes('not configured');return NextResponse.json({error:unavailable?e.message:'Could not process the company video.'},{status:unavailable?503:500});}
}
