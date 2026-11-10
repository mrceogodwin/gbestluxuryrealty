import {NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {createAdminSessionToken,validSessionToken,ADMIN_COOKIE} from '../../../../lib/admin-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function sameSecret(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);}
const options={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:2*60*60};
export async function GET(req){const token=req.cookies.get(ADMIN_COOKIE)?.value;return NextResponse.json({authenticated:validSessionToken(token)},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req){if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});if(!process.env.ADMIN_SECRET)return NextResponse.json({error:'Admin access is not configured.'},{status:503});let body;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid login request.'},{status:400})}if(!sameSecret(body?.secret,process.env.ADMIN_SECRET))return NextResponse.json({error:'The admin access key is incorrect.'},{status:401});const response=NextResponse.json({ok:true,expiresIn:options.maxAge});response.cookies.set(ADMIN_COOKIE,createAdminSessionToken(),options);return response;}
export async function DELETE(){const response=NextResponse.json({ok:true});response.cookies.set(ADMIN_COOKIE,'',{...options,maxAge:0});return response;}
