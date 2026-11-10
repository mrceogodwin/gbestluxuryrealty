import {createHmac,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {cookies} from 'next/headers';
import {getDatabasePool} from './db';
const COOKIE='gbest_admin_session';
const SESSION_MS=2*60*60*1000;
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function signature(payload){return createHmac('sha256',process.env.ADMIN_SECRET||'').update(payload).digest('base64url');}
function parseToken(token){
 if(!process.env.ADMIN_SECRET||typeof token!=='string'||token.length>1000)return null;
 const parts=token.split('.');if(parts.length!==2)return null;
 const [payload,sig]=parts,expected=signature(payload),a=Buffer.from(sig),b=Buffer.from(expected);
 if(a.length!==b.length||!timingSafeEqual(a,b))return null;
 try{const d=JSON.parse(Buffer.from(payload,'base64url').toString());if(d.v!==1||d.sv!==(process.env.ADMIN_SESSION_VERSION||'1')||!Number.isFinite(d.iat)||d.iat>Date.now()+30000||!Number.isFinite(d.exp)||d.exp<=Date.now()||d.exp-d.iat>SESSION_MS)return null;return d;}catch{return null;}
}
export async function validSessionToken(token){
 const d=parseToken(token);if(!d)return false;
 try{const q=await getDatabasePool().query('SELECT 1 FROM public.super_admin_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() LIMIT 1',[hash(token)]);return q.rowCount===1;}catch(e){console.error('Admin session validation',e.code||e.message);return false;}
}
export async function hasAdminSession(){const jar=await cookies();return validSessionToken(jar.get(COOKIE)?.value);}
export async function isAdminRequest(req){
 if(!process.env.ADMIN_SECRET)return false;
 const token=req.cookies?.get?.(COOKIE)?.value||req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 return validSessionToken(token);
}
export async function createAdminSessionToken(){
 const iat=Date.now(),payload=Buffer.from(JSON.stringify({v:1,sv:process.env.ADMIN_SESSION_VERSION||'1',iat,exp:iat+SESSION_MS,jti:randomBytes(16).toString('base64url')})).toString('base64url');
 const token=payload+'.'+signature(payload);
 await getDatabasePool().query('INSERT INTO public.super_admin_sessions(token_hash,expires_at) VALUES($1,to_timestamp($2/1000.0))',[hash(token),iat+SESSION_MS]);
 return token;
}
export async function revokeAdminSession(token){
 if(!token)return;
 await getDatabasePool().query('UPDATE public.super_admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[hash(token)]);
}
export async function revokeAllAdminSessions(){
 await getDatabasePool().query('UPDATE public.super_admin_sessions SET revoked_at=now() WHERE revoked_at IS NULL');
}
export const ADMIN_COOKIE=COOKIE;
