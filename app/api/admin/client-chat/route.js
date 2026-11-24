import {NextResponse} from 'next/server';
import {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {randomUUID} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};

function attachmentStorage(){
 const endpoint=process.env.NEON_STORAGE_ENDPOINT,region=process.env.NEON_STORAGE_REGION,bucket=process.env.NEON_STORAGE_BUCKET;
 const accessKeyId=process.env.NEON_STORAGE_ACCESS_KEY_ID,secretAccessKey=process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
 if(!endpoint||!region||!bucket||!accessKeyId||!secretAccessKey)throw new Error('Chat file storage is not configured.');
 return {s3:new S3Client({region,endpoint,forcePathStyle:true,credentials:{accessKeyId,secretAccessKey}}),bucket,endpoint};
}
function attachmentPolicy(type){
 if(/^image\/(jpeg|png|webp|gif)$/.test(type))return {max:15*1024*1024,kind:'image'};
 if(type==='application/pdf')return {max:20*1024*1024,kind:'document'};
 if(/^audio\/(mpeg|mp4|wav|ogg|webm)$/.test(type))return {max:25*1024*1024,kind:'audio'};
 if(/^video\/(mp4|webm)$/.test(type))return {max:50*1024*1024,kind:'video'};
 return null;
}
async function signMessageAttachments(rows){
 const list=Array.isArray(rows)?rows:[];
 if(!list.some(m=>Array.isArray(m.attachments)&&m.attachments.length))return list.map(m=>({...m,attachments:Array.isArray(m.attachments)?m.attachments:[]}));
 const {s3,bucket}=attachmentStorage();
 return Promise.all(list.map(async m=>({...m,attachments:await Promise.all((Array.isArray(m.attachments)?m.attachments:[]).map(async a=>({...a,url:await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:a.objectKey,ResponseContentDisposition:'inline'}),{expiresIn:3600})})))})));
}
async function accessibleConversation(pool,id,ctx){
 const q=await pool.query(`SELECT c.id,c.status FROM public.client_chat_conversations c
  WHERE c.id=$1 AND c.tenant_id=$2 AND ($3::boolean OR c.assigned_staff_id=$4
   OR EXISTS(SELECT 1 FROM public.client_chat_participants cp WHERE cp.conversation_id=c.id AND cp.tenant_id=c.tenant_id AND cp.staff_id=$4 AND cp.removed_at IS NULL)) LIMIT 1`,[id,ctx.tenantId,ctx.admin,ctx.staff?.id||null]);
 return q.rows[0]||null;
}

