import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};
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
   const messages=await pool.query(`SELECT id,sender_type,sender_id,body,created_at,read_at FROM public.client_chat_messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`,[id]);
   return NextResponse.json({conversation:c.rows[0],messages:messages.rows.reverse()},{headers:noStore});
  }
  const q=await pool.query(`SELECT c.id,c.status,c.handoff_status,c.assigned_staff_id,c.assigned_by,c.assigned_at,c.created_at,c.last_message_at,r.client_id,r.full_name,r.email,r.phone,
   a.full_name AS assigned_staff_name,a.avatar_url AS assigned_staff_avatar_url,CASE WHEN $2::boolean THEN a.phone_number END AS assigned_staff_phone_number,
   CASE WHEN p.last_seen_at>now()-interval '90 seconds' AND p.presence='online' THEN 'online' WHEN p.last_seen_at>now()-interval '90 seconds' THEN p.presence ELSE 'offline' END AS assigned_staff_presence,
   (SELECT count(*)::int FROM public.client_chat_messages m WHERE m.conversation_id=c.id AND m.sender_type='client' AND m.read_at IS NULL) AS unread_count,
   (SELECT body FROM public.client_chat_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
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
  if(!/^[0-9a-f-]{36}$/i.test(id)||!message||message.length>4000)return NextResponse.json({error:'A conversation and a message of 1–4,000 characters are required.'},{status:400});
  const pool=getDatabasePool(),ctx=await context(req,pool,d?.tenantId);
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
   const saved=await db.query("INSERT INTO public.client_chat_messages(conversation_id,sender_type,sender_id,body) VALUES($1,$2,$3,$4) RETURNING id,sender_type,sender_id,body,created_at,read_at",[id,sender,senderId,message]);
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
    const valid=await pool.query("SELECT id,full_name FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 AND status='active' AND role<>'super_admin'",[staffId,ctx.tenantId]);
    if(!valid.rowCount)return NextResponse.json({error:'That staff member is not active in this workspace.'},{status:400});
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
