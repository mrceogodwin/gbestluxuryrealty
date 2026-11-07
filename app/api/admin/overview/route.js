import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
export async function GET(req){
 if(!await authorizeAdminRequest(req,'dashboard.view'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const p=getDatabasePool();
  const exists=async name=>(await p.query('SELECT to_regclass($1) AS t',['public.'+name])).rows[0]?.t;
  const tables=await Promise.all(['properties','client_registrations','inspection_requests','admin_media_assets'].map(exists));
  const count=async(i,sql)=>tables[i]?(await p.query(sql)).rows[0]:{};
  const [properties,clients,inspections,media]=await Promise.all([
   count(0,"SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='published')::int AS published,COUNT(*) FILTER(WHERE status='draft')::int AS drafts FROM public.properties"),
   count(1,"SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE payment_status='pending')::int AS pending,COUNT(*) FILTER(WHERE payment_status='approved')::int AS approved FROM public.client_registrations"),
   count(2,"SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='confirmed')::int AS confirmed FROM public.inspection_requests"),
   count(3,"SELECT COUNT(*)::int AS total FROM public.admin_media_assets")
  ]);
  return NextResponse.json({properties:properties||{total:0,published:0,drafts:0},clients:clients||{total:0,pending:0,approved:0},inspections:inspections||{total:0,pending:0,confirmed:0},media:media||{total:0},generatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Admin overview failed',e.code||e.message);return NextResponse.json({error:'Could not load company dashboard data.'},{status:500});}
}
