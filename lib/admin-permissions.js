import {isAdminRequest} from './admin-auth';
import {getStaffSession,hasStaffPermission} from './staff-auth';
export async function authorizeAdminRequest(req,permission){
 if(await isAdminRequest(req))return true;
 try{const staff=await getStaffSession(req);return !!staff&&await hasStaffPermission(staff,permission);}catch(error){console.error('Admin permission check failed',error.code||error.message);return false;}
}
