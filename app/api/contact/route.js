import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req){
 try{
  const origin=req.headers.get('origin'),host=req.headers.get('x-forwarded-host')||req.headers.get('host');
  if(!origin||!host||new URL(origin).host!==host)return NextResponse.json({error:'Request origin could not be verified.'},{status:403});
  if(Number(req.headers.get('content-length')||0)>12000)return NextResponse.json({error:'Message is too large.'},{status:413});
  const pool=getDatabasePool(),tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'This website workspace is not available.'},{status:404});
  const d=await req.json();
  if(String(d?.website||'').trim())return NextResponse.json({ok:true,message:'Thank you. Your message has been received.'});
  const name=String(d?.name||'').trim(),email=String(d?.email||'').trim().toLowerCase(),phone=String(d?.phone||'').trim(),subject=String(d?.subject||'').trim(),message=String(d?.message||'').trim();
  if(name.length<2||name.length>120)return NextResponse.json({error:'Enter your full name.'},{status:400});
  if(email.length>254||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return NextResponse.json({error:'Enter a valid email address.'},{status:400});
  if(phone.length>40||subject.length<3||subject.length>160||message.length<10||message.length>5000)return NextResponse.json({error:'Please check the subject, phone number and message length.'},{status:400});
  const q=await pool.query('INSERT INTO public.business_contact_submissions(tenant_id,full_name,email,phone,subject,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at',[tenant.id,name,email,phone||null,subject,message]);
  return NextResponse.json({ok:true,id:q.rows[0].id,message:'Thank you. Your message has been received by the '+tenant.display_name+' team.'},{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error('Public business contact submission failed',e.code||e.message);return NextResponse.json({error:'Contact messages are temporarily unavailable. Please try again later.'},{status:503});}
}
