import {NextResponse} from 'next/server';
import {getSchedule,slotIsAvailable} from '../../../lib/inspection-schedule';
import {getDatabasePool} from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const date=String(req.nextUrl.searchParams.get('date')||'');
  const month=String(req.nextUrl.searchParams.get('month')||'');
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Choose a valid inspection date.'},{status:400});
  if(!date&&!month)return NextResponse.json({error:'Choose an inspection date or calendar month.'},{status:400});
  if(month&&!date&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return NextResponse.json({error:'Choose a valid calendar month.'},{status:400});
  const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';const tenant=await resolveSiteTenant(getDatabasePool(),host);if(!tenant)return NextResponse.json({error:'This domain is not connected to an active company workspace.'},{status:404});
  const schedule=await getSchedule(tenant.id);
  if(month&&!date)return NextResponse.json({month,timezone:'Africa/Lagos',workingDays:schedule.workingDays,blockedDates:schedule.blockedDates},{headers:{'Cache-Control':'no-store'}});
  const [y,m,d]=date.split('-').map(Number),weekday=new Date(Date.UTC(y,m-1,d,12)).getUTCDay();
  if(date!==[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-')||!schedule.workingDays.includes(weekday)||schedule.blockedDates.includes(date))return NextResponse.json({date,timezone:'Africa/Lagos',slots:[]},{headers:{'Cache-Control':'no-store'}});
  const toMin=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),fromMin=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const slots=[];
  for(let n=toMin(schedule.startTime);n+schedule.slotMinutes<=toMin(schedule.endTime);n+=schedule.slotMinutes){const time=fromMin(n);if(await slotIsAvailable(date,time,schedule,[],tenant.id))slots.push(time)}
  return NextResponse.json({date,timezone:'Africa/Lagos',slots},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Schedule availability failed',e.message);return NextResponse.json({error:e.message||'Could not load availability.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
