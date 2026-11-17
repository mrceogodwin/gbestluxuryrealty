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
    if(Object.values(fields).some(v=>!v) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) || form.get('terms_accepted')!=='true')
      return NextResponse.json({error:'Complete all required fields and accept the terms.'},{status:400});
    const file=form.get('receipt');
    if(!(file instanceof File) || !file.size) return NextResponse.json({error:'Upload your bank transfer receipt.'},{status:400});
    if(file.size>5*1024*1024) return NextResponse.json({error:'Receipt must be 5 MB or smaller.'},{status:400});
    const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
    if(!allowed.includes(file.type)) return NextResponse.json({error:'Receipt must be JPG, PNG, WEBP or PDF.'},{status:400});
    const reference=clean(form.get('payment_reference'),120);
    if(!reference) return NextResponse.json({error:'Enter your transfer reference.'},{status:400});
    const pool=getDatabasePool();const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';const tenant=await resolveSiteTenant(pool,host);if(!tenant)return NextResponse.json({error:'This domain is not connected to an active company workspace.'},{status:404});
    let selectedProperty=null;
    if(String(form.get('has_seen_property')||'no')==='yes'&&fields.property_id){
      const listings=await pool.query(`SELECT id::text AS id,
        CASE WHEN id::text ~ '^[0-9]+
    const signatures={
      'image/jpeg':bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
      'image/png':bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
      'image/webp':bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',
      'application/pdf':bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-'
    };
    if(!signatures[file.type])return NextResponse.json({error:'The uploaded receipt content does not match its file type.'},{status:400});
    const dbClient=await pool.connect();
    let q;
    try {
      await dbClient.query('BEGIN');
      await dbClient.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)),hashtext('client-registration'))",[fields.email]);
      const duplicate=await dbClient.query("SELECT id FROM public.client_registrations WHERE tenant_id=$2 AND lower(email)=lower($1) AND payment_status='pending' ORDER BY created_at DESC LIMIT 1",[fields.email,tenant.id]);
      if(duplicate.rowCount) {
        await dbClient.query('ROLLBACK');
        return NextResponse.json({error:'A registration for this email is already awaiting payment verification. Contact G-BEST if you need to update the submitted details.'},{status:409});
      }
      const fullName = fields.full_name;
      q=await dbClient.query(`INSERT INTO public.client_registrations
        (full_name,email,email_normalized,phone,registration_fee_kobo,payment_status,client_status,
         surname,other_names,address,nationality,state_of_origin,lga,occupation,property_type,price_range,
         preferred_location,property_description,terms_accepted,fee_amount,payment_reference,receipt_name,receipt_type,receipt_data,tenant_id)
        VALUES ($1,$2,lower($2),$3,1500000,'pending','pending',
         $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,15000,$15,$16,$17,$18,$19)
        RETURNING id,client_id,payment_status,created_at`,
        [fullName,fields.email,fields.phone,fullName,'',fields.current_location,'','','','',fields.property_type,'',fields.preferred_location,propertyNotes,reference,file.name.slice(0,255),file.type,bytes,tenant.id]);
      await dbClient.query('COMMIT');
    } catch(registrationError) {
      await dbClient.query('ROLLBACK').catch(()=>{});
      throw registrationError;
    } finally { dbClient.release(); }
    const fullName = fields.full_name;
    const adminEmail = await sendClientRegistrationEmail({
      to: process.env.ADMIN_EMAIL || 'gbestinnovations@gmail.com',
      subject: 'New client registration awaiting payment verification',
      html: '<p>A new client registration has been submitted.</p><p><strong>Client:</strong> ' + escapeHtml(fullName) + '<br/><strong>Email:</strong> ' + escapeHtml(fields.email) + '<br/><strong>Phone:</strong> ' + escapeHtml(fields.phone) + '<br/><strong>Transfer reference:</strong> ' + escapeHtml(reference) + '</p><p>Sign in to the G-BEST admin area to inspect the receipt and verify the bank transaction manually.</p>'
    });
    const clientEmail = await sendClientRegistrationEmail({
      to: fields.email,
      subject: 'G-BEST received your client registration',
      html: '<p>Hello ' + escapeHtml(fullName) + ',</p><p>We have received your client registration and transfer receipt. Your payment is <strong>pending manual verification</strong>. Uploading a receipt does not confirm payment.</p><p>Our team will review the transfer against the bank account and update you. You may request an inspection only after your registration is approved. Please use this same email address when booking.</p><p>G-BEST Luxury Realty</p>'
    });
    const warnings = [];
    if (!adminEmail.sent) warnings.push('The admin notification email could not be sent. The registration was still saved.');
    if (!clientEmail.sent) warnings.push('The confirmation email could not be sent. Keep your registration reference.');
    return NextResponse.json({ok:true,registration:q.rows[0],message:'Registration received. Your payment is awaiting manual verification.',email:{admin:adminEmail.sent,client:clientEmail.sent},warnings},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    console.error('Client registration failed',e.code||e.message);
    return NextResponse.json({error:'Could not submit registration. Please try again.'},{status:500});
  }
}
 THEN 'GB-' || lpad(id::text, 8, '0') ELSE 'GB-' || right(upper(replace(id::text, '-', '')), 8) END AS property_code
        FROM public.properties WHERE tenant_id=$1 AND status IN ('published','available')
        AND COALESCE(description,'') !~* '(sample showcase listing|illustrative|design preview|test listing)'
        AND (id::text=$2 OR (CASE WHEN id::text ~ '^[0-9]+
    const signatures={
      'image/jpeg':bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
      'image/png':bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
      'image/webp':bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',
      'application/pdf':bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-'
    };
    if(!signatures[file.type])return NextResponse.json({error:'The uploaded receipt content does not match its file type.'},{status:400});
    const dbClient=await pool.connect();
    let q;
    try {
      await dbClient.query('BEGIN');
      await dbClient.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)),hashtext('client-registration'))",[fields.email]);
      const duplicate=await dbClient.query("SELECT id FROM public.client_registrations WHERE tenant_id=$2 AND lower(email)=lower($1) AND payment_status='pending' ORDER BY created_at DESC LIMIT 1",[fields.email,tenant.id]);
      if(duplicate.rowCount) {
        await dbClient.query('ROLLBACK');
        return NextResponse.json({error:'A registration for this email is already awaiting payment verification. Contact G-BEST if you need to update the submitted details.'},{status:409});
      }
      const fullName = fields.full_name;
      q=await dbClient.query(`INSERT INTO public.client_registrations
        (full_name,email,email_normalized,phone,registration_fee_kobo,payment_status,client_status,
         surname,other_names,address,nationality,state_of_origin,lga,occupation,property_type,price_range,
         preferred_location,property_description,terms_accepted,fee_amount,payment_reference,receipt_name,receipt_type,receipt_data,tenant_id)
        VALUES ($1,$2,lower($2),$3,1500000,'pending','pending',
         $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,15000,$15,$16,$17,$18,$19)
        RETURNING id,client_id,payment_status,created_at`,
        [fullName,fields.email,fields.phone,fullName,'','','','','','','','','','',reference,file.name.slice(0,255),file.type,bytes,tenant.id]);
      await dbClient.query('COMMIT');
    } catch(registrationError) {
      await dbClient.query('ROLLBACK').catch(()=>{});
      throw registrationError;
    } finally { dbClient.release(); }
    const fullName = fields.full_name;
    const adminEmail = await sendClientRegistrationEmail({
      to: process.env.ADMIN_EMAIL || 'gbestinnovations@gmail.com',
      subject: 'New client registration awaiting payment verification',
      html: '<p>A new client registration has been submitted.</p><p><strong>Client:</strong> ' + escapeHtml(fullName) + '<br/><strong>Email:</strong> ' + escapeHtml(fields.email) + '<br/><strong>Phone:</strong> ' + escapeHtml(fields.phone) + '<br/><strong>Transfer reference:</strong> ' + escapeHtml(reference) + '</p><p>Sign in to the G-BEST admin area to inspect the receipt and verify the bank transaction manually.</p>'
    });
    const clientEmail = await sendClientRegistrationEmail({
      to: fields.email,
      subject: 'G-BEST received your client registration',
      html: '<p>Hello ' + escapeHtml(fullName) + ',</p><p>We have received your client registration and transfer receipt. Your payment is <strong>pending manual verification</strong>. Uploading a receipt does not confirm payment.</p><p>Our team will review the transfer against the bank account and update you. You may request an inspection only after your registration is approved. Please use this same email address when booking.</p><p>G-BEST Luxury Realty</p>'
    });
    const warnings = [];
    if (!adminEmail.sent) warnings.push('The admin notification email could not be sent. The registration was still saved.');
    if (!clientEmail.sent) warnings.push('The confirmation email could not be sent. Keep your registration reference.');
    return NextResponse.json({ok:true,registration:q.rows[0],message:'Registration received. Your payment is awaiting manual verification.',email:{admin:adminEmail.sent,client:clientEmail.sent},warnings},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    console.error('Client registration failed',e.code||e.message);
    return NextResponse.json({error:'Could not submit registration. Please try again.'},{status:500});
  }
}
 THEN 'GB-' || lpad(id::text, 8, '0') ELSE 'GB-' || right(upper(replace(id::text, '-', '')), 8) END)=upper($2))
        LIMIT 1`,[tenant.id,fields.property_id]);
      if(!listings.rowCount)return NextResponse.json({error:'We could not find that Property ID among current G-BEST listings. Check the code or choose “Not yet / still exploring”.'},{status:400});
      selectedProperty=listings.rows[0];
    }
    const propertyNotes=[selectedProperty?'Property ID: '+selectedProperty.property_code:'',fields.property_description].filter(Boolean).join('\\n').slice(0,1000);
    const bytes=Buffer.from(await file.arrayBuffer());
    const signatures={
      'image/jpeg':bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff,
      'image/png':bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
      'image/webp':bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP',
      'application/pdf':bytes.length>=5&&bytes.toString('ascii',0,5)==='%PDF-'
    };
    if(!signatures[file.type])return NextResponse.json({error:'The uploaded receipt content does not match its file type.'},{status:400});
    const dbClient=await pool.connect();
    let q;
    try {
      await dbClient.query('BEGIN');
      await dbClient.query("SELECT pg_advisory_xact_lock(hashtext(lower($1)),hashtext('client-registration'))",[fields.email]);
      const duplicate=await dbClient.query("SELECT id FROM public.client_registrations WHERE tenant_id=$2 AND lower(email)=lower($1) AND payment_status='pending' ORDER BY created_at DESC LIMIT 1",[fields.email,tenant.id]);
      if(duplicate.rowCount) {
        await dbClient.query('ROLLBACK');
        return NextResponse.json({error:'A registration for this email is already awaiting payment verification. Contact G-BEST if you need to update the submitted details.'},{status:409});
      }
      const fullName = fields.full_name;
      q=await dbClient.query(`INSERT INTO public.client_registrations
        (full_name,email,email_normalized,phone,registration_fee_kobo,payment_status,client_status,
         surname,other_names,address,nationality,state_of_origin,lga,occupation,property_type,price_range,
         preferred_location,property_description,terms_accepted,fee_amount,payment_reference,receipt_name,receipt_type,receipt_data,tenant_id)
        VALUES ($1,$2,lower($2),$3,1500000,'pending','pending',
         $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,15000,$15,$16,$17,$18,$19)
        RETURNING id,client_id,payment_status,created_at`,
        [fullName,fields.email,fields.phone,fullName,'','','','','','','','','','',reference,file.name.slice(0,255),file.type,bytes,tenant.id]);
      await dbClient.query('COMMIT');
    } catch(registrationError) {
      await dbClient.query('ROLLBACK').catch(()=>{});
      throw registrationError;
    } finally { dbClient.release(); }
    const fullName = fields.full_name;
    const adminEmail = await sendClientRegistrationEmail({
      to: process.env.ADMIN_EMAIL || 'gbestinnovations@gmail.com',
      subject: 'New client registration awaiting payment verification',
      html: '<p>A new client registration has been submitted.</p><p><strong>Client:</strong> ' + escapeHtml(fullName) + '<br/><strong>Email:</strong> ' + escapeHtml(fields.email) + '<br/><strong>Phone:</strong> ' + escapeHtml(fields.phone) + '<br/><strong>Transfer reference:</strong> ' + escapeHtml(reference) + '</p><p>Sign in to the G-BEST admin area to inspect the receipt and verify the bank transaction manually.</p>'
    });
    const clientEmail = await sendClientRegistrationEmail({
      to: fields.email,
      subject: 'G-BEST received your client registration',
      html: '<p>Hello ' + escapeHtml(fullName) + ',</p><p>We have received your client registration and transfer receipt. Your payment is <strong>pending manual verification</strong>. Uploading a receipt does not confirm payment.</p><p>Our team will review the transfer against the bank account and update you. You may request an inspection only after your registration is approved. Please use this same email address when booking.</p><p>G-BEST Luxury Realty</p>'
    });
    const warnings = [];
    if (!adminEmail.sent) warnings.push('The admin notification email could not be sent. The registration was still saved.');
    if (!clientEmail.sent) warnings.push('The confirmation email could not be sent. Keep your registration reference.');
    return NextResponse.json({ok:true,registration:q.rows[0],message:'Registration received. Your payment is awaiting manual verification.',email:{admin:adminEmail.sent,client:clientEmail.sent},warnings},{status:201,headers:{'Cache-Control':'no-store'}});
  } catch(e) {
    console.error('Client registration failed',e.code||e.message);
    return NextResponse.json({error:'Could not submit registration. Please try again.'},{status:500});
  }
}
