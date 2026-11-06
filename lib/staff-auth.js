import { createHash } from 'node:crypto';
import { getDatabasePool } from './db';
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function getStaffSession(req){
 const token=req.cookies.get('gbest_staff_session')?.value;
 if(!token)return null;
 const q=await getDatabasePool().query(`SELECT s.id AS session_id,a.id AS staff_id,a.full_name,a.email,a.role,a.status FROM public.staff_sessions s JOIN public.staff_accounts a ON a.id=s.staff_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() LIMIT 1`,[digest(token)]);
 if(!q.rowCount||q.rows[0].status!=='active')return null;
 return q.rows[0];
}
export async function requireStaff(req,permission){
 const staff=await getStaffSession(req);
 if(!staff)return {ok:false,status:401,error:'Staff sign-in required.'};
 if(staff.role==='super_admin')return {ok:true,staff};
 const q=await getDatabasePool().query(`SELECT COALESCE(p.enabled,r.enabled,false) AS allowed FROM public.staff_role_permissions r LEFT JOIN public.staff_account_permissions p ON p.staff_id=$1 AND p.permission_key=r.permission_key WHERE r.role=$2 AND r.permission_key=$3`,[staff.staff_id,staff.role,permission]);
 if(!q.rows[0]?.allowed)return {ok:false,status:403,error:'You do not have permission to perform this action.'};
 return {ok:true,staff};
}
export const staffDigest=digest;

export async function authorizeStaff(req, permission) {
 const result=await requireStaff(req,permission);
 return result.ok===true;
}
