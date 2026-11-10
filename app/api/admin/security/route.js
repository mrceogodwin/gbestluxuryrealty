import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest,ADMIN_COOKIE} from '../../../../lib/admin-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function noStore(data,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store, max-age=0'}});}
export async function GET(req){
 if(!await isAdminRequest(req))return noStore({error:'Unauthorized' },401);
 try{
  const p=getDatabasePool(),token=req.cookies.get(ADMIN_COOKIE)?.value||'';
  const [sessions,attempts,events]=await Promise.all([
   p.query(`SELECT id,created_at,expires_at,last_seen_at,(token_hash=$1) AS is_current
   FROM public.super_admin_sessions WHERE revoked_at IS NULL AND expires_at>now()
   ORDER BY is_current DESC,last_seen_at DESC LIMIT 100`,[hash(token)]),
   p.query(`SELECT right(attempt_key,6) AS reference,failed_attempts,window_started_at,locked_until,updated_at,
   (locked_until>now()) AS is_locked FROM public.staff_login_attempts
   WHERE updated_at>now()-interval '7 days' ORDER BY updated_at DESC LIMIT 50`),
   p.query(`SELECT id,actor_type,actor_email,action,created_at,details FROM public.staff_audit_events
   WHERE action IN ('admin.login','admin.logout','staff.login','staff.logout')
   ORDER BY created_at DESC LIMIT 50`)
  ]);
  return noStore({sessions:sessions.rows,attempts:attempts.rows,events:events.rows,generatedAt:new Date().toISOString()});
 }catch(e){console.error('Security centre GET',e.code||e.message);return noStore({error:'Could not load security activity.'},500);}
}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return noStore({error:'Invalid request origin.'},403);
 if(!await isAdminRequest(req))return noStore({error:'Unauthorized'},401);
 let body;try{body=await req.json()}catch{return noStore({error:'Invalid request body.'},400)}
 const p=getDatabasePool(),token=req.cookies.get(ADMIN_COOKIE)?.value||'';
 try{
  if(body.action==='revoke-session'){
   const id=String(body.id||'');
   if(!/^[0-9a-f-]{36}$/i.test(id))return noStore({error:'Invalid session ID.'},400);
   const r=await p.query('UPDATE public.super_admin_sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL AND expires_at>now() RETURNING id',( [id] ));
   if(!r.rowCount)return noStore({error:'Session is no longer active.'},404);
   await p.query(`INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details)
   VALUES('super_admin','master-admin','admin.session_revoked','session',$1,$2::jsonb)`,[id,JSON.stringify({revokedByCurrentSession:hash(token)})]);
   return noStore({ok:true,message:'Session revoked.'});
  }
  if(body.action==='revoke-all'){
   const r=await p.query('UPDATE public.super_admin_sessions SET revoked_at=now() WHERE revoked_at IS NULL AND expires_at>now() RETURNING id');
   await p.query(`INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details)
   VALUES('super_admin','master-admin','admin.sessions_revoked_all','session',NULL,$1::jsonb)`,[JSON.stringify({count:r.rowCount})]);
   return noStore({ok:true,count:r.rowCount,message:'All active sessions revoked. You will need to sign in again.'});
  }
  if(body.action==='clear-expired-attempts'){
   const r=await p.query('DELETE FROM public.staff_login_attempts WHERE updated_at<now()-interval \'30 days\' RETURNING attempt_key');
   return noStore({ok:true,count:r.rowCount,message:'Old sign-in records cleaned up.'});
  }
  return noStore({error:'Unsupported security action.'},400);
 }catch(e){console.error('Security centre POST',e.code||e.message);return noStore({error:'Could not complete the security action.'},500);}
}
