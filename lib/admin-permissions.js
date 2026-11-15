import {isAdminRequest} from './admin-auth';
import {getStaffSession,hasStaffPermission} from './staff-auth';
export async function authorizeAdminRequest(req,permission){
 if(await isAdminRequest(req))return true;
 try{const staff=await getStaffSession(req);if(!staff)return false;const required=Array.isArray(permission)?permission:[permission];for(const key of required){if(await hasStaffPermission(staff,key))return true;}return false;}catch(error){console.error('Admin permission check failed',error.code||error.message);return false;}
}
