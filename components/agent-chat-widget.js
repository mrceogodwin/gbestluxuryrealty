'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';

const START={x:20,y:null};
function AgentBrandMark({className=''}) {
 return <svg className={className} viewBox="0 0 64 64" role="img" aria-label="G-BEST Agent">
  <path d="M32 2.8C16 2.8 3.5 14.7 3.5 30c0 10.2 5.2 18.8 13.2 23.8l-1.3 7.1 10.1-3.4c2.1.5 4.3.8 6.5.8 16 0 28.5-11.9 28.5-27.2S48 2.8 32 2.8Z" fill="#0c2e20" stroke="#d8bd77" strokeWidth="1.7"/>
  <circle cx="31.5" cy="29.5" r="21.5" fill="#e7cb83" stroke="#fff4d5" strokeWidth="1.1"/>
  <circle cx="31.5" cy="29.5" r="18.8" fill="none" stroke="#b4934e" strokeWidth=".65" opacity=".8"/>
  <text x="31.5" y="37.3" textAnchor="middle" fontFamily="Georgia,serif" fontSize="25" fontWeight="700" fill="#153d2b">G</text>
  <path d="m49 8 1.6 4.1 4.1 1.6-4.1 1.6L49 19.4l-1.6-4.1-4.1-1.6 4.1-1.6L49 8Z" fill="#f1d98e"/>
 </svg>
}
export default function AgentChatWidget(){
 const pathname=usePathname();
 const [open,setOpen]=useState(false),[minimized,setMinimized]=useState(false),[position,setPosition]=useState(START),[draft,setDraft]=useState(''),[messages,setMessages]=useState([{id:'welcome',from:'agent',text:'Hello, I’m Agent — your G-BEST property assistant. Ask me about finding a property, arranging an inspection or getting started.'}]),[busy,setBusy]=useState(false),[gate,setGate]=useState(false),[authenticated,setAuthenticated]=useState(false);
 const panelRef=useRef(null),drag=useRef(null);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('gbest-agent-position-v2')||'null');if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))setPosition(saved)}catch{}},[]);
 useEffect(()=>{let active=true;fetch('/api/client-auth/session',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(active)setAuthenticated(Boolean(d.authenticated))}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{if(!authenticated)return;let active=true;fetch('/api/client-chat',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load messages');if(active&&Array.isArray(d.messages)&&d.messages.length)setMessages(d.messages.map(m=>({id:m.id,from:m.sender_type==='client'?'visitor':'agent',text:m.body}))) }).catch(()=>{});return()=>{active=false}},[authenticated]);
 useEffect(()=>{if(pathname?.startsWith('/admin')||pathname?.startsWith('/staff')||pathname?.startsWith('/client-login')||pathname?.startsWith('/client-registration'))setOpen(false)},[pathname]);
 if(pathname?.startsWith('/admin')||pathname?.startsWith('/staff')||pathname?.startsWith('/client-login')||pathname?.startsWith('/client-registration'))return null;
 function startDrag(e){if(e.target.closest('button'))return;drag.current={x:e.clientX,y:e.clientY,originX:position.x,originY:position.y};e.currentTarget.setPointerCapture?.(e.pointerId)}
 function moveDrag(e){if(!drag.current)return;const maxX=Math.max(8,window.innerWidth-64),maxY=Math.max(8,window.innerHeight-64);const next={x:Math.min(maxX,Math.max(8,drag.current.originX-(e.clientX-drag.current.x))),y:Math.min(maxY,Math.max(8,drag.current.originY+e.clientY-drag.current.y))};setPosition(next)}
 function endDrag(){if(!drag.current)return;drag.current=null;try{localStorage.setItem('gbest-agent-position',JSON.stringify(position))}catch{}}
 async function send(e){e.preventDefault();const text=draft.trim();if(!text||busy)return;setDraft('');setBusy(true);try{const r=await fetch('/api/client-auth/session',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error();setAuthenticated(Boolean(d.authenticated));if(!d.authenticated){setMessages(m=>[...m,{id:Date.now(),from:'visitor',text},{id:Date.now()+1,from:'agent',text:'I’d be happy to help with that. Please register as a G-BEST client before sending your message so our team can continue the conversation and keep your enquiry with your account.'}]);}else{const sent=await fetch('/api/client-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});const saved=await sent.json();if(!sent.ok)throw new Error(saved.error||'Your message could not be sent.');setMessages(m=>[...m,{id:saved.message.id,from:'visitor',text:saved.message.body}]);}}catch{setMessages(m=>[...m,{id:Date.now()+3,from:'agent',text:'I couldn’t verify your client access just now. Please try again in a moment.'}])}finally{setBusy(false)}}
 return <div className="gb-agent-root" style={{right:position.x,bottom:position.y===null?20:undefined,top:position.y===null?undefined:position.y}}>
  {open&&!minimized&&<section className="gb-agent-panel" ref={panelRef} aria-label="Chat with Agent">
   <header className="gb-agent-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <span className="gb-agent-avatar"><AgentBrandMark className="gb-agent-mark"/></span><div><b>Agent</b><small>G-BEST PROPERTY ASSISTANT</small></div><button type="button" aria-label="Minimize Agent chat" onClick={()=>setMinimized(true)}>−</button><button type="button" aria-label="Close Agent chat" onClick={()=>setOpen(false)}>×</button>
   </header>
   <div className="gb-agent-messages" aria-live="polite">{messages.map(m=><div key={m.id} className={'gb-agent-message '+m.from}>{m.from==='agent'&&<span className="gb-agent-mini"><AgentBrandMark className="gb-agent-mark"/></span>}<p>{m.text}</p></div>)}
    {gate&&<div className="gb-agent-gate"><b>One quick step before we continue</b><p>Create your free client profile, or sign in if you already have an approved account.</p><a href="/client-registration">REGISTER AS A CLIENT <span>↗</span></a><a className="gb-agent-login" href="/client-login">Already registered? Sign in</a></div>}
    {authenticated&&!gate&&<a className="gb-agent-inspect" href="/#inspection">REQUEST A PROPERTY INSPECTION ↗</a>}
   </div>
   <form className="gb-agent-compose" onSubmit={send}><input aria-label="Message Agent" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask Agent anything…" maxLength={1200}/><button type="submit" disabled={!draft.trim()||busy} aria-label="Send message">➤</button></form>
   <footer className="gb-agent-foot">PRIVATE PROPERTY ENQUIRIES · G-BEST LUXURY REALTY</footer>
  </section>}
  {minimized&&<button className="gb-agent-minimized" aria-label="Reopen Agent chat" title="Reopen Agent" onClick={()=>{setMinimized(false);setOpen(true)}}><AgentBrandMark className="gb-agent-mark"/></button>}
  {!minimized&&<button className={'gb-agent-launcher '+(open?'is-open':'')} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-label={open?'Close Agent assistant':'Open Agent assistant'} onClick={()=>{setOpen(v=>!v);setMinimized(false)}}>{open?<span className="gb-agent-close-icon">×</span>:<AgentBrandMark className="gb-agent-mark gb-agent-launch-icon"/>}{!open&&<><span className="gb-agent-launch-copy"><b>Agent</b><small>ASK US ANYTHING</small></span><span className="gb-agent-spark">✦</span></>}</button>}
 </div>
}
