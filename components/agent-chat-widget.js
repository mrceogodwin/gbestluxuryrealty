'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';

const START={x:20,y:null};
function AgentChatMark({className=''}) {
 return <svg className={className} viewBox="0 0 64 64" role="img" aria-label="Open Agent chat">
  <circle cx="32" cy="32" r="29" fill="#103b29" stroke="#d8bd77" strokeWidth="1.8"/>
  <circle cx="32" cy="32" r="25.2" fill="none" stroke="#ffffff" strokeOpacity=".18" strokeWidth=".8"/>
  <path d="M16 19.5c0-3 2.4-5.5 5.5-5.5h21c3 0 5.5 2.5 5.5 5.5v15c0 3-2.5 5.5-5.5 5.5H29l-8.5 6v-6.4c-2.7-.5-4.5-2.8-4.5-5.1v-15Z" fill="#f7f4e8" stroke="#e4cb8d" strokeWidth="1.1" strokeLinejoin="round"/>
  <circle cx="25" cy="27.5" r="2.3" fill="#174b32"/>
  <circle cx="32" cy="27.5" r="2.3" fill="#174b32"/>
  <circle cx="39" cy="27.5" r="2.3" fill="#174b32"/>
  <path d="M38 40h8.5c2.5 0 4.5 2 4.5 4.5v3.8l4.2 3v-7c0-4.6-3.4-8.3-8.1-8.3H38" fill="#e5c77f" stroke="#103b29" strokeWidth="1.2" strokeLinejoin="round"/>
  <circle cx="51.5" cy="12.5" r="5" fill="#c7f36a" stroke="#103b29" strokeWidth="1.8"/>
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
    <span className="gb-agent-avatar"><AgentChatMark className="gb-agent-mark"/></span><div><b>Agent</b><small>G-BEST PROPERTY ASSISTANT</small></div><button type="button" aria-label="Minimize Agent chat" onClick={()=>setMinimized(true)}>−</button><button type="button" aria-label="Close Agent chat" onClick={()=>setOpen(false)}>×</button>
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
