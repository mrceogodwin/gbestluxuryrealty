import {NextResponse} from 'next/server';
import {createHash,randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {getDatabasePool} from '../../../../lib/db';
import {resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='gbest_client_session',MAX_BYTES=5*1024*1024;
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'};
export async function POST(req){
 try{
  if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const token=req.cookies.get(COOKIE)?.value;
  if(!token||token.length<32||token.length>128)return NextResponse.json({error:'Please sign in again.'},{status:401});
  const pool=getDatabasePool(),host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'Client account not found.'},{status:401});
  const hash=createHash('sha256').update(token).digest('hex');
  const q=await pool.query(`SELECT r.id,r.tenant_id FROM public.client_sessions s JOIN public.client_registrations r ON r.id=s.registration_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND r.tenant_id=$2 AND r.client_status='active' LIMIT 1`,[hash,tenant.id]);
  if(!q.rowCount)return NextResponse.json({error:'Please sign in again.'},{status:401});
  const form=await req.formData(),file=form.get('photo');
  if(!file||typeof file.arrayBuffer!=='function')return NextResponse.json({error:'Choose a profile photo.'},{status:400});
  const ext=TYPES[file.type];if(!ext)return NextResponse.json({error:'Use a JPG, PNG, WebP or AVIF image.'},{status:415});
  if(file.size<1||file.size>MAX_BYTES)return NextResponse.json({error:'Your photo must be 5 MB or smaller.'},{status:413});
  const bucket=process.env.S3_BUCKET_NAME||process.env.AWS_S3_BUCKET,region=process.env.AWS_REGION||'auto',endpoint=process.env.S3_ENDPOINT||process.env.AWS_ENDPOINT_URL_S3,accessKeyId=process.env.AWS_ACCESS_KEY_ID,secretAccessKey=process.env.AWS_SECRET_ACCESS_KEY,publicBase=process.env.S3_PUBLIC_URL||process.env.AWS_S3_PUBLIC_URL;
  if(!bucket||!accessKeyId||!secretAccessKey||!publicBase)return NextResponse.json({error:'Profile photo storage is not configured. Please contact G-BEST.'},{status:503});
  const s3=new S3Client({region,endpoint,forcePathStyle:!!endpoint,credentials:{accessKeyId,secretAccessKey}});
  const key='client-avatars/'+String(q.rows[0].id)+'/'+randomUUID()+'.'+ext;
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:Buffer.from(await file.arrayBuffer()),ContentType:file.type,CacheControl:'public, max-age=31536000, immutable'}));
  const url=publicBase.replace(/\/$/,'')+'/'+key.split('/').map(encodeURIComponent).join('/');
  await pool.query('UPDATE public.client_registrations SET avatar_url=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3',[url,q.rows[0].id,tenant.id]);
  return NextResponse.json({ok:true,avatarUrl:url},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Client profile photo upload failed',e.code||e.name,e.message);return NextResponse.json({error:'Could not upload your photo. Please try again.'},{status:500});}
}
