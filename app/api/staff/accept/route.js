import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {hashPassword,hashToken,STAFF_COOKIE,STAFF_SESSION_SECONDS,staffCookieOptions,newOpaqueToken} from '../../../../lib/staff-auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 let body;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid request.'},{status:400})}
 const token=String(body?.token||''),password=String(body?.password||'');
 if(token.length<32||token.length>200||password.length<12||password.length>128)return NextResponse.json({error:'Use a valid invitation and a password of at least 12 characters.'},{status:400});
 const pool=getDatabasePool(),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const found=await client.query(`SELECT id,email FROM public.staff_accounts WHERE invitation_token_hash=$1 AND status='invited' AND invitation_expires_at>now() AND password_hash IS NULL FOR UPDATE`,[hashToken(token)]);
  if(!found.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'This invitation is invalid, expired or already used. Ask the administrator for a new invitation.'},{status:410});}
  const staff=found.rows[0],passwordHash=await hashPassword(password),sessionToken=newOpaqueToken();
  await client.query(`UPDATE public.staff_accounts SET password_hash=$2,status='active',accepted_at=now(),invitation_token_hash=NULL,invitation_expires_at=NULL,updated_at=now() WHERE id=$1`,[staff.id,passwordHash]);
  await client.query(`INSERT INTO public.staff_sessions(staff_id,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')`,[staff.id,hashToken(sessionToken)]);
  await client.query(`INSERT INTO public.staff_audit_events(actor_type,actor_email,action,target_type,target_id,details) VALUES('system',$1,'staff.invitation_accepted','staff',$2,'{}'::jsonb)`,[staff.email,staff.id]);
  await client.query('COMMIT');
  const response=NextResponse.json({ok:true,message:'Your staff account is active.'});
  response.cookies.set(STAFF_COOKIE,sessionToken,staffCookieOptions);return response;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Staff invitation acceptance',e.code||e.message);return NextResponse.json({error:'Could not activate this staff account.'},{status:500});}finally{client.release();}
}
