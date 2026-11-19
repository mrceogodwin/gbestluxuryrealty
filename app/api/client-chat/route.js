import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {getDatabasePool} from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const COOKIE='gbest_client_session';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};
async function clientContext(req){
 const token=req.cookies.get(COOKIE)?.value;
 if(!token||token.length<32||token.length>128)return null;
 const pool=getDatabasePool(),host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
 if(!tenant)return null;
 const hash=createHash('sha256').update(token).digest('hex');
 const q=await pool.query(`SELECT r.id,r.tenant_id,r.full_name,r.email,r.client_id
  FROM public.client_sessions s JOIN public.client_registrations r ON r.id::text=s.registration_id
  WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
   AND r.tenant_id=$2 AND r.payment_status IN ('approved','not_required','pending','rejected') AND r.client_status='active' LIMIT 1`,[hash,tenant.id]);
 return q.rows[0]||null;
}
export async function GET(req){
 try{
  const client=await clientContext(req);
  if(!client)return NextResponse.json({error:'Sign in with an active G-BEST client account to use Agent messaging.'},{status:401,headers:noStore});
  const pool=getDatabasePool();
  await pool.query("UPDATE public.client_chat_messages m SET read_at=COALESCE(m.read_at,now()) FROM public.client_chat_conversations c WHERE m.conversation_id=c.id AND c.tenant_id=$1 AND c.registration_id=$2 AND m.sender_type IN ('admin','staff') AND m.read_at IS NULL",[client.tenant_id,client.id]);
  const q=await pool.query(`SELECT c.id AS conversation_id,c.status,c.handoff_status,c.handoff_requested_at,c.created_at,c.last_message_at,
   m.id AS message_id,m.sender_type,m.sender_id,m.body,m.created_at AS message_created_at,m.read_at
   FROM public.client_chat_conversations c
   LEFT JOIN public.client_chat_messages m ON m.conversation_id=c.id
   WHERE c.tenant_id=$1 AND c.registration_id=$2
   ORDER BY m.created_at ASC NULLS FIRST LIMIT 500`,[client.tenant_id,client.id]);
  const first=q.rows[0];
  const staff=first?.conversation_id?await pool.query(`SELECT a.id,a.full_name,a.avatar_url,a.phone_number,CASE WHEN p.last_seen_at>now()-interval '120 seconds' AND p.presence='online' THEN 'online' WHEN p.last_seen_at>now()-interval '90 seconds' THEN p.presence ELSE 'offline' END AS presence,p.last_seen_at
   FROM public.client_chat_conversations c
   JOIN public.client_chat_participants cp ON cp.conversation_id=c.id AND cp.removed_at IS NULL
   JOIN public.staff_accounts a ON a.id=cp.staff_id AND a.status='active'
   LEFT JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id
   WHERE c.id=$1
   UNION SELECT a.id,a.full_name,a.avatar_url,a.phone_number,CASE WHEN p.last_seen_at>now()-interval '90 seconds' AND p.presence='online' THEN 'online' WHEN p.last_seen_at>now()-interval '90 seconds' THEN p.presence ELSE 'offline' END,p.last_seen_at
   FROM public.client_chat_conversations c JOIN public.staff_accounts a ON a.id=c.assigned_staff_id
   LEFT JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id WHERE c.id=$1`,[first.conversation_id]):{rows:[]};
  const events=first?.conversation_id?await pool.query(`SELECT e.event_type,e.created_at,a.full_name,a.avatar_url FROM public.client_chat_handover_events e LEFT JOIN public.staff_accounts a ON a.id::text=e.details->>'staffId' WHERE e.conversation_id=$1 ORDER BY e.created_at DESC LIMIT 12`,[first.conversation_id]):{rows:[]};
  return NextResponse.json({conversation:first?{id:first.conversation_id,status:first.status,handoffStatus:first.handoff_status,handoffRequestedAt:first.handoff_requested_at,created_at:first.created_at,last_message_at:first.last_message_at}:null,
   humanAvailable:staff.rows.some(s=>s.presence==='online'),staff:staff.rows,events:events.rows,
   messages:q.rows.filter(x=>x.message_id).map(x=>({id:x.message_id,sender_type:x.sender_type,sender_id:x.sender_id,body:x.body,created_at:x.message_created_at,read_at:x.read_at}))},{headers:noStore});
 }catch(e){console.error('Client chat load failed',e.code||e.message);return NextResponse.json({error:'Could not load your messages right now.'},{status:503,headers:noStore});}
}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 try{
  const client=await clientContext(req);
  if(!client)return NextResponse.json({error:'Sign in with an active G-BEST client account to send messages.'},{status:401,headers:noStore});
  const pool=getDatabasePool();
  const body=await req.json().catch(()=>null);
  if(body?.action==='presence'){
   const presence=['online','away','offline'].includes(body?.presence)?body.presence:'online';
   await pool.query(`INSERT INTO public.client_presence(tenant_id,registration_id,presence,last_seen_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(tenant_id,registration_id) DO UPDATE SET presence=EXCLUDED.presence,last_seen_at=now(),updated_at=now()`,[client.tenant_id,client.id,presence]);
   return NextResponse.json({ok:true,presence},{headers:noStore});
  }
  if(body?.action==='request-human'){
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    const conv=await db.query(`INSERT INTO public.client_chat_conversations(tenant_id,registration_id,last_message_at,handoff_status,handoff_requested_at)
     VALUES($1,$2,now(),'requested',now()) ON CONFLICT(tenant_id,registration_id) DO UPDATE SET handoff_status=CASE WHEN public.client_chat_conversations.handoff_status='assigned' THEN 'assigned' ELSE 'requested' END,handoff_requested_at=COALESCE(public.client_chat_conversations.handoff_requested_at,now()),updated_at=now()
     RETURNING id,handoff_status`,[client.tenant_id,client.id]);
    await db.query("INSERT INTO public.client_chat_handover_events(tenant_id,conversation_id,event_type,actor_type,actor_id) VALUES($1,$2,'client_requested','client',$3)",[client.tenant_id,conv.rows[0].id,String(client.id)]);
    await db.query("INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id) SELECT $1,a.id,'chat_assigned','Client requested a human','A client has requested a human team member.','client_conversation',$2 FROM public.staff_accounts a WHERE a.tenant_id=$1 AND a.status='active' AND a.role<>'super_admin'",[client.tenant_id,conv.rows[0].id]);
    await db.query('COMMIT');
    return NextResponse.json({ok:true,conversationId:conv.rows[0].id,handoffStatus:conv.rows[0].handoff_status,message:'Your request has been sent. Agent can continue helping while a team member becomes available.'},{headers:noStore});
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  }
  const message=String(body?.message||'').trim();
  if(!message||message.length>4000)return NextResponse.json({error:'Enter a message of 1–4,000 characters.'},{status:400});
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const conv=await db.query(`INSERT INTO public.client_chat_conversations(tenant_id,registration_id,last_message_at)
    VALUES($1,$2,now()) ON CONFLICT(tenant_id,registration_id) DO UPDATE SET updated_at=now()
    RETURNING id,status`,[client.tenant_id,client.id]);
   if(conv.rows[0].status!=='open'){await db.query('ROLLBACK');return NextResponse.json({error:'This conversation is closed. Please contact G-BEST to reopen it.'},{status:409});}
   const saved=await db.query(`INSERT INTO public.client_chat_messages(conversation_id,sender_type,sender_id,body)
    VALUES($1,'client',$2,$3) RETURNING id,sender_type,body,created_at,read_at`,[conv.rows[0].id,String(client.id),message]);
   await db.query('UPDATE public.client_chat_conversations SET last_message_at=now(),last_client_message_at=now(),updated_at=now() WHERE id=$1',[conv.rows[0].id]);
   await db.query(`INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id)
    SELECT c.tenant_id,recipients.staff_id,'team_message',$3,left($4,420),'client_chat',c.id::text
    FROM public.client_chat_conversations c
    JOIN (
      SELECT c2.assigned_staff_id AS staff_id FROM public.client_chat_conversations c2
       WHERE c2.id=$2 AND c2.tenant_id=$1 AND c2.assigned_staff_id IS NOT NULL
      UNION
      SELECT cp.staff_id FROM public.client_chat_participants cp
       WHERE cp.conversation_id=$2 AND cp.tenant_id=$1 AND cp.removed_at IS NULL
    ) recipients ON true
    JOIN public.staff_accounts a ON a.id=recipients.staff_id AND a.tenant_id=c.tenant_id AND a.status='active'
    WHERE c.id=$2 AND c.tenant_id=$1`,[client.tenant_id,conv.rows[0].id,'New client message from '+client.full_name,message.slice(0,420)]);
   await db.query('COMMIT');
   let agentMessage=null,suggestHuman=false;
   try{
    const agentResponse=await fetch(new URL('/api/agent/chat',req.nextUrl.origin),{method:'POST',headers:{'Content-Type':'application/json','Origin':req.nextUrl.origin},body:JSON.stringify({message}),signal:AbortSignal.timeout(9000)});
    const agentData=await agentResponse.json();
    if(agentResponse.ok&&agentData.reply){suggestHuman=Boolean(agentData.suggestHuman);
     const stored=await pool.query("INSERT INTO public.client_chat_messages(conversation_id,sender_type,sender_id,body) VALUES($1,'agent','agent',$2) RETURNING id,sender_type,sender_id,body,created_at,read_at",[conv.rows[0].id,String(agentData.reply).slice(0,4000)]);
     agentMessage=stored.rows[0];
     await pool.query('UPDATE public.client_chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1',[conv.rows[0].id]);
    }
   }catch(agentError){console.warn('Agent fallback unavailable',agentError?.name||'error')}
   return NextResponse.json({ok:true,conversationId:conv.rows[0].id,message:saved.rows[0],agentMessage,suggestHuman},{status:201,headers:noStore});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
 }catch(e){console.error('Client chat send failed',e.code||e.message);return NextResponse.json({error:'Your message could not be sent. Please try again.'},{status:503,headers:noStore});}
}
