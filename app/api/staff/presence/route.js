import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {getStaffSession} from '../../../../lib/staff-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403,headers:noStore});
 try{
  const staff=await getStaffSession(req);
  if(!staff)return NextResponse.json({error:'Your staff session has expired.'},{status:401,headers:noStore});
  const body=await req.json().catch(()=>({}));
  const presence=['online','away','offline'].includes(body?.presence)?body.presence:'online';
  await getDatabasePool().query(`INSERT INTO public.staff_presence(tenant_id,staff_id,presence,last_seen_at,updated_at)
    VALUES($1,$2,$3,now(),now())
    ON CONFLICT(tenant_id,staff_id) DO UPDATE SET presence=EXCLUDED.presence,last_seen_at=now(),updated_at=now()`,[staff.tenant_id,staff.id,presence]);
  return NextResponse.json({ok:true,presence},{headers:noStore});
 }catch(e){
  console.error('Staff presence update failed',e.code||e.message);
  return NextResponse.json({error:'Could not update staff presence.'},{status:503,headers:noStore});
 }
}
