import {isAdminRequest} from './admin-auth';
import {getStaffSession,hasStaffPermission} from './staff-auth';
export function hasValidRequestOrigin(req){
 return req.headers.get('origin')===req.nextUrl.origin;
}
export async function authorizeAdminRequest(req,permission){
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!hasValidRequestOrigin(req))return false;
 if(await isAdminRequest(req))return true;
 try{const staff=await getStaffSession(req);if(!staff)return false;const required=Array.isArray(permission)?permission:[permission];for(const key of required){if(await hasStaffPermission(staff,key))return true;}return false;}catch(error){console.error('Admin permission check failed',error.code||error.message);return false;}
}
