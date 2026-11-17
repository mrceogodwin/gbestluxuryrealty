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
   AND r.tenant_id=$2 AND r.payment_status='approved' AND r.client_status='active' LIMIT 1`,[hash,tenant.id]);
 return q.rows[0]||null;
}
export async function GET(req){
 try{
  const client=await clientContext(req);
  if(!client)return NextResponse.json({error:'Sign in with an approved G-BEST client account to use Agent messaging.'},{status:401,headers:noStore});
  const pool=getDatabasePool();
  await pool.query("UPDATE public.client_chat_messages m SET read_at=COALESCE(m.read_at,now()) FROM public.client_chat_conversations c WHERE m.conversation_id=c.id AND c.tenant_id=$1 AND c.registration_id=$2 AND m.sender_type IN ('admin','staff') AND m.read_at IS NULL",[client.tenant_id,client.id]);
  const q=await pool.query(`SELECT c.id AS conversation_id,c.status,c.created_at,c.last_message_at,
   m.id AS message_id,m.sender_type,m.body,m.created_at AS message_created_at,m.read_at
   FROM public.client_chat_conversations c
   LEFT JOIN public.client_chat_messages m ON m.conversation_id=c.id
   WHERE c.tenant_id=$1 AND c.registration_id=$2
   ORDER BY m.created_at ASC NULLS FIRST LIMIT 500`,[client.tenant_id,client.id]);
  const first=q.rows[0];
  return NextResponse.json({conversation:first?{id:first.conversation_id,status:first.status,created_at:first.created_at,last_message_at:first.last_message_at}:null,
   messages:q.rows.filter(x=>x.message_id).map(x=>({id:x.message_id,sender_type:x.sender_type,body:x.body,created_at:x.message_created_at,read_at:x.read_at}))},{headers:noStore});
 }catch(e){console.error('Client chat load failed',e.code||e.message);return NextResponse.json({error:'Could not load your messages right now.'},{status:503,headers:noStore});}
}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 try{
  const client=await clientContext(req);
  if(!client)return NextResponse.json({error:'Sign in with an approved G-BEST client account to send messages.'},{status:401,headers:noStore});
  const body=await req.json().catch(()=>null),message=String(body?.message||'').trim();
  if(!message||message.length>4000)return NextResponse.json({error:'Enter a message of 1–4,000 characters.'},{status:400});
  const pool=getDatabasePool(),db=await pool.connect();
  try{
   await db.query('BEGIN');
   const conv=await db.query(`INSERT INTO public.client_chat_conversations(tenant_id,registration_id,last_message_at)
    VALUES($1,$2,now()) ON CONFLICT(tenant_id,registration_id) DO UPDATE SET updated_at=now()
    RETURNING id,status`,[client.tenant_id,client.id]);
   if(conv.rows[0].status!=='open'){await db.query('ROLLBACK');return NextResponse.json({error:'This conversation is closed. Please contact G-BEST to reopen it.'},{status:409});}
   const saved=await db.query(`INSERT INTO public.client_chat_messages(conversation_id,sender_type,sender_id,body)
    VALUES($1,'client',$2,$3) RETURNING id,sender_type,body,created_at,read_at`,[conv.rows[0].id,String(client.id),message]);
   await db.query('UPDATE public.client_chat_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1',[conv.rows[0].id]);
   await db.query('COMMIT');
   return NextResponse.json({ok:true,conversationId:conv.rows[0].id,message:saved.rows[0]},{status:201,headers:noStore});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
 }catch(e){console.error('Client chat send failed',e.code||e.message);return NextResponse.json({error:'Your message could not be sent. Please try again.'},{status:503,headers:noStore});}
}
