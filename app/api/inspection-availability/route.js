import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../lib/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(new Date(s+'T00:00:00Z').getTime())&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export async function GET(req){try{const date=req.nextUrl.searchParams.get('date')||'';if(!validDate(date))return NextResponse.json({error:'Choose a valid date.'},{status:400});const q=await getDatabasePool().query(`SELECT to_char(a.starts_at AT TIME ZONE 'Africa/Lagos','HH24:MI') AS time
 FROM public.inspection_availability a
 WHERE a.is_open=true AND (a.starts_at AT TIME ZONE 'Africa/Lagos')::date=$1::date
 AND a.starts_at>now()
 AND NOT EXISTS(SELECT 1 FROM public.inspection_requests r WHERE r.preferred_date=(a.starts_at AT TIME ZONE 'Africa/Lagos')::date AND r.preferred_time=(a.starts_at AT TIME ZONE 'Africa/Lagos')::time AND r.status IN ('pending','confirmed'))
 ORDER BY a.starts_at`,[date]);return NextResponse.json({date,slots:q.rows.map(x=>x.time)},{headers:{'Cache-Control':'no-store'}})}catch(e){console.error('Availability lookup failed',e.code||e.message);return NextResponse.json({error:'Availability is temporarily unavailable.'},{status:503})}}
