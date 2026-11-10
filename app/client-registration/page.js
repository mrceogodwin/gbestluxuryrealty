'use client';

import './registration.css';
import {useState} from 'react';

const groups=[
 ['PERSONAL INFORMATION',[['surname','Surname'],['other_names','Other names'],['address','Residential address'],['email','Email address'],['phone','Phone number'],['nationality','Nationality'],['state_of_origin','State of origin'],['lga','Local government area'],['occupation','Occupation']]],
 ['PROPERTY REQUIREMENTS',[['property_type','Type of property'],['price_range','Price range'],['preferred_location','Preferred property location'],['property_description','Property description / requirements']]]
];

export default function ClientRegistrationPage(){
 const [step,setStep]=useState(1),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(''),[copied,setCopied]=useState(false);
 async function copyAccount(){try{await navigator.clipboard.writeText('5601035351');setCopied(true);window.setTimeout(()=>setCopied(false),2200);}catch{setError('Unable to copy automatically. Please copy the account number manually.')}}
 function continueToPayment(){
  const form=document.getElementById('client-registration-form');
  if(!form.reportValidity())return;
  setError('');
  setStep(2);
  window.scrollTo({top:0,behavior:'smooth'});
 }
 async function submit(e){
  e.preventDefault();const formElement=e.currentTarget;setBusy(true);setError('');setResult('');
  try{
   const form=new FormData(formElement);
   const r=await fetch('/api/client-registrations',{method:'POST',body:form});
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||'Submission failed');
   setResult('Your registration has been received. Reference: '+d.registration.id+'. Your transfer is awaiting manual verification. We will update you after review.'+(d.warnings?.length?' '+d.warnings.join(' '):''));
   setStep(3);window.scrollTo({top:0,behavior:'smooth'});
  }catch(err){setError(err.message)}finally{setBusy(false)}
 }
 return <main className="client-registration-shell">
  <div className="registration-topbar"><a href="/" className="registration-back">← G-BEST LUXURY REALTY</a><span>CLIENT ONBOARDING · NIGERIA</span></div>
  <header className="registration-header">
   <div className="registration-brandline"><span className="registration-monogram">G</span><span>G-BEST <small>LUXURY REALTY</small></span></div>
   <p className="registration-eyebrow">A MORE CONSIDERED PROPERTY JOURNEY</p>
   <h1>LET’S FIND YOUR <i>PROPERTY.</i></h1>
   <p className="registration-intro">Tell us a little about yourself and the property you have in mind. Complete your profile first; your registration payment comes afterwards.</p>
  </header>
  <div className="registration-progress" aria-label={'Registration step '+step+' of 2'}>
   <div className={step>=1?'active':''}><span>01</span><b>Your details</b></div><i className={step>=2?'active':''}></i><div className={step>=2?'active':''}><span>02</span><b>Payment & submit</b></div>
  </div>
  {step===3?<section className="registration-confirmation"><span className="registration-confirm-icon">✓</span><p className="registration-eyebrow">SUBMISSION RECEIVED</p><h2>Thank you. We’ll take it from here.</h2><p>{result}</p><p className="registration-help">Your receipt is not proof of payment approval. Our team will verify the transfer manually. You can request an inspection after your registration is approved.</p><a href="/" className="registration-primary-link">RETURN TO HOMEPAGE ↗</a></section>:<form id="client-registration-form" className="registration-form" onSubmit={submit}>
   <div className="registration-stage-heading"><div><span className="registration-section-kicker">STEP 0{step}</span><h2>{step===1?'Your client profile':'Complete your registration'}</h2><p>{step===1?'Share your contact information and tell us what kind of property you are looking for.':'Make the one-time registration transfer, attach your receipt and submit for verification.'}</p></div><span className="registration-stage-count">0{step} / 02</span></div>
   <div className="registration-stage-content" hidden={step!==1}>
    {groups.map(([title,fields],groupIndex)=><section className="registration-panel" key={title}><div className="registration-section-kicker">0{groupIndex+1} / {title}</div><div className="registration-grid">{fields.map(([name,label])=><label key={name} className={['address','property_description','preferred_location'].includes(name)?'wide':''}>{label}{['address','property_description'].includes(name)?<textarea name={name} rows="3" required={step===1}/>:<input name={name} type={name==='email'?'email':'text'} required={step===1}/>}</label>)}</div></section>)}
    <section className="registration-panel registration-terms"><div className="registration-section-kicker">03 / TERMS & CONSENT</div><h3>Before we proceed</h3><p>A 5% commission applies to the cost of purchase, lease or sale of the desired property, subject to G-BEST Luxury Realty’s final terms. Property inspections are subject to payment verification and appointment confirmation. Please contact G-BEST for the applicable cancellation and refund policy before making payment.</p><label className="registration-consent"><input type="checkbox" name="terms_accepted" value="true" required={step===1}/>  I have read and agree to the terms and conditions.</label></section>
    <button type="button" className="registration-primary" onClick={continueToPayment}>CONTINUE TO PAYMENT <span>→</span></button>
   </div>
   {step===2&&<div className="registration-stage-content">
    <section className="registration-panel registration-payment">
     <div className="registration-section-kicker">04 / REGISTRATION FEE</div><h3>Make your registration payment</h3><p className="registration-payment-copy">Your details are ready. Transfer the one-time fee below, then enter the transfer reference and attach your receipt.</p>
     <div className="registration-bank-details"><div className="registration-fee-top"><span>ONE-TIME REGISTRATION FEE</span><strong>₦15,000</strong></div><div className="registration-account-row"><span>ACCOUNT NAME</span><strong>Gbest Innovation Ltd</strong></div><div className="registration-account-row"><span>ACCOUNT NUMBER</span><strong className="registration-account-number">5601035351</strong><button type="button" onClick={copyAccount} className="registration-copy">{copied?'COPIED ✓':'COPY'}</button></div><div className="registration-account-row"><span>BANK</span><strong>Fidelity Bank Plc</strong></div><p className="registration-support">Payment support: <a href="mailto:gbestinnovations@gmail.com">gbestinnovations@gmail.com</a></p></div>
     <div className="registration-payment-note"><b>PLEASE NOTE</b><p>Submitting a receipt does not mean your payment is approved. G-BEST will verify the transfer manually before activating your client registration.</p></div>
    </section>
    <section className="registration-panel"><div className="registration-section-kicker">05 / PAYMENT EVIDENCE</div><h3>Confirm your transfer</h3><div className="registration-grid"><label>Transfer reference<input name="payment_reference" required={step===2} maxLength="120" placeholder="Enter your bank transfer reference"/></label><label>Upload transfer receipt<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required={step===2}/></label></div><p className="registration-help">Accepted formats: JPG, PNG, WEBP or PDF. Maximum file size: 5 MB.</p></section>
    <div className="registration-actions"><button type="button" className="registration-secondary" onClick={()=>{setStep(1);setError('');window.scrollTo({top:0,behavior:'smooth'})}}>← BACK TO DETAILS</button><button type="submit" className="registration-primary" disabled={busy}>{busy?'SUBMITTING…':'SUBMIT REGISTRATION ↗'}</button></div>
   </div>}
   {error&&<p role="alert" className="registration-error">{error}</p>}
  </form>}
  <footer className="registration-footer"><span>G-BEST LUXURY REALTY</span><span>PROPERTY · PEOPLE · PERSPECTIVE</span></footer>
 </main>
}
