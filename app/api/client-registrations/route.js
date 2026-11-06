import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../lib/db';
import { sendClientRegistrationEmail, escapeHtml } from '../../../lib/client-registration-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ensureTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.client_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    surname varchar(100) NOT NULL,
    other_names varchar(160) NOT NULL,
    address text NOT NULL,
    email varchar(254) NOT NULL,
    phone varchar(40) NOT NULL,
    nationality varchar(80) NOT NULL,
    state_of_origin varchar(100) NOT NULL,
    lga varchar(100) NOT NULL,
    occupation varchar(120) NOT NULL,
    property_type varchar(100) NOT NULL,
    price_range varchar(160) NOT NULL,
    preferred_location varchar(180) NOT NULL,
    property_description text,
    terms_accepted boolean NOT NULL DEFAULT false,
    fee_amount numeric(12,2),
    payment_reference varchar(120),
    receipt_name varchar(255),
    receipt_type varchar(100),
    receipt_data bytea,
    payment_status varchar(24) NOT NULL DEFAULT 'pending',
    admin_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS client_registrations_status_created_idx ON public.client_registrations(payment_status, created_at DESC)`);
}

const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
export async function POST(req) {
  if (!process.env.DATABASE_URL) return NextResponse.json({error:'Registration is temporarily unavailable.'},{status:503});
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > 6 * 1024 * 1024) return NextResponse.json({error:'Submission is too large. Keep the receipt under 5 MB.'},{status:413});
  try {
    const form=await req.formData();
    const fields={
      surname:clean(form.get('surname'),100), other_names:clean(form.get('other_names'),160),
      address:clean(form.get('address'),1000), email:clean(form.get('email'),254),
      phone:clean(form.get('phone'),40), nationality:clean(form.get('nationality'),80),
      state_of_origin:clean(form.get('state_of_origin'),100), lga:clean(form.get('lga'),100),
      occupation:clean(form.get('occupation'),120), property_type:clean(form.get('property_type'),100),
      price_range:clean(form.get('price_range'),160), preferred_location:clean(form.get('preferred_location'),180),
      property_description:clean(form.get('property_description'),2000)
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
    const pool=getDatabasePool(); await ensureTable(pool);
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
      const duplicate=await dbClient.query("SELECT id FROM public.client_registrations WHERE lower(email)=lower($1) AND payment_status='pending' ORDER BY created_at DESC LIMIT 1",[fields.email]);
      if(duplicate.rowCount) {
        await dbClient.query('ROLLBACK');
        return NextResponse.json({error:'A registration for this email is already awaiting payment verification. Contact G-BEST if you need to update the submitted details.'},{status:409});
      }
      q=await dbClient.query(`INSERT INTO public.client_registrations
        (surname,other_names,address,email,phone,nationality,state_of_origin,lga,occupation,property_type,price_range,preferred_location,property_description,terms_accepted,payment_reference,receipt_name,receipt_type,receipt_data,payment_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,$17,'pending')
        RETURNING id,payment_status,created_at`,
        [...Object.values(fields),reference,file.name.slice(0,255),file.type,bytes]);
      await dbClient.query('COMMIT');
    } catch(registrationError) {
      await dbClient.query('ROLLBACK').catch(()=>{});
      throw registrationError;
    } finally { dbClient.release(); }
    const fullName = fields.surname + ' ' + fields.other_names;
    const adminEmail = await sendClientRegistrationEmail({
      to: process.env.ADMIN_EMAIL || 'gbestinnovations@gmail.com',
      subject: 'New client registration awaiting payment verification',
      html: '<p>A new client registration has been submitted.</p><p><strong>Client:</strong> ' + escapeHtml(fullName) + '<br/><strong>Email:</strong> ' + escapeHtml(fields.email) + '<br/><strong>Phone:</strong> ' + escapeHtml(fields.phone) + '<br/><strong>Property:</strong> ' + escapeHtml(fields.property_type) + ' — ' + escapeHtml(fields.price_range) + '<br/><strong>Transfer reference:</strong> ' + escapeHtml(reference) + '</p><p>Sign in to the G-BEST admin area to inspect the receipt and verify the bank transaction manually.</p>'
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
