import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getDatabasePool } from '../../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function POST(req){
 try{
  const token=req.cookies.get('gbest_client_session')?.value;
  if(token){await getDatabasePool().query('UPDATE public.client_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[digest(token)]);}
  const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  response.cookies.set('gbest_client_session','',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});
  return response;
 }catch(e){return NextResponse.json({error:'Could not sign out.'},{status:500});}
}
