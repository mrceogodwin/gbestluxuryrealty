import {NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {getDatabasePool} from '../../../../lib/db';
export const runtime='nodejs';
export async function POST(req){
 const token=req.cookies.get('gbest_client_session')?.value;
 if(token&&process.env.DATABASE_URL){
  try{await getDatabasePool().query('UPDATE public.client_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[createHash('sha256').update(token).digest('hex')]);}catch(e){console.error('Client logout session revocation failed',e.code||e.message);}
 }
 const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 response.cookies.set('gbest_client_session','',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});
 return response;
}
