'use client';
import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';

const START={x:20,y:null};
export default function AgentChatWidget(){
 const pathname=usePathname();
 const [open,setOpen]=useState(false),[minimized,setMinimized]=useState(false),[position,setPosition]=useState(START),[draft,setDraft]=useState(''),[messages,setMessages]=useState([{id:'welcome',from:'agent',text:'Hello, I’m Agent — your G-BEST property assistant. Ask me about finding a property, arranging an inspection or getting started.'}]),[busy,setBusy]=useState(false),[gate,setGate]=useState(false),[authenticated,setAuthenticated]=useState(false);
 const panelRef=useRef(null),drag=useRef(null);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('gbest-agent-position-v2')||'null');if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))setPosition(saved)}catch{}},[]);
 useEffect(()=>{let active=true;fetch('/api/client-auth/session',{cache:'no-store'}).then(r=>r.json()).then(d=>{if(active)setAuthenticated(Boolean(d.authenticated))}).catch(()=>{});return()=>{active=false}},[]);
 useEffect(()=>{if(pathname?.startsWith('/admin')||pathname?.startsWith('/staff')||pathname?.startsWith('/client-login')||pathname?.startsWith('/client-registration'))setOpen(false)},[pathname]);
 if(pathname?.startsWith('/admin')||pathname?.startsWith('/staff')||pathname?.startsWith('/client-login')||pathname?.startsWith('/client-registration'))return null;
 function startDrag(e){if(e.target.closest('button'))return;drag.current={x:e.clientX,y:e.clientY,originX:position.x,originY:position.y};e.currentTarget.setPointerCapture?.(e.pointerId)}
 function moveDrag(e){if(!drag.current)return;const maxX=Math.max(8,window.innerWidth-64),maxY=Math.max(8,window.innerHeight-64);const next={x:Math.min(maxX,Math.max(8,drag.current.originX-(e.clientX-drag.current.x))),y:Math.min(maxY,Math.max(8,drag.current.originY+e.clientY-drag.current.y))};setPosition(next)}
 function endDrag(){if(!drag.current)return;drag.current=null;try{localStorage.setItem('gbest-agent-position',JSON.stringify(position))}catch{}}
 async function send(e){e.preventDefault();const text=draft.trim();if(!text||busy)return;setMessages(m=>[...m,{id:Date.now(),from:'visitor',text}]);setDraft('');setBusy(true);try{const r=await fetch('/api/client-auth/session',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error();setAuthenticated(Boolean(d.authenticated));if(!d.authenticated){setGate(true);setMessages(m=>[...m,{id:Date.now()+1,from:'agent',text:'I’d be happy to help with that. Please register as a G-BEST client before sending your message so our team can continue the conversation and keep your enquiry with your account.'}]);}else{setMessages(m=>[...m,{id:Date.now()+2,from:'agent',text:'You’re signed in. Secure client messaging is being connected to your account. In the meantime, you can request an inspection or speak with our team directly.'}]);}}catch{setMessages(m=>[...m,{id:Date.now()+3,from:'agent',text:'I couldn’t verify your client access just now. Please try again in a moment.'}])}finally{setBusy(false)}}
 return <div className="gb-agent-root" style={{right:position.x,bottom:position.y===null?20:undefined,top:position.y===null?undefined:position.y}}>
  {open&&!minimized&&<section className="gb-agent-panel" ref={panelRef} aria-label="Chat with Agent">
   <header className="gb-agent-head" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <span className="gb-agent-avatar">G<span>✦</span></span><div><b>Agent</b><small>G-BEST PROPERTY ASSISTANT</small></div><button type="button" aria-label="Minimize Agent chat" onClick={()=>setMinimized(true)}>−</button><button type="button" aria-label="Close Agent chat" onClick={()=>setOpen(false)}>×</button>
   </header>
   <div className="gb-agent-messages" aria-live="polite">{messages.map(m=><div key={m.id} className={'gb-agent-message '+m.from}>{m.from==='agent'&&<span className="gb-agent-mini">G</span>}<p>{m.text}</p></div>)}
    {gate&&<div className="gb-agent-gate"><b>One quick step before we continue</b><p>Create your free client profile, or sign in if you already have an approved account.</p><a href="/client-registration">REGISTER AS A CLIENT <span>↗</span></a><a className="gb-agent-login" href="/client-login">Already registered? Sign in</a></div>}
    {authenticated&&!gate&&<a className="gb-agent-inspect" href="/#inspection">REQUEST A PROPERTY INSPECTION ↗</a>}
   </div>
   <form className="gb-agent-compose" onSubmit={send}><input aria-label="Message Agent" value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask Agent anything…" maxLength={1200}/><button type="submit" disabled={!draft.trim()||busy} aria-label="Send message">➤</button></form>
   <footer className="gb-agent-foot">PRIVATE PROPERTY ENQUIRIES · G-BEST LUXURY REALTY</footer>
  </section>}
  {minimized&&<button className="gb-agent-minimized" onClick={()=>{setMinimized(false);setOpen(true)}}>Agent <span>↗</span></button>}
  {!minimized&&<button className={'gb-agent-launcher '+(open?'is-open':'')} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-label={open?'Close Agent assistant':'Open Agent assistant'} onClick={()=>{setOpen(v=>!v);setMinimized(false)}}><span className="gb-agent-launch-icon">{open?'×':'G'}</span>{!open&&<><span className="gb-agent-launch-copy"><b>Agent</b><small>ASK US ANYTHING</small></span><span className="gb-agent-spark">✦</span></>}</button>}
 </div>
}
