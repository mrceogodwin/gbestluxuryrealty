import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession} from '../../../../lib/staff-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const admin=await isAdminRequest(req);
  const staff=admin?null:await getStaffSession(req);
  if(!admin&&!staff)return NextResponse.json({error:'Your staff session has expired. Please sign in again.'},{status:401,headers:{'Cache-Control':'no-store'}});
  const pool=getDatabasePool();
  let granted=new Set();
  if(admin){
   granted=new Set(['dashboard.view','properties.manage','clients.view','payments.review','inspections.view','inspections.manage','media.manage','staff.manage','homepage.manage','audit.view']);
  }else{
   const permissions=await pool.query('SELECT permission_key,enabled FROM public.staff_account_permissions WHERE staff_id=$1',[staff.id]);
   granted=new Set(permissions.rows.filter(x=>x.enabled===true).map(x=>x.permission_key));
  }
  if(!admin&&!granted.has('dashboard.view'))return NextResponse.json({error:'Your Super Admin has not assigned dashboard access to this account.'},{status:403,headers:{'Cache-Control':'no-store'}});
  const can={
   properties:admin||granted.has('properties.manage'),
   clients:admin||granted.has('clients.view')||granted.has('payments.review'),
   inspections:admin||granted.has('inspections.view')||granted.has('inspections.manage'),
   media:admin||granted.has('media.manage'),
   finance:admin,staff:admin,homepage:admin,audit:admin
  };
  const tenantId=staff?.tenant_id??null;
  const safeQuery=async(sql,params,fallback,key)=>{
   try{return (await pool.query(sql,params)).rows[0]||fallback;}
   catch(e){console.error('Overview metric '+key+' failed',e.code||e.message);return fallback;}
  };
  const safeRows=async(sql,params,fallback,key)=>{
   try{return (await pool.query(sql,params)).rows;}
   catch(e){console.error('Overview metric '+key+' failed',e.code||e.message);return fallback;}
  };
  const [properties,clients,inspections,media,finance,clientActivity,onlineClients,recentClientActivity]=await Promise.all([
   can.properties?safeQuery("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='published')::int AS published,COUNT(*) FILTER(WHERE status='draft')::int AS drafts FROM public.properties WHERE ($1::bigint IS NULL OR tenant_id=$1)",[tenantId],{total:0,published:0,drafts:0},'properties'):null,
   can.clients?safeQuery("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved FROM public.client_registrations WHERE ($1::bigint IS NULL OR tenant_id=$1)",[tenantId],{total:0,pending:0,approved:0},'clients'):null,
   can.inspections?safeQuery("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='confirmed')::int AS confirmed FROM public.inspection_requests WHERE ($1::bigint IS NULL OR tenant_id=$1)",[tenantId],{total:0,pending:0,confirmed:0},'inspections'):null,
   can.media?safeQuery("SELECT COUNT(*)::int AS total FROM public.admin_media_assets WHERE ($1::bigint IS NULL OR tenant_id=$1)",[tenantId],{total:0},'media'):null,
   can.finance?safeQuery("SELECT COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending_count,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved_count,COALESCE(SUM(fee_amount) FILTER(WHERE payment_status='approved'),0)::numeric(14,2)::text AS approved_amount,COALESCE(SUM(fee_amount) FILTER(WHERE payment_status='pending'),0)::numeric(14,2)::text AS pending_amount,COUNT(*) FILTER(WHERE payment_status='rejected')::int AS rejected_count FROM public.client_registrations",[],{pending_count:0,approved_count:0,approved_amount:'0.00',pending_amount:'0.00',rejected_count:0},'finance'):null,
   admin?safeQuery(`SELECT
     (SELECT COUNT(*)::int FROM public.client_registrations WHERE tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1)) AS registered_total,
     (SELECT COUNT(*)::int FROM public.client_registrations WHERE tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1) AND created_at>=now()-interval '7 days') AS joined_7d,
     (SELECT COUNT(*)::int FROM public.client_presence WHERE tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1) AND last_seen_at>=now()-interval '30 days') AS interacted_30d,
     (SELECT COUNT(*)::int FROM public.client_presence WHERE tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1) AND presence='online' AND last_seen_at>now()-interval '90 seconds') AS online_now,
     (SELECT COUNT(*)::int FROM public.inspection_requests WHERE tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1)) AS inspection_total,
     (SELECT COUNT(*)::int FROM public.inspection_requests WHERE tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1) AND status='pending') AS inspection_pending`,[],{registered_total:0,joined_7d:0,interacted_30d:0,online_now:0,inspection_total:0,inspection_pending:0},'client-activity'):null,
   admin?safeRows(`SELECT r.id,r.full_name,r.email,r.phone,p.presence,p.last_seen_at
     FROM public.client_presence p JOIN public.client_registrations r ON r.id=p.registration_id AND r.tenant_id=p.tenant_id
     WHERE p.tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1)
       AND p.presence='online' AND p.last_seen_at>now()-interval '90 seconds'
     ORDER BY p.last_seen_at DESC LIMIT 15`,[],[],'online-clients'):[],
   admin?safeRows(`SELECT * FROM (
     SELECT 'registration'::text AS activity_type,r.full_name,r.email,r.created_at AS happened_at,'Joined G-BEST'::text AS description
       FROM public.client_registrations r WHERE r.tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1)
     UNION ALL
     SELECT 'chat'::text,r.full_name,r.email,m.created_at AS happened_at,'Sent a private message'::text AS description
       FROM public.client_chat_messages m JOIN public.client_chat_conversations c ON c.id=m.conversation_id
       JOIN public.client_registrations r ON r.id=c.registration_id AND r.tenant_id=c.tenant_id
       WHERE c.tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1) AND m.sender_type='client'
     UNION ALL
     SELECT 'inspection'::text,COALESCE(r.full_name,i.full_name),COALESCE(r.email,i.client_email),i.created_at AS happened_at,'Requested a physical inspection'::text AS description
       FROM public.inspection_requests i LEFT JOIN public.client_registrations r ON r.id=i.client_registration_id AND r.tenant_id=i.tenant_id
       WHERE i.tenant_id=(SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1)
   ) activity ORDER BY happened_at DESC LIMIT 20`,[],[],'recent-client-activity'):[]
  ]);
  return NextResponse.json({isSuperAdmin:admin,permissions:Object.entries(can).filter(([,v])=>v).map(([k])=>k),properties,clients,inspections,media,finance,clientActivity:admin?{summary:clientActivity,online:onlineClients,recent:recentClientActivity}:null,generatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  console.error('Admin overview failed',e.code||e.message);
  return NextResponse.json({error:'Dashboard data could not be loaded. Please refresh; if it continues, contact your Super Admin.'},{status:500,headers:{'Cache-Control':'no-store'}});
 }
}