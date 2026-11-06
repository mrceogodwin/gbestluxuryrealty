'use client';

import './registration.css';
import {useState} from 'react';

const groups=[
 ['CLIENT PERSONAL INFORMATION',[['surname','Surname'],['other_names','Other names'],['address','Residential address'],['email','Email address'],['phone','Phone number'],['nationality','Nationality'],['state_of_origin','State of origin'],['lga','Local government area'],['occupation','Occupation']]],
 ['PROPERTY REQUIREMENTS',[['property_type','Type of property'],['price_range','Price range'],['preferred_location','Preferred property location'],['property_description','Property description / requirements']]]
];
export default function ClientRegistrationPage(){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[copied,setCopied]=useState(false);
 async function copyAccount(){try{await navigator.clipboard.writeText('5601035351');setCopied(true);window.setTimeout(()=>setCopied(false),2200);}catch{setError('Unable to copy the account number. Please copy it manually.')}}
 async function submit(e){
  e.preventDefault();const formElement=e.currentTarget;setBusy(true);setError('');setResult('');
  try{const form=new FormData(e.currentTarget);const r=await fetch('/api/client-registrations',{method:'POST',body:form});const d=await r.json();if(!r.ok)throw new Error(d.error||'Submission failed');setResult('Registration submitted. Reference: '+d.registration.id+'. Payment verification is pending. Use this same email address when requesting an inspection after G-BEST approves your registration.'+(d.warnings?.length?' '+d.warnings.join(' '):''));formElement.reset();}
  catch(err){setError(err.message)}finally{setBusy(false)}
 }
 return <main className="client-registration-shell">
  <a href="/" className="registration-back">← G-BEST Luxury Realty</a>
  <header className="registration-header"><p>G-BEST LUXURY REALTY</p><h1>LET’S FIND YOUR <i>PROPERTY.</i></h1><span>CLIENT REGISTRATION</span><p className="registration-intro">Complete your details and tell us what you are looking for. It takes a few minutes to get started.</p></header>
  <section className="registration-payment">
   <div className="registration-section-kicker">STEP 01 · BOOKING FEE</div>
   <h2>Complete your registration payment</h2>
   <p className="registration-payment-copy">Pay the fixed booking fee below by bank transfer. Keep your transfer receipt and reference ready; you will need them in the form.</p>
   <div className="registration-bank-details">
    <span className="registration-fee-label">ONE-TIME BOOKING FEE</span><strong className="registration-fee">₦15,000</strong>
    <div className="registration-account-row"><div><span>ACCOUNT NAME</span><strong>Gbest Innovation Ltd</strong></div></div>
    <div className="registration-account-row registration-account-number"><div><span>ACCOUNT NUMBER</span><strong>5601035351</strong></div><button type="button" onClick={copyAccount} className="registration-copy">{copied?'COPIED ✓':'COPY NUMBER'}</button></div>
    <div className="registration-account-row"><div><span>BANK</span><strong>Fidelity Bank Plc</strong></div></div>
    <p className="registration-support">Payment support: <a href="mailto:gbestinnovations@gmail.com">gbestinnovations@gmail.com</a></p>
   </div>
   <div className="registration-next-steps"><strong>WHAT HAPPENS NEXT?</strong><ol><li>Transfer exactly ₦15,000 to the account above.</li><li>Complete the form and upload your receipt.</li><li>Our team checks the payment and updates your registration.</li><li>Once approved, you can request a property inspection.</li></ol></div>
   <p className="registration-help">Important: submitting a receipt does not mean your payment is approved. Inspection requests become available only after manual verification. Use the same email address for registration and inspection booking.</p>
  </section>
  <form className="registration-form" onSubmit={submit}>
   {groups.map(([title,fields],groupIndex)=><section key={title}><div className="registration-section-kicker">STEP {String(groupIndex+2).padStart(2,'0')}</div><h2>{title}</h2><div className="registration-grid">{fields.map(([name,label])=><label key={name} className={['address','property_description','preferred_location'].includes(name)?'wide':''}>{label}{['address','property_description'].includes(name)?<textarea name={name} rows="3" required/>:<input name={name} type={name==='email'?'email':'text'} required/>}</label>)}</div></section>)}
   <section><div className="registration-section-kicker">STEP 04</div><h2>PAYMENT DETAILS & RECEIPT</h2><div className="registration-grid"><label>Transfer reference<input name="payment_reference" required maxLength="120"/></label><label>Upload transfer receipt<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required/></label></div><p className="registration-help">Accepted formats: JPG, PNG, WEBP or PDF. Maximum file size: 5 MB.</p></section>
   <section className="registration-terms"><div className="registration-section-kicker">STEP 05</div><h2>REVIEW & AGREE</h2><p>The ₦15,000 booking fee is required to complete client registration and proceed to inspection requests. A 5% commission applies to the cost of purchase, lease or sale of the desired property, subject to G-BEST Luxury Realty’s final terms. Property inspections are subject to payment verification and appointment confirmation. Please contact G-BEST for the applicable cancellation and refund policy before making payment.</p><label className="registration-consent"><input type="checkbox" name="terms_accepted" value="true" required/> I have read and agree to the terms and conditions.</label></section>
   {error&&<p role="alert" className="registration-error">{error}</p>}{result&&<p role="status" className="registration-success">{result}</p>}
   <button disabled={busy}>{busy?'SUBMITTING…':'SUBMIT REGISTRATION ↗'}</button>
  </form>
 </main>
}
