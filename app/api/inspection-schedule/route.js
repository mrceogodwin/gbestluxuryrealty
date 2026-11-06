import {NextResponse} from 'next/server';
import {getSchedule,slotIsAvailable,calendarBusy,localSlot} from '../../../lib/inspection-schedule';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req){
 try{
  const date=String(req.nextUrl.searchParams.get('date')||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:'Choose an inspection date.'},{status:400});
  const schedule=await getSchedule();
  const [y,m,d]=date.split('-').map(Number),weekday=new Date(Date.UTC(y,m-1,d,12)).getUTCDay();
  if(date!==[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-')||!schedule.workingDays.includes(weekday)||schedule.blockedDates.includes(date))return NextResponse.json({date,timezone:'Africa/Lagos',slots:[]},{headers:{'Cache-Control':'no-store'}});
  const toMin=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),fromMin=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  const dayBusy=await calendarBusy(localSlot(date,schedule.startTime),localSlot(date,schedule.endTime));
  const slots=[];
  for(let n=toMin(schedule.startTime);n+schedule.slotMinutes<=toMin(schedule.endTime);n+=schedule.slotMinutes){const time=fromMin(n);if(await slotIsAvailable(date,time,schedule,dayBusy))slots.push(time)}
  return NextResponse.json({date,timezone:'Africa/Lagos',slots},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Schedule availability failed',e.message);return NextResponse.json({error:e.message||'Could not load availability.'},{status:503,headers:{'Cache-Control':'no-store'}})}
}
