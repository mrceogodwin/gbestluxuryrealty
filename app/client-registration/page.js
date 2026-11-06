'use client';

import './registration.css';
import {useState} from 'react';

const groups=[
 ['CLIENT PERSONAL INFORMATION',[['surname','Surname'],['other_names','Other names'],['address','Residential address'],['email','Email address'],['phone','Phone number'],['nationality','Nationality'],['state_of_origin','State of origin'],['lga','Local government area'],['occupation','Occupation']]],
 ['PROPERTY REQUIREMENTS',[['property_type','Type of property'],['price_range','Price range'],['preferred_location','Preferred property location'],['property_description','Property description / requirements']]]
];
export default function ClientRegistrationPage(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState('');
 async function submit(e){
  e.preventDefault();const formElement=e.currentTarget;setBusy(true);setError('');setResult('');
  try{const form=new FormData(e.currentTarget);const r=await fetch('/api/client-registrations',{method:'POST',body:form});const d=await r.json();if(!r.ok)throw new Error(d.error||'Submission failed');setResult('Registration submitted. Reference: '+d.registration.id+'. Payment verification is pending. Use this same email address when requesting an inspection after G-BEST approves your registration.'+(d.warnings?.length?' '+d.warnings.join(' '):''));formElement.reset();}
  catch(err){setError(err.message)}finally{setBusy(false)}
 }
 return <main className="client-registration-shell">
  <a href="/" className="registration-back">← G-BEST Luxury Realty</a>
  <header className="registration-header"><p>G-BEST LUXURY REALTY</p><h1>CLIENT <i>REGISTRATION.</i></h1><span>REGISTER YOUR PROPERTY REQUIREMENTS</span></header>
  <section className="registration-payment"><h2>REGISTRATION FEE PAYMENT</h2><p>Make a bank transfer of the ₦15,000 booking fee to the account below, then upload your payment receipt. Your registration will remain pending until our team verifies the payment.</p><div className="registration-bank-details"><p className="registration-fee-label">FIXED REGISTRATION / BOOKING FEE</p><strong className="registration-fee">₦15,000</strong><dl><div><dt>Account name</dt><dd>Gbest Innovation Ltd</dd></div><div><dt>Account number</dt><dd>5601035351</dd></div><div><dt>Bank</dt><dd>Fidelity Bank Plc</dd></div></dl><p>After transferring exactly ₦15,000, enter your transfer reference and upload the receipt in the form below.</p><p>Need help? <a href="mailto:gbestinnovations@gmail.com">gbestinnovations@gmail.com</a></p></div><p className="registration-help">After submitting your transfer receipt, G-BEST will manually verify the payment. You can request an inspection only after approval. Use the same email address for registration and inspection booking.</p></section>
  <form className="registration-form" onSubmit={submit}>
   {groups.map(([title,fields])=><section key={title}><h2>{title}</h2><div className="registration-grid">{fields.map(([name,label])=><label key={name} className={['address','property_description','preferred_location'].includes(name)?'wide':''}>{label}{['address','property_description'].includes(name)?<textarea name={name} rows="3" required/>:<input name={name} type={name==='email'?'email':'text'} required/>}</label>)}</div></section>)}
   <section><h2>PAYMENT DETAILS & RECEIPT</h2><div className="registration-grid"><label>Transfer reference<input name="payment_reference" required maxLength="120"/></label><label>Upload transfer receipt<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required/></label></div><p className="registration-help">Accepted formats: JPG, PNG, WEBP or PDF. Maximum file size: 5 MB.</p></section>
   <section className="registration-terms"><h2>TERMS & CONDITIONS</h2><p>The registration form fee is mandatory and non-refundable. The stated 10% commission applies to the cost of purchase, lease or sale of the desired property, subject to the final terms approved by G-BEST Luxury Realty. Sight-seeing is subject to payment verification and appointment confirmation.</p><label className="registration-consent"><input type="checkbox" name="terms_accepted" value="true" required/> I have read and agree to the terms and conditions.</label></section>
   {error&&<p role="alert" className="registration-error">{error}</p>}{result&&<p role="status" className="registration-success">{result}</p>}
   <button disabled={busy}>{busy?'SUBMITTING…':'SUBMIT REGISTRATION ↗'}</button>
  </form>
 </main>
}
