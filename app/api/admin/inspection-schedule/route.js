import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {ZONE,getSchedule,validClock} from '../../../../lib/inspection-schedule';
export const runtime='nodejs';export const dynamic='force-dynamic';
import {isAdminRequest} from '../../../../lib/admin-auth';
export async function GET(req){if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});try{return NextResponse.json({settings:await getSchedule()},{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({error:'Could not load schedule settings.'},{status:500})}}
export async function PUT(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const d=await req.json(),workingDays=[...new Set((Array.isArray(d.workingDays)?d.workingDays:[]).map(Number))].sort();
  const blockedDates=[...new Set((Array.isArray(d.blockedDates)?d.blockedDates:[]).map(String))];
  const settings={timezone:ZONE,workingDays,startTime:String(d.startTime||''),endTime:String(d.endTime||''),slotMinutes:Number(d.slotMinutes),blockedDates};
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  if(!workingDays.length||workingDays.some(x=>!Number.isInteger(x)||x<1||x>6)||!validClock(settings.startTime)||!validClock(settings.endTime)||minutes(settings.endTime)<=minutes(settings.startTime)||![15,30,60].includes(settings.slotMinutes)||blockedDates.length>180||blockedDates.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)))return NextResponse.json({error:'Check working days, opening hours, slot length and blocked dates.'},{status:400});
  const pool=getDatabasePool();
  await pool.query("CREATE TABLE IF NOT EXISTS public.inspection_schedule_settings (id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
  await pool.query('INSERT INTO public.inspection_schedule_settings(id,settings) VALUES(1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=now()',[JSON.stringify(settings)]);
  return NextResponse.json({ok:true,settings},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Schedule settings save failed',e.message);return NextResponse.json({error:'Could not save inspection schedule.'},{status:500})}
}
