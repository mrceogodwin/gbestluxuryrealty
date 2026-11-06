import { getDatabasePool } from './db';
export const ZONE='Africa/Lagos';
export const DEFAULT_SCHEDULE={timezone:ZONE,workingDays:[1,2,3,4,5,6],startTime:'09:00',endTime:'17:00',slotMinutes:30,blockedDates:[]};
export async function getSchedule(){
 const pool=getDatabasePool();
 await pool.query("CREATE TABLE IF NOT EXISTS public.inspection_schedule_settings (id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
 const q=await pool.query('SELECT settings FROM public.inspection_schedule_settings WHERE id=1');
 return {...DEFAULT_SCHEDULE,...(q.rows[0]?.settings||{}),timezone:ZONE};
}
export function validClock(t){return /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(t||''))}
export async function calendarBusy(start,end){
 const {GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,GOOGLE_REFRESH_TOKEN,GOOGLE_CALENDAR_ID}=process.env;
 if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!GOOGLE_REFRESH_TOKEN||!GOOGLE_CALENDAR_ID)throw new Error('G-BEST appointment calendar is not connected. Please contact our team.');
 const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(!tokenRes.ok)throw new Error('G-BEST appointment calendar is temporarily unavailable.');
 const token=await tokenRes.json();
 const r=await fetch('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({timeMin:start.toISOString(),timeMax:end.toISOString(),timeZone:ZONE,items:[{id:GOOGLE_CALENDAR_ID}]})});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error('Could not check G-BEST calendar availability.');
 return d.calendars?.[GOOGLE_CALENDAR_ID]?.busy||[];
}
export function localSlot(date,time){return new Date(date+'T'+time+':00+01:00')}
export async function slotIsAvailable(date,time,schedule){
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||!validClock(time))return false;
 const [y,m,d]=date.split('-').map(Number),day=new Date(Date.UTC(y,m-1,d,12)).getUTCDay();
 if(date!==[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-')||!schedule.workingDays.includes(day)||schedule.blockedDates.includes(date))return false;
 const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
 const startM=mins(time),endM=startM+schedule.slotMinutes;
 if(startM<mins(schedule.startTime)||endM>mins(schedule.endTime)||(startM-mins(schedule.startTime))%schedule.slotMinutes!==0)return false;
 const start=localSlot(date,time),end=new Date(start.getTime()+schedule.slotMinutes*60000);
 if(start.getTime()<=Date.now())return false;
 const busy=await calendarBusy(start,end);
 if(busy.length)return false;
 const q=await getDatabasePool().query("SELECT 1 FROM public.inspection_requests WHERE preferred_date=$1::date AND preferred_time >= $2::time AND preferred_time < $3::time AND status IN ('pending','confirmed') LIMIT 1",[date,time,end.toISOString().slice(11,16)]);
 return !q.rowCount;
}
