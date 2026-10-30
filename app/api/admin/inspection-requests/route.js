import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { queueInspectionEmails, deliverInspectionEmails } from '@/lib/inspection-email-outbox';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const pool = globalThis.__gbestPool || (globalThis.__gbestPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, ssl: { rejectUnauthorized: true } }));
const safe = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function auth(req) { const expected = process.env.ADMIN_SECRET; const got = req.headers.get('authorization') || ''; return !!expected && got === 'Bearer ' + expected; }
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
  const end = new Date(start.getTime()+30*60*1000);
  const eventId=calendarEventId(reqRow.id);
  const event = { id:eventId, summary:'G-BEST property inspection — '+reqRow.full_name, description:'Approved physical property inspection. Property reference: '+(reqRow.property_id||'Not specified')+'. Client contact: '+reqRow.contact+'. Request ID: '+reqRow.id, start:{dateTime:start.toISOString(),timeZone:'Africa/Lagos'}, end:{dateTime:end.toISOString(),timeZone:'Africa/Lagos'}, attendees:reqRow.client_email?[{email:reqRow.client_email}]:[], guestsCanModify:false };
  const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(GOOGLE_CALENDAR_ID)+'/events';
  let evRes=await fetch(base+'?sendUpdates=all',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify(event)});
  let ev=await evRes.json().catch(()=>({}));
  if(evRes.status===409) {
    evRes=await fetch(base+'/'+encodeURIComponent(eventId),{headers:{Authorization:'Bearer '+token.access_token}});
    ev=await evRes.json().catch(()=>({}));
  }
  if(!evRes.ok){console.error('Google Calendar event create/recovery failed',evRes.status);return {created:false,reason:'Google Calendar rejected event creation.'};}
  await pool.query('UPDATE public.inspection_requests SET calendar_event_id=$2,updated_at=now() WHERE id=$1',[reqRow.id,eventId]);
  return {created:true,eventId,htmlLink:ev.htmlLink};
}
export async function GET(req) {
  if (!auth(req)) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Database is not configured'},{status:503});
  try {
    const q=await pool.query(\`SELECT r.id,r.full_name,r.contact,r.client_email,r.preferred_date,r.preferred_time,r.property_id,r.message,r.status,r.calendar_event_id,r.created_at,
      COALESCE(o.sent_count,0)::int AS emails_sent,COALESCE(o.failed_count,0)::int AS emails_failed,COALESCE(o.pending_count,0)::int AS emails_pending
      FROM public.inspection_requests r
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE status='sent') AS sent_count,count(*) FILTER (WHERE status='failed') AS failed_count,count(*) FILTER (WHERE status='pending') AS pending_count FROM public.inspection_email_outbox WHERE inspection_request_id=r.id) o ON true
      ORDER BY r.created_at DESC LIMIT 100\`);
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
    const allowedPrevious={
      confirmed:['pending','contacted'],
      declined:['pending','contacted'],
      contacted:['pending','confirmed'],
      completed:['confirmed'],
      cancelled:['pending','confirmed','contacted']
    };
    if(!/^[0-9a-f-]{36}$/i.test(id)||!Object.hasOwn(allowedPrevious,status)) return NextResponse.json({error:'Invalid action'},{status:400});
    const q=await pool.query('UPDATE public.inspection_requests SET status=$2,updated_at=now() WHERE id=$1 AND status=ANY($3::text[]) AND status IS DISTINCT FROM $2 RETURNING id,status,full_name,contact,client_email,preferred_date,preferred_time,property_id,message,calendar_event_id',[id,status,allowedPrevious[status]]);
    if(!q.rowCount) {
      const existing=await pool.query('SELECT id,status,full_name,contact,client_email,preferred_date,preferred_time,property_id,message,calendar_event_id FROM public.inspection_requests WHERE id=$1',[id]);
      if(!existing.rowCount) return NextResponse.json({error:'Request not found'},{status:404});
      const prior=existing.rows[0];
      if(prior.status!==status) return NextResponse.json({error:'This status change is not allowed from '+prior.status+'. Refresh the request and choose a valid next action.',currentStatus:prior.status},{status:409});
      let retryCalendar={created:false,reason:'No status change; calendar was not changed.'};
      if(status==='confirmed'&&!prior.calendar_event_id) {
        try { retryCalendar=await createCalendarEvent(prior); }
        catch(e) { console.error('Calendar retry failed',e.message); retryCalendar={created:false,reason:'Google Calendar could not be reached.'}; }
      }
      const retried=await deliverInspectionEmails(id);
      return NextResponse.json({ok:true,unchanged:true,request:prior,calendar:retryCalendar,email:{retried},warnings:[...(!retryCalendar.created&&status==='confirmed'&&!prior.calendar_event_id?[retryCalendar.reason]:[]),...(retried.failed?['Some emails remain queued for retry.']:[])]},{headers:{'Cache-Control':'no-store'}});
    }
    const row=q.rows[0];
    let calendar={created:false,reason:'Calendar event only applies to confirmed requests.'};
    if(status==='confirmed'&&!row.calendar_event_id) {
      try { calendar=await createCalendarEvent(row); }
      catch(e) { console.error('Calendar integration failed',e.message); calendar={created:false,reason:'Google Calendar could not be reached.'}; }
      if(calendar.created) row.calendar_event_id=calendar.eventId;
    }
    const date=String(row.preferred_date).slice(0,10), time=String(row.preferred_time||'').slice(0,5);
    const subject=status==='confirmed'?'Your G-BEST inspection is confirmed':status==='declined'?'Update on your G-BEST inspection request':'Update to your G-BEST inspection request';
    const message=status==='confirmed'?'Your physical inspection has been approved for '+date+' at '+time+' WAT. The appointment is 30 minutes.':status==='declined'?'We are sorry, but we cannot approve your requested inspection slot. Please contact our team to arrange another time.':'Your inspection request status has been updated to '+status+'.';
    await queueInspectionEmails([
      {requestId:row.id,type:'client',to:row.client_email,subject,html:'<p>Hello '+safe(row.full_name)+',</p><p>'+safe(message)+'</p><p>G-BEST Luxury Realty</p>'},
      {requestId:row.id,type:'admin',to:process.env.ADMIN_EMAIL,subject:'Inspection request '+status+' — '+row.full_name,html:'<p>Request status: '+safe(status)+'</p><p>Client: '+safe(row.full_name)+' ('+safe(row.client_email)+')</p><p>Requested slot: '+safe(date)+' '+safe(time)+' WAT</p><p>Calendar event: '+(calendar.created?'created':safe(calendar.reason))+'</p>'}
    ]);
    const email=await deliverInspectionEmails(row.id);
    return NextResponse.json({ok:true,request:row,calendar,email,warnings:[...(!calendar.created&&status==='confirmed'?[calendar.reason]:[]),...(email.failed||email.skipped?['Some emails remain queued for retry.']:[])]},{headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    if(e.code==='23505') return NextResponse.json({error:'That slot is already held by another pending or confirmed request. Choose another slot.'},{status:409});
    console.error('Admin request update failed',e.code||e.message);
    return NextResponse.json({error:'Could not update request'},{status:500});
  }
}