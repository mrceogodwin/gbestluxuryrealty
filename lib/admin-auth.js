import {createHmac,timingSafeEqual} from 'node:crypto';
import {cookies} from 'next/headers';
const COOKIE='gbest_admin_session';
function signature(payload){return createHmac('sha256',process.env.ADMIN_SECRET||'').update(payload).digest('base64url');}
export function validSessionToken(token){if(!process.env.ADMIN_SECRET||typeof token!=='string')return false;const parts=token.split('.');if(parts.length!==2)return false;const [payload,sig]=parts;const expected=signature(payload);const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return false;try{const d=JSON.parse(Buffer.from(payload,'base64url').toString());return d.v===1&&Number.isFinite(d.exp)&&d.exp>Date.now();}catch{return false;}}
export async function hasAdminSession(){const jar=await cookies();return validSessionToken(jar.get(COOKIE)?.value);}
export async function isAdminRequest(req){if(!process.env.ADMIN_SECRET)return false;const bearer=req.headers.get('authorization');if(bearer==='Bearer '+process.env.ADMIN_SECRET)return true;const token=req.cookies?.get?.(COOKIE)?.value||req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return validSessionToken(token);}
export function createAdminSessionToken(){const payload=Buffer.from(JSON.stringify({v:1,exp:Date.now()+8*60*60*1000})).toString('base64url');return payload+'.'+signature(payload);}
export const ADMIN_COOKIE=COOKIE;