async function context(req,pool,requested){
 await ensureSiteTenants(pool);
 const admin=await isAdminRequest(req);let staff=null,tenantId=requested;
 if(!admin){staff=await getStaffSession(req);tenantId=staff?.tenant_id;}
 else if(!tenantId){const q=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");tenantId=q.rows[0]?.id;}
 if(!/^\d+$/.test(String(tenantId||'')))throw new Error('Choose a valid company workspace.');
 const tenant=await pool.query('SELECT id FROM public.site_tenants WHERE id=$1',[tenantId]);
 if(!tenant.rowCount)throw new Error('Company workspace not found.');
 return {admin,staff,tenantId:Number(tenant.rows[0].id)};
}
export async function GET(req){
 if(!await authorizeAdminRequest(req,['clients.view','clients.manage']))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const pool=getDatabasePool(),url=new URL(req.url),ctx=await context(req,pool,url.searchParams.get('tenantId'));
  const id=url.searchParams.get('conversationId');
  if(id){
   if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid conversation ID.'},{status:400});
   const c=await pool.query(`SELECT c.id,c.status,c.handoff_status,c.assigned_staff_id,c.assigned_by,c.assigned_at,c.created_at,c.last_message_at,r.id AS registration_id,r.client_id,r.full_name,r.email,r.phone,
    a.full_name AS assigned_staff_name,a.avatar_url AS assigned_staff_avatar_url,CASE WHEN $3::boolean THEN a.phone_number END AS assigned_staff_phone_number,CASE WHEN $3::boolean THEN a.email END AS assigned_staff_email,
    CASE WHEN p.last_seen_at>now()-interval '120 seconds' AND p.presence='online' THEN 'online' WHEN p.last_seen_at>now()-interval '90 seconds' THEN p.presence ELSE 'offline' END AS assigned_staff_presence,p.last_seen_at AS assigned_staff_last_seen_at
    FROM public.client_chat_conversations c JOIN public.client_registrations r ON r.id=c.registration_id AND r.tenant_id=c.tenant_id
    LEFT JOIN public.staff_accounts a ON a.id=c.assigned_staff_id AND a.tenant_id=c.tenant_id
    LEFT JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id
    WHERE c.id=$1 AND c.tenant_id=$2
      AND ($3::boolean OR c.assigned_staff_id=$4
        OR EXISTS(SELECT 1 FROM public.client_chat_participants cp WHERE cp.conversation_id=c.id AND cp.tenant_id=c.tenant_id AND cp.staff_id=$4 AND cp.removed_at IS NULL)
        OR EXISTS(SELECT 1 FROM public.client_chat_monitor_access ma WHERE ma.conversation_id=c.id AND ma.tenant_id=c.tenant_id AND ma.staff_id=$4 AND ma.revoked_at IS NULL)
        OR (c.assigned_staff_id IS NULL AND c.handoff_status='requested'))
    LIMIT 1`,[id,ctx.tenantId,ctx.admin,ctx.staff?.id||null]);
   if(!c.rowCount)return NextResponse.json({error:'Conversation not found.'},{status:404});
   const messages=await pool.query(`SELECT id,sender_type,sender_id,body,attachments,created_at,read_at FROM public.client_chat_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`,[id]);
   const signedMessages=await signMessageAttachments(messages.rows.reverse());
   return NextResponse.json({conversation:c.rows[0],messages:signedMessages},{headers:noStore});
  }
  const q=await pool.query(`SELECT c.id,c.status,c.handoff_status,c.assigned_staff_id,c.assigned_by,c.assigned_at,c.created_at,c.last_message_at,r.client_id,r.full_name,r.email,r.phone,
   a.full_name AS assigned_staff_name,a.avatar_url AS assigned_staff_avatar_url,CASE WHEN $2::boolean THEN a.phone_number END AS assigned_staff_phone_number,
   CASE WHEN p.last_seen_at>now()-interval '90 seconds' AND p.presence='online' THEN 'online' WHEN p.last_seen_at>now()-interval '90 seconds' THEN p.presence ELSE 'offline' END AS assigned_staff_presence,
   (SELECT count(*)::int FROM public.client_chat_messages m WHERE m.conversation_id=c.id AND m.sender_type='client' AND m.read_at IS NULL) AS unread_count,
   (SELECT COALESCE(NULLIF(body,''),'Shared an attachment') FROM public.client_chat_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
   FROM public.client_chat_conversations c JOIN public.client_registrations r ON r.id=c.registration_id AND r.tenant_id=c.tenant_id
   LEFT JOIN public.staff_accounts a ON a.id=c.assigned_staff_id AND a.tenant_id=c.tenant_id
   LEFT JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id
   WHERE c.tenant_id=$1 AND ($2::boolean OR c.assigned_staff_id=$3
     OR EXISTS(SELECT 1 FROM public.client_chat_participants cp WHERE cp.conversation_id=c.id AND cp.tenant_id=c.tenant_id AND cp.staff_id=$3 AND cp.removed_at IS NULL)
     OR EXISTS(SELECT 1 FROM public.client_chat_monitor_access ma WHERE ma.conversation_id=c.id AND ma.tenant_id=c.tenant_id AND ma.staff_id=$3 AND ma.revoked_at IS NULL)
     OR (c.assigned_staff_id IS NULL AND c.handoff_status='requested'))
   ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC LIMIT 200`,[ctx.tenantId,ctx.admin,ctx.staff?.id||null]);
  const tenants=ctx.admin?(await pool.query('SELECT id,display_name,status FROM public.site_tenants ORDER BY created_at')).rows:[];
  const staff=ctx.admin?(await pool.query(`SELECT a.id,a.full_name,a.email,a.phone_number,a.avatar_url,a.role,
    CASE WHEN p.last_seen_at>now()-interval '90 seconds' AND p.presence='online' THEN 'online' WHEN p.last_seen_at>now()-interval '90 seconds' THEN p.presence ELSE 'offline' END AS presence,
    p.last_seen_at,
    (SELECT count(*)::int FROM public.client_chat_conversations c WHERE c.tenant_id=a.tenant_id AND c.assigned_staff_id=a.id AND c.status='open') AS assigned_count
    FROM public.staff_accounts a LEFT JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id
    WHERE a.tenant_id=$1 AND a.role<>'super_admin' AND a.status='active' ORDER BY CASE WHEN p.last_seen_at>now()-interval '90 seconds' AND p.presence='online' THEN 0 ELSE 1 END,a.full_name`,[ctx.tenantId])).rows:[];
  return NextResponse.json({conversations:q.rows,staff,tenants,activeTenantId:ctx.tenantId},{headers:noStore});
 }catch(e){console.error('Admin chat list failed',e.code||e.message);return NextResponse.json({error:e.message||'Could not load conversations.'},{status:400,headers:noStore});}
}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 if(!await authorizeAdminRequest(req,'clients.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const d=await req.json().catch(()=>null),id=String(d?.conversationId||''),message=String(d?.message||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'A valid conversation is required.'},{status:400});
  const pool=getDatabasePool(),ctx=await context(req,pool,d?.tenantId);
  if(d?.action==='attachment-presign'){
   const conversation=await accessibleConversation(pool,id,ctx);
   if(!conversation)return NextResponse.json({error:'Conversation not found.'},{status:404});
   if(conversation.status!=='open')return NextResponse.json({error:'Reopen this conversation before attaching a file.'},{status:409});
   const fileName=String(d.fileName||'attachment').normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'-').slice(-100)||'attachment';
   const mimeType=String(d.mimeType||'').toLowerCase(),fileSize=Number(d.fileSize),policy=attachmentPolicy(mimeType);
   if(!policy)return NextResponse.json({error:'Choose an image, PDF, audio or MP4/WebM video file.'},{status:400});
   if(!Number.isSafeInteger(fileSize)||fileSize<1||fileSize>policy.max)return NextResponse.json({error:'This file is larger than the allowed size for its type.'},{status:413});
   const {s3,bucket}=attachmentStorage(),key='chat/'+ctx.tenantId+'/'+id+'/'+Date.now()+'-'+randomUUID()+'-'+fileName;
   const uploadUrl=await getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:mimeType}),{expiresIn:300});
   return NextResponse.json({upload:{url:uploadUrl,headers:{'Content-Type':mimeType}},objectKey:key},{headers:noStore});
  }
  if(d?.action==='attachment-complete'){
   const conversation=await accessibleConversation(pool,id,ctx);
   if(!conversation)return NextResponse.json({error:'Conversation not found.'},{status:404});
   if(conversation.status!=='open')return NextResponse.json({error:'Reopen this conversation before attaching a file.'},{status:409});
   const key=String(d.objectKey||''),prefix='chat/'+ctx.tenantId+'/'+id+'/';
   if(!key.startsWith(prefix)||key.includes('..')||key.length>1024)return NextResponse.json({error:'Invalid attachment object key.'},{status:400});
   const {s3,bucket}=attachmentStorage(),head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key}));
   const mimeType=String(head.ContentType||'').toLowerCase(),fileSize=Number(head.ContentLength||0),policy=attachmentPolicy(mimeType);
   if(!policy||!Number.isSafeInteger(fileSize)||fileSize<1||fileSize>policy.max)return NextResponse.json({error:'The uploaded attachment is not supported or exceeds its size limit.'},{status:413});
   return NextResponse.json({attachment:{objectKey:key,fileName:String(d.fileName||key.split('/').pop()).slice(0,160),mimeType,fileSize,kind:policy.kind}},{headers:noStore});
  }
  const inputAttachments=Array.isArray(d?.attachments)?d.attachments:[];
  if(inputAttachments.length>5||(!message&&!inputAttachments.length)||message.length>4000)return NextResponse.json({error:'Enter a message or attach up to five files.'},{status:400});
  const conversation=await accessibleConversation(pool,id,ctx);
  if(!conversation)return NextResponse.json({error:'Conversation not found.'},{status:404});
  if(conversation.status!=='open')return NextResponse.json({error:'This conversation is closed.'},{status:409});
  const attachments=[];
  if(inputAttachments.length){
   const {s3,bucket}=attachmentStorage(),prefix='chat/'+ctx.tenantId+'/'+id+'/';
   for(const item of inputAttachments){
    const key=String(item?.objectKey||'');
    if(!key.startsWith(prefix)||key.includes('..')||key.length>1024) return NextResponse.json({error:'An attachment does not belong to this conversation.'},{status:400});
    const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:key})),mimeType=String(head.ContentType||'').toLowerCase(),fileSize=Number(head.ContentLength||0),policy=attachmentPolicy(mimeType);
    if(!policy||!Number.isSafeInteger(fileSize)||fileSize<1||fileSize>policy.max)return NextResponse.json({error:'An attachment is unsupported or exceeds its size limit.'},{status:413});
    attachments.push({objectKey:key,fileName:String(item.fileName||key.split('/').pop()).slice(0,160),mimeType,fileSize,kind:policy.kind});
   }
  }
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const c=await db.query(`SELECT c.id,c.status,c.tenant_id FROM public.client_chat_conversations c
    WHERE c.id=$1 AND c.tenant_id=$2 AND ($3::boolean OR c.assigned_staff_id=$4
      OR EXISTS(SELECT 1 FROM public.client_chat_participants cp WHERE cp.conversation_id=c.id AND cp.tenant_id=c.tenant_id AND cp.staff_id=$4 AND cp.removed_at IS NULL))
    FOR UPDATE`,[id,ctx.tenantId,ctx.admin,ctx.staff?.id||null]);
   if(!c.rowCount){await db.query('ROLLBACK');return NextResponse.json({error:'Conversation not found.'},{status:404});}
   if(c.rows[0].status!=='open'){await db.query('ROLLBACK');return NextResponse.json({error:'This conversation is closed.'},{status:409});}
   const sender=ctx.admin?'admin':'staff',senderId=ctx.admin?'master-admin':ctx.staff.email;
   const saved=await db.query("INSERT INTO public.client_chat_messages(conversation_id,sender_type,sender_id,body,attachments) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,sender_type,sender_id,body,attachments,created_at,read_at",[id,sender,senderId,message||'Shared an attachment',JSON.stringify(attachments)]);
   await db.query('UPDATE public.client_chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1',[id]);
   await db.query("UPDATE public.client_chat_messages SET read_at=COALESCE(read_at,now()) WHERE conversation_id=$1 AND sender_type='client' AND read_at IS NULL",[id]);
   await db.query('COMMIT');
   return NextResponse.json({ok:true,message:saved.rows[0]},{status:201,headers:noStore});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
 }catch(e){console.error('Admin chat reply failed',e.code||e.message);return NextResponse.json({error:'Could not send your reply.'},{status:503,headers:noStore});}
}
export async function PATCH(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 if(!await authorizeAdminRequest(req,'clients.manage'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const d=await req.json().catch(()=>null),id=String(d?.conversationId||''),action=String(d?.action||'');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!['close','reopen','assign','claim','read'].includes(action))return NextResponse.json({error:'Invalid conversation action.'},{status:400});
  const pool=getDatabasePool(),ctx=await context(req,pool,d?.tenantId);
  if(action==='assign'&&!ctx.admin)return NextResponse.json({error:'Only an administrator can assign conversations.'},{status:403});
  if(action==='claim'&&(!ctx.staff||ctx.admin))return NextResponse.json({error:'Only a signed-in staff member can claim a waiting conversation.'},{status:403});
  const c=await pool.query(`SELECT c.id FROM public.client_chat_conversations c
   WHERE c.id=$1 AND c.tenant_id=$2 AND ($3::boolean OR c.assigned_staff_id=$4
     OR EXISTS(SELECT 1 FROM public.client_chat_participants cp WHERE cp.conversation_id=c.id AND cp.tenant_id=c.tenant_id AND cp.staff_id=$4 AND cp.removed_at IS NULL)
     OR (c.assigned_staff_id IS NULL AND c.handoff_status='requested'))
   `,[id,ctx.tenantId,ctx.admin,ctx.staff?.id||null]);
  if(!c.rowCount)return NextResponse.json({error:'Conversation not found.'},{status:404});
  if(action==='claim'){
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    const claimed=await db.query(`UPDATE public.client_chat_conversations
     SET assigned_staff_id=$3,assigned_by=$4,assigned_at=now(),handoff_status='assigned',handoff_resolved_at=NULL,updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND assigned_staff_id IS NULL AND handoff_status='requested' AND status='open'
     RETURNING id`,[id,ctx.tenantId,ctx.staff.id,ctx.staff.email]);
    if(!claimed.rowCount){await db.query('ROLLBACK');return NextResponse.json({error:'This request has already been claimed or is no longer waiting.'},{status:409,headers:noStore});}
    await db.query(`INSERT INTO public.client_chat_participants(conversation_id,tenant_id,staff_id,added_by,added_at,removed_at)
     VALUES($1,$2,$3,$4,now(),NULL) ON CONFLICT(conversation_id,staff_id) DO UPDATE SET added_by=EXCLUDED.added_by,added_at=now(),removed_at=NULL`,[id,ctx.tenantId,ctx.staff.id,ctx.staff.email]);
    await db.query(`INSERT INTO public.client_chat_handover_events(tenant_id,conversation_id,event_type,actor_type,actor_id,details)
     VALUES($1,$2,'staff_joined','staff',$3,$4::jsonb)`,[ctx.tenantId,id,ctx.staff.id,JSON.stringify({staffId:ctx.staff.id,fullName:ctx.staff.full_name,claimed:true})]);
    await db.query(`INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id)
     VALUES($1,$2,'chat_assigned','Waiting client chat claimed','You claimed a waiting client conversation.','client_chat',$3)`,[ctx.tenantId,ctx.staff.id,id]);
    await db.query('COMMIT');
    return NextResponse.json({ok:true,claimed:true},{headers:noStore});
   }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{db.release();}
  }
  if(action==='close'||action==='reopen')await pool.query('UPDATE public.client_chat_conversations SET status=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2',[id,ctx.tenantId,action==='close'?'closed':'open']);
  if(action==='assign'){
   const staffId=d?.staffId?String(d.staffId):null;
   const current=await pool.query('SELECT assigned_staff_id FROM public.client_chat_conversations WHERE id=$1 AND tenant_id=$2',[id,ctx.tenantId]);
   if(!current.rowCount)return NextResponse.json({error:'Conversation not found.'},{status:404});
   let selectedStaff=null;
   if(staffId){
    const valid=await pool.query(`SELECT a.id,a.full_name
     FROM public.staff_accounts a
     JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id
     WHERE a.id=$1 AND a.tenant_id=$2 AND a.status='active' AND a.role<>'super_admin'
       AND p.presence='online' AND p.last_seen_at>now()-interval '90 seconds'
     LIMIT 1`,[staffId,ctx.tenantId]);
    if(!valid.rowCount)return NextResponse.json({error:'That team member is not currently online. Refresh the team list and choose an available colleague.'},{status:409,headers:noStore});
    selectedStaff=valid.rows[0];
   }
   if(String(current.rows[0].assigned_staff_id||'')!==String(staffId||'')){
    if(staffId){
     await pool.query("UPDATE public.client_chat_participants SET removed_at=now() WHERE conversation_id=$1 AND tenant_id=$2 AND removed_at IS NULL AND staff_id<>$3",[id,ctx.tenantId,staffId]);
     await pool.query("INSERT INTO public.client_chat_participants(conversation_id,tenant_id,staff_id,added_by,added_at,removed_at) VALUES($1,$2,$3,$4,now(),NULL) ON CONFLICT(conversation_id,staff_id) DO UPDATE SET added_by=EXCLUDED.added_by,added_at=now(),removed_at=NULL",[id,ctx.tenantId,staffId,'master-admin']);
     await pool.query("UPDATE public.client_chat_conversations SET assigned_staff_id=$3,assigned_by='master-admin',assigned_at=now(),handoff_status='assigned',handoff_resolved_at=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2",[id,ctx.tenantId,staffId]);
     await pool.query("INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id) VALUES($1,$2,$3,$4,$5,'client_chat',$6)",[ctx.tenantId,staffId,current.rows[0].assigned_staff_id?'chat_reassigned':'chat_assigned',current.rows[0].assigned_staff_id?'Client chat reassigned':'New client chat assigned','A client conversation has been assigned to you. Open the Client Chats inbox to respond.',id]);
     await pool.query("INSERT INTO public.client_chat_handover_events(tenant_id,conversation_id,event_type,actor_type,actor_id,details) VALUES($1,$2,'staff_joined','super_admin','master-admin',$3::jsonb)",[ctx.tenantId,id,JSON.stringify({staffId,fullName:selectedStaff.full_name,assignedBy:'master-admin'})]);
    }else{
     await pool.query("UPDATE public.client_chat_participants SET removed_at=now() WHERE conversation_id=$1 AND tenant_id=$2 AND removed_at IS NULL",[id,ctx.tenantId]);
     await pool.query("UPDATE public.client_chat_conversations SET assigned_staff_id=NULL,assigned_by='master-admin',assigned_at=NULL,handoff_status='agent_only',handoff_resolved_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2",[id,ctx.tenantId]);
     await pool.query("INSERT INTO public.client_chat_handover_events(tenant_id,conversation_id,event_type,actor_type,actor_id,details) VALUES($1,$2,'agent_resumed','super_admin','master-admin',$3::jsonb)",[ctx.tenantId,id,JSON.stringify({reason:'assignment_removed'})]);
    }
   }
  }
  if(action==='read')await pool.query("UPDATE public.client_chat_messages SET read_at=COALESCE(read_at,now()) WHERE conversation_id=$1 AND sender_type='client' AND read_at IS NULL",[id]);
  return NextResponse.json({ok:true},{headers:noStore});
 }catch(e){console.error('Admin chat action failed',e.code||e.message);return NextResponse.json({error:'Could not update this conversation.'},{status:503,headers:noStore});}
}
