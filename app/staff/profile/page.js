'use client';
import {useState} from 'react';
import Link from 'next/link';

export default function StaffProfilePage(){
 const [file,setFile]=useState(null);
 const [preview,setPreview]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 function choose(e){
  const next=e.target.files?.[0]||null;
  setFile(next);setNotice('');setError('');
  if(preview)URL.revokeObjectURL(preview);
  setPreview(next?URL.createObjectURL(next):'');
 }
 async function upload(e){
  e.preventDefault();if(!file)return;
  setBusy(true);setNotice('');setError('');
  try{
   const body=new FormData();body.append('photo',file);
   const response=await fetch('/api/staff/profile-photo',{method:'POST',body});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||'Photo upload failed.');
   setNotice('Your profile photo has been updated.');
   setFile(null);
   const input=document.getElementById('staff-profile-photo');if(input)input.value='';
  }catch(err){setError(err.message||'Could not upload your photo.');}
  finally{setBusy(false);}
 }
 return <main style={{minHeight:'100vh',background:'#101411',color:'#f2f5f1',padding:'clamp(20px,5vw,56px)',fontFamily:'Arial,sans-serif'}}>
  <section style={{maxWidth:620,margin:'0 auto'}}>
   <Link href="/staff/communications" style={{color:'#caff70',textDecoration:'none',fontSize:13}}>← Back to staff area</Link>
   <p style={{marginTop:36,color:'#caff70',fontSize:11,fontWeight:800,letterSpacing:'.18em'}}>GBEST LUXURY REALTY / TEAM</p>
   <h1 style={{fontSize:'clamp(30px,6vw,44px)',letterSpacing:'-.04em',margin:'10px 0'}}>Your profile photo</h1>
   <p style={{color:'#aeb8b0',lineHeight:1.7,fontSize:14}}>Add a clear photo so your team can recognise you across the workspace.</p>
   <form onSubmit={upload} style={{marginTop:30,padding:24,border:'1px solid #344038',borderRadius:18,background:'#1a211c'}}>
    <div style={{display:'flex',alignItems:'center',gap:18,marginBottom:24}}>
     {preview?<img src={preview} alt="Selected profile preview" style={{width:88,height:88,borderRadius:'50%',objectFit:'cover',border:'2px solid #caff70'}}/>:<div aria-hidden="true" style={{width:88,height:88,borderRadius:'50%',display:'grid',placeItems:'center',background:'#2b352e',color:'#caff70',fontSize:30}}>＋</div>}
     <div><strong style={{display:'block',fontSize:14}}>Choose a new photo</strong><span style={{display:'block',fontSize:12,color:'#9da99f',marginTop:6}}>JPG, PNG, WebP or AVIF · Maximum 5 MB</span></div>
    </div>
    <input id="staff-profile-photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={choose} style={{display:'block',width:'100%',fontSize:14,color:'#dce4dc',marginBottom:20}}/>
    {notice&&<p role="status" style={{color:'#caff70',fontSize:13}}>{notice}</p>}
    {error&&<p role="alert" style={{color:'#ff9c8e',fontSize:13}}>{error}</p>}
    <button type="submit" disabled={!file||busy} style={{width:'100%',padding:15,border:0,borderRadius:10,background:!file||busy?'#566052':'#caff35',color:'#172016',fontWeight:900,fontSize:13,cursor:!file||busy?'not-allowed':'pointer'}}>{busy?'UPLOADING…':'SAVE PROFILE PHOTO'}</button>
   </form>
   <p style={{marginTop:18,color:'#89958c',fontSize:12,lineHeight:1.6}}>For your security, staff accounts can only update their own profile photo. Super Admin can manage staff photos from Staff Management.</p>
  </section>
 </main>;
}
