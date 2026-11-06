import { NextResponse } from 'next/server';
import { staffDigest } from '../../../../lib/staff-auth';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export async function POST(req){
 if(req.headers.get('origin')&&req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
 const token=req.cookies.get('gbest_staff_session')?.value;
 if(token)await getDatabasePool().query('UPDATE public.staff_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[staffDigest(token)]);
 const response=NextResponse.json({ok:true});
 response.cookies.set('gbest_staff_session','',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});
 return response;
}
