import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
export const runtime='nodejs';export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store'};
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
const clean=(v,n=4000)=>String(v??'').trim().slice(0,n);
async function actor(req,tenantRequested){
 const admin=await isAdminRequest(req),staff=admin?null:await getStaffSession(req);
 if(!admin&&!staff)return null;
 const pool=getDatabasePool();await ensureSiteTenants(pool);
 let tenantId=admin?String(tenantRequested||''):String(staff.tenant_id);
 let t;
 if(admin&&!tenantId){t=await pool.query("SELECT id,display_name FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");tenantId=String(t.rows[0]?.id||'');}
 if(!/^\d+$/.test(tenantId)||Number(tenantId)<1)return null;
 t=await pool.query('SELECT id,display_name FROM public.site_tenants WHERE id=$1',[tenantId]);
 if(!t.rowCount)return null;
 if(staff&&Number(staff.tenant_id)!==Number(t.rows[0].id))return null;
 return {pool,admin,staff,tenant:t.rows[0],actorId:staff?.id||null,actorType:admin?'super_admin':'staff'};
}
async function isMember(pool,conversationId,tenantId,staffId){
 const q=await pool.query('SELECT 1 FROM public.staff_chat_members WHERE conversation_id=$1 AND tenant_id=$2 AND staff_id=$3',[conversationId,tenantId,staffId]);
 return q.rowCount>0;
}
export async function GET(req){
 const url=new URL(req.url),ctx=await actor(req,url.searchParams.get('tenantId'));
 if(!ctx)return NextResponse.json({error:'Sign in to access communications.'},{status:401,headers:noStore});
 const {pool,admin,staff,tenant}=ctx;
 try{
  const [staffRows,clientRows,teamRows,notifications]=await Promise.all([
   pool.query("SELECT a.id,a.full_name,a.email,a.role,a.status,a.avatar_url,a.last_login_at,COALESCE(p.presence,'offline') AS presence, p.last_seen_at FROM public.staff_accounts a LEFT JOIN public.staff_presence p ON p.staff_id=a.id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.status='active' AND a.role<>'super_admin' ORDER BY a.full_name",[tenant.id]),
   pool.query(`SELECT c.id,c.status,c.priority,c.last_message_at,c.created_at,c.assigned_staff_id,c.assigned_at,
    r.full_name AS client_name,r.email AS client_email,r.phone AS client_phone,
    s.full_name AS assigned_staff_name,s.avatar_url AS assigned_staff_avatar,COALESCE(sp.presence,'offline') AS assigned_staff_presence,
    (SELECT count(*)::int FROM public.client_chat_messages m WHERE m.conversation_id=c.id AND m.read_at IS NULL AND m.sender_type='client') AS unread_count
    FROM public.client_chat_conversations c
    JOIN public.client_registrations r ON r.id=c.registration_id
    LEFT JOIN public.staff_accounts s ON s.id=c.assigned_staff_id LEFT JOIN public.staff_presence sp ON sp.staff_id=s.id AND sp.tenant_id=c.tenant_id
    WHERE c.tenant_id=$1 AND ($2::boolean OR c.assigned_staff_id=$3::uuid OR EXISTS(SELECT 1 FROM public.client_chat_participants cp WHERE cp.conversation_id=c.id AND cp.staff_id=$3::uuid AND cp.removed_at IS NULL) OR EXISTS(SELECT 1 FROM public.client_chat_monitor_access ma WHERE ma.conversation_id=c.id AND ma.staff_id=$3::uuid AND ma.revoked_at IS NULL))
    ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC LIMIT 150`,[tenant.id,admin,staff?.id||null]),
   pool.query(`SELECT c.id,c.conversation_type,c.title,c.last_message_at,c.created_at,
    (SELECT count(*)::int FROM public.staff_chat_members m WHERE m.conversation_id=c.id) AS member_count,
    (SELECT count(*)::int FROM public.staff_chat_messages x WHERE x.conversation_id=c.id AND x.deleted_at IS NULL AND x.sender_staff_id<>$3::uuid AND x.created_at>COALESCE((SELECT sm.last_read_at FROM public.staff_chat_members sm WHERE sm.conversation_id=c.id AND sm.staff_id=$3::uuid),to_timestamp(0))) AS unread_count
    FROM public.staff_chat_conversations c
    WHERE c.tenant_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM public.staff_chat_members m WHERE m.conversation_id=c.id AND m.staff_id=$3::uuid))
    ORDER BY c.last_message_at DESC NULLS LAST,c.created_at DESC LIMIT 150`,[tenant.id,admin,staff?.id||null]),
   staff?pool.query("SELECT id,notification_type,title,body,reference_type,reference_id,created_at FROM public.staff_notifications WHERE tenant_id=$1 AND staff_id=$2 AND read_at IS NULL ORDER BY created_at DESC LIMIT 30",[tenant.id,staff.id]):Promise.resolve({rows:[]})
  ]);
  let messages=[];
  const conversationId=url.searchParams.get('conversationId');
  if(conversationId&&uuid(conversationId)){
   const isClient=String(url.searchParams.get('kind')||'')==='client';
   if(isClient){
    const exists=await pool.query('SELECT 1 FROM public.client_chat_conversations WHERE id=$1 AND tenant_id=$2 AND ($3::boolean OR assigned_staff_id=$4::uuid)',[conversationId,tenant.id,admin,staff?.id||null]);
    if(exists.rowCount){messages=(await pool.query("SELECT m.id,m.sender_type,m.sender_id,m.body,m.created_at,m.read_at,COALESCE(a.full_name,'G-BEST Agent') AS sender_name,a.avatar_url AS sender_avatar FROM public.client_chat_messages m LEFT JOIN public.staff_accounts a ON a.id::text=m.sender_id WHERE m.conversation_id=$1 ORDER BY m.created_at ASC LIMIT 250",[conversationId])).rows;await pool.query(`UPDATE public.client_chat_messages SET read_at=now() WHERE conversation_id=$1 AND sender_type='client' AND read_at IS NULL`,[conversationId]);}
   }else{
    const allowed=admin||(staff&&await isMember(pool,conversationId,tenant.id,staff.id));
    if(!allowed)return NextResponse.json({error:'This team conversation is not available to your account.'},{status:403,headers:noStore});
    messages=(await pool.query(`SELECT m.id,m.sender_staff_id,m.sender_type,m.body,m.message_type,m.created_at,m.edited_at,COALESCE(s.full_name,'G-BEST Super Admin') AS sender_name
      FROM public.staff_chat_messages m LEFT JOIN public.staff_accounts s ON s.id=m.sender_staff_id
      WHERE m.conversation_id=$1 AND m.tenant_id=$2 AND m.deleted_at IS NULL ORDER BY m.created_at ASC LIMIT 250`,[conversationId,tenant.id])).rows;
    if(staff)await pool.query('UPDATE public.staff_chat_members SET last_read_at=now() WHERE conversation_id=$1 AND staff_id=$2',[conversationId,staff.id]);
   }
  }
  return NextResponse.json({tenant,isSuperAdmin:admin,staff:staffRows.rows,clientConversations:clientRows.rows,teamConversations:teamRows.rows,notifications:notifications.rows,messages},{headers:noStore});
 }catch(e){console.error('Communications GET',e.code||e.message);return NextResponse.json({error:'Could not load communications.'},{status:500,headers:noStore});}
}
export async function POST(req){
 const d=await req.json().catch(()=>null);if(!d||typeof d!=='object')return NextResponse.json({error:'Invalid request.'},{status:400});
 const ctx=await actor(req,d.tenantId);if(!ctx)return NextResponse.json({error:'Sign in to access communications.'},{status:401});
 const {pool,admin,staff,tenant,actorId,actorType}=ctx;
 try{
  if(d.action==='assign-client'){
   if(!admin)return NextResponse.json({error:'Only Super Admin can assign client conversations.'},{status:403});
   if(!uuid(d.conversationId)||!(d.staffId===null||uuid(d.staffId)))return NextResponse.json({error:'Choose a valid conversation and staff member.'},{status:400});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const c=await client.query('SELECT id,assigned_staff_id FROM public.client_chat_conversations WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[d.conversationId,tenant.id]);
    if(!c.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Client conversation not found.'},{status:404});}
    if(d.staffId){const target=await client.query("SELECT id,full_name FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 AND status='active' AND role<>'super_admin'",[d.staffId,tenant.id]);if(!target.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'That staff account is not active in this company.'},{status:400});}}
    const previous=c.rows[0].assigned_staff_id;
    await client.query('UPDATE public.client_chat_conversations SET assigned_staff_id=$1,assigned_by=$2,assigned_at=now(),updated_at=now() WHERE id=$3',[d.staffId,actorId||'super-admin',d.conversationId]);
    await client.query("INSERT INTO public.client_chat_assignment_events(tenant_id,conversation_id,from_staff_id,to_staff_id,actor_type,actor_id,note) VALUES($1,$2,$3,$4,'super_admin',$5,$6)",[tenant.id,d.conversationId,previous,d.staffId,actorId||'super-admin',clean(d.note,300)||null]);
    if(d.staffId)await client.query("INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id) VALUES($1,$2,'chat_assigned','New client conversation assigned','A client conversation has been assigned to you.','client_conversation',$3)",[tenant.id,d.staffId,d.conversationId]);
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
   return NextResponse.json({ok:true,message:'Client conversation assignment updated.'},{headers:noStore});
  }
  if(d.action==='create-team'){
   if(!staff&&!admin)return NextResponse.json({error:'Not allowed.'},{status:403});
   const type=d.type==='direct'?'direct':'group',title=type==='group'?clean(d.title,100):null;
   if(type==='group'&&title.length<2)return NextResponse.json({error:'Enter a group name.'},{status:400});
   const members=Array.isArray(d.memberIds)?[...new Set(d.memberIds.filter(uuid))]:[];
   if(staff&&!members.includes(staff.id))members.push(staff.id);
   if(admin&&!members.length)return NextResponse.json({error:'Choose at least one staff member.'},{status:400});
   if(type==='direct'&&((admin&&members.length!==1)||(!admin&&members.length!==2)))return NextResponse.json({error:admin?'A Super Admin direct chat needs one staff member.':'A direct chat needs exactly two staff members.'},{status:400});
   if(type==='group'&&members.length<2)return NextResponse.json({error:'A group needs at least two members.'},{status:400});
   const valid=await pool.query("SELECT id FROM public.staff_accounts WHERE tenant_id=$1 AND status='active' AND id=ANY($2::uuid[])",[tenant.id,members]);
   if(valid.rowCount!==members.length)return NextResponse.json({error:'One or more selected staff members are not active in this company.'},{status:400});
   if(type==='direct'){
    const existing=await pool.query(`SELECT c.id FROM public.staff_chat_conversations c
      WHERE c.tenant_id=$1 AND c.conversation_type='direct'
      AND (SELECT array_agg(m.staff_id ORDER BY m.staff_id) FROM public.staff_chat_members m WHERE m.conversation_id=c.id)=
          (SELECT array_agg(x::uuid ORDER BY x::uuid) FROM unnest($2::uuid[]) x) LIMIT 1`,[tenant.id,members]);
    if(existing.rowCount)return NextResponse.json({ok:true,conversationId:existing.rows[0].id,message:'Existing direct chat opened.'},{headers:noStore});
   }
   const client=await pool.connect();let id;
   try{await client.query('BEGIN');const created=await client.query('INSERT INTO public.staff_chat_conversations(tenant_id,conversation_type,title,created_by) VALUES($1,$2,$3,$4) RETURNING id',[tenant.id,type,title,staff?.id||null]);id=created.rows[0].id;
    for(const memberId of members)await client.query("INSERT INTO public.staff_chat_members(conversation_id,tenant_id,staff_id,member_role) VALUES($1,$2,$3,$4)",[id,tenant.id,memberId,memberId===(staff?.id||'')?'owner':(admin?'owner':'member')]);
    await client.query("INSERT INTO public.staff_communications_audit(tenant_id,actor_staff_id,actor_type,action,reference_type,reference_id,details) VALUES($1,$2,$3,'team_conversation.created','team_conversation',$4,$5::jsonb)",[tenant.id,actorId,actorType,id,JSON.stringify({type,title,members})]);
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
   return NextResponse.json({ok:true,conversationId:id,message:type==='group'?'Team group created.':'Direct chat created.'},{headers:noStore});
  }
  if(d.action==='presence'){
   if(!staff)return NextResponse.json({error:'Staff sign-in required.'},{status:403});
   const presence=['online','away','offline'].includes(d.presence)?d.presence:'online';
   await pool.query(`INSERT INTO public.staff_presence(tenant_id,staff_id,presence,last_seen_at,updated_at) VALUES($1,$2,$3,now(),now()) ON CONFLICT(tenant_id,staff_id) DO UPDATE SET presence=EXCLUDED.presence,last_seen_at=now(),updated_at=now()`,[tenant.id,staff.id,presence]);
   return NextResponse.json({ok:true,presence},{headers:noStore});
  }
  if(d.action==='manage-client-staff'){
   if(!admin)return NextResponse.json({error:'Only Super Admin can manage client chat participants.'},{status:403});
   if(!uuid(d.conversationId)||!uuid(d.staffId))return NextResponse.json({error:'Choose a valid conversation and staff member.'},{status:400});
   const target=await pool.query("SELECT id FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 AND status='active' AND role<>'super_admin'",[d.staffId,tenant.id]);
   if(!target.rowCount)return NextResponse.json({error:'Staff account is not active in this company.'},{status:400});
   const exists=await pool.query('SELECT 1 FROM public.client_chat_conversations WHERE id=$1 AND tenant_id=$2',[d.conversationId,tenant.id]);
   if(!exists.rowCount)return NextResponse.json({error:'Client conversation not found.'},{status:404});
   if(d.remove===true){
    await pool.query('UPDATE public.client_chat_participants SET removed_at=now() WHERE conversation_id=$1 AND staff_id=$2',[d.conversationId,d.staffId]);
   }else{
    await pool.query(`INSERT INTO public.client_chat_participants(conversation_id,tenant_id,staff_id,added_by) VALUES($1,$2,$3,'super_admin') ON CONFLICT(conversation_id,staff_id) DO UPDATE SET removed_at=NULL,added_by='super_admin',added_at=now()`,[d.conversationId,tenant.id,d.staffId]);
    await pool.query("INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id) VALUES($1,$2,'chat_assigned','Added to a client conversation','You have been added as a collaborating staff member.','client_conversation',$3)",[tenant.id,d.staffId,d.conversationId]);
   }
   await pool.query("INSERT INTO public.staff_communications_audit(tenant_id,actor_type,action,reference_type,reference_id,details) VALUES($1,'super_admin',$2,'client_conversation',$3,$4::jsonb)",[tenant.id,d.remove?'client_chat.staff_removed':'client_chat.staff_added',d.conversationId,JSON.stringify({staffId:d.staffId})]);
   return NextResponse.json({ok:true,message:d.remove?'Staff member removed.':'Staff member added to the client conversation.'},{headers:noStore});
  }
  if(d.action==='monitor-client'){
   if(!admin)return NextResponse.json({error:'Only Super Admin can control monitoring access.'},{status:403});
   if(!uuid(d.conversationId)||!uuid(d.staffId))return NextResponse.json({error:'Choose a valid conversation and staff member.'},{status:400});
   const target=await pool.query("SELECT id FROM public.staff_accounts WHERE id=$1 AND tenant_id=$2 AND status='active'",[d.staffId,tenant.id]);
   if(!target.rowCount)return NextResponse.json({error:'Staff account not found.'},{status:404});
   if(d.enabled===false)await pool.query('UPDATE public.client_chat_monitor_access SET revoked_at=now() WHERE conversation_id=$1 AND staff_id=$2 AND revoked_at IS NULL',[d.conversationId,d.staffId]);
   else await pool.query(`INSERT INTO public.client_chat_monitor_access(conversation_id,tenant_id,staff_id,granted_by) VALUES($1,$2,$3,'super_admin') ON CONFLICT(conversation_id,staff_id) DO UPDATE SET revoked_at=NULL,granted_by='super_admin',granted_at=now()`,[d.conversationId,tenant.id,d.staffId]);
   return NextResponse.json({ok:true,message:d.enabled===false?'Monitoring access revoked.':'Monitoring access granted.'},{headers:noStore});
  }
  if(d.action==='reply-client'){
   if(!admin&&!staff)return NextResponse.json({error:'Staff sign-in required.'},{status:403});
   if(!uuid(d.conversationId))return NextResponse.json({error:'Choose a valid client conversation.'},{status:400});
   const body=clean(d.body,4000);if(!body)return NextResponse.json({error:'Write a reply first.'},{status:400});
   const client=await pool.connect();
   try{await client.query('BEGIN');const c=await client.query(`SELECT id FROM public.client_chat_conversations x WHERE id=$1 AND tenant_id=$2 AND ($3::boolean OR assigned_staff_id=$4::uuid OR EXISTS(SELECT 1 FROM public.client_chat_participants p WHERE p.conversation_id=x.id AND p.staff_id=$4::uuid AND p.removed_at IS NULL) OR EXISTS(SELECT 1 FROM public.client_chat_monitor_access m WHERE m.conversation_id=x.id AND m.staff_id=$4::uuid AND m.revoked_at IS NULL)) FOR UPDATE`,[d.conversationId,tenant.id,admin,staff?.id||null]);if(!c.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Client conversation not found.'},{status:404});}
    const m=await client.query("INSERT INTO public.client_chat_messages(conversation_id,sender_type,sender_id,body) VALUES($1,$2,$3,$4) RETURNING id,created_at",[d.conversationId,admin?'admin':'staff',admin?'super-admin':staff.id,body]);
    await client.query("UPDATE public.client_chat_conversations SET last_message_at=now(),last_staff_message_at=now(),updated_at=now() WHERE id=$1",[d.conversationId]);
    await client.query("INSERT INTO public.staff_communications_audit(tenant_id,actor_type,action,reference_type,reference_id,details) VALUES($1,$2,'client_chat.replied','client_conversation',$3,$4::jsonb)",[tenant.id,actorType,d.conversationId,JSON.stringify({messageId:m.rows[0].id})]);
    await client.query('COMMIT');return NextResponse.json({ok:true,message:m.rows[0]},{headers:noStore});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  if(d.action==='send-team-message'){
   if(!staff&&!admin)return NextResponse.json({error:'Sign in required to send team messages.'},{status:403});
   if(!uuid(d.conversationId))return NextResponse.json({error:'Choose a conversation.'},{status:400});
   const body=clean(d.body,4000);if(!body)return NextResponse.json({error:'Write a message first.'},{status:400});
   if(staff&&!await isMember(pool,d.conversationId,tenant.id,staff.id))return NextResponse.json({error:'You are not a member of this team conversation.'},{status:403});
   const conversation=await pool.query('SELECT 1 FROM public.staff_chat_conversations WHERE id=$1 AND tenant_id=$2',[d.conversationId,tenant.id]);
   if(!conversation.rowCount)return NextResponse.json({error:'Team conversation not found.'},{status:404});
   const client=await pool.connect();
   try{await client.query('BEGIN');const ins=await client.query('INSERT INTO public.staff_chat_messages(tenant_id,conversation_id,sender_staff_id,sender_type,body) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',[tenant.id,d.conversationId,staff?.id||null,admin?'super_admin':'staff',body]);
    await client.query('UPDATE public.staff_chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2',[d.conversationId,tenant.id]);
    await client.query(`INSERT INTO public.staff_notifications(tenant_id,staff_id,notification_type,title,body,reference_type,reference_id)
      SELECT $1,m.staff_id,'team_message','New team message',$3,'team_conversation',$2
      FROM public.staff_chat_members m WHERE m.conversation_id=$2 AND ($4::uuid IS NULL OR m.staff_id<>$4)`,[tenant.id,d.conversationId,body.slice(0,300),staff?.id||null]);
    if(staff)await client.query('UPDATE public.staff_chat_members SET last_read_at=now() WHERE conversation_id=$1 AND staff_id=$2',[d.conversationId,staff.id]);
    await client.query('COMMIT');return NextResponse.json({ok:true,message:ins.rows[0]},{headers:noStore});
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  if(d.action==='mark-notifications-read'){
   if(!staff)return NextResponse.json({ok:true},{headers:noStore});
   await pool.query('UPDATE public.staff_notifications SET read_at=now() WHERE tenant_id=$1 AND staff_id=$2 AND read_at IS NULL',[tenant.id,staff.id]);
   return NextResponse.json({ok:true},{headers:noStore});
  }
  return NextResponse.json({error:'Unknown communications action.'},{status:400});
 }catch(e){console.error('Communications POST',e.code||e.message);return NextResponse.json({error:'Could not complete that communications action.'},{status:500,headers:noStore});}
}
