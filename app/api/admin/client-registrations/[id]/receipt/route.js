import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../../../lib/db';
import {authorizeAdminRequest} from '../../../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../../../lib/admin-auth';
import {ensureSiteTenants} from '../../../../../../lib/site-tenants';
import {getStaffSession} from '../../../../../../lib/staff-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req,{params}){
 if(!await authorizeAdminRequest(req,'payments.review'))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const {id}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'Invalid ID'},{status:400});
  const pool=getDatabasePool();await ensureSiteTenants(pool);const admin=await isAdminRequest(req),staff=admin?null:await getStaffSession(req);
  const q=await pool.query('SELECT tenant_id,receipt_name,receipt_type,receipt_data FROM public.client_registrations WHERE id=$1',[id]);
  if(q.rowCount&&!admin){
   if(Number(q.rows[0].tenant_id)!==Number(staff?.tenant_id))return NextResponse.json({error:'You cannot access another company’s receipt.'},{status:403});
  }
  if(!q.rowCount||!q.rows[0].receipt_data)return NextResponse.json({error:'Receipt not found'},{status:404});
  const row=q.rows[0];
  return new NextResponse(row.receipt_data,{headers:{'Content-Type':row.receipt_type||'application/octet-stream','Content-Disposition':'inline; filename="'+String(row.receipt_name||'receipt').replace(/["\\]/g,'')+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){console.error('Receipt retrieval failed',e.code||e.message);return NextResponse.json({error:'Could not retrieve receipt'},{status:500});}
}
