import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {getDatabasePool} from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const token=req.cookies.get('gbest_client_session')?.value;
  if(!token||token.length<32||token.length>128)return NextResponse.json({error:'Please sign in to view your inspection requests.'},{status:401});
  const pool=getDatabasePool(),host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'Company workspace unavailable.'},{status:404});
  const hash=createHash('sha256').update(token).digest('hex');
  const session=await pool.query(`SELECT r.id FROM public.client_sessions s JOIN public.client_registrations r ON r.id=s.registration_id
   WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND r.tenant_id=$2 AND r.client_status='active'
   AND r.payment_status IN ('approved','not_required','pending','rejected') LIMIT 1`,[hash,tenant.id]);
  if(!session.rowCount)return NextResponse.json({error:'Your client session has expired. Please sign in again.'},{status:401});
  const q=await pool.query(`SELECT i.id,i.preferred_date,i.preferred_time,i.duration_minutes,i.status,i.preference,i.message,i.created_at,
    p.title AS property_title,
    ('GB-' || CASE WHEN p.id::text ~ '^[0-9]+$' THEN lpad(p.id::text,8,'0') ELSE right(upper(replace(p.id::text,'-','')),8) END) AS property_code
   FROM public.inspection_requests i LEFT JOIN public.properties p ON p.id=i.property_id AND p.tenant_id=i.tenant_id
   WHERE i.tenant_id=$1 AND i.client_registration_id=$2 ORDER BY i.created_at DESC LIMIT 50`,[tenant.id,session.rows[0].id]);
  return NextResponse.json({requests:q.rows},{headers:{'Cache-Control':'no-store','Pragma':'no-cache'}});
 }catch(e){console.error('Client inspection history failed',e.code||e.message);return NextResponse.json({error:'Could not load inspection history right now.'},{status:503});}
}