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
   const permissions=await pool.query(`SELECT rp.permission_key,
    COALESCE(ap.enabled,rp.enabled,false) AS enabled
    FROM public.staff_role_permissions rp
    LEFT JOIN public.staff_account_permissions ap
      ON ap.staff_id=$1 AND ap.permission_key=rp.permission_key
    WHERE rp.role=$2
    UNION
    SELECT ap.permission_key,ap.enabled
    FROM public.staff_account_permissions ap
    WHERE ap.staff_id=$1 AND NOT EXISTS(
      SELECT 1 FROM public.staff_role_permissions rp
      WHERE rp.role=$2 AND rp.permission_key=ap.permission_key
    )`,[staff.id,staff.role]);
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
  const safeQuery=async(sql,fallback,key)=>{
   try{return (await pool.query(sql)).rows[0]||fallback;}
   catch(e){console.error('Overview metric '+key+' failed',e.code||e.message);return fallback;}
  };
  const [properties,clients,inspections,media,finance]=await Promise.all([
   can.properties?safeQuery("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='published')::int AS published,COUNT(*) FILTER(WHERE status='draft')::int AS drafts FROM public.properties",{total:0,published:0,drafts:0},'properties'):null,
   can.clients?(admin||granted.has('payments.review')?safeQuery("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved,true AS payment_metrics_available FROM public.client_registrations",{total:0,pending:0,approved:0,payment_metrics_available:true},'clients'):safeQuery("SELECT COUNT(*)::int AS total,false AS payment_metrics_available FROM public.client_registrations",{total:0,payment_metrics_available:false},'clients')):null,
   can.inspections?safeQuery("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='confirmed')::int AS confirmed FROM public.inspection_requests",{total:0,pending:0,confirmed:0},'inspections'):null,
   can.media?safeQuery("SELECT COUNT(*)::int AS total FROM public.admin_media_assets",{total:0},'media'):null,
   can.finance?safeQuery("SELECT COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending_count,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved_count,COALESCE(SUM(fee_amount) FILTER(WHERE payment_status='approved'),0)::numeric(14,2)::text AS approved_amount,COALESCE(SUM(fee_amount) FILTER(WHERE payment_status='pending'),0)::numeric(14,2)::text AS pending_amount,COUNT(*) FILTER(WHERE payment_status='rejected')::int AS rejected_count FROM public.client_registrations",{pending_count:0,approved_count:0,approved_amount:'0.00',pending_amount:'0.00',rejected_count:0},'finance'):null
  ]);
  return NextResponse.json({isSuperAdmin:admin,permissions:Object.entries(can).filter(([,v])=>v).map(([k])=>k),properties,clients,inspections,media,finance,generatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  console.error('Admin overview failed',e.code||e.message);
  return NextResponse.json({error:'Dashboard data could not be loaded. Please refresh; if it continues, contact your Super Admin.'},{status:500,headers:{'Cache-Control':'no-store'}});
 }
}