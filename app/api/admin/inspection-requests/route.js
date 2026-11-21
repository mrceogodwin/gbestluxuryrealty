import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import { queueInspectionEmails, deliverInspectionEmails } from '../../../../lib/inspection-email-outbox';
import {authorizeAdminRequest} from '../../../../lib/admin-permissions';
import {isAdminRequest} from '../../../../lib/admin-auth';
import {ensureSiteTenants} from '../../../../lib/site-tenants';
import {getStaffSession} from '../../../../lib/staff-auth';
import {getSchedule,validClock} from '../../../../lib/inspection-schedule';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function GET(req) {
  if (!await authorizeAdminRequest(req,['inspections.view','inspections.manage'])) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Database is not configured'},{status:503});
  try {
    const pool=getDatabasePool();await ensureSiteTenants(pool);const admin=await isAdminRequest(req);const url=new URL(req.url);let tenantId=url.searchParams.get('tenantId');if(!admin){const staff=await getStaffSession(req);tenantId=String(staff?.tenant_id||'');}else if(!tenantId){const owner=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");tenantId=String(owner.rows[0]?.id||'');}if(!Number.isSafeInteger(Number(tenantId))||Number(tenantId)<1)return NextResponse.json({error:'Choose a valid company workspace.'},{status:400});const tenant=await pool.query('SELECT id FROM public.site_tenants WHERE id=$1',[tenantId]);if(!tenant.rowCount)return NextResponse.json({error:'Company workspace not found.'},{status:404});
    const q=await pool.query(`SELECT r.id,r.tenant_id,r.full_name,r.contact,r.client_email,r.preferred_date,r.preferred_time,r.duration_minutes,r.property_id,r.message,r.status,r.created_at,
      COALESCE(o.sent_count,0)::int AS emails_sent,COALESCE(o.failed_count,0)::int AS emails_failed,COALESCE(o.pending_count,0)::int AS emails_pending
      FROM public.inspection_requests r
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE status='sent') AS sent_count,count(*) FILTER (WHERE status='failed') AS failed_count,count(*) FILTER (WHERE status='pending') AS pending_count FROM public.inspection_email_outbox WHERE inspection_request_id=r.id) o ON true
      WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 100`,[tenantId]);
    const tenants=admin?(await pool.query('SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC')).rows:[];
    return NextResponse.json({requests:q.rows,tenants,activeTenantId:Number(tenantId)},{headers:{'Cache-Control':'no-store'}});
  } catch(e) { console.error('Admin request list failed',e.code||e.message); return NextResponse.json({error:'Could not load requests'},{status:500}); }
}
export async function PATCH(req) {
  if (!await authorizeAdminRequest(req,'inspections.manage')) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Database is not configured'},{status:503});
  let d;
  try { d=await req.json(); } catch { return NextResponse.json({error:'Invalid JSON body'},{status:400}); }
  if(!d||typeof d!=='object'||Array.isArray(d)) return NextResponse.json({error:'Request body must be an object'},{status:400});
  try {
    const pool=getDatabasePool();await ensureSiteTenants(pool);const admin=await isAdminRequest(req);
    const id=String(d.id||''), status=String(d.status||'');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Invalid request ID'},{status:400});
    const ownership=await pool.query('SELECT tenant_id FROM public.inspection_requests WHERE id=$1',[id]);if(!ownership.rowCount)return NextResponse.json({error:'Request not found'},{status:404});
    if(!admin){const staff=await getStaffSession(req);if(Number(ownership.rows[0].tenant_id)!==Number(staff?.tenant_id))return NextResponse.json({error:'You cannot manage another company’s inspection request.'},{status:403});}
    const allowedPrevious={confirmed:['pending','contacted'],declined:['pending','contacted'],contacted:['pending','confirmed'],completed:['confirmed'],cancelled:['pending','confirmed','contacted']};
    if(!Object.hasOwn(allowedPrevious,status)) return NextResponse.json({error:'Invalid action'},{status:400});
    const initial=await pool.query('SELECT preferred_date FROM public.inspection_requests WHERE id=$1',[id]);
    if(!initial.rowCount)return NextResponse.json({error:'Request not found'},{status:404});
    const dateKey=String(initial.rows[0].preferred_date).slice(0,10);
    const client=await pool.connect();let q;let currentRow;
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('inspection-booking'))",[dateKey]);
      const current=await client.query('SELECT id,tenant_id,status,full_name,contact,client_email,client_registration_id,preferred_date,preferred_time,duration_minutes,property_id,message,calendar_event_id FROM public.inspection_requests WHERE id=$1 FOR UPDATE',[id]);
      if(!current.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'Request not found'},{status:404});}
      currentRow=current.rows[0];
      if(!allowedPrevious[status].includes(currentRow.status)&&currentRow.status!==status){await client.query('ROLLBACK');return NextResponse.json({error:'This status change is not allowed from '+currentRow.status+'. Refresh the request and choose a valid next action.',currentStatus:currentRow.status},{status:409});}
      if(status==='confirmed'&&currentRow.status!=='confirmed'){
        // A property can be marked SOLD after the client submits a pending request.
        // Re-check its live status at approval time, not only at initial submission.
        const property=await client.query(
          "SELECT status FROM public.properties WHERE id=$1 AND tenant_id=$2 LIMIT 1",
          [currentRow.property_id,currentRow.tenant_id]
        );
        if(!property.rowCount||!['published','available'].includes(property.rows[0].status)){
          await client.query('ROLLBACK');
          return NextResponse.json({error:'This property is no longer available for inspection. It may have been sold, archived or unpublished. Please contact the client before approving.'},{status:409});
        }
        const eligibility=currentRow.client_registration_id
          ? await client.query("SELECT id FROM public.client_registrations WHERE id=$1::uuid AND tenant_id=$2 AND lower(email)=lower($3) AND payment_status='approved' AND client_status='active' LIMIT 1",[currentRow.client_registration_id,currentRow.tenant_id,currentRow.client_email])
          : await client.query("SELECT id FROM public.client_registrations WHERE tenant_id=$2 AND lower(email)=lower($1) AND payment_status='approved' AND client_status='active' ORDER BY updated_at DESC,created_at DESC LIMIT 1",[currentRow.client_email,currentRow.tenant_id]);
        if(!eligibility.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'This client does not have an approved registration and verified payment. Do not confirm this inspection.'},{status:403});}
        const schedule=await getSchedule(currentRow.tenant_id),date=String(currentRow.preferred_date).slice(0,10),time=String(currentRow.preferred_time||'').slice(0,5);
        const [year,month,day]=date.split('-').map(Number),weekday=new Date(Date.UTC(year,month-1,day,12)).getUTCDay(),duration=Number(currentRow.duration_minutes||schedule.slotMinutes||30);
        const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),start=minutes(time),end=start+duration;
        const valid=validClock(time)&&schedule.workingDays.includes(weekday)&&!schedule.blockedDates.includes(date)&&start>=minutes(schedule.startTime)&&end<=minutes(schedule.endTime)&&(start-minutes(schedule.startTime))%Number(schedule.slotMinutes)===0&&duration===Number(schedule.slotMinutes)&&new Date(date+'T'+time+':00+01:00').getTime()>Date.now();
        if(!valid){await client.query('ROLLBACK');return NextResponse.json({error:'This requested time is no longer valid under the current inspection schedule. Contact the client to arrange another available slot.'},{status:409});}
        const overlap=await client.query("SELECT 1 FROM public.inspection_requests WHERE tenant_id=$4 AND preferred_date=$1::date AND id<>$5 AND status IN ('pending','contacted','confirmed') AND preferred_time < ($2::time + ($3 * interval '1 minute')) AND (preferred_time + (COALESCE(duration_minutes,30) * interval '1 minute')) > $2::time LIMIT 1",[date,time,duration,currentRow.tenant_id,id]);
        if(overlap.rowCount){await client.query('ROLLBACK');return NextResponse.json({error:'This inspection slot is no longer available. Another request is holding the time. Contact the client to choose another slot.'},{status:409});}
      }
      q=await client.query('UPDATE public.inspection_requests SET status=$2,updated_at=now() WHERE id=$1 AND status=$3 RETURNING id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message',[id,status,currentRow.status]);
      await client.query('COMMIT');
    } catch(transactionError){await client.query('ROLLBACK').catch(()=>{});throw transactionError;}
    finally{client.release();}
    if(!q.rowCount) {
      const existing=await getDatabasePool().query('SELECT id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message FROM public.inspection_requests WHERE id=$1',[id]);
      if(!existing.rowCount) return NextResponse.json({error:'Request not found'},{status:404});
      const prior=existing.rows[0];
      if(prior.status!==status) return NextResponse.json({error:'This status change is not allowed from '+prior.status+'. Refresh the request and choose a valid next action.',currentStatus:prior.status},{status:409});
      const retried=await deliverInspectionEmails(id);
      const counts=await getDatabasePool().query(`SELECT count(*) FILTER (WHERE status='sent')::int AS emails_sent,count(*) FILTER (WHERE status='failed')::int AS emails_failed,count(*) FILTER (WHERE status='pending')::int AS emails_pending FROM public.inspection_email_outbox WHERE inspection_request_id=$1`,[id]);
      Object.assign(prior,counts.rows[0]||{});
      return NextResponse.json({ok:true,unchanged:true,request:prior,email:{retried},warnings:retried.failed?['Some emails remain queued for retry.']:[]},{headers:{'Cache-Control':'no-store'}});
    }
    const row=q.rows[0];
    const warnings=[];
    const date=String(row.preferred_date).slice(0,10), time=String(row.preferred_time||'').slice(0,5);
    const subject=status==='confirmed'?'Your G-BEST inspection is confirmed':status==='declined'?'Update on your G-BEST inspection request':'Update to your G-BEST inspection request';
    const message=status==='confirmed'?'Your physical inspection has been approved for '+date+' at '+time+' WAT. The appointment is '+Number(row.duration_minutes||30)+' minutes.':status==='declined'?'We are sorry, but we cannot approve your requested inspection slot. Please contact our team to arrange another time.':'Your inspection request status has been updated to '+status+'.';
    let email={sent:0,failed:0,skipped:0};
    try {
      await queueInspectionEmails([
        {requestId:row.id,type:'client',to:row.client_email,subject,html:'<p>Hello '+safe(row.full_name)+',</p><p>'+safe(message)+'</p><p>G-BEST Luxury Realty</p>'},
        {requestId:row.id,type:'admin',to:process.env.ADMIN_EMAIL,subject:'Inspection request '+status+' — '+row.full_name,html:'<p>Request status: '+safe(status)+'</p><p>Client: '+safe(row.full_name)+' ('+safe(row.client_email)+')</p><p>Requested slot: '+safe(date)+' '+safe(time)+' WAT</p>'}
      ]);
      email=await deliverInspectionEmails(row.id);
      if(email.failed||email.skipped)warnings.push('Some emails remain queued for retry.');
    } catch(notificationError) {
      console.error('Inspection status saved but email queueing failed',notificationError.code||notificationError.message);
      warnings.push('The status was saved, but notification emails could not be queued. Retry notifications from the admin panel.');
    }
    const counts=await getDatabasePool().query(`SELECT count(*) FILTER (WHERE status='sent')::int AS emails_sent,count(*) FILTER (WHERE status='failed')::int AS emails_failed,count(*) FILTER (WHERE status='pending')::int AS emails_pending FROM public.inspection_email_outbox WHERE inspection_request_id=$1`,[row.id]);
    Object.assign(row,counts.rows[0]||{});
    return NextResponse.json({ok:true,request:row,email,warnings:[...warnings]},{headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    if(e.code==='23505') return NextResponse.json({error:'That slot is already held by another pending, contacted or confirmed request. Choose another slot.'},{status:409});
    console.error('Admin request update failed',e.code||e.message);
    return NextResponse.json({error:'Could not update request'},{status:500});
  }
}