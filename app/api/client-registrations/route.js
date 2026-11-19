import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../lib/db';
import { sendClientRegistrationEmail, escapeHtml } from '../../../lib/client-registration-email';
import {resolveSiteTenant} from '../../../lib/site-tenants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
export async function POST(req) {
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Registration is temporarily unavailable.'},{status:503});
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > 6 * 1024 * 1024) return NextResponse.json({error:'Submission is too large. Keep the receipt under 5 MB.'},{status:413});
  try {
    const form=await req.formData();
    const fields={
      full_name:clean(form.get('full_name'),180), email:clean(form.get('email'),254), phone:clean(form.get('phone'),40), current_location:clean(form.get('current_location'),180), preferred_location:clean(form.get('preferred_location'),180), property_type:clean(form.get('property_type'),80), property_id:clean(form.get('property_id'),80), property_description:clean(form.get('property_description'),1000)
    };
    if(!fields.full_name||!fields.email||!fields.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) || form.get('terms_accepted')!=='true')
      return NextResponse.json({error:'Complete all required fields and accept the terms.'},{status:400});
    const intent=clean(form.get('registration_intent')||'general',20);
    if(!['general','inspection'].includes(intent))return NextResponse.json({error:'Choose a valid registration purpose.'},{status:400});
    const file=form.get('receipt');
    const reference=clean(form.get('payment_reference'),120);
    let bytes=null;
    if(intent==='inspection'){
      if(!(file instanceof File) || !file.size) return NextResponse.json({error:'Upload your bank transfer receipt for inspection registration.'},{status:400});
      if(file.size>5*1024*1024) return NextResponse.json({error:'Receipt must be 5 MB or smaller.'},{status:400});
      const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
      if(!allowed.includes(file.type)) return NextResponse.json({error:'Receipt must be JPG, PNG, WEBP or PDF.'},{status:400});
      if(!reference) return NextResponse.json({error:'Enter your transfer reference.'},{status:400});
      bytes=Buffer.from(await file.arrayBuffer());
      const signatures={
        'image/jpeg':bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
        'image/png':bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
        'image/webp':bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',
        'application/pdf':bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-'
      };
      if(!signatures[file.type])return NextResponse.json({error:'The uploaded receipt content does not match its file type.'},{status:400});
    }
    const pool=getDatabasePool();const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';const tenant=await resolveSiteTenant(pool,host);if(!tenant)return NextResponse.json({error:'This domain is not connected to an active company workspace.'},{status:404});
    if(String(form.get('has_seen_property')||'no')==='yes'&&!fields.property_id)return NextResponse.json({error:'Enter the Property ID you have seen, or choose “Not yet / still exploring”.'},{status:400});

    const dbClient=await pool.connect();
    let q;
    try {
      await dbClient.query('BEGIN');
      await dbClient.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)),hashtext('client-registration'))",[fields.email]);
      const existing=await dbClient.query("SELECT id,tenant_id,registration_intent,payment_status,client_status FROM public.client_registrations WHERE lower(email_normalized)=lower($1) FOR UPDATE",[fields.email]);
      const fullName=fields.full_name;
      const fee=intent==='inspection'?15000:null;
      if(existing.rowCount){
        const prior=existing.rows[0];
        if(Number(prior.tenant_id)!==Number(tenant.id)){
          await dbClient.query('ROLLBACK');
          return NextResponse.json({error:'This email is already registered with another G-BEST workspace.'},{status:409});
        }
        if(intent==='inspection'&&prior.registration_intent==='general'&&prior.payment_status==='not_required'){
          q=await dbClient.query(`UPDATE public.client_registrations SET
            registration_intent='inspection',registration_fee_kobo=1500000,payment_status='pending',
            client_status='active',fee_amount=15000,payment_reference=$2,receipt_name=$3,receipt_type=$4,
            receipt_data=$5,full_name=$6,phone=$7,preferred_location=$8,property_type=$9,
            property_description=$10,updated_at=now()
            WHERE id=$1 AND tenant_id=$11
            RETURNING id,client_id,payment_status,registration_intent,client_status,created_at`,
            [prior.id,reference,file.name.slice(0,255),file.type,bytes,fullName,fields.phone,fields.preferred_location,fields.property_type,[fields.property_id?'Property ID: '+fields.property_id:'',fields.property_description].filter(Boolean).join('\\n').slice(0,1000),tenant.id]);
        }else if(intent==='general'&&prior.registration_intent==='inspection'&&prior.payment_status==='rejected'){
          q=await dbClient.query(`UPDATE public.client_registrations SET
            registration_intent='general',registration_fee_kobo=0,payment_status='not_required',
            client_status='active',fee_amount=NULL,payment_reference=NULL,receipt_name=NULL,receipt_type=NULL,
            receipt_data=NULL,approved_at=NULL,approved_by=NULL,admin_note=NULL,
            full_name=$2,phone=$3,preferred_location=$4,property_type=$5,property_description=$6,updated_at=now()
            WHERE id=$1 AND tenant_id=$7
            RETURNING id,client_id,payment_status,registration_intent,client_status,created_at`,
            [prior.id,fullName,fields.phone,fields.preferred_location,fields.property_type,[fields.property_id?'Property ID: '+fields.property_id:'',fields.property_description].filter(Boolean).join('\\n').slice(0,1000),tenant.id]);
        }else{
          await dbClient.query('ROLLBACK');
          return NextResponse.json({error:'A client account already exists for this email. Please sign in instead of registering again.'},{status:409});
        }
      }else{
        q=await dbClient.query(`INSERT INTO public.client_registrations
          (full_name,email,email_normalized,phone,registration_intent,registration_fee_kobo,payment_status,client_status,
           surname,other_names,address,nationality,state_of_origin,lga,occupation,property_type,price_range,
           preferred_location,property_description,terms_accepted,fee_amount,payment_reference,receipt_name,receipt_type,receipt_data,tenant_id)
          VALUES ($1,$2,lower($2),$3,$4,$5,$6,$7,
           $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true,$19,$20,$21,$22,$23,$24)
          RETURNING id,client_id,payment_status,registration_intent,client_status,created_at`,
          [fullName,fields.email,fields.phone,intent,intent==='inspection'?1500000:0,
           intent==='inspection'?'pending':'not_required',intent==='inspection'?'pending':'active',
           fullName,'',fields.current_location,'','','','',fields.property_type,'',fields.preferred_location,
           [fields.property_id?'Property ID: '+fields.property_id:'',fields.property_description].filter(Boolean).join('\\n').slice(0,1000),
           fee, intent==='inspection'?reference:null,intent==='inspection'?file.name.slice(0,255):null,
           intent==='inspection'?file.type:null,bytes,tenant.id]);
      }
      await dbClient.query('COMMIT');
    } catch(registrationError) {
      await dbClient.query('ROLLBACK').catch(()=>{});
      throw registrationError;
    } finally { dbClient.release(); }
    const fullName=fields.full_name;
    let adminEmail={sent:true},clientEmail={sent:false};
    if(intent==='inspection'){
      adminEmail=await sendClientRegistrationEmail({
        to:process.env.ADMIN_EMAIL||'gbestinnovations@gmail.com',
        subject:'New inspection client registration awaiting payment verification',
        html:'<p>A client has selected physical inspection and submitted a registration payment receipt.</p><p><strong>Client:</strong> '+escapeHtml(fullName)+'<br/><strong>Email:</strong> '+escapeHtml(fields.email)+'<br/><strong>Phone:</strong> '+escapeHtml(fields.phone)+'<br/><strong>Transfer reference:</strong> '+escapeHtml(reference)+'</p><p>Review the receipt and verify the bank transaction manually before allowing inspection booking.</p>'
      });
      clientEmail=await sendClientRegistrationEmail({
        to:fields.email,
        subject:'G-BEST received your inspection registration',
        html:'<p>Hello '+escapeHtml(fullName)+',</p><p>We received your inspection registration and transfer receipt. Payment is <strong>pending manual verification</strong>. Uploading a receipt does not confirm payment. You can use your account for private messaging while our team reviews the transfer, but inspection booking remains locked until approval.</p><p>G-BEST Luxury Realty</p>'
      });
    }else{
      clientEmail=await sendClientRegistrationEmail({
        to:fields.email,
        subject:'Your free G-BEST client profile is ready',
        html:'<p>Hello '+escapeHtml(fullName)+',</p><p>Your free G-BEST client profile has been created. No registration payment is required for browsing, enquiries or private messaging. You can sign in using the one-time code sent to this email address. If you later request a physical inspection, the inspection registration fee and manual verification will apply before booking.</p><p>G-BEST Luxury Realty</p>'
      });
    }
    const warnings=[];
    if(!adminEmail.sent)warnings.push('The admin notification email could not be sent. The registration was still saved.');
    if(!clientEmail.sent)warnings.push('The confirmation email could not be sent. Keep your registration reference.');
    const message=intent==='inspection'?'Inspection registration received. Payment is awaiting manual verification.':'Your free client profile has been created. No payment is required for general enquiries or private messaging.';
    return NextResponse.json({ok:true,registration:q.rows[0],message,email:{admin:adminEmail.sent,client:clientEmail.sent},warnings},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    console.error('Client registration failed',e.code||e.message);
    return NextResponse.json({error:'Could not submit registration. Please try again.'},{status:500});
  }
}
