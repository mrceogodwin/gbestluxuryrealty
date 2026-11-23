import {redirect} from 'next/navigation';
import {getStaffSession,hasStaffPermission} from '../../../lib/staff-auth';
export const dynamic='force-dynamic';
export default async function StaffCommunicationsPage(){
 const staff=await getStaffSession();
 if(!staff)redirect('/staff/login');
 if(!await hasStaffPermission(staff,'communications.use'))return <main style={{minHeight:'100vh',background:'#111512',color:'#edf3ec',padding:32,fontFamily:'Arial,sans-serif'}}><h1>Communications access not assigned</h1><p>Your Super Admin has not granted access to this area.</p><a href='/staff/profile' style={{color:'#caff70'}}>Manage your profile</a></main>;
 return <main style={{minHeight:'100vh',background:'#111512',color:'#edf3ec',padding:32,fontFamily:'Arial,sans-serif'}}><h1>Staff communications</h1><p>Communications workspace is available to accounts explicitly granted this permission.</p></main>;
}
