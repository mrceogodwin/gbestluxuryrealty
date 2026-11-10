import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {getStaffSession,hasStaffPermission} from '../../../../lib/staff-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const admin=await isAdminRequest(req);
  const staff=admin?null:await getStaffSession(req);
  if(!admin&&!staff)return NextResponse.json({error:'Unauthorized'},{status:401});
  const allowed=async key=>admin||await hasStaffPermission(staff,key);
  if(!await allowed('dashboard.view'))return NextResponse.json({error:'Unauthorized'},{status:401});
  const can={properties:await allowed('properties.manage'),clients:await allowed('clients.view')||await allowed('payments.review'),inspections:await allowed('inspections.view')||await allowed('inspections.manage'),media:await allowed('media.manage'),finance:admin};
  const p=getDatabasePool();
  const exists=async name=>(await p.query('SELECT to_regclass($1) AS t',['public.'+name])).rows[0]?.t;
  const names=[];if(can.properties)names.push('properties');if(can.clients)names.push('client_registrations');if(can.inspections)names.push('inspection_requests');if(can.media)names.push('admin_media_assets');
  const found={};for(const name of names)found[name]=await exists(name);
  const query=async(name,sql,fallback)=>found[name]?(await p.query(sql)).rows[0]:fallback;
  const [properties,clients,inspections,media,finance]=await Promise.all([
   can.properties?query('properties',"SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='published')::int AS published,COUNT(*) FILTER(WHERE status='draft')::int AS drafts",{total:0,published:0,drafts:0}):null,
   can.clients?query('client_registrations',"SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved",{total:0,pending:0,approved:0}):null,
   can.inspections?query('inspection_requests',"SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='confirmed')::int AS confirmed",{total:0,pending:0,confirmed:0}):null,
   can.media?query('admin_media_assets',"SELECT COUNT(*)::int AS total",{total:0}):null,
   can.finance?query('client_registrations',"SELECT COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending_count,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved_count,COALESCE(SUM(fee_amount) FILTER(WHERE payment_status='approved'),0)::numeric(14,2)::text AS approved_amount,COALESCE(SUM(fee_amount) FILTER(WHERE payment_status='pending'),0)::numeric(14,2)::text AS pending_amount,COUNT(*) FILTER(WHERE payment_status='rejected')::int AS rejected_count FROM public.client_registrations",{pending_count:0,approved_count:0,approved_amount:'0.00',pending_amount:'0.00',rejected_count:0}):null
  ]);
  return NextResponse.json({isSuperAdmin:admin,permissions:Object.entries(can).filter(([,v])=>v).map(([k])=>k),properties,clients,inspections,media,finance,generatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Admin overview failed',e.code||e.message);return NextResponse.json({error:'Could not load company dashboard data.'},{status:500});}
}