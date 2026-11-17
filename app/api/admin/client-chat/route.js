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
 if(!/^\\d+$/.test(String(tenantId||'')))throw new Error('Choose a valid company workspace.');
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
   const c=await pool.query(`SELECT c.id,c.status,c.assigned_staff_id,c.created_at,c.last_message_at,r.id AS registration_id,r.client_id,r.full_name,r.email,r.phone
    FROM public.client_chat_conversations c JOIN public.client_registrations r ON r.id=c.registration_id AND r.tenant_id=c.tenant_id
    WHERE c.id=$1 AND c.tenant_id=$2 LIMIT 1`,[id,ctx.tenantId]);
   if(!c.rowCount)return NextResponse.json({error:'Conversation not found.'},{status:404});
   const messages=await pool.query(`SELECT id,sender_type,sender_id,body,created_at,read_at FROM public.client_chat_messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 500`,[id]);
   return NextResponse.json({conversation:c.rows[0],messages:messages.rows},{headers:noStore});
  }
  const q=await pool.query(`SELECT c.id,c.status,c.assigned_staff_id,c.created_at,c.last_message_at,r.client_id,r.full_name,r.email,r.phone,
   (SELECT count(*)::int FROM public.client_chat_messages m WHERE m.conversation_id=c.id AND m.sender_type='client' AND m.read_at IS NULL) AS unread_count,
   (SELECT body FROM public.client_chat_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
   FROM public.client_chat_conversations c JOIN public.client_registrations r ON r.id=c.registration_id AND r.tenant_id=c.tenant_id
   WHERE c.tenant_id=$1 ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC LIMIT 200`,[ctx.tenantId]);
  const tenants=ctx.admin?(await pool.query('SELECT id,display_name,status FROM public.site_tenants ORDER BY created_at')).rows:[];
  return NextResponse.json({conversations:q.rows,tenants,activeTenantId:ctx.tenantId},{headers:noStore});
 }catch(e){console.error('Admin chat list failed',e.code||e.message);return NextResponse.json({error:e.message||'Could not load conversations.'},{status:400,headers:noStore});}
}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 if(!await authorizeAdminRequest(req,['clients.view','clients.manage']))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const d=await req.json().catch(()=>null),id=String(d?.conversationId||''),message=String(d?.message||'').trim();
  if(!/^[0-9a-f-]{36}$/i.test(id)||!message||message.length>4000)return NextResponse.json({error:'A conversation and a message of 1–4,000 characters are required.'},{status:400});
  const pool=getDatabasePool(),ctx=await context(req,pool,d?.tenantId);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const c=await db.query('SELECT id,status,tenant_id FROM public.client_chat_conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,ctx.tenantId]);
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
 if(!await authorizeAdminRequest(req,['clients.view','clients.manage']))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const d=await req.json().catch(()=>null),id=String(d?.conversationId||''),action=String(d?.action||'');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!['close','reopen','assign','read'].includes(action))return NextResponse.json({error:'Invalid conversation action.'},{status:400});
  const pool=getDatabasePool(),ctx=await context(req,pool,d?.tenantId);
  if(action==='assign'&&!ctx.admin)return NextResponse.json({error:'Only an administrator can assign conversations.'},{status:403});
  const c=await pool.query('SELECT id FROM public.client_chat_conversations WHERE id=$1 AND tenant_id=$2',[id,ctx.tenantId]);
  if(!c.rowCount)return NextResponse.json({error:'Conversation not found.'},{status:404});
  if(action==='close'||action==='reopen')await pool.query('UPDATE public.client_chat_conversations SET status=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2',[id,ctx.tenantId,action==='close'?'closed':'open']);
  if(action==='assign'){const staffId=d?.staffId?String(d.staffId):null;if(staffId){const valid=await pool.query('SELECT id FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 AND status=$3',[staffId,ctx.tenantId,'active']);if(!valid.rowCount)return NextResponse.json({error:'That staff member is not active in this workspace.'},{status:400});}await pool.query('UPDATE public.client_chat_conversations SET assigned_staff_id=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2',[id,ctx.tenantId,staffId]);}
  if(action==='read')await pool.query("UPDATE public.client_chat_messages SET read_at=COALESCE(read_at,now()) WHERE conversation_id=$1 AND sender_type='client' AND read_at IS NULL",[id]);
  return NextResponse.json({ok:true},{headers:noStore});
 }catch(e){console.error('Admin chat action failed',e.code||e.message);return NextResponse.json({error:'Could not update this conversation.'},{status:503,headers:noStore});}
}
