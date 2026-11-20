import {createHash} from 'node:crypto';

const zone='Africa/Lagos';
const config=()=>({
  clientId:process.env.GOOGLE_CLIENT_ID||'',
  clientSecret:process.env.GOOGLE_CLIENT_SECRET||'',
  refreshToken:process.env.GOOGLE_REFRESH_TOKEN||'',
  calendarId:process.env.GOOGLE_CALENDAR_ID||'primary'
});
const configured=()=>{const c=config();return Boolean(c.clientId&&c.clientSecret&&c.refreshToken&&c.calendarId);};

async function accessToken(){
  const c=config();
  if(!configured())throw new Error('Google Calendar credentials are not configured.');
  const body=new URLSearchParams({
    client_id:c.clientId,
    client_secret:c.clientSecret,
    refresh_token:c.refreshToken,
    grant_type:'refresh_token'
  });
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body,
    cache:'no-store'
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw new Error('Google Calendar authorization failed.');
  return data.access_token;
}
async function calendarRequest(path,{method='GET',body}={}){
  const token=await accessToken(),c=config();
  const response=await fetch('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(c.calendarId)+'/events'+path,{
    method,
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
    cache:'no-store'
  });
  if(response.status===404)return null;
  if(response.status===409)return {conflict:true};
  if(method==='DELETE'&&response.status===410)return {deleted:true};
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error('Google Calendar request failed ('+response.status+').');
  return data;
}

export async function createInspectionCalendarEvent(request){
  if(!configured())return {created:false,reason:'Google Calendar is not configured.'};
  const id=String(request.id||'').replace(/[^a-f0-9]/gi,'').toLowerCase();
  if(id.length<5)throw new Error('Inspection request ID is invalid for calendar event creation.');
  const date=String(request.preferred_date).slice(0,10);
  const time=String(request.preferred_time).slice(0,5);
  const duration=Number(request.duration_minutes||30);
  const start=new Date(date+'T'+time+':00+01:00');
  if(!Number.isFinite(start.getTime())||!Number.isFinite(duration)||duration<1||duration>480)throw new Error('Inspection appointment time is invalid.');
  const end=new Date(start.getTime()+duration*60000);
  const event={
    id,
    summary:'G-BEST Property Inspection — '+String(request.full_name||'Client').slice(0,100),
    description:[
      'G-BEST Luxury Realty inspection appointment',
      'Client: '+String(request.full_name||'').slice(0,120),
      'Contact: '+String(request.contact||'').slice(0,160),
      'Email: '+String(request.client_email||'').slice(0,254),
      'Property reference: '+String(request.property_id||'').slice(0,100),
      'Request ID: '+String(request.id)
    ].join('\n'),
    start:{dateTime:start.toISOString(),timeZone:zone},
    end:{dateTime:end.toISOString(),timeZone:zone}
  };
  const result=await calendarRequest('?sendUpdates=none',{method:'POST',body:event});
  if(result?.conflict){
    const existing=await calendarRequest('/'+encodeURIComponent(id));
    if(existing?.id)return {created:true,eventId:existing.id,alreadyExisted:true};
    throw new Error('Calendar event already exists but could not be retrieved.');
  }
  return {created:Boolean(result?.id),eventId:result?.id||null};
}

export async function deleteInspectionCalendarEvent(eventId){
  if(!eventId)return {deleted:false,reason:'No calendar event is linked to this request.'};
  if(!configured())return {deleted:false,reason:'Google Calendar is not configured.'};
  await calendarRequest('/'+encodeURIComponent(String(eventId))+'?sendUpdates=none',{method:'DELETE'});
  return {deleted:true};
}
