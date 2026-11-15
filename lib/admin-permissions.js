import {isAdminRequest} from './admin-auth';
import {requireStaff} from './staff-auth';

export async function authorizeAdminRequest(req, permission) {
  if (await isAdminRequest(req)) return true;
  const required = Array.isArray(permission) ? permission : [permission];
  for (const key of required) {
    try {
      const result = await requireStaff(req, key);
      if (result.ok) return true;
    } catch (error) {
      console.error('Admin permission check failed', error.code || error.message);
      return false;
    }
  }
  return false;
}
