import {getDatabasePool} from './db';
import {ensureSiteTenants} from './site-tenants';
export const ZONE='Africa/Lagos';
export const DEFAULT_SCHEDULE={timezone:ZONE,workingDays:[1,2,3,4,5,6],startTime:'08:00',endTime:'18:00',slotMinutes:30,blockedDates:[]};
export async function getSchedule(tenantId){
 const pool=getDatabasePool();
 await ensureSiteTenants(pool);
 await pool.query("CREATE TABLE IF NOT EXISTS public.inspection_schedule_tenant_settings (tenant_id bigint PRIMARY KEY REFERENCES public.site_tenants(id) ON DELETE RESTRICT,settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
 if(tenantId!==undefined&&tenantId!==null){
  const scoped=await pool.query('SELECT settings FROM public.inspection_schedule_tenant_settings WHERE tenant_id=$1',[tenantId]);
  if(scoped.rowCount)return {...DEFAULT_SCHEDULE,...(scoped.rows[0].settings||{}),timezone:ZONE};
  const owner=await pool.query('SELECT tenant_key FROM public.site_tenants WHERE id=$1',[tenantId]);
  if(owner.rows[0]?.tenant_key!=='gbest')return {...DEFAULT_SCHEDULE,timezone:ZONE};
 }
 await pool.query("CREATE TABLE IF NOT EXISTS public.inspection_schedule_settings (id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),settings jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())");
 const q=await pool.query('SELECT settings FROM public.inspection_schedule_settings WHERE id=1');
 return {...DEFAULT_SCHEDULE,...(q.rows[0]?.settings||{}),timezone:ZONE};
}
export function validClock(t){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t||''))}
export async function calendarBusy(){
 // Inspection requests in Neon are the source of truth for each company's schedule.
 return [];
}
export function localSlot(date,time){return new Date(date+'T'+time+':00+01:00')}
export async function slotIsAvailable(date,time,schedule,busyOverride,tenantId){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validClock(time))return false;
 const [y,m,d]=date.split('-').map(Number),day=new Date(Date.UTC(y,m-1,d,12)).getUTCDay();
 if(date!==[y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-')||!schedule.workingDays.includes(day)||schedule.blockedDates.includes(date))return false;
 const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
 const startM=mins(time),endM=startM+schedule.slotMinutes;
 if(startM<mins(schedule.startTime)||endM>mins(schedule.endTime)||(startM-mins(schedule.startTime))%schedule.slotMinutes!==0)return false;
 const start=localSlot(date,time),end=new Date(start.getTime()+schedule.slotMinutes*60000);
 if(start.getTime()<=Date.now())return false;
 const busy=busyOverride===undefined?await calendarBusy(start,end):busyOverride;
 if(busy.some(item=>new Date(item.start)<end&&new Date(item.end)>start))return false;
 const endTime=String(Math.floor(endM/60)).padStart(2,'0')+':'+String(endM%60).padStart(2,'0');
 const pool=getDatabasePool();
 const q=tenantId===undefined||tenantId===null
  ?await pool.query(`SELECT 1 FROM public.inspection_requests WHERE preferred_date=$1::date AND status IN ('pending','confirmed') AND preferred_time < $2::time AND (preferred_time + (COALESCE(duration_minutes,30) * interval '1 minute')) > $3::time LIMIT 1`,[date,endTime,time])
  :await pool.query(`SELECT 1 FROM public.inspection_requests WHERE tenant_id=$4 AND preferred_date=$1::date AND status IN ('pending','confirmed') AND preferred_time < $2::time AND (preferred_time + (COALESCE(duration_minutes,30) * interval '1 minute')) > $3::time LIMIT 1`,[date,endTime,time,tenantId]);
 return !q.rowCount;
}
