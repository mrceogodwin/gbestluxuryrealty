import {authorizeStaff} from '../../../../../lib/staff-auth';
import {NextResponse} from 'next/server';
import {randomBytes,createHash} from 'node:crypto';
import {getDatabasePool} from '../../../../../lib/db';
import {ensureLegalDocumentTables} from '../../../../../lib/legal-documents';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function auth(req, permission='legal.publish') { return authorizeStaff(req, permission); }
export async function POST(req){
 if(!await auth(req))return NextResponse.json({error:'Unauthorized'},{status:401});
 try{
  const b=await req.json(),requestId=String(b.inspection_request_id||''),documentId=String(b.document_id||'');
  if(!/^[0-9a-f-]{36}$/i.test(requestId)||!/^[0-9a-f-]{36}$/i.test(documentId))return NextResponse.json({error:'Choose a valid inspection request and document.'},{status:400});
  const pool=await ensureLegalDocumentTables();
  const q=await pool.query("SELECT r.id,r.full_name,r.client_email,d.id AS document_id,d.title,d.version,d.change_summary,d.change_type,d.required,d.status FROM public.inspection_requests r CROSS JOIN public.legal_documents d WHERE r.id=$1 AND d.id=$2 AND d.status='published' LIMIT 1",[requestId,documentId]);
  if(!q.rowCount)return NextResponse.json({error:'Published document or inspection request not found.'},{status:404});
  const row=q.rows[0];
  if(!row.client_email)return NextResponse.json({error:'This request has no client email address.'},{status:400});
  if(row.change_type!=='material'&&!row.required)return NextResponse.json({error:'Only material changes or required documents need re-acceptance.'},{status:400});
  const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
  await pool.query("INSERT INTO public.legal_document_reacceptance_tokens(token_hash,inspection_request_id,document_id,document_version,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",[hash,requestId,documentId,row.version]);
  const base=(process.env.SITE_URL||process.env.NEXT_PUBLIC_SITE_URL||'https://gbestluxuryrealty.vercel.app').replace(/\/$/,'');
  const link=base+'/legal/reacceptance/'+token;
  if(!process.env.RESEND_API_KEY||!process.env.RESEND_FROM_EMAIL)return NextResponse.json({ok:true,emailSent:false,message:'Secure link created but email delivery is not configured. Configure Resend before sending this link to the client.'},{status:503});
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[row.client_email],subject:'Action required: updated G-BEST agreement',html:'<p>Hello '+String(row.full_name).replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]))+',</p><p>G-BEST Luxury Realty has published an updated version of <b>'+row.title+'</b> (version '+row.version+').</p><p><b>What changed:</b> '+String(row.change_summary||'Please review the updated document.').replace(/[&<>"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]))+'</p><p>Please read the updated version and record your acknowledgement using this secure link. It expires in seven days and can be used once.</p><p><a href="'+link+'">Review and acknowledge updated agreement</a></p><p>If you were not expecting this request, contact G-BEST Luxury Realty before proceeding.</p>'})});
  if(!response.ok){console.error('Reacceptance email delivery failed',response.status);return NextResponse.json({ok:false,error:'The secure link was created, but the email provider did not accept the message. Retry after checking email configuration.'},{status:502});}
  await pool.query("INSERT INTO public.legal_document_update_events(document_id,document_version,event_type,actor,details) VALUES($1,$2,'reacceptance_requested','Super Admin',$3::jsonb)",[documentId,row.version,JSON.stringify({inspection_request_id:requestId,client_email:row.client_email,expires_in_days:7})]);
  return NextResponse.json({ok:true,emailSent:true,expiresInDays:7});
 }catch(e){console.error('Reacceptance request failed',e.code||e.message);return NextResponse.json({error:'Could not send the re-acceptance request.'},{status:500});}
}