'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
const statusLabel=s=>({pending:'Awaiting review',contacted:'Team will contact you',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled',rejected:'Not approved'}[String(s||'').toLowerCase()]||String(s||'Pending').replace(/_/g,' '));
const dateLabel=v=>{if(!v)return 'Date to be arranged';const d=new Date(String(v).slice(0,10)+'T12:00:00');return d.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'});};
const tabs=[['home','Home'],['inspections','Inspections'],['messages','Messages'],['profile','Profile']];
function TabIcon({name}){const paths={home:<><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,inspections:<><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 9h16M8 13h3M8 17h7"/></>,messages:<><path d="M4 5h16v12H8l-4 3z"/><path d="M8 9h8M8 13h5"/></>,profile:<><circle cx="12" cy="8" r="3.5"/><path d="M5 21c.5-4 3-6 7-6s6.5 2 7 6"/></>};return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>}
export default function ClientDashboard(){
 const [client,setClient]=useState(null),[requests,setRequests]=useState([]),[chat,setChat]=useState(null),[messages,setMessages]=useState([]),[staff,setStaff]=useState([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(true),[sending,setSending]=useState(false),[error,setError]=useState(''),[inspectionError,setInspectionError]=useState(''),[chatError,setChatError]=useState(''),[notice,setNotice]=useState(''),[tab,setTab]=useState('home');
 async function get(url){const r=await fetch(url,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load this information.');return d;}
 async function load(){
  setBusy(true);setError('');
  try{
   const s=await get('/api/client-auth/session');
   if(!s.authenticated){window.location.href='/client-login?next=%2Fclient-dashboard';return;}
   setClient(s.client);
   const [i,c]=await Promise.allSettled([get('/api/client-inspections'),get('/api/client-chat')]);
   if(i.status==='fulfilled'){setRequests(i.value.requests||[]);setInspectionError('')}else setInspectionError(i.reason?.message||'Inspection history is temporarily unavailable.');
   if(c.status==='fulfilled'){setChat(c.value.conversation||null);setMessages(c.value.messages||[]);setStaff(c.value.staff||[]);setChatError('')}else setChatError(c.reason?.message||'Messages are temporarily unavailable.');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 useEffect(()=>{load()},[]);
 useEffect(()=>{if(!client)return;let active=true;let previous='';const refresh=async()=>{try{const r=await fetch('/api/client-chat',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load messages.');if(!active)return;const snapshot=JSON.stringify([d.conversation||null,d.messages||[],d.staff||[]]);if(snapshot!==previous){previous=snapshot;setChat(d.conversation||null);setMessages(d.messages||[]);setStaff(d.staff||[])}setChatError('')}catch(e){if(active)setChatError(e.message||'Messages are temporarily unavailable.')}};const timer=window.setInterval(refresh,20000);return()=>{active=false;window.clearInterval(timer)}},[client]);
 async function send(e){e.preventDefault();const body=message.trim();if(!body||sending)return;setSending(true);setChatError('');try{const r=await fetch('/api/client-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:body})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Message could not be sent.');setMessage('');const c=await get('/api/client-chat');setChat(c.conversation);setMessages(c.messages||[]);setStaff(c.staff||[]);setNotice('Message sent securely.')}catch(e){setChatError(e.message)}finally{setSending(false)}}
 async function handoff(){setChatError('');try{const r=await fetch('/api/client-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request-human'})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not request a team member.');setNotice(d.message||'Your request has been sent.');const c=await get('/api/client-chat');setChat(c.conversation);setMessages(c.messages||[]);setStaff(c.staff||[])}catch(e){setChatError(e.message)}}
 async function logout(){try{await fetch('/api/client-auth/logout',{method:'POST'})}finally{window.location.href='/client-login'}}
 const approved=client?.paymentStatus==='approved',free=client?.paymentStatus==='not_required';
 const unread=messages.filter(m=>m.sender_type!=='client'&&!m.read_at).length;
 const title={home:'Your space',inspections:'Inspection requests',messages:'Private messages',profile:'Your profile'}[tab];
 return <main className="client-app">
  <header className="appbar"><Link href="/" className="appbrand"><span className="brand-mark">G</span><span><b>G-BEST</b><small>LUXURY REALTY</small></span></Link><div className="appbar-right"><span className="secure-pill"><i/> PRIVATE CLIENT</span><button onClick={logout} className="signout">Sign out</button></div></header>
  <div className="app-content">
   <div className="screen-heading"><div><small>G-BEST CLIENT SPACE</small><h1>{title}</h1></div><span className="client-initial">{client?.fullName?.slice(0,1)||'G'}</span></div>
   {error&&<div className="page-alert" role="alert">{error}<button onClick={load}>Retry</button></div>}
   {notice&&<div className="notice" role="status">{notice}</div>}
   {busy?<div className="loading-card">Loading your private space…</div>:client&&<>
    {tab==='home'&&<>
     <section className="welcome-card"><div><small>WELCOME BACK</small><h2>{client.fullName?.split(' ')[0]||'Client'}<em>.</em></h2><p>Your property journey, inspection updates and conversations — all in one place.</p></div><div className="welcome-art">G</div></section>
     <section className="quick-stats"><article><span>CLIENT ID</span><b>{client.clientId||'ACTIVE'}</b><small>Verified profile</small></article><article><span>INSPECTION ACCESS</span><b>{approved?'Approved':free?'Free access':'Pending'}</b><small>{free?'No registration fee':approved?'You can request inspections':'Awaiting review'}</small></article><article><span>REQUESTS</span><b>{String(requests.length).padStart(2,'0')}</b><small>Inspection history</small></article></section>
     <section className="action-grid"><button onClick={()=>setTab('inspections')}><span className="action-icon">▣</span><b>My inspections</b><small>Track appointments and updates</small><strong>View requests →</strong></button><button onClick={()=>setTab('messages')}><span className="action-icon">✉</span><b>Talk to G-BEST</b><small>Private support conversation</small><strong>Open messages → {unread>0&&<i>{unread}</i>}</strong></button></section>
     <section className="info-strip"><span className="info-icon">✦</span><p><b>Need help choosing a property?</b><br/>Our team can guide you through listings, inspections and next steps.</p><button onClick={()=>setTab('messages')}>Chat with us</button></section>
    </>}
    {tab==='inspections'&&<section className="app-card"><div className="card-top"><div><small>YOUR PROPERTY JOURNEY</small><h2>Inspection requests</h2></div><Link href="/#inspection">Request inspection</Link></div>{inspectionError?<div className="inline-error">{inspectionError}<button onClick={load}>Retry</button></div>:requests.length?<div className="request-list">{requests.map(x=><article key={x.id}><div className="request-icon">⌂</div><div className="request-main"><b>{x.property_title||'Property inspection'}</b><span>{x.property_code||'G-BEST'} · {dateLabel(x.preferred_date)} · {String(x.preferred_time||'').slice(0,5)}</span></div><em data-status={String(x.status).toLowerCase()}>{statusLabel(x.status)}</em></article>)}</div>:<div className="empty-state"><span>▣</span><b>No inspection requests yet</b><p>Your submitted inspection requests and confirmation updates will appear here.</p><Link href="/#inspection">Explore inspection booking →</Link></div>}</section>}
    {tab==='messages'&&<section className="chat-card"><div className="chat-head"><div className="agent-avatar">G</div><div><b>G-BEST Client Support</b><small><i/> Secure private conversation</small></div><span className="chat-lock">⌑</span></div><div className="agent-presence">{staff.length?staff.slice(0,3).map(s=><span key={s.id}>{s.avatar_url?<img src={s.avatar_url} alt=""/>:<i>{s.full_name?.slice(0,1)||'G'}</i>}<b>{s.full_name}</b><small>{s.presence==='online'?'Online':'Away'}</small></span>):<p>Our team can continue helping while a staff member becomes available.</p>}</div>{chatError&&<div className="inline-error" role="alert">{chatError}<button onClick={load}>Retry</button></div>}<div className="chat-thread">{messages.length?messages.map(m=><div key={m.id} className={'bubble '+(m.sender_type==='client'?'outgoing':'incoming')}><small>{m.sender_type==='client'?'You':m.sender_name||'G-BEST team'}</small><p>{m.body}</p><time>{m.created_at?new Date(m.created_at).toLocaleString('en-NG',{hour:'numeric',minute:'2-digit',day:'numeric',month:'short'}):''}</time></div>):<div className="empty-chat"><span>✉</span><b>Start a conversation</b><p>Ask about a property, an inspection or anything else our team can help with.</p></div>}</div><form className="message-compose" onSubmit={send}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Message G-BEST…" maxLength={4000}/><button disabled={sending||!message.trim()} aria-label="Send message">{sending?'…':'➤'}</button></form><button className="human-button" onClick={handoff}>Request a human team member</button><p className="chat-footnote">Your messages are private to your client account and the authorised G-BEST team.</p></section>}
    {tab==='profile'&&<section className="app-card profile-card"><div className="profile-avatar">{client.fullName?.slice(0,1)||'G'}</div><small>CLIENT PROFILE</small><h2>{client.fullName}</h2><p>{client.email}</p><div className="profile-row"><span>Client reference</span><b>{client.clientId}</b></div><div className="profile-row"><span>Account status</span><b>Active</b></div><div className="profile-row"><span>Inspection payment</span><b>{approved?'Approved':free?'Not required':String(client.paymentStatus||'Pending')}</b></div><button className="profile-signout" onClick={logout}>Sign out of your account</button></section>}
   </>}
  </div>
  <nav className="bottom-dock" aria-label="Client navigation">{tabs.map(([id,label])=><button key={id} type="button" onClick={()=>{setTab(id);setNotice('')}} className={tab===id?'active':''} aria-current={tab===id?'page':undefined}><span className="dock-icon"><TabIcon name={id}/></span><small>{label}</small>{id==='messages'&&unread>0&&<i>{unread}</i>}</button>)}</nav>
  <style jsx global>{`
  *{box-sizing:border-box}.client-app{--forest:#173f2d;--forest2:#214f39;--sage:#738879;--lime:#d6e8a5;--paper:#f3f6f1;min-height:100vh;background:var(--paper);color:#173b2b;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding-bottom:calc(96px + env(safe-area-inset-bottom))}
  .appbar{height:76px;padding:0 clamp(18px,5vw,72px);display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #e2e9e1;position:sticky;top:0;z-index:20}.appbrand{display:flex;gap:10px;align-items:center;color:var(--forest);text-decoration:none;letter-spacing:.12em}.brand-mark{width:38px;height:38px;border-radius:12px;background:var(--forest);color:#fff;display:grid;place-items:center;font-family:Georgia,serif;font-size:24px}.appbrand b,.appbrand small{display:block}.appbrand b{font-size:14px}.appbrand small{font-size:8px;letter-spacing:.22em;margin-top:3px}.appbar-right{display:flex;align-items:center;gap:14px}.secure-pill{font-size:9px;letter-spacing:.1em;color:#62776a;background:#f0f5ef;border-radius:30px;padding:9px 12px}.secure-pill i,.chat-head small i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#6eaa78;margin-right:6px}.signout{background:transparent;border:1px solid #cbd8cc;color:var(--forest);border-radius:9px;padding:10px 13px;font-size:11px;font-weight:700}
  .app-content{width:min(100%,980px);margin:auto;padding:26px clamp(16px,4vw,28px) 30px}.screen-heading{display:flex;justify-content:space-between;align-items:center;margin:8px 0 20px}.screen-heading small,.welcome-card small,.card-top small{font-size:9px;letter-spacing:.18em;font-weight:800;color:#788c7d}.screen-heading h1{font-size:25px;letter-spacing:-.04em;margin:5px 0 0}.client-initial{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#dce9da;color:var(--forest);font-weight:800}.welcome-card{position:relative;overflow:hidden;background:linear-gradient(120deg,#143c2a,#24583d);color:#fff;border-radius:22px;padding:27px 25px;min-height:180px;display:flex;align-items:center;box-shadow:0 12px 30px #173b2b18}.welcome-card small{color:#c8d9b0}.welcome-card h2{font-size:36px;letter-spacing:-.05em;margin:9px 0}.welcome-card h2 em{color:#d6e8a5;font-family:Georgia,serif}.welcome-card p{max-width:440px;color:#d8e3d9;font-size:13px;line-height:1.6;margin:0}.welcome-art{position:absolute;right:24px;top:8px;font-family:Georgia,serif;font-size:170px;line-height:1;color:#ffffff0b;pointer-events:none}
  .quick-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.quick-stats article,.app-card,.action-grid button,.info-strip,.chat-card,.loading-card{background:#fff;border:1px solid #e2e9e1;border-radius:16px;box-shadow:0 5px 18px #193b2910}.quick-stats article{padding:16px}.quick-stats span,.quick-stats small{display:block;font-size:9px;color:#819084;letter-spacing:.08em}.quick-stats b{display:block;font-size:19px;margin:9px 0 5px;overflow-wrap:anywhere}.quick-stats small{letter-spacing:0}.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.action-grid button{text-align:left;padding:18px;color:var(--forest);display:flex;flex-direction:column;align-items:flex-start;gap:8px}.action-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:#eef4eb;font-size:18px}.action-grid b{font-size:15px}.action-grid small{color:#78877b;font-size:11px}.action-grid strong{font-size:11px;color:#416c4e;margin-top:5px}.action-grid strong i,.bottom-dock i{font-style:normal;background:#d7e9a7;border-radius:20px;padding:2px 6px}.info-strip{display:flex;align-items:center;gap:12px;margin-top:14px;padding:15px}.info-icon{width:34px;height:34px;border-radius:50%;background:#f1f5e9;display:grid;place-items:center;color:#7b9853}.info-strip p{flex:1;font-size:11px;line-height:1.6;color:#6e7d71;margin:0}.info-strip p b{color:var(--forest)}.info-strip button{border:0;background:#eaf1e8;color:var(--forest);padding:10px 12px;border-radius:9px;font-size:10px;font-weight:800;white-space:nowrap}
  .app-card{padding:22px}.card-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:14px}.card-top h2{font-size:22px;margin:6px 0}.card-top a{background:var(--forest);color:#fff;text-decoration:none;border-radius:9px;padding:11px 13px;font-size:10px;font-weight:700}.request-list article{display:flex;align-items:center;gap:12px;padding:16px 0;border-top:1px solid #edf1ec}.request-icon{width:38px;height:38px;border-radius:12px;background:#eff4ed;display:grid;place-items:center}.request-main{flex:1;min-width:0}.request-main b,.request-main span{display:block}.request-main b{font-size:13px}.request-main span{font-size:10px;color:#7b887d;margin-top:5px}.request-list em{font-style:normal;font-size:9px;border-radius:30px;padding:7px 9px;background:#edf4ee;white-space:nowrap}.request-list em[data-status=cancelled],.request-list em[data-status=rejected]{background:#f8eaea;color:#9b3737}.empty-state,.empty-chat{text-align:center;padding:38px 14px;color:#748378}.empty-state>span,.empty-chat>span{font-size:27px;color:#9db39e}.empty-state b,.empty-chat b{display:block;margin-top:10px;color:var(--forest)}.empty-state p,.empty-chat p{font-size:12px;line-height:1.6;max-width:360px;margin:8px auto 14px}.empty-state a{font-size:11px;color:#416c4e;font-weight:800}
  .chat-card{overflow:hidden}.chat-head{background:var(--forest);color:#fff;padding:16px;display:flex;align-items:center;gap:11px}.agent-avatar{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#d8e8b0;color:var(--forest);font-family:Georgia,serif;font-size:21px}.chat-head b,.chat-head small{display:block}.chat-head b{font-size:13px}.chat-head small{font-size:9px;color:#d0ddce;margin-top:4px}.chat-lock{margin-left:auto;color:#d8e8b0}.agent-presence{padding:12px 15px;background:#f7faf6;border-bottom:1px solid #e8eee7;display:flex;gap:10px;flex-wrap:wrap}.agent-presence>span{display:flex;align-items:center;gap:6px;font-size:10px}.agent-presence img,.agent-presence i{width:25px;height:25px;border-radius:50%;object-fit:cover}.agent-presence i{display:grid;place-items:center;background:#dce8dc;font-style:normal}.agent-presence small{color:#829084}.agent-presence p{font-size:11px;color:#748378;margin:0}.chat-thread{min-height:260px;max-height:48vh;overflow:auto;padding:17px;display:flex;flex-direction:column;gap:10px;background:#f9fbf8}.bubble{max-width:min(82%,520px);padding:10px 12px;border-radius:15px;box-shadow:0 2px 6px #173b2b0b}.bubble.incoming{align-self:flex-start;background:#fff;border:1px solid #e8eee7;border-bottom-left-radius:5px}.bubble.outgoing{align-self:flex-end;background:#e2efdf;border-bottom-right-radius:5px}.bubble small,.bubble time{display:block;font-size:9px;color:#7d8b80}.bubble p{font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}.bubble time{text-align:right;font-size:8px}.message-compose{display:flex;gap:9px;padding:13px;border-top:1px solid #e7eee6}.message-compose input{flex:1;min-width:0;border:1px solid #dce6dc;border-radius:25px;padding:13px 16px;font:inherit;font-size:13px;outline:none}.message-compose input:focus{border-color:#76977c;box-shadow:0 0 0 3px #dfeade}.message-compose button{width:44px;height:44px;border:0;border-radius:50%;background:var(--forest);color:#fff;font-size:18px}.message-compose button:disabled{opacity:.4}.human-button{display:block;margin:0 13px 10px;border:1px solid #d8e4d5;background:#f2f6ef;color:#355d40;border-radius:10px;padding:11px 14px;font-size:10px;font-weight:800}.chat-footnote{text-align:center;color:#94a095;font-size:9px;padding:0 12px 13px;margin:0}.inline-error,.page-alert{margin:12px;padding:12px;border-radius:10px;background:#fff0ef;color:#9b3737;font-size:12px}.inline-error button,.page-alert button{margin-left:10px;border:0;background:transparent;color:inherit;font-weight:800;text-decoration:underline}.profile-card{text-align:center}.profile-avatar{width:58px;height:58px;border-radius:50%;margin:0 auto 12px;background:#e2eddf;display:grid;place-items:center;font-size:24px;font-weight:800}.profile-card>small{font-size:9px;letter-spacing:.15em;color:#819084}.profile-card h2{margin:8px 0 3px}.profile-card>p{font-size:12px;color:#77877a;margin:0 0 20px}.profile-row{display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid #edf1ec;font-size:12px}.profile-row span{color:#78877c}.profile-signout{margin-top:20px;background:#f7eeee;border:1px solid #f0dada;color:#98453e;border-radius:9px;padding:12px 16px;font-size:11px;font-weight:800}
  .bottom-dock{position:fixed;z-index:30;bottom:0;left:0;right:0;display:flex;justify-content:space-around;gap:4px;padding:9px 12px calc(9px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e0e8df;box-shadow:0 -8px 24px #173b2b10}.bottom-dock button{position:relative;flex:1;border:0;background:transparent;color:#89968b;display:flex;flex-direction:column;align-items:center;gap:4px;padding:5px 2px;border-radius:12px}.bottom-dock button.active{color:var(--forest);background:#f0f5ee}.bottom-dock button>span{font-size:19px;line-height:1.1}.bottom-dock button small{font-size:9px;font-weight:700}.bottom-dock i{position:absolute;top:0;right:18%;font-size:8px;color:#24442e}
  .notice{margin:12px 0;padding:10px 13px;border-radius:10px;background:#edf5e9;color:#315e3b;font-size:11px}.loading-card{padding:30px;text-align:center;color:#738477;font-size:12px}
  @media(min-width:900px){.app-content{padding-top:34px}.welcome-card{min-height:205px}.bottom-dock{left:50%;right:auto;transform:translateX(-50%);bottom:16px;width:min(540px,calc(100% - 40px));border:1px solid #e0e8df;border-radius:22px;padding:9px 14px calc(9px + env(safe-area-inset-bottom));box-shadow:0 12px 40px #173b2b20}.client-app{padding-bottom:120px}}
  @media(max-width:600px){.appbar{height:64px;padding:0 16px}.secure-pill{display:none}.app-content{padding:16px 14px 24px}.screen-heading{margin:5px 2px 15px}.screen-heading h1{font-size:22px}.welcome-card{border-radius:18px;padding:23px 20px;min-height:165px}.welcome-card h2{font-size:31px}.welcome-card p{font-size:12px;max-width:280px}.welcome-art{right:8px;font-size:130px}.quick-stats{gap:7px}.quick-stats article{padding:12px 10px;border-radius:13px}.quick-stats span{font-size:8px}.quick-stats b{font-size:15px}.quick-stats small{font-size:9px}.action-grid{gap:8px}.action-grid button{padding:14px;border-radius:14px}.action-grid b{font-size:13px}.action-grid small{font-size:10px;line-height:1.4}.info-strip{align-items:flex-start;flex-wrap:wrap}.info-strip p{min-width:calc(100% - 55px)}.info-strip button{margin-left:46px}.app-card{padding:16px;border-radius:15px}.card-top{align-items:flex-start;flex-direction:column}.card-top h2{font-size:20px}.request-list article{align-items:flex-start;flex-wrap:wrap}.request-list em{margin-left:50px}.chat-thread{max-height:52vh;min-height:300px;padding:13px}.bubble{max-width:90%}.bottom-dock button small{font-size:9px}.signout{padding:9px 10px;font-size:10px}}

  /* Premium native-app finish: layered depth, tactile surfaces and generous mobile rhythm. */
  .client-app{background:radial-gradient(ellipse at 8% 12%,#e3ede2 0,transparent 34%),radial-gradient(ellipse at 100% 52%,#e8eee5 0,transparent 36%),linear-gradient(180deg,#f7f9f5,#edf2ec);padding-bottom:calc(108px + env(safe-area-inset-bottom))}
  .appbar{box-shadow:0 5px 20px #173b2b0b;backdrop-filter:blur(18px);background:#ffffffed}
  .brand-mark{box-shadow:0 5px 0 #0b2c1c,0 9px 18px #153c2b30,inset 0 1px 1px #ffffff65}
  .welcome-card{border:1px solid #ffffff30;box-shadow:0 18px 32px #153c2b27,inset 0 1px 1px #ffffff30,inset 0 -8px 20px #061d1230;transform:translateZ(0)}
  .welcome-card:after{content:"";position:absolute;inset:1px;border-radius:inherit;pointer-events:none;background:linear-gradient(135deg,#ffffff1c,transparent 38%,#ffffff08 70%,transparent)}
  .quick-stats article,.app-card,.action-grid button,.info-strip,.chat-card{border:1px solid #ffffffd9;box-shadow:0 9px 18px #183c2810,0 2px 4px #183c2808,inset 0 1px 0 #fff;transition:transform .18s ease,box-shadow .18s ease}
  .quick-stats article{background:linear-gradient(150deg,#fff,#f8fbf7);border-radius:17px}
  .action-grid button{background:linear-gradient(150deg,#fff,#f7faf6);min-height:164px;border-radius:19px;box-shadow:0 10px 22px #173b2b12,0 3px 0 #dce7dc,inset 0 1px 0 #fff}
  .action-grid button:active,.bottom-dock button:active{transform:translateY(2px)}
  .action-icon{box-shadow:inset 0 2px 4px #fff,0 3px 8px #173b2b10}
  .bottom-dock{background:linear-gradient(180deg,#132b20,#07130d);border:1px solid #34503d;border-bottom:0;box-shadow:0 -10px 28px #0a201655,inset 0 1px 0 #ffffff25;padding:10px 12px calc(10px + env(safe-area-inset-bottom))}
  .bottom-dock button{color:#b8c8ba;min-height:54px;border-radius:14px}
  .bottom-dock button.active{color:#153c2b;background:linear-gradient(180deg,#f8fbf5,#dfeadd);box-shadow:0 4px 0 #a6bea8,0 7px 14px #0005,inset 0 1px #fff}
  .bottom-dock button>span{font-size:0;width:24px;height:24px;display:grid;place-items:center}
  .bottom-dock button>span:before{font-size:21px;line-height:1}
  .bottom-dock button:nth-child(1)>span:before{content:"⌂"}
  .bottom-dock button:nth-child(2)>span:before{content:"▤"}
  .bottom-dock button:nth-child(3)>span:before{content:"✉"}
  .bottom-dock button:nth-child(4)>span:before{content:"◉"}
  .bottom-dock button small{font-size:10px;letter-spacing:.01em}
  .chat-card{border-radius:20px;box-shadow:0 16px 35px #173b2b17,0 3px 0 #dce6da}
  .chat-head{background:linear-gradient(115deg,#123925,#24583d);box-shadow:inset 0 1px #ffffff2b}
  .message-compose{background:#fff}
  .message-compose button{box-shadow:0 4px 0 #0b2c1c,0 7px 12px #173b2b25}
  .app-card{border-radius:20px;box-shadow:0 12px 28px #173b2b12,0 3px 0 #dce6da}
  .screen-heading h1{letter-spacing:-.055em}
  @media(max-width:600px){
   .app-content{padding:20px 15px 28px}
   .screen-heading{margin:8px 2px 19px}
   .screen-heading h1{font-size:27px}
   .welcome-card{min-height:190px;padding:27px 22px;border-radius:22px}
   .welcome-card h2{font-size:37px}
   .welcome-card p{font-size:14px;line-height:1.7;max-width:290px}
   .quick-stats{gap:9px;margin:17px 0}
   .quick-stats article{padding:15px 11px;min-height:128px}
   .quick-stats span{font-size:8px;line-height:1.5}
   .quick-stats b{font-size:17px;line-height:1.25}
   .quick-stats small{font-size:10px;line-height:1.4}
   .action-grid{gap:10px;margin-top:15px}
   .action-grid button{padding:16px;min-height:178px}
   .action-grid b{font-size:14px}
   .action-grid small{font-size:11px;line-height:1.55}
   .bottom-dock{left:10px;right:10px;bottom:8px;border:1px solid #526657;border-radius:22px;padding:8px 8px calc(8px + env(safe-area-inset-bottom));}
   .bottom-dock button{min-height:58px}
   .bottom-dock button small{font-size:9px}
  }
  @media(prefers-reduced-motion:no-preference){.action-grid button:hover{transform:translateY(-3px);box-shadow:0 15px 26px #173b2b1b,0 4px 0 #dce7dc}}
  
/* Cohesive mobile-first client app shell */
.client-app{min-height:100dvh!important;background:linear-gradient(180deg,#f8faf6 0%,#eef3ed 100%)!important;color:#173b2b!important;padding-bottom:calc(100px + env(safe-area-inset-bottom))!important}
.client-app .appbar{height:74px!important;padding:0 clamp(16px,4vw,44px)!important;background:#fbfcfa!important;border-bottom:1px solid #e3eae1!important;box-shadow:0 4px 18px #173b2b0a!important}
.client-app .app-content{max-width:1040px!important;padding:28px clamp(16px,3.8vw,34px) 34px!important}
.client-app .screen-heading{margin:4px 0 22px!important}
.client-app .screen-heading h1{font-size:clamp(25px,4vw,34px)!important;letter-spacing:-.05em!important}
.client-app .welcome-card{min-height:196px!important;border-radius:24px!important;padding:30px!important;background:linear-gradient(125deg,#123b29 0%,#1d5037 58%,#286344 100%)!important;box-shadow:0 16px 34px #123b2928,inset 0 1px #ffffff30,0 3px 0 #0e3021!important}
.client-app .welcome-card h2{font-size:clamp(34px,5vw,44px)!important}
.client-app .quick-stats{gap:12px!important;margin:18px 0!important}
.client-app .quick-stats article{border-radius:18px!important;padding:18px!important;min-width:0!important;background:linear-gradient(145deg,#fff,#f7faf6)!important;box-shadow:0 7px 18px #173b2b0c,0 2px 0 #dce7dc!important}
.client-app .quick-stats b{font-size:clamp(16px,2vw,21px)!important;line-height:1.25!important;overflow-wrap:anywhere!important}
.client-app .action-grid{gap:12px!important;margin-top:14px!important}
.client-app .action-grid button{min-height:160px!important;border-radius:19px!important;padding:19px!important;background:linear-gradient(150deg,#fff,#f7faf6)!important;box-shadow:0 8px 18px #173b2b0d,0 2px 0 #dce7dc!important}
.client-app .app-card,.client-app .chat-card{border-radius:22px!important;box-shadow:0 12px 28px #173b2b12,0 2px 0 #dce6da!important}
.client-app .chat-card{display:flex!important;flex-direction:column!important;min-height:min(690px,calc(100dvh - 190px))!important;overflow:hidden!important}
.client-app .chat-head{position:sticky!important;top:0!important;z-index:2!important;min-height:76px!important;padding:16px 18px!important;background:linear-gradient(120deg,#123b29,#24583d)!important}
.client-app .agent-presence{min-height:52px!important;padding:12px 16px!important;background:#f5f8f3!important}
.client-app .chat-thread{flex:1 1 auto!important;min-height:300px!important;max-height:none!important;overflow-y:auto!important;overscroll-behavior:contain!important;padding:20px!important;background:linear-gradient(180deg,#f6f9f4,#eef4ed)!important}
.client-app .bubble{max-width:min(82%,560px)!important;border-radius:17px!important;padding:12px 14px!important;box-shadow:0 4px 12px #173b2b0c!important}
.client-app .bubble.incoming{border-bottom-left-radius:5px!important}
.client-app .bubble.outgoing{border-bottom-right-radius:5px!important;background:linear-gradient(145deg,#e5f1df,#d7e9d1)!important}
.client-app .message-compose{position:sticky!important;bottom:0!important;z-index:3!important;padding:13px 15px!important;background:#fff!important;border-top:1px solid #e5ece3!important}
.client-app .message-compose input{min-height:48px!important;border-radius:25px!important;background:#f8faf7!important;padding:13px 17px!important}
.client-app .message-compose button{width:48px!important;height:48px!important;flex:0 0 48px!important;border-radius:50%!important;background:linear-gradient(145deg,#24583b,#123b29)!important;box-shadow:0 3px 0 #0b2b1b,0 6px 12px #173b2b22!important}
.client-app .human-button{align-self:flex-start!important;margin:0 15px 10px!important}
.client-app .chat-footnote{padding:0 14px 14px!important}
.client-app .bottom-dock{left:12px!important;right:12px!important;bottom:8px!important;max-width:560px!important;margin:auto!important;border:1px solid #45614d!important;border-radius:22px!important;background:linear-gradient(180deg,#183c2a,#0d2418)!important;box-shadow:0 12px 30px #071b12a0,inset 0 1px #ffffff2b!important;padding:8px 9px calc(8px + env(safe-area-inset-bottom))!important}
.client-app .bottom-dock button{min-height:58px!important;border-radius:15px!important;color:#d0ddcf!important;gap:5px!important}
.client-app .bottom-dock button.active{background:linear-gradient(180deg,#fff,#e5eee2)!important;color:#173b2b!important;box-shadow:0 3px 0 #a9bea8,0 6px 12px #0004!important}
.client-app .bottom-dock button>span{font-size:19px!important}
.client-app .bottom-dock button small{font-size:10px!important;font-weight:750!important}
.client-app button,.client-app a{touch-action:manipulation}
.client-app button:focus-visible,.client-app a:focus-visible,.client-app input:focus-visible{outline:3px solid #b7d18b!important;outline-offset:3px!important}
@media(max-width:600px){
 .client-app .appbar{height:66px!important;padding:0 15px!important}
 .client-app .app-content{padding:18px 14px 28px!important}
 .client-app .screen-heading{margin:5px 2px 17px!important}
 .client-app .welcome-card{min-height:178px!important;padding:24px 20px!important;border-radius:21px!important}
 .client-app .welcome-card p{font-size:13px!important;line-height:1.65!important;max-width:290px!important}
 .client-app .quick-stats{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
 .client-app .quick-stats article{padding:13px 9px!important;min-height:122px!important}
 .client-app .quick-stats span{font-size:7px!important;letter-spacing:.06em!important}
 .client-app .quick-stats b{font-size:14px!important}
 .client-app .quick-stats small{font-size:9px!important;line-height:1.35!important}
 .client-app .action-grid{gap:9px!important}
 .client-app .action-grid button{min-height:158px!important;padding:14px!important}
 .client-app .action-grid b{font-size:13px!important}
 .client-app .action-grid small{font-size:10px!important;line-height:1.45!important}
 .client-app .chat-card{min-height:calc(100dvh - 190px)!important;border-radius:18px!important}
 .client-app .chat-thread{min-height:300px!important;padding:14px!important}
 .client-app .bubble{max-width:90%!important}
 .client-app .bottom-dock{left:9px!important;right:9px!important;bottom:7px!important}
 .client-app .bottom-dock button{min-height:55px!important}
}
@media(max-width:600px){
 .client-app .quick-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important;align-items:stretch!important}
 .client-app .quick-stats article:first-child{grid-column:1/-1!important;min-height:94px!important}
 .client-app .quick-stats article:first-child b{font-size:19px!important}
 .client-app .quick-stats article:not(:first-child){min-height:112px!important}
 .client-app .screen-heading h1{line-height:1.12!important}
 .client-app .chat-head{flex:0 0 auto!important}
 .client-app .chat-thread{scrollbar-gutter:stable!important}
 .client-app .message-compose{padding-bottom:max(13px,env(safe-area-inset-bottom))!important}
 .client-app .bottom-dock{backdrop-filter:blur(18px)!important}
}
@media(min-width:601px){.client-app .quick-stats{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
.client-app{padding-bottom:calc(88px + env(safe-area-inset-bottom))!important}
.client-app nav.bottom-dock{position:fixed!important;left:12px!important;right:12px!important;bottom:calc(8px + env(safe-area-inset-bottom))!important;width:auto!important;max-width:520px!important;min-height:66px!important;height:66px!important;margin:0 auto!important;padding:6px 8px!important;display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:5px!important;align-items:stretch!important;border:1px solid #dce6dc!important;border-radius:19px!important;background:rgba(255,255,255,.96)!important;box-shadow:0 8px 24px #173b2b18,0 2px 0 #d5e0d4!important;backdrop-filter:blur(18px)!important}
.client-app nav.bottom-dock button{position:relative!important;min-width:0!important;min-height:0!important;height:52px!important;padding:4px 2px!important;margin:0!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;border:0!important;border-radius:13px!important;background:transparent!important;color:#728277!important;box-shadow:none!important;line-height:1!important}
.client-app nav.bottom-dock button.active{background:#eaf2e8!important;color:#173f2d!important;box-shadow:inset 0 1px #fff,0 1px 2px #173b2b12!important}
.client-app nav.bottom-dock .dock-icon{width:22px!important;height:22px!important;display:grid!important;place-items:center!important;font-size:0!important;line-height:0!important}
.client-app nav.bottom-dock .dock-icon svg{display:block!important;width:21px!important;height:21px!important;overflow:visible!important}
.client-app nav.bottom-dock button small{display:block!important;font-size:10px!important;line-height:1.1!important;font-weight:750!important;white-space:nowrap!important}
.client-app nav.bottom-dock button i{position:absolute!important;top:1px!important;right:calc(50% - 24px)!important;min-width:16px!important;height:16px!important;padding:0 4px!important;display:grid!important;place-items:center!important;border-radius:99px!important;background:#d6e8a5!important;color:#173b2b!important;font-size:9px!important;font-style:normal!important;font-weight:850!important}
@media(max-width:600px){.client-app nav.bottom-dock{left:12px!important;right:12px!important;bottom:calc(8px + env(safe-area-inset-bottom))!important;height:64px!important;min-height:64px!important}.client-app nav.bottom-dock button{height:50px!important}.client-app .app-content{padding-bottom:18px!important}}
@media(min-width:601px){.client-app nav.bottom-dock{left:50%!important;right:auto!important;transform:translateX(-50%)!important;width:min(520px,calc(100% - 40px))!important}}
@media(prefers-reduced-motion:reduce){.client-app *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`}</style>
 </main>
}
