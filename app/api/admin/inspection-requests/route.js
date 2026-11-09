import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (!await authorizeAdminRequest(req,['inspections.view','inspections.manage'])) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Database is not configured'},{status:503});
  try {
    const q=await getDatabasePool().query(`SELECT r.id,r.full_name,r.contact,r.client_email,r.preferred_date,r.preferred_time,r.duration_minutes,r.property_id,r.message,r.status,r.created_at FROM public.inspection_requests r ORDER BY r.created_at DESC LIMIT 100`);
    return NextResponse.json({requests:q.rows},{headers:{'Cache-Control':'no-store'}});
  } catch(e) { console.error('Admin request list failed',e.code||e.message); return NextResponse.json({error:'Could not load requests'},{status:500}); }
}
export async function PATCH(req) {
  if (!await authorizeAdminRequest(req,'inspections.manage')) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Database is not configured'},{status:503});
  let d;
  try { d=await req.json(); } catch { return NextResponse.json({error:'Invalid JSON body'},{status:400}); }
  if(!d||typeof d!=='object'||Array.isArray(d)) return NextResponse.json({error:'Request body must be an object'},{status:400});
  try {
    const id=String(d.id||''), status=String(d.status||'');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Invalid request ID'},{status:400});
    // Re-check eligibility at approval time as well as at submission time.
    // This prevents a pending request from being confirmed after its registration
    // has been rejected or otherwise changed.
    if (status === 'confirmed') {
      const eligibility = await getDatabasePool().query(
        `SELECT r.id FROM public.inspection_requests i
         JOIN LATERAL (SELECT id,payment_status FROM public.client_registrations
           WHERE lower(email)=lower(i.client_email)
           ORDER BY updated_at DESC,created_at DESC LIMIT 1) r ON true
         WHERE i.id=$1 AND r.payment_status='approved'`,
        [id]
      );
      if (!eligibility.rowCount) return NextResponse.json({error:'This client does not have an approved registration and verified payment. Do not confirm this inspection.'},{status:403});
    }
    const allowedPrevious={
      confirmed:['pending','contacted'],
      declined:['pending','contacted'],
      contacted:['pending','confirmed'],
      completed:['confirmed'],
      cancelled:['pending','confirmed','contacted']
    };
    if(!/^[0-9a-f-]{36}$/i.test(id)||!Object.hasOwn(allowedPrevious,status)) return NextResponse.json({error:'Invalid action'},{status:400});
    const pool=getDatabasePool();
    const current=await pool.query('SELECT id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message,calendar_event_id FROM public.inspection_requests WHERE id=$1',[id]);
    if(!current.rowCount)return NextResponse.json({error:'Request not found'},{status:404});
    const currentRow=current.rows[0];
    if(!allowedPrevious[status].includes(currentRow.status) && currentRow.status!==status)
      return NextResponse.json({error:'This status change is not allowed from '+currentRow.status+'. Refresh the request and choose a valid next action.',currentStatus:currentRow.status},{status:409});
    // Inspection approvals are managed entirely in the Super Admin dashboard.
    // Neon is the only source of truth; no external calendar is required.
    const calendar={created:false,reason:'Managed directly in the Super Admin dashboard.'};
    const q=await pool.query('UPDATE public.inspection_requests SET status=$2,calendar_event_id=CASE WHEN $5::boolean THEN NULL ELSE COALESCE($4,calendar_event_id) END,updated_at=now() WHERE id=$1 AND status=$3 RETURNING id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message,calendar_event_id',[id,status,currentRow.status,currentRow.calendar_event_id||null,(status==='cancelled'||status==='contacted')&&currentRow.status==='confirmed']);
    if(!q.rowCount) return NextResponse.json({error:'This request was updated by another admin. Refresh the inbox and try again.'},{status:409});
    return NextResponse.json({ok:true,request:q.rows[0],message:'Inspection booking status saved in the Super Admin dashboard.'},{headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    if(e.code==='23505') return NextResponse.json({error:'That slot is already held by another pending or confirmed request. Choose another slot.'},{status:409});
    console.error('Admin request update failed',e.code||e.message);
    return NextResponse.json({error:'Could not update request'},{status:500});
  }
}