import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import { queueInspectionEmails, deliverInspectionEmails } from '../../../../lib/inspection-email-outbox';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function GET(req) {
  if (!await authorizeAdminRequest(req,['inspections.view','inspections.manage'])) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Database is not configured'},{status:503});
  try {
    const q=await getDatabasePool().query(`SELECT r.id,r.full_name,r.contact,r.client_email,r.preferred_date,r.preferred_time,r.duration_minutes,r.property_id,r.message,r.status,r.calendar_event_id,r.created_at,
      COALESCE(o.sent_count,0)::int AS emails_sent,COALESCE(o.failed_count,0)::int AS emails_failed,COALESCE(o.pending_count,0)::int AS emails_pending
      FROM public.inspection_requests r
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE status='sent') AS sent_count,count(*) FILTER (WHERE status='failed') AS failed_count,count(*) FILTER (WHERE status='pending') AS pending_count FROM public.inspection_email_outbox WHERE inspection_request_id=r.id) o ON true
      ORDER BY r.created_at DESC LIMIT 100`);
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
    if(!q.rowCount) {
      const existing=await getDatabasePool().query('SELECT id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message,calendar_event_id FROM public.inspection_requests WHERE id=$1',[id]);
      if(!existing.rowCount) return NextResponse.json({error:'Request not found'},{status:404});
      const prior=existing.rows[0];
      if(prior.status!==status) return NextResponse.json({error:'This status change is not allowed from '+prior.status+'. Refresh the request and choose a valid next action.',currentStatus:prior.status},{status:409});
      const retryCalendar={created:false,reason:'Managed directly in the Super Admin dashboard.'};
      const retried=await deliverInspectionEmails(id);
      const counts=await getDatabasePool().query(`SELECT count(*) FILTER (WHERE status='sent')::int AS emails_sent,count(*) FILTER (WHERE status='failed')::int AS emails_failed,count(*) FILTER (WHERE status='pending')::int AS emails_pending FROM public.inspection_email_outbox WHERE inspection_request_id=$1`,[id]);
      Object.assign(prior,counts.rows[0]||{});
      return NextResponse.json({ok:true,unchanged:true,request:prior,calendar:retryCalendar,email:{retried},warnings:[...(!retryCalendar.created&&status==='confirmed'&&!prior.calendar_event_id?[retryCalendar.reason]:[]),...(retried.failed?['Some emails remain queued for retry.']:[])]},{headers:{'Cache-Control':'no-store'}});
    }
    const row=q.rows[0];
    const date=String(row.preferred_date).slice(0,10), time=String(row.preferred_time||'').slice(0,5);
    const subject=status==='confirmed'?'Your G-BEST inspection is confirmed':status==='declined'?'Update on your G-BEST inspection request':'Update to your G-BEST inspection request';
    const message=status==='confirmed'?'Your physical inspection has been approved for '+date+' at '+time+' WAT. The appointment is '+Number(row.duration_minutes||30)+' minutes.':status==='declined'?'We are sorry, but we cannot approve your requested inspection slot. Please contact our team to arrange another time.':'Your inspection request status has been updated to '+status+'.';
    let email={sent:0,failed:0,skipped:0};
    const warnings=[];
    try {
      await queueInspectionEmails([
        {requestId:row.id,type:'client',to:row.client_email,subject,html:'<p>Hello '+safe(row.full_name)+',</p><p>'+safe(message)+'</p><p>G-BEST Luxury Realty</p>'},
        {requestId:row.id,type:'admin',to:process.env.ADMIN_EMAIL,subject:'Inspection request '+status+' — '+row.full_name,html:'<p>Request status: '+safe(status)+'</p><p>Client: '+safe(row.full_name)+' ('+safe(row.client_email)+')</p><p>Requested slot: '+safe(date)+' '+safe(time)+' WAT</p><p>Calendar event: '+(calendar.created?'created':safe(calendar.reason))+'</p>'}
      ]);
      email=await deliverInspectionEmails(row.id);
      if(email.failed||email.skipped)warnings.push('Some emails remain queued for retry.');
    } catch(notificationError) {
      console.error('Inspection status saved but email queueing failed',notificationError.code||notificationError.message);
      warnings.push('The status was saved, but notification emails could not be queued. Retry notifications from the admin panel.');
    }
    const counts=await getDatabasePool().query(`SELECT count(*) FILTER (WHERE status='sent')::int AS emails_sent,count(*) FILTER (WHERE status='failed')::int AS emails_failed,count(*) FILTER (WHERE status='pending')::int AS emails_pending FROM public.inspection_email_outbox WHERE inspection_request_id=$1`,[row.id]);
    Object.assign(row,counts.rows[0]||{});
    return NextResponse.json({ok:true,request:row,calendar,email,warnings:[...warnings]},{headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    if(e.code==='23505') return NextResponse.json({error:'That slot is already held by another pending or confirmed request. Choose another slot.'},{status:409});
    console.error('Admin request update failed',e.code||e.message);
    return NextResponse.json({error:'Could not update request'},{status:500});
  }
}