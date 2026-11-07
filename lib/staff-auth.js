import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {cookies} from 'next/headers';
import {getDatabasePool} from './db';
const scrypt=promisify(scryptCallback);
export const STAFF_COOKIE='gbest_staff_session';
export const STAFF_SESSION_SECONDS=60*60*8;
export const hashToken=value=>createHash('sha256').update(String(value)).digest('hex');
export function newOpaqueToken(){return randomBytes(32).toString('base64url');}
export async function hashPassword(password){
 const salt=randomBytes(16),derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 return 'scrypt$16384$8$1$'+salt.toString('base64url')+'$'+Buffer.from(derived).toString('base64url');
}
export async function verifyPassword(password,encoded){
 try{const [scheme,n,r,p,saltText,hashText]=String(encoded||'').split('$');if(scheme!=='scrypt'||n!=='16384'||r!=='8'||p!=='1')return false;const expected=Buffer.from(hashText,'base64url');const actual=Buffer.from(await scrypt(password,Buffer.from(saltText,'base64url'),expected.length,{N:16384,r:8,p:1,maxmem:64*1024*1024}));return expected.length===actual.length&&timingSafeEqual(expected,actual);}catch{return false;}
}
export async function getStaffSession(req){
 const token=req?.cookies?.get?.(STAFF_COOKIE)?.value|| (await cookies()).get(STAFF_COOKIE)?.value;
 if(!token||token.length>200)return null;
 const q=await getDatabasePool().query(`SELECT s.id AS session_id,a.id,a.full_name,a.email,a.role,a.status
 FROM public.staff_sessions s JOIN public.staff_accounts a ON a.id=s.staff_id
 WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active' AND a.password_hash IS NOT NULL LIMIT 1`,[hashToken(token)]);
 return q.rows[0]||null;
}
export async function hasStaffPermission(staff,permission){
 if(!staff||staff.status!=='active')return false;
 const p=getDatabasePool();
 const q=await p.query(`SELECT COALESCE((SELECT enabled FROM public.staff_account_permissions WHERE staff_id=$1 AND permission_key=$2),(SELECT enabled FROM public.staff_role_permissions WHERE role=$3 AND permission_key=$2),false) AS allowed`,[staff.id,permission,staff.role]);
 return q.rows[0]?.allowed===true;
}
export const staffCookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:STAFF_SESSION_SECONDS};
