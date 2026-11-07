import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import { queueInspectionEmails, deliverInspectionEmails } from '../../../../lib/inspection-email-outbox';
import {isAdminRequest} from '../../../../lib/admin-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function calendarEventId(requestId) {
  const hex=String(requestId).replace(/-/g,'').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(hex)) throw new Error('Invalid inspection request ID');
  return 'gbest'+BigInt('0x'+hex).toString(32);
}
async function createCalendarEvent(reqRow) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_CALENDAR_ID) return { created:false, reason:'Google Calendar credentials are not configured.' };
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}) });
  if (!tokenRes.ok) { console.error('Google OAuth token refresh failed',tokenRes.status); return {created:false,reason:'Google authorization failed.'}; }
  const token = await tokenRes.json();
  const start = new Date(String(reqRow.preferred_date).slice(0,10)+'T'+String(reqRow.preferred_time).slice(0,8)+'+01:00');
  const durationMinutes=Number(reqRow.duration_minutes||30);
  const end = new Date(start.getTime()+durationMinutes*60*1000);
  const eventId=calendarEventId(reqRow.id);
  const event = { id:eventId, summary:'G-BEST property inspection — '+reqRow.full_name, description:'Approved physical property inspection. Property reference: '+(reqRow.property_id||'Not specified')+'. Client contact: '+reqRow.contact+'. Request ID: '+reqRow.id, start:{dateTime:start.toISOString(),timeZone:'Africa/Lagos'}, end:{dateTime:end.toISOString(),timeZone:'Africa/Lagos'}, attendees:reqRow.client_email?[{email:reqRow.client_email}]:[], guestsCanModify:false };
  const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(GOOGLE_CALENDAR_ID)+'/events';
  const headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
  // Idempotency: recover this request's event before checking availability.
  // Otherwise a retry would see its own existing event as a conflict.
  let existingRes=await fetch(base+'/'+encodeURIComponent(eventId),{headers});
  if(existingRes.ok) {
    const existing=await existingRes.json().catch(()=>({}));
    await getDatabasePool().query('UPDATE public.inspection_requests SET calendar_event_id=$2,updated_at=now() WHERE id=$1',[reqRow.id,eventId]);
    return {created:true,eventId,htmlLink:existing.htmlLink,recovered:true};
  }
  if(existingRes.status!==404){console.error('Google Calendar event lookup failed',existingRes.status);return {created:false,reason:'Could not verify whether this inspection is already on Google Calendar.'};}
  // Ask Google Calendar FreeBusy for the exact 30-minute window before creating.
  const freeBusyRes=await fetch('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers,body:JSON.stringify({timeMin:start.toISOString(),timeMax:end.toISOString(),timeZone:'Africa/Lagos',items:[{id:GOOGLE_CALENDAR_ID}]})});
  const freeBusy=await freeBusyRes.json().catch(()=>({}));
  if(!freeBusyRes.ok){console.error('Google Calendar availability check failed',freeBusyRes.status);return {created:false,reason:'Could not verify calendar availability. The inspection was not added to the calendar.'};}
  const busy=freeBusy.calendars?.[GOOGLE_CALENDAR_ID]?.busy||[];
  if(busy.length)return {created:false,reason:'The requested time conflicts with an existing calendar event. Choose another inspection slot.'};
  const evRes=await fetch(base+'?sendUpdates=all',{method:'POST',headers,body:JSON.stringify(event)});
  const ev=await evRes.json().catch(()=>({}));
  if(!evRes.ok){console.error('Google Calendar event creation failed',evRes.status);return {created:false,reason:'Google Calendar rejected event creation.'};}
  await getDatabasePool().query('UPDATE public.inspection_requests SET calendar_event_id=$2,updated_at=now() WHERE id=$1',[reqRow.id,eventId]);
  return {created:true,eventId,htmlLink:ev.htmlLink};
}
async function deleteCalendarEvent(reqRow) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_CALENDAR_ID } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN || !GOOGLE_CALENDAR_ID)
    return { deleted:false, reason:'Google Calendar credentials are not configured.' };
  const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
  if(!tokenRes.ok)return {deleted:false,reason:'Google authorization failed.'};
  const token=await tokenRes.json();
  const eventId=reqRow.calendar_event_id||calendarEventId(reqRow.id);
  const url='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(GOOGLE_CALENDAR_ID)+'/events/'+encodeURIComponent(eventId);
  const res=await fetch(url,{method:'DELETE',headers:{Authorization:'Bearer '+token.access_token}});
  if(res.status===404||res.status===410)return {deleted:true,eventId,alreadyAbsent:true};
  if(!res.ok){console.error('Google Calendar event deletion failed',res.status);return {deleted:false,reason:'Could not remove the inspection from Google Calendar.'};}
  return {deleted:true,eventId};
}
export async function GET(req) {
  if (!await isAdminRequest(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
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
  if (!auth(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
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
    // Remove the calendar event before cancelling or moving a confirmed request
    // back to contacted. If Google cannot remove it, leave the database unchanged.
    let calendar={created:false,reason:'Calendar event only applies to confirmed requests.'};
    if((status==='cancelled'||status==='contacted')&&currentRow.status==='confirmed') {
      let removal;
      try { removal=await deleteCalendarEvent(currentRow); }
      catch(e) { console.error('Calendar cancellation failed',e.message); removal={deleted:false,reason:'Google Calendar could not be reached.'}; }
      if(!removal.deleted)return NextResponse.json({error:removal.reason||'Could not cancel the calendar event. The request status was not changed.'},{status:503});
      calendar={created:false,deleted:true,eventId:removal.eventId};
    }
    if(status==='confirmed') {
      try { calendar=await createCalendarEvent(currentRow); }
      catch(e) { console.error('Calendar integration failed',e.message); calendar={created:false,reason:'Google Calendar could not be reached.'}; }
      if(!calendar.created)return NextResponse.json({error:calendar.reason||'Google Calendar could not confirm this appointment. The request remains unconfirmed.'},{status:503});
      currentRow.calendar_event_id=calendar.eventId||currentRow.calendar_event_id;
    }
    const q=await pool.query('UPDATE public.inspection_requests SET status=$2,calendar_event_id=CASE WHEN $5::boolean THEN NULL ELSE COALESCE($4,calendar_event_id) END,updated_at=now() WHERE id=$1 AND status=$3 RETURNING id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message,calendar_event_id',[id,status,currentRow.status,currentRow.calendar_event_id||null,(status==='cancelled'||status==='contacted')&&currentRow.status==='confirmed']);
    if(!q.rowCount) {
      if(status==='confirmed'&&calendar.created&&calendar.eventId) {
        // The deterministic event can be recovered safely on the next admin retry.
        console.error('Calendar event exists but request status changed concurrently',id);
      }
      const existing=await getDatabasePool().query('SELECT id,status,full_name,contact,client_email,preferred_date,preferred_time,duration_minutes,property_id,message,calendar_event_id FROM public.inspection_requests WHERE id=$1',[id]);
      if(!existing.rowCount) return NextResponse.json({error:'Request not found'},{status:404});
      const prior=existing.rows[0];
      if(prior.status!==status) return NextResponse.json({error:'This status change is not allowed from '+prior.status+'. Refresh the request and choose a valid next action.',currentStatus:prior.status},{status:409});
      let retryCalendar={created:false,reason:'No status change; calendar was not changed.'};
      if(status==='confirmed'&&!prior.calendar_event_id) {
        try { retryCalendar=await createCalendarEvent(prior); }
        catch(e) { console.error('Calendar retry failed',e.message); retryCalendar={created:false,reason:'Google Calendar could not be reached.'}; }
      }
      if(status==='confirmed'&&!prior.calendar_event_id&&!retryCalendar.created) {
        return NextResponse.json({ok:false,unchanged:true,request:prior,calendar:retryCalendar,error:retryCalendar.reason||'Calendar confirmation is still pending. No confirmation emails were sent.'},{status:503,headers:{'Cache-Control':'no-store'}});
      }
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
    return NextResponse.json({ok:true,request:row,calendar,email,warnings:[...(!calendar.created&&status==='confirmed'?[calendar.reason]:[]),...warnings]},{headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    if(e.code==='23505') return NextResponse.json({error:'That slot is already held by another pending or confirmed request. Choose another slot.'},{status:409});
    console.error('Admin request update failed',e.code||e.message);
    return NextResponse.json({error:'Could not update request'},{status:500});
  }
}