'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';

const initials=(name='Client')=>name.trim().split(/\\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const clock=(value)=>value?new Date(value).toLocaleTimeString('en-NG',{hour:'numeric',minute:'2-digit'}):'';
const dateLabel=(value)=>value?new Date(value).toLocaleDateString('en-NG',{day:'numeric',month:'short'}):'';
const ago=(value)=>{if(!value)return 'Not recently active';const m=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));return m<1?'Active just now':m<60?m+' min ago':m<1440?Math.floor(m/60)+' hr ago':Math.floor(m/1440)+' days ago';};

function DockIcon({name}){const p={width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true};return <svg {...p}>{name==='chats'?<><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6a7.5 7.5 0 1 1 17-3.5Z"/><path d="M8 10h8M8 14h5"/></>:name==='team'?<><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>:name==='activity'?<path d="M3 12h4l3-8 4 16 3-8h4"/>:<><circle cx="12" cy="12" r="3"/><path d="M19 13a7 7 0 0 0 0-2l2-1.5-2-3.5-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-4L10 6a7 7 0 0 0-1.7 1L6 6 4 9.5 6 11a7 7 0 0 0 0 2l-2 1.5L6 18l2.3-1a7 7 0 0 0 1.7 1l.5 3h4l.5-3a7 7 0 0 0 1.7-1l2.3 1 2-3.5Z"/></>}</svg>}

export default function AdminClientChatPage(){
 const [items,setItems]=useState([]),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[tenants,setTenants]=useState([]),[staff,setStaff]=useState([]),[tenantId,setTenantId]=useState(''),[tab,setTab]=useState('chats'),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[showInfo,setShowInfo]=useState(false);
 const openRequest=useRef(0),messageScrollRef=useRef(null),fileInputRef=useRef(null);
 const [pendingFiles,setPendingFiles]=useState([]),[soundEnabled,setSoundEnabled]=useState(true);
 const soundRef=useRef(true),lastSeenMessage=useRef('');
 useEffect(()=>{soundRef.current=soundEnabled},[soundEnabled]);
 function playTone(kind){if(!soundRef.current||typeof window==='undefined')return;try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const x=new A(),o=x.createOscillator(),g=x.createGain();o.connect(g);g.connect(x.destination);o.type='sine';o.frequency.value=kind==='incoming'?880:740;g.gain.setValueAtTime(.0001,x.currentTime);g.gain.exponentialRampToValueAtTime(.07,x.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,x.currentTime+.16);o.start();o.stop(x.currentTime+.18);o.onended=()=>x.close()}catch{}}
 const load=useCallback(async()=>{try{const r=await fetch('/api/admin/client-chat'+(tenantId?'?tenantId='+encodeURIComponent(tenantId):''),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load conversations');setItems(d.conversations||[]);setTenants(d.tenants||[]);setStaff(d.staff||[]);if(d.activeTenantId&&String(d.activeTenantId)!==tenantId)setTenantId(String(d.activeTenantId));if(selected&&!(d.conversations||[]).some(x=>x.id===selected)){setSelected('');setDetail(null)}}catch(e){setError(e.message)}},[tenantId,selected]);
 const open=useCallback(async(id)=>{const request=++openRequest.current;setSelected(id);setDetail(null);setPendingFiles([]);if(fileInputRef.current)fileInputRef.current.value='';setError('');setNotice('');try{const q=new URLSearchParams({conversationId:id});if(tenantId)q.set('tenantId',tenantId);const r=await fetch('/api/admin/client-chat?'+q.toString(),{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not open conversation');if(request!==openRequest.current)return;setDetail(d);lastSeenMessage.current=d.messages?.[d.messages.length-1]?.id||'';await fetch('/api/admin/client-chat',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:id,tenantId:tenantId||undefined,action:'read'})});if(request===openRequest.current)setItems(old=>old.map(x=>x.id===id?{...x,unread_count:0}:x))}catch(e){if(request===openRequest.current){setSelected('');setDetail(null);setError(e.message)}}},[tenantId]);
 useEffect(()=>{load()},[load]);
 useEffect(()=>{const node=messageScrollRef.current;if(node)node.scrollTop=node.scrollHeight},[detail?.messages?.length,selected,showInfo]);
 useEffect(()=>{const timer=setInterval(load,15000);return()=>clearInterval(timer)},[load]);
 useEffect(()=>{if(!selected||!detail)return;let live=true;const poll=async()=>{try{const q=new URLSearchParams({conversationId:selected});if(tenantId)q.set('tenantId',tenantId);const r=await fetch('/api/admin/client-chat?'+q,{cache:'no-store'}),d=await r.json();if(!live||!r.ok)return;const ms=d.messages||[],last=ms[ms.length-1];if(last?.id&&lastSeenMessage.current&&last.id!==lastSeenMessage.current&&last.sender_type==='client')playTone('incoming');if(last?.id)lastSeenMessage.current=last.id;setDetail(old=>old?.conversation?.id===selected?d:old)}catch{}};const t=setInterval(poll,7000);return()=>{live=false;clearInterval(t)}},[selected,tenantId,Boolean(detail)]);
 const visible=useMemo(()=>items.filter(x=>{const q=search.toLowerCase();const match=!q||[x.full_name,x.email,x.client_id,x.last_message].some(v=>String(v||'').toLowerCase().includes(q));const f=filter==='unread'?Number(x.unread_count)>0:filter==='assigned'?!!x.assigned_staff_id:filter==='unassigned'?!x.assigned_staff_id:true;return match&&f}),[items,search,filter]);
 const online=staff.filter(s=>s.presence==='online');
 const activity=useMemo(()=>[...items].sort((a,b)=>new Date(b.last_message_at||b.updated_at||0)-new Date(a.last_message_at||a.updated_at||0)),[items]);
 async function send(e){
  e.preventDefault();
  if((!draft.trim()&&!pendingFiles.length)||!selected||busy)return;
  setBusy(true);setError('');
  try{
   const attachments=[];
   for(const file of pendingFiles){
    const base={conversationId:selected,tenantId:tenantId||undefined,fileName:file.name,mimeType:file.type,fileSize:file.size};
    const presign=await fetch('/api/admin/client-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,action:'attachment-presign'})});
    const uploadData=await presign.json();if(!presign.ok)throw Error(uploadData.error||'Could not prepare this attachment');
    const uploaded=await fetch(uploadData.upload.url,{method:'PUT',headers:uploadData.upload.headers,body:file});
    if(!uploaded.ok)throw Error('The file upload failed. Please try again.');
    const complete=await fetch('/api/admin/client-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,action:'attachment-complete',objectKey:uploadData.objectKey})});
    const completed=await complete.json();if(!complete.ok)throw Error(completed.error||'Could not verify this attachment');
    attachments.push(completed.attachment);
   }
   const r=await fetch('/api/admin/client-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:selected,tenantId:tenantId||undefined,message:draft.trim(),attachments})});
   const d=await r.json();if(!r.ok)throw Error(d.error||'Reply failed');
   setDraft('');setPendingFiles([]);if(fileInputRef.current)fileInputRef.current.value='';playTone('sent');
   await open(selected);await load();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function action(actionName,staffId){if(!selected)return;setBusy(true);setError('');try{const body={conversationId:selected,tenantId:tenantId||undefined,action:actionName};if(staffId!==undefined)body.staffId=staffId||null;const r=await fetch('/api/admin/client-chat',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not update conversation');await open(selected);await load();setNotice(actionName==='assign'?'Conversation assignment updated.':actionName==='close'?'Conversation closed.':actionName==='reopen'?'Conversation reopened.':'Conversation updated.')}catch(e){setError(e.message)}finally{setBusy(false)}}
 const active=items.find(x=>x.id===selected);
 const startNew=()=>{setPendingFiles([]);if(fileInputRef.current)fileInputRef.current.value='';setTab('chats');setSelected('');setDetail(null);setNotice('Choose a conversation from your inbox to start replying.')};
 return <main className="gb-ios-chat">
  <header className="gb-chat-top"><a className="gb-chat-brand" href="/admin/super/overview"><span className="gb-brand-mark">G</span><span><b>G-BEST</b><small>MESSAGES</small></span></a><div className="gb-top-actions">{tenants.length>1&&<select aria-label="Company workspace" value={tenantId} onChange={e=>{setTenantId(e.target.value);setSelected('');setDetail(null);setPendingFiles([]);if(fileInputRef.current)fileInputRef.current.value=''}}>{tenants.map(t=><option key={t.id} value={t.id}>{t.display_name}</option>)}</select>}<span className="gb-admin-pill"><i/> Admin</span><a href="/admin/super/overview" className="gb-top-link">Control room</a></div></header>
  <div className="gb-chat-app">
   <aside className={'gb-chat-sidebar '+(selected?'gb-mobile-hide':'')}>
    <div className="gb-sidebar-title"><div><h1>{tab==='chats'?'Chats':tab==='team'?'Team':tab==='activity'?'Activity':'Settings'}</h1><p>{tab==='chats'?'Private client conversations':tab==='team'?'Staff availability and assignments':tab==='activity'?'Recent client communication':'Messaging workspace'}</p></div>{tab==='chats'&&<button className="gb-icon-btn" onClick={startNew} aria-label="New conversation">＋</button>}</div>
    {tab==='chats'&&<><label className="gb-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients or messages"/></label><div className="gb-filter-row">{[['all','All'],['unread','Unread'],['assigned','Assigned'],['unassigned','Unassigned']].map(([v,l])=><button key={v} onClick={()=>setFilter(v)} className={filter===v?'active':''}>{l}</button>)}</div><div className="gb-inbox-meta"><span>MESSAGES</span><span>{items.length} conversations</span></div><div className="gb-thread-list">{visible.length===0?<div className="gb-empty"><span>◎</span><b>No conversations found</b><small>New client messages will appear here.</small></div>:visible.map(x=><button key={x.id} className={'gb-thread '+(selected===x.id?'selected':'')} onClick={()=>open(x.id)}><span className="gb-avatar-wrap"><span className="gb-avatar">{x.client_avatar_url?<img src={x.client_avatar_url} alt=""/>:initials(x.full_name)}</span><i className={x.client_presence==='online'?'is-online':''}/></span><span className="gb-thread-copy"><span className="gb-thread-line"><b>{x.full_name}</b><time>{clock(x.last_message_at||x.updated_at)}</time></span><span className="gb-thread-preview">{x.last_message||'Conversation opened'}</span><span className="gb-thread-id">{x.client_id||x.email||'G-BEST client'}{x.assigned_staff_name?' · '+x.assigned_staff_name:''}</span></span>{Number(x.unread_count)>0&&<i className="gb-unread">{x.unread_count}</i>}</button>)}{visible.length>0&&<div className="gb-inbox-note"><span>✦</span><div><b>Your inbox is up to date</b><small>New client messages appear here automatically. This inbox refreshes every 30 seconds.</small></div></div>}</div></>}
    {tab==='team'&&<div className="gb-team-list"><div className="gb-presence-summary"><b>{online.length} online</b><span>{staff.length} team members</span></div>{staff.length===0?<div className="gb-empty"><b>No team members yet</b><small>Active staff accounts will appear here.</small></div>:staff.map(s=><div className="gb-team-row" key={s.id}><span className="gb-avatar">{s.avatar_url?<img src={s.avatar_url} alt=""/>:initials(s.full_name)}</span><span><b>{s.full_name}</b><small><i className={s.presence==='online'?'online':''}/>{s.presence==='online'?'Available now':'Offline'} · {s.assigned_count||0} chats</small></span></div>)}</div>}
    {tab==='activity'&&<div className="gb-activity-screen"><div className="gb-activity-overview"><div><small>CLIENT COMMUNICATION</small><b>{activity.length}</b><span>Total conversations</span></div><div><small>CLIENTS ONLINE</small><b>{activity.filter(x=>x.client_presence==='online').length}</b><span>Active right now</span></div><div><small>UNREAD</small><b>{items.reduce((n,x)=>n+Number(x.unread_count||0),0)}</b><span>Awaiting your team</span></div></div><div className="gb-activity-heading"><div><h2>Recent conversations</h2><p>Latest client messages and account activity</p></div><button type="button" onClick={()=>{setTab('chats');setFilter('all')}}>Open inbox ↗</button></div>{activity.length===0?<div className="gb-empty"><b>No activity yet</b><small>New client conversations will appear here.</small></div>:<div className="gb-activity-list">{activity.map(x=><button key={x.id} className="gb-activity-row" onClick={()=>open(x.id)}><span className="gb-activity-avatar">{x.client_avatar_url?<img src={x.client_avatar_url} alt=""/>:initials(x.full_name)}<i className={x.client_presence==='online'?'is-online':''}/></span><span className="gb-activity-copy"><span className="gb-activity-line"><b>{x.full_name}</b><time>{dateLabel(x.last_message_at||x.updated_at)} · {clock(x.last_message_at||x.updated_at)}</time></span><small>{x.last_message||'Conversation updated'}</small><span className="gb-activity-meta"><i className={x.client_presence==='online'?'is-online':''}/>{x.client_presence==='online'?'Online now':x.client_presence==='away'?'Recently active':'Offline'}{Number(x.unread_count)>0?' · '+x.unread_count+' unread':''}</span></span><span className="gb-activity-arrow">›</span></button>)}</div>}</div>}
    {tab==='settings'&&<div className="gb-settings-list">
      <div className="gb-settings-intro"><div><span className="gb-settings-kicker">WORKSPACE PREFERENCES</span><h2>Messaging, organised.</h2><p>Manage how your team receives and handles client conversations.</p></div><span className="gb-settings-live"><i/> WORKSPACE ACTIVE</span></div>
      <section className="gb-settings-group"><div className="gb-settings-group-title"><span>01</span><div><h3>Workspace</h3><p>Your messaging environment and live activity</p></div></div><div className="gb-settings-card-grid">
       <article className="gb-settings-card"><span className="gb-settings-icon">⌂</span><div><small>COMPANY WORKSPACE</small><b>G-BEST Luxury Realty</b><p>Private client conversations for your team.</p></div><span className="gb-settings-card-tag">ACTIVE</span></article>
       <article className="gb-settings-card"><span className="gb-settings-icon">↻</span><div><small>LIVE SYNCHRONISATION</small><b>Automatic refresh</b><p>Inbox every 15 seconds · Open chats every 7 seconds.</p></div><span className="gb-settings-card-tag">ON</span></article>
      </div></section>
      <section className="gb-settings-group"><div className="gb-settings-group-title"><span>02</span><div><h3>Notifications</h3><p>Stay aware of client activity without missing a reply</p></div></div>
       <article className="gb-settings-card gb-settings-sound"><span className="gb-settings-icon">♫</span><div><small>MESSAGE AUDIO</small><b>Message sounds</b><p>Play a tone when a new client message arrives or when your reply is sent.</p></div><button className={'gb-sound-toggle '+(soundEnabled?'is-on':'')} type="button" aria-pressed={soundEnabled} onClick={()=>{const next=!soundEnabled;soundRef.current=next;setSoundEnabled(next);if(next)playTone('sent')}}><span className="gb-sound-toggle-dot"/>{soundEnabled?'Sounds on':'Enable sounds'}</button></article>
      </section>
      <section className="gb-settings-group"><div className="gb-settings-group-title"><span>03</span><div><h3>Team & support</h3><p>Know who is available and return to administration</p></div></div><div className="gb-settings-card-grid">
       <article className="gb-settings-card"><span className="gb-settings-icon">◎</span><div><small>TEAM PRESENCE</small><b>{online.length} team members online</b><p>{staff.length} team members in this workspace.</p></div><span className="gb-settings-card-tag">{online.length?'LIVE':'QUIET'}</span></article>
       <a className="gb-settings-card gb-settings-return" href="/admin/super/overview"><span className="gb-settings-icon">↗</span><div><small>ADMINISTRATION</small><b>Return to Control Room</b><p>Manage properties, inspections, clients and company settings.</p></div><span className="gb-settings-arrow">→</span></a>
      </div></section>
      <div className="gb-settings-footnote">G-BEST MESSAGING <span>·</span> Workspace preferences</div>
     </div>}
   </aside>
   <section className={'gb-chat-main '+(selected?'gb-mobile-show':'')}>
    {!detail?<><div className="gb-welcome"><span className="gb-welcome-icon">✉</span><h2>Your messages, in one place.</h2><p>Select a client conversation to read, reply, or manage its assignment.</p><div className="gb-welcome-stats"><span><b>{items.length}</b><small>Conversations</small></span><span><b>{items.filter(x=>Number(x.unread_count)>0).length}</b><small>Unread</small></span><span><b>{online.length}</b><small>Team online</small></span></div></div>{selected&&<div className="gb-chat-loading" role="status"><span className="gb-loading-dot"/>Loading conversation…</div>}</>:<>
     <div className="gb-conversation-head"><button className="gb-back-btn" onClick={()=>{openRequest.current++;setSelected('');setDetail(null);setShowInfo(false);setPendingFiles([]);if(fileInputRef.current)fileInputRef.current.value=''}} aria-label="Back to chats">‹</button><span className="gb-avatar-wrap gb-head-avatar"><span className="gb-avatar">{detail.conversation.client_avatar_url?<img src={detail.conversation.client_avatar_url} alt=""/>:initials(detail.conversation.full_name)}</span><i className={detail.conversation.client_presence==='online'?'is-online':''}/></span><button className="gb-person-title" onClick={()=>setShowInfo(v=>!v)}><b>{detail.conversation.full_name}</b><small>{detail.conversation.email||detail.conversation.client_id||'G-BEST client'} · {detail.conversation.client_presence==='online'?'Online now':detail.conversation.client_presence==='away'?'Recently active':'Offline'}</small></button><span className="gb-status-chip">{detail.conversation.status==='open'?'Open':'Closed'}</span><button className="gb-icon-btn gb-info-toggle" onClick={()=>setShowInfo(v=>!v)} aria-label="Conversation details">ⓘ</button></div>
     {showInfo&&<div className="gb-info-panel"><div><small>CLIENT ID</small><b>{detail.conversation.client_id||'—'}</b></div><div><small>PHONE</small><b>{detail.conversation.phone||'Not provided'}</b></div><div><small>CONVERSATION OWNER</small><b>{detail.conversation.assigned_staff_name||'Agent assistant'}</b></div><div className="gb-assignment-title"><small>HUMAN ASSIGNMENT</small></div><label>ASSIGN TEAM MEMBER<select value={detail.conversation.assigned_staff_id||''} onChange={e=>action('assign',e.target.value)} disabled={busy}><option value="">Agent assistant · No human assigned</option>{detail.conversation.assigned_staff_id&&!online.some(s=>String(s.id)===String(detail.conversation.assigned_staff_id))&&<option value={detail.conversation.assigned_staff_id} disabled>{detail.conversation.assigned_staff_name||'Assigned colleague'} · Offline</option>}{online.map(s=><option key={s.id} value={s.id}>{s.full_name} · Online</option>)}</select></label>{detail.conversation.assigned_staff_phone_number&&<a className="gb-whatsapp-link" href={'https://wa.me/'+String(detail.conversation.assigned_staff_phone_number).replace(/\D/g,'')} target="_blank" rel="noreferrer">WHATSAPP</a>}</div>}
     <div className="gb-message-scroll" ref={messageScrollRef}>{detail.messages.map((m,i)=><div key={m.id} className={'gb-message-row '+(m.sender_type==='client'?'incoming':'outgoing')}><div className="gb-message-bubble"><small>{m.sender_type==='client'?'CLIENT':m.sender_type==='staff'?'TEAM':'G-BEST'}</small><p>{m.body}</p>{Array.isArray(m.attachments)&&m.attachments.length>0&&<div className="gb-message-attachments">{m.attachments.map((a,i)=><a key={a.objectKey||i} href={a.url} target="_blank" rel="noreferrer">{a.kind==='image'?<img src={a.url} alt={a.fileName||'Chat attachment'}/>:<span>{a.kind==='video'?'▶':a.kind==='audio'?'♫':'PDF'}</span>}<small>{a.fileName||'Open attachment'}</small></a>)}</div>}<div className="gb-message-foot"><time>{clock(m.created_at)}</time>{m.sender_type!=='client'&&<span className={'gb-read-state '+(m.read_at?'is-seen':'')}>{m.read_at?'✓✓ Seen':'✓ Sent'}</span>}</div></div></div>)}{detail.messages.length===0&&<div className="gb-empty"><b>No messages yet</b><small>Send the first reply to this client.</small></div>}</div>
     {notice&&<p className="gb-notice">{notice}</p>}
     <div className="gb-conversation-tools"><span>{detail.conversation.assigned_staff_name?'Assigned to '+detail.conversation.assigned_staff_name:'Not assigned to a staff member'}</span><div>{detail.conversation.handoff_status==='requested'&&!detail.conversation.assigned_staff_id&&<button onClick={()=>action('claim')} disabled={busy}>CLAIM WAITING CHAT</button>}<button onClick={()=>action(detail.conversation.status==='open'?'close':'reopen')} disabled={busy}>{detail.conversation.status==='open'?'Close chat':'Reopen chat'}</button></div></div>
     {pendingFiles.length>0&&<div className="gb-pending-files">{pendingFiles.map((file,i)=><span key={file.name+i}>{file.name}<button type="button" onClick={()=>setPendingFiles(old=>old.filter((_,n)=>n!==i))} aria-label={'Remove '+file.name}>×</button></span>)}</div>}
     <form className="gb-composer" onSubmit={send}><input ref={fileInputRef} className="gb-file-input" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,video/mp4,video/webm" onChange={e=>{const next=Array.from(e.target.files||[]);setPendingFiles(old=>[...old,...next].slice(0,5));e.target.value=''}}/><button className="gb-attach" type="button" onClick={()=>fileInputRef.current?.click()} disabled={detail.conversation.status!=='open'||busy} aria-label="Attach files" title="Attach photos, documents, audio or video">＋</button><textarea value={draft} onChange={e=>setDraft(e.target.value)} maxLength={4000} rows={1} placeholder={detail.conversation.status==='open'?'Message…':'Reopen this chat to reply'} disabled={detail.conversation.status!=='open'||busy}/><button type="submit" disabled={busy||(!draft.trim()&&!pendingFiles.length)||detail.conversation.status!=='open'} aria-label="Send message">➤</button></form>
    </>}
   </section>
  </div>
  <nav className={"gb-bottom-dock"+(selected?" gb-dock-chat-open":"")} aria-label="Messaging navigation" aria-hidden={Boolean(selected)}>{[['chats','Chats'],['team','Team'],['activity','Activity'],['settings','Settings']].map(([id,label])=><button type="button" key={id} className={tab===id?'active':''} aria-current={tab===id?'page':undefined} aria-label={label} onClick={()=>{openRequest.current++;setTab(id);setSelected('');setDetail(null);setShowInfo(false)}}><span className="gb-dock-icon"><DockIcon name={id}/></span><small>{label}</small></button>)}</nav>
  {error&&<div className="gb-toast" role="alert">{error}<button onClick={()=>setError('')}>×</button></div>}
  <style jsx>{`
  .gb-ios-chat{--forest:#174b32;--deep:#0e3826;--lime:#c8e79b;--paper:#f5f7f2;--line:#e4e9e1;height:calc(100dvh - 66px);min-height:calc(100dvh - 66px);max-height:calc(100dvh - 66px);box-sizing:border-box;overflow:hidden;background:#edf1eb;color:#192d21;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;padding:0}
  .gb-chat-top{height:66px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid var(--line)}
  .gb-chat-brand{display:flex;align-items:center;gap:10px;color:var(--forest);text-decoration:none}.gb-brand-mark{width:34px;height:34px;border-radius:11px;background:var(--forest);color:white;display:grid;place-items:center;font-weight:900;font-size:20px;box-shadow:0 3px 0 #0a2e1d}.gb-chat-brand b{display:block;font-size:13px;letter-spacing:.1em}.gb-chat-brand small{display:block;font-size:9px;color:#7b887e;letter-spacing:.18em;margin-top:3px}.gb-top-actions{display:flex;align-items:center;gap:14px}.gb-top-actions select{border:1px solid var(--line);border-radius:10px;padding:8px;background:#fff;color:var(--forest)}.gb-admin-pill{font-size:10px;font-weight:800;color:var(--forest);background:#eff6e8;padding:9px 13px;border-radius:20px}.gb-admin-pill i,.gb-team-row i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#9aa69b;margin-right:6px}.gb-admin-pill i{background:#91c45c}.gb-top-link{font-size:11px;color:#66756a}
  .gb-chat-app{display:grid;grid-template-columns:370px minmax(0,1fr);max-width:1440px;height:calc(100dvh - 240px);min-height:420px;margin:22px auto 0;padding:0 22px;gap:16px}.gb-chat-sidebar,.gb-chat-main{background:#fff;border:1px solid #e0e7dd;border-radius:18px;overflow:hidden;box-shadow:0 8px 26px #173b2b0a;min-width:0}.gb-chat-sidebar{display:flex;flex-direction:column}.gb-sidebar-title{padding:22px 20px 15px;display:flex;align-items:center;justify-content:space-between}.gb-sidebar-title h1{font-size:25px;margin:0;font-weight:750;letter-spacing:-.04em}.gb-sidebar-title p{margin:5px 0 0;color:#859087;font-size:11px}.gb-icon-btn{width:36px;height:36px;border:0;border-radius:50%;background:#eff5e9;color:var(--forest);font-size:21px;display:grid;place-items:center}.gb-search{margin:0 16px 12px;background:#f1f4ef;border-radius:10px;height:40px;display:flex;align-items:center;padding:0 11px;gap:8px;color:#839087}.gb-search span{font-size:22px}.gb-search input{border:0;outline:0;background:transparent;width:100%;font-size:12px;color:#263b2d}.gb-filter-row{display:flex;gap:6px;padding:0 16px 13px;overflow:auto}.gb-filter-row button{border:1px solid #e4eae2;border-radius:18px;padding:7px 10px;background:#fff;color:#6d7a70;font-size:10px;white-space:nowrap}.gb-filter-row button.active{background:var(--forest);color:#fff;border-color:var(--forest)}.gb-inbox-meta{display:flex;justify-content:space-between;padding:12px 18px;border-top:1px solid #edf0eb;border-bottom:1px solid #edf0eb;color:#879188;font-size:9px;letter-spacing:.1em}.gb-inbox-meta span:last-child{letter-spacing:0}.gb-thread-list,.gb-team-list,.gb-activity-list{overflow:auto;flex:1}.gb-thread{width:100%;border:0;border-bottom:1px solid #edf0eb;background:#fff;display:flex;align-items:center;gap:11px;text-align:left;padding:14px 16px;cursor:pointer;color:#24382a}.gb-thread:hover,.gb-thread.selected{background:#f2f7ef}.gb-avatar{width:43px;height:43px;flex:0 0 43px;border-radius:50%;display:grid;place-items:center;background:#e4eddf;color:var(--forest);font-weight:800;font-size:13px;overflow:hidden}.gb-avatar img{width:100%;height:100%;object-fit:cover}.gb-thread-copy{min-width:0;flex:1}.gb-thread-line{display:flex;justify-content:space-between;gap:8px;align-items:center}.gb-thread-line b{font-size:12px}.gb-thread-line time,.gb-thread-id{font-size:9px;color:#8b968d}.gb-thread-preview{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#68776c;margin:5px 0 4px}.gb-thread-id{display:block}.gb-unread{font-style:normal;background:#2e754a;color:white;border-radius:20px;min-width:19px;height:19px;display:grid;place-items:center;font-size:9px}
  .gb-chat-main{display:flex;flex-direction:column;position:relative}.gb-welcome{margin:auto;text-align:center;padding:30px;max-width:430px}.gb-welcome-icon{display:grid;place-items:center;margin:0 auto 18px;width:62px;height:62px;border-radius:20px;background:#eff6e9;color:var(--forest);font-size:28px}.gb-welcome h2{font-size:23px;letter-spacing:-.04em;margin:0 0 8px}.gb-welcome p{font-size:12px;line-height:1.6;color:#849087}.gb-welcome-stats{display:flex;justify-content:center;gap:28px;margin-top:30px}.gb-welcome-stats span{display:grid;gap:4px}.gb-welcome-stats b{font-size:19px;color:var(--forest)}.gb-welcome-stats small{font-size:9px;color:#879188}.gb-conversation-head{height:74px;display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid #e9eee7}.gb-person-title{border:0;background:none;text-align:left;display:grid;gap:4px;flex:1;min-width:0}.gb-person-title b{font-size:13px;color:#263b2d}.gb-person-title small{font-size:10px;color:#89948b;overflow:hidden;text-overflow:ellipsis}.gb-status-chip{border-radius:20px;background:#edf6e8;color:#47764a;font-size:9px;padding:7px 10px}.gb-back-btn{display:none;border:0;background:transparent;color:var(--forest);font-size:28px}.gb-info-toggle{font-size:16px}.gb-info-panel{display:flex;flex-wrap:wrap;gap:18px;padding:13px 18px;background:#f7faf5;border-bottom:1px solid #e7ede4}.gb-info-panel>div{display:grid;gap:4px}.gb-info-panel small{font-size:8px;color:#89958b;letter-spacing:.1em}.gb-info-panel b{font-size:10px;color:#304535}.gb-info-panel label{display:flex;align-items:center;gap:8px;font-size:10px;color:#718075}.gb-info-panel select{border:1px solid #dce5d9;border-radius:8px;padding:8px;background:white;color:#263b2d;font-size:10px}.gb-assignment-title{flex-basis:100%;padding-top:5px;border-top:1px solid #e7ede4}.gb-whatsapp-link{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 13px;border-radius:9px;background:#e8f6e9;color:#176b37;font-size:9px;font-weight:850;letter-spacing:.06em;text-decoration:none}.gb-message-scroll{flex:1;overflow:auto;padding:24px clamp(14px,4vw,42px);background-color:#f6f8f4;background-image:radial-gradient(#dbe5d8 0.7px,transparent .7px);background-size:18px 18px}.gb-message-row{display:flex;margin:8px 0}.gb-message-row.incoming{justify-content:flex-start}.gb-message-row.outgoing{justify-content:flex-end}.gb-message-bubble{max-width:min(76%,560px);padding:11px 13px 8px;border-radius:15px;box-shadow:0 2px 5px #163b250a}.incoming .gb-message-bubble{background:#fff;border:1px solid #e7ece5;border-bottom-left-radius:4px;color:#26392c}.outgoing .gb-message-bubble{background:#dff0d6;border:1px solid #d4e7ca;border-bottom-right-radius:4px;color:#24412d}.gb-message-bubble>small{font-size:8px;font-weight:800;letter-spacing:.09em;opacity:.62}.gb-message-bubble p{font-size:13px;line-height:1.55;margin:5px 0;white-space:pre-wrap;overflow-wrap:anywhere}.gb-message-bubble time{display:block;text-align:right;font-size:8px;color:#829087}.gb-conversation-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 16px;border-top:1px solid #edf0eb;color:#859087;font-size:9px}.gb-conversation-tools>div{display:flex;gap:7px}.gb-conversation-tools button{border:1px solid #dce6d9;background:#fff;border-radius:8px;color:#45624b;padding:7px 10px;font-size:9px}.gb-composer{display:flex;align-items:flex-end;gap:10px;padding:13px 16px 16px;border-top:1px solid #e9eee7;background:#fff}.gb-composer textarea{flex:1;min-width:0;resize:none;max-height:110px;border:1px solid #dfe7dc;border-radius:20px;padding:12px 15px;outline:none;background:#f7f9f6;font:13px -apple-system,BlinkMacSystemFont,sans-serif;color:#24382a}.gb-composer textarea:focus{border-color:#9dbb91}.gb-composer button{width:42px;height:42px;flex:0 0 42px;border:0;border-radius:50%;background:var(--forest);color:#fff;font-size:17px}.gb-composer button:disabled{opacity:.35}.gb-notice{margin:6px 14px 0;padding:8px 12px;border-radius:8px;background:#eff7e9;color:#416c43;font-size:10px}
  .gb-bottom-dock{position:fixed;z-index:40;left:50%;right:auto;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(440px,calc(100vw - 28px));min-height:72px;padding:9px 10px;display:flex;justify-content:space-between;align-items:center;gap:7px;border:1px solid #ffffff55;border-radius:27px;background:linear-gradient(155deg,#2b3b31,#17271e 48%,#0b1510);backdrop-filter:blur(26px) saturate(155%);-webkit-backdrop-filter:blur(26px) saturate(155%);box-shadow:0 22px 48px #102d1d42,0 7px 16px #0b241735,inset 0 2px 3px #ffffff35,inset 0 -6px 12px #0008;isolation:isolate}.gb-bottom-dock:before{content:"";position:absolute;inset:1px 12px auto;height:1px;border-radius:99px;background:linear-gradient(90deg,transparent,#ffffffa8,transparent);pointer-events:none}.gb-bottom-dock button{position:relative;z-index:1;flex:1;min-width:0;min-height:54px;padding:6px 5px;border:1px solid transparent;border-radius:19px;background:transparent;color:#d0ded3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:transform .2s ease,background .2s ease,box-shadow .2s ease,color .2s ease;-webkit-tap-highlight-color:transparent}.gb-bottom-dock button .gb-dock-icon{width:36px;height:31px;display:grid;place-items:center;border-radius:12px;color:inherit}.gb-bottom-dock button small{font-size:9px;line-height:1;font-weight:650;letter-spacing:.015em;color:inherit;opacity:.82}.gb-bottom-dock button.active{transform:translateY(-5px);color:#173a27;background:linear-gradient(145deg,#efffd0,#c9ed91 48%,#9dc66c);border-color:#f5ffdf;box-shadow:0 9px 17px #0006,inset 0 2px 2px #ffffffd9,inset 0 -3px 4px #6c963c80}.gb-bottom-dock button.active small{opacity:1;font-weight:800}.gb-bottom-dock button:focus-visible{outline:2px solid #d8f6a7;outline-offset:3px}.gb-bottom-dock button:active{transform:translateY(-2px) scale(.97)}
  @media(max-width:760px){.gb-ios-chat{padding-bottom:calc(104px + env(safe-area-inset-bottom));background:#fff}.gb-chat-top{height:56px;padding:0 14px}.gb-top-link{display:none}.gb-admin-pill{padding:7px 10px;font-size:9px}.gb-chat-app{display:block;height:calc(100dvh - 122px);min-height:0;margin:0;padding:0;gap:0}.gb-chat-sidebar,.gb-chat-main{height:100%;border:0;border-radius:0;box-shadow:none}.gb-chat-sidebar{border-bottom:1px solid #e8ede6}.gb-sidebar-title{padding:18px 17px 14px}.gb-sidebar-title h1{font-size:27px}.gb-thread{padding:14px 16px}.gb-chat-main{display:none}.gb-chat-main.gb-mobile-show{display:flex;height:100%;min-height:0}.gb-chat-sidebar.gb-mobile-hide{display:none}.gb-back-btn{display:block}.gb-conversation-head{height:64px;padding:0 11px;gap:8px}.gb-conversation-head .gb-avatar{width:38px;height:38px;flex-basis:38px}.gb-status-chip{font-size:8px;padding:6px 8px}.gb-info-toggle{width:30px;height:30px}.gb-message-scroll{padding:16px 12px}.gb-message-bubble{max-width:88%;padding:10px 12px}.gb-message-bubble p{font-size:13px}.gb-composer{padding:10px 11px calc(10px + env(safe-area-inset-bottom))}.gb-composer textarea{font-size:16px;min-height:42px}.gb-conversation-tools{padding:8px 11px}.gb-conversation-tools>span{max-width:45%;line-height:1.4}.gb-conversation-tools button{font-size:8px;padding:7px}.gb-info-panel{padding:10px 12px;gap:12px}.gb-info-panel label{width:100%;justify-content:space-between}.gb-bottom-dock{bottom:max(12px,env(safe-area-inset-bottom));width:min(440px,calc(100vw - 24px));min-height:70px;padding:8px 9px}.gb-bottom-dock button{min-width:0;flex:1}.gb-welcome{display:none}.gb-toast{bottom:calc(75px + env(safe-area-inset-bottom))}}
  @media(min-width:761px){.gb-back-btn{display:none}}

  /* Mobile conversation workspace: reserve a real footer lane for the floating dock. */
  @media(max-width:760px){
   .gb-ios-chat{height:calc(100dvh - 60px);min-height:calc(100dvh - 60px);max-height:calc(100dvh - 60px);display:flex;flex-direction:column;overflow:hidden;padding:0!important;box-sizing:border-box;background:#f5f7f3}
   .gb-chat-top{height:56px;min-height:56px;flex:0 0 56px;padding:0 14px;position:relative;z-index:2}
   .gb-chat-brand b{font-size:12px}.gb-chat-brand small{font-size:8px}
   .gb-top-actions{gap:8px}.gb-top-actions select{max-width:42vw;min-width:0;font-size:11px}.gb-admin-pill{display:none}.gb-top-link{display:inline-flex;font-size:10px;white-space:nowrap}
   .gb-chat-app{display:block;flex:1 1 auto;min-height:0;height:auto!important;margin:0!important;padding:0 0 82px!important;overflow:hidden;box-sizing:border-box}
   .gb-chat-sidebar,.gb-chat-main{height:100%!important;min-height:0!important;max-height:100%;border:0;border-radius:0;box-shadow:none}
   .gb-chat-sidebar{display:flex;flex-direction:column;overflow:hidden}
   .gb-sidebar-title{padding:17px 17px 12px;flex:0 0 auto}.gb-sidebar-title h1{font-size:25px;color:#172b20}.gb-sidebar-title p{font-size:11px;line-height:1.4;color:#657568}
   .gb-search{height:44px;min-height:44px;margin:0 15px 11px;background:#eef2ec!important;border:1px solid #e0e8de;border-radius:13px;color:#758579}
   .gb-search input,.gb-search input:focus{height:100%;min-width:0;background:transparent!important;color:#1e3426!important;border:0!important;box-shadow:none!important;outline:none!important;font-size:16px!important;-webkit-appearance:none}
   .gb-filter-row{padding:0 15px 12px;gap:7px}.gb-filter-row button{font-size:11px;padding:8px 12px}
   .gb-inbox-meta{padding:11px 17px;font-size:9px;color:#6f7d72}
   .gb-thread-list,.gb-team-list,.gb-activity-list{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}
   .gb-thread{padding:14px 16px;min-height:78px}.gb-thread-line b{font-size:13px}.gb-thread-preview{font-size:12px}.gb-thread-id{font-size:10px}
   .gb-empty{min-height:180px;align-content:center;padding:28px 22px;color:#344a39}.gb-empty b{font-size:13px;color:#263b2d}.gb-empty small{font-size:11px;color:#718075;line-height:1.5}
   .gb-chat-main{display:none;flex-direction:column;overflow:hidden;background:#f6f8f4}
   .gb-chat-main.gb-mobile-show{display:flex;height:100%!important;min-height:0!important}
   .gb-conversation-head{height:62px;min-height:62px;flex:0 0 62px;padding:0 11px;gap:8px;background:#fff}
   .gb-back-btn{display:grid;place-items:center;width:32px;height:38px;font-size:30px;flex:0 0 32px}
   .gb-conversation-head .gb-avatar{width:36px;height:36px;flex:0 0 36px}
   .gb-person-title{gap:3px}.gb-person-title b{font-size:13px;line-height:1.2;color:#203729}.gb-person-title small{font-size:10px;max-width:45vw;color:#718075}
   .gb-status-chip{font-size:9px;padding:6px 8px;white-space:nowrap}.gb-info-toggle{width:32px;height:32px;flex:0 0 32px}
   .gb-info-panel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:12px;background:#f7faf5;flex:0 0 auto}
   .gb-info-panel>div{min-width:0;gap:5px}.gb-info-panel small{font-size:8px;letter-spacing:.12em;color:#77867a}.gb-info-panel b{font-size:11px;line-height:1.35;overflow-wrap:anywhere;color:#263d2d}
   .gb-info-panel label{grid-column:1/-1;display:grid;gap:7px;font-size:10px;color:#566b5a}
   .gb-info-panel select{width:100%;min-height:42px;font-size:13px;padding:10px 12px;background:#fff!important;color:#203729!important;border:1px solid #d8e3d5!important;border-radius:11px}
   .gb-message-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:15px 12px 18px}
   .gb-message-row{margin:7px 0}.gb-message-bubble{max-width:min(84%,520px);min-width:52px;padding:10px 12px 8px;border-radius:16px}
   .incoming .gb-message-bubble{background:#fff;border:1px solid #e5ebe3}.outgoing .gb-message-bubble{background:#dff0d6;border:1px solid #d2e7c8}
   .gb-message-bubble>small{font-size:8px}.gb-message-bubble p{font-size:13px;line-height:1.5;margin:5px 0;overflow-wrap:anywhere}.gb-message-bubble time{font-size:9px}
   .gb-notice{flex:0 0 auto;margin:5px 10px 0;font-size:10px;line-height:1.4}
   .gb-conversation-tools{flex:0 0 auto;min-height:42px;padding:7px 10px;gap:7px;flex-wrap:wrap;background:#fff}
   .gb-conversation-tools>span{max-width:100%;font-size:9px;line-height:1.35;color:#647468}
   .gb-conversation-tools>div{margin-left:auto;display:flex;gap:6px}.gb-conversation-tools button{min-height:32px;padding:7px 9px;font-size:9px}
   .gb-composer{display:flex!important;visibility:visible!important;position:relative;z-index:2;flex:0 0 auto;min-height:64px;align-items:flex-end;gap:8px;padding:9px 11px calc(9px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e5ebe3}
   .gb-composer textarea{display:block!important;visibility:visible!important;flex:1 1 auto;min-width:0;min-height:44px;max-height:104px;resize:none;border:1px solid #dbe5d8!important;border-radius:22px;background:#f4f7f2!important;color:#203729!important;padding:12px 14px;font:16px/1.35 -apple-system,BlinkMacSystemFont,sans-serif!important;outline:none!important;box-shadow:none!important;-webkit-appearance:none}
   .gb-composer textarea:focus{border-color:#87aa7d!important;box-shadow:0 0 0 3px #8dbb7520!important}
   .gb-composer button{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border:0;border-radius:50%;background:#174b32!important;color:#fff!important;font-size:17px;box-shadow:0 4px 10px #174b3230!important}
   .gb-bottom-dock{position:fixed;z-index:40;left:50%;right:auto;bottom:calc(9px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(410px,calc(100vw - 28px));height:62px;min-height:62px;padding:6px 8px;gap:5px;border:1px solid #ffffff55;border-radius:23px;background:linear-gradient(155deg,#2b3b31,#17271e 48%,#0b1510);box-shadow:0 14px 30px #102d1d3b,0 4px 10px #0b241730,inset 0 1px 2px #ffffff35}
   .gb-bottom-dock button{min-height:48px;padding:4px 3px;gap:3px;border-radius:16px}
   .gb-bottom-dock button .gb-dock-icon{width:31px;height:28px}.gb-bottom-dock button .gb-dock-icon svg{width:20px;height:20px}
   .gb-bottom-dock button small{font-size:9px}.gb-bottom-dock button.active{transform:translateY(-2px)}
   .gb-toast{bottom:calc(82px + env(safe-area-inset-bottom));max-width:calc(100vw - 28px)}
  }
  @media(min-width:761px){.gb-chat-app{min-height:570px}.gb-composer{flex-shrink:0}.gb-message-scroll{min-height:0}}

  .gb-chat-loading{display:none}
  .gb-console .gb-content>.gb-ios-chat{background:#f5f7f3!important;color:#192d21!important}
  .gb-settings-list>div{min-width:0}
  .gb-settings-list b,.gb-settings-list small{display:block;line-height:1.45}
  .gb-settings-list b{color:#263b2d}
  .gb-settings-list small{color:#758378}
  .gb-chat-loading{align-items:center;justify-content:center;gap:10px;color:#6b7b6f;font-size:12px}
  .gb-loading-dot{width:8px;height:8px;border-radius:50%;background:#6e9d5b;box-shadow:0 0 0 5px #6e9d5b1e;animation:gbChatPulse 1s ease-in-out infinite}
  
   .gb-activity-screen{display:flex;flex-direction:column;gap:20px;padding:18px 18px 28px;background:#f5f7f3;min-height:100%;overflow:auto}
   .gb-activity-overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
   .gb-activity-overview>div{display:grid;gap:5px;padding:15px 14px;border:1px solid #e0e8dc;border-radius:15px;background:linear-gradient(145deg,#fff,#f9fbf7);min-width:0}
   .gb-activity-overview small{font-size:8px;font-weight:850;letter-spacing:.1em;color:#758579}
   .gb-activity-overview b{font-size:25px;line-height:1;color:#174b32}
   .gb-activity-overview span{font-size:10px;color:#718075}
   .gb-activity-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
   .gb-activity-heading h2{margin:0;color:#1d3325;font-size:17px;letter-spacing:-.025em}
   .gb-activity-heading p{margin:4px 0 0;color:#77857a;font-size:10px}
   .gb-activity-heading button{border:1px solid #d6e3d1;border-radius:10px;padding:9px 11px;background:#edf5e9;color:#285c38;font-size:10px;font-weight:800;white-space:nowrap}
   .gb-activity-list{display:grid;gap:9px;overflow:visible;flex:0 0 auto}
   .gb-activity-row{width:100%;min-width:0;display:flex;align-items:center;gap:12px;padding:14px 15px;border:1px solid #e1e9de;border-radius:15px;background:#fff;text-align:left;color:#23392a;box-shadow:0 3px 12px #193b2608}
   .gb-activity-avatar,.gb-avatar-wrap{position:relative;display:block;flex:0 0 46px;width:46px;height:46px}
   .gb-activity-avatar{border-radius:50%;background:#e4eddf;color:#174b32;display:grid;place-items:center;font-size:14px;font-weight:850}
   .gb-activity-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
   .gb-activity-avatar i,.gb-avatar-wrap>i{position:absolute;right:0;bottom:0;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#9aa69b}
   .gb-activity-avatar i.is-online,.gb-avatar-wrap>i.is-online{background:#36a45b}
   .gb-activity-copy{display:grid;gap:5px;flex:1;min-width:0}
   .gb-activity-line{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
   .gb-activity-line b{font-size:13px;color:#1d3425;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
   .gb-activity-line time{font-size:9px;color:#839086;white-space:nowrap}
   .gb-activity-copy>small{font-size:11px;color:#53665a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
   .gb-activity-meta{display:flex;align-items:center;gap:5px;font-size:9px;color:#748277}
   .gb-activity-meta i{width:6px;height:6px;border-radius:50%;background:#9aa69b}
   .gb-activity-meta i.is-online{background:#36a45b}
   .gb-activity-arrow{font-size:24px;color:#8a9b8d;line-height:1}
   .gb-avatar-wrap .gb-avatar{width:46px;height:46px;flex:0 0 46px}
   .gb-head-avatar{flex-basis:38px;width:38px;height:38px}
   .gb-head-avatar .gb-avatar{width:38px;height:38px;flex-basis:38px}
   .gb-message-foot{display:flex;align-items:center;justify-content:flex-end;gap:9px;margin-top:3px}
   .gb-read-state{font-size:9px;font-weight:700;color:#7d8b80}
   .gb-read-state.is-seen{color:#2877b8}
   @media(max-width:760px){
    .gb-activity-screen{padding:14px 14px 28px;gap:16px}
    .gb-activity-overview{gap:7px}
    .gb-activity-overview>div{padding:12px 10px;border-radius:12px}
    .gb-activity-overview small{font-size:7px;letter-spacing:.06em}
    .gb-activity-overview b{font-size:22px}
    .gb-activity-overview span{font-size:9px;line-height:1.3}
    .gb-activity-heading h2{font-size:16px}
    .gb-activity-heading p{font-size:9px}
    .gb-activity-row{padding:13px 11px;gap:10px;border-radius:13px}
    .gb-activity-avatar{width:42px;height:42px;flex-basis:42px}
    .gb-activity-line{align-items:flex-start;flex-direction:column;gap:3px}
    .gb-activity-line time{font-size:8px}
    .gb-activity-copy>small{font-size:10px}
    .gb-avatar-wrap{flex-basis:40px;width:40px;height:40px}
    .gb-avatar-wrap .gb-avatar{width:40px;height:40px;flex-basis:40px}
   }

   @keyframes gbChatPulse{50%{opacity:.35;transform:scale(.82)}}
  @media(max-width:760px){
   .gb-chat-loading{display:flex;height:100%;min-height:180px}
   .gb-sidebar-title h1{color:#172b20!important}
   .gb-sidebar-title p{color:#68786d!important}
   .gb-inbox-meta{color:#718075!important}
   .gb-team-list,.gb-activity-list{background:#fff}
   .gb-presence-summary{align-items:center;gap:12px;min-height:54px;padding:14px 17px;color:#657568!important;background:#f8faf7}
   .gb-presence-summary b{color:#27633d!important;font-size:12px}
   .gb-presence-summary span{color:#78867b!important;font-size:10px}
   .gb-team-row{min-height:70px;padding:12px 16px}
   .gb-team-row b{display:block;color:#263b2d!important;font-size:12px;line-height:1.35}
   .gb-team-row small{display:block;color:#78867b!important;font-size:10px;line-height:1.4}
   .gb-empty{display:grid;gap:9px;align-content:center;justify-items:center;text-align:center;min-height:190px;padding:24px;color:#263b2d}
   .gb-settings-list{padding:12px 15px 30px;display:grid;grid-template-columns:minmax(0,1fr);gap:9px;background:#f5f7f3;overflow:auto}
   .gb-settings-list>div,.gb-settings-list>a{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:15px 14px;border:1px solid #e2e9df;border-radius:13px;background:#fff;min-height:70px}
   .gb-settings-list b{font-size:12px;color:#233a2a!important;line-height:1.35}
   .gb-settings-list small{font-size:11px;color:#738176!important;line-height:1.45;overflow-wrap:anywhere}
   .gb-settings-list>a{display:flex;align-items:center;justify-content:space-between;color:#245b37!important;font-size:11px;font-weight:700}
   .gb-activity-row{gap:10px;padding:14px 16px;background:#fff}
   .gb-activity-row>span:last-child{min-width:0;display:grid;gap:5px}
   .gb-activity-row b{color:#24392b!important;font-size:12px;line-height:1.35}
   .gb-activity-row small,.gb-activity-row time{color:#718075!important;font-size:10px;line-height:1.4;overflow-wrap:anywhere}
   .gb-inbox-note{display:flex;align-items:flex-start;gap:10px;margin:auto 14px 14px;padding:13px 12px;border:1px solid #e4ebe1;border-radius:13px;background:linear-gradient(145deg,#f7faf5,#fff);color:#607366}
   .gb-inbox-note>span{display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;border-radius:8px;background:#eaf3e4;color:#3d7147;font-size:13px}
   .gb-inbox-note>div{display:grid;gap:4px;min-width:0}
   .gb-inbox-note b{font-size:10px;color:#31543a;line-height:1.3}
   .gb-inbox-note small{font-size:9px;color:#7a897d;line-height:1.45}
   .gb-file-input{display:none!important}
   .gb-composer .gb-attach{display:grid!important;place-items:center;flex:0 0 38px;width:38px;height:38px;border:1px solid #dbe5d8!important;border-radius:50%;background:#f4f7f2!important;color:#315b3c!important;font-size:22px!important;line-height:1}
   .gb-pending-files{display:flex;gap:7px;flex-wrap:wrap;padding:7px 11px;background:#fff;border-top:1px solid #edf1eb}
   .gb-pending-files>span{display:flex;align-items:center;gap:6px;max-width:100%;padding:5px 8px;border:1px solid #dbe5d8;border-radius:9px;background:#f7faf5;color:#31543a;font-size:10px;overflow-wrap:anywhere}
   .gb-pending-files button{border:0;background:transparent;color:#8b4c42;font-size:15px}
   .gb-message-attachments{display:grid;gap:7px;margin:8px 0}
   .gb-message-attachments a{display:flex;align-items:center;gap:8px;max-width:100%;padding:7px;border:1px solid #dbe5d8;border-radius:10px;background:#ffffffa8;color:#31543a;text-decoration:none;overflow-wrap:anywhere}
   .gb-message-attachments img{width:58px;height:48px;object-fit:cover;border-radius:7px}
   .gb-message-attachments a>span{display:grid;place-items:center;width:38px;height:38px;border-radius:8px;background:#e8f0e4;font-weight:800}
   .gb-message-attachments small{font-size:10px;line-height:1.35;overflow-wrap:anywhere}
   .gb-bottom-dock{backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%)}
  }
  /* Final iPhone layout corrections: the conversation gets the full screen; navigation belongs to the inbox. */
  @media(max-width:760px){
   .gb-ios-chat{height:calc(100vh - 58px);height:calc(100dvh - 58px);min-height:0;max-height:none;display:flex;flex-direction:column;overflow:hidden;padding:0!important}
   .gb-chat-app{flex:1 1 auto;height:auto!important;min-height:0!important;padding:0 0 78px!important;overflow:hidden}
   .gb-chat-app:has(.gb-chat-sidebar.gb-mobile-hide){padding-bottom:0!important}
   .gb-chat-sidebar,.gb-chat-main{min-height:0!important;max-height:none!important;backface-visibility:hidden;transform:translateZ(0);transition:none!important}
   .gb-chat-main.gb-mobile-show{height:100%!important;display:flex!important}
   .gb-bottom-dock.gb-dock-chat-open{display:none!important}
   .gb-composer{padding-bottom:calc(9px + env(safe-area-inset-bottom,0px))!important}
   .gb-message-scroll{scrollbar-width:thin;scroll-padding-bottom:12px}
   .gb-info-panel{max-height:34dvh;overflow-y:auto;overscroll-behavior:contain}
   .gb-sidebar-title h1{color:#172b20!important;opacity:1!important}
   .gb-team-list,.gb-activity-list,.gb-settings-list{min-height:0;overscroll-behavior:contain}
   .gb-presence-summary{display:flex!important;flex-wrap:wrap;justify-content:space-between;line-height:1.4}
   .gb-presence-summary b,.gb-presence-summary span{display:block;line-height:1.4;white-space:normal}
   .gb-settings-list>div{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:5px!important;align-content:center}
   .gb-settings-list b,.gb-settings-list small{display:block!important;min-width:0!important;line-height:1.45!important;overflow-wrap:anywhere}
   .gb-bottom-dock{height:60px!important;min-height:60px!important;bottom:calc(8px + env(safe-area-inset-bottom,0px))!important}
  }
  @media(max-width:390px){
   .gb-conversation-head{gap:6px;padding-inline:8px}
   .gb-person-title small{max-width:38vw}
   .gb-status-chip{padding:5px 7px}
   .gb-conversation-tools{align-items:flex-start}
   .gb-conversation-tools>div{flex-wrap:wrap}
  }
  @media(prefers-reduced-motion:reduce){.gb-chat-sidebar,.gb-chat-main,.gb-bottom-dock button{transition:none!important}}
      .gb-settings-list{padding:22px 20px 30px;display:grid;align-content:start;gap:24px;background:#f5f7f3;overflow:auto;min-height:0}
   .gb-settings-intro{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;padding:4px 2px 20px;border-bottom:1px solid #dfe7dc}
   .gb-settings-kicker,.gb-settings-card small{display:block;font-size:9px;font-weight:850;letter-spacing:.14em;color:#718276}
   .gb-settings-intro h2{margin:7px 0 5px;font-size:25px;line-height:1.08;letter-spacing:-.045em;color:#172d20}
   .gb-settings-intro p,.gb-settings-group-title p{margin:0;color:#647568;font-size:12px;line-height:1.55}
   .gb-settings-live{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;padding:8px 11px;border:1px solid #d7e5d1;border-radius:30px;background:#edf5e9;color:#315d3d;font-size:9px;font-weight:850;letter-spacing:.06em}
   .gb-settings-live i{width:7px;height:7px;border-radius:50%;background:#5caa65;box-shadow:0 0 0 3px #5caa6520}
   .gb-settings-group{display:grid;gap:12px}
   .gb-settings-group-title{display:flex;align-items:flex-start;gap:11px}
   .gb-settings-group-title>span{display:grid;place-items:center;flex:0 0 29px;width:29px;height:29px;border-radius:9px;background:#e5eee0;color:#376347;font-size:10px;font-weight:850}
   .gb-settings-group-title h3{margin:0 0 3px;color:#1d3626;font-size:15px;letter-spacing:-.02em}
   .gb-settings-group-title p{font-size:11px}
   .gb-settings-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
   .gb-settings-card{display:flex;align-items:flex-start;gap:12px;min-width:0;min-height:112px;padding:16px;border:1px solid #dce6d8;border-radius:16px;background:linear-gradient(145deg,#fff,#fbfcfa);color:#203729;text-decoration:none;box-shadow:0 3px 10px #173b2b08}
   .gb-settings-icon{display:grid;place-items:center;flex:0 0 37px;width:37px;height:37px;border-radius:12px;background:#edf4e9;color:#285c39;font-size:20px;font-weight:750}
   .gb-settings-card>div{display:grid;gap:5px;min-width:0;flex:1}
   .gb-settings-card small{font-size:8px;color:#78877b}
   .gb-settings-card b{font-size:13px;line-height:1.35;color:#203b2a}
   .gb-settings-card p{margin:0;color:#68796d;font-size:11px;line-height:1.5}
   .gb-settings-card-tag{margin-left:auto;padding:5px 7px;border-radius:20px;background:#edf5e9;color:#3c7046;font-size:8px;font-weight:850;letter-spacing:.06em}
   .gb-settings-sound{align-items:center;min-height:118px}
   .gb-settings-sound>div{margin-right:auto}
   .gb-sound-toggle{display:inline-flex;align-items:center;justify-content:center;gap:8px;flex:0 0 auto;min-height:42px;padding:0 14px;border:1px solid #cbdcc5;border-radius:12px;background:#f0f4ed;color:#536b57;font-size:11px;font-weight:800;white-space:nowrap}
   .gb-sound-toggle-dot{width:8px;height:8px;border-radius:50%;background:#89978b}
   .gb-sound-toggle.is-on{background:#e9f5df;border-color:#c6dfb7;color:#205b35}
   .gb-sound-toggle.is-on .gb-sound-toggle-dot{background:#51a45c;box-shadow:0 0 0 3px #51a45c20}
   .gb-settings-return{align-items:center;border-color:#cbdcc6;background:linear-gradient(120deg,#f7fbf3,#fff)}
   .gb-settings-arrow{margin-left:auto;color:#2d7042;font-size:20px;font-weight:800}
   .gb-settings-footnote{padding-top:13px;border-top:1px solid #e0e8dd;color:#7d8a80;font-size:9px;font-weight:750;letter-spacing:.1em}
   .gb-settings-footnote span{padding:0 5px;color:#b3c0b0}
   @media(max-width:760px){
    .gb-settings-list{padding:20px 15px calc(26px + env(safe-area-inset-bottom));gap:23px;background:#f3f6f1}
    .gb-settings-intro{display:grid;align-items:start;gap:12px;padding:3px 2px 17px}
    .gb-settings-intro h2{font-size:26px}
    .gb-settings-intro p{max-width:320px;font-size:12px}
    .gb-settings-live{justify-self:start}
    .gb-settings-group{gap:10px}
    .gb-settings-group-title h3{font-size:14px}
    .gb-settings-group-title p{font-size:10px}
    .gb-settings-card-grid{grid-template-columns:minmax(0,1fr);gap:9px}
    .gb-settings-card{min-height:88px;padding:14px;border-radius:15px;gap:11px;align-items:center}
    .gb-settings-card b{font-size:13px}
    .gb-settings-card p{font-size:11px}
    .gb-settings-icon{width:36px;height:36px;flex-basis:36px}
    .gb-settings-sound{align-items:center;flex-wrap:wrap}
    .gb-settings-sound>div{flex:1 1 calc(100% - 50px)}
    .gb-sound-toggle{margin:4px 0 0 47px;min-height:40px}
    .gb-settings-card-tag{font-size:8px}
    .gb-settings-footnote{font-size:8px}
   }
   @media(min-width:761px){.gb-settings-list{padding:24px}.gb-settings-card-grid{grid-template-columns:1fr}}
   :global(.gb-content .gb-ios-chat),:global(.gb-content .gb-ios-chat *){filter:none!important}
   :global(.gb-content .gb-ios-chat .gb-chat-sidebar),:global(.gb-content .gb-ios-chat .gb-chat-main){box-shadow:none!important}
   :global(.gb-content .gb-ios-chat .gb-search),:global(.gb-content .gb-ios-chat .gb-filter-row button),:global(.gb-content .gb-ios-chat .gb-thread),:global(.gb-content .gb-ios-chat .gb-inbox-note),:global(.gb-content .gb-ios-chat .gb-message-bubble),:global(.gb-content .gb-ios-chat .gb-conversation-tools button),:global(.gb-content .gb-ios-chat .gb-composer button){box-shadow:none!important;filter:none!important}
   :global(.gb-content .gb-ios-chat .gb-sidebar-title),:global(.gb-content .gb-ios-chat .gb-search),:global(.gb-content .gb-ios-chat .gb-filter-row),:global(.gb-content .gb-ios-chat .gb-thread),:global(.gb-content .gb-ios-chat .gb-inbox-meta),:global(.gb-content .gb-ios-chat .gb-inbox-note),:global(.gb-content .gb-ios-chat .gb-message-scroll),:global(.gb-content .gb-ios-chat .gb-conversation-head),:global(.gb-content .gb-ios-chat .gb-conversation-tools),:global(.gb-content .gb-ios-chat .gb-composer){opacity:1!important;filter:none!important}
   :global(.gb-content .gb-ios-chat .gb-thread-line b),:global(.gb-content .gb-ios-chat .gb-message-bubble p),:global(.gb-content .gb-ios-chat .gb-person-title b),:global(.gb-content .gb-ios-chat .gb-composer textarea){color:#172b20!important;opacity:1!important}
   :global(.gb-content .gb-ios-chat .gb-thread-preview),:global(.gb-content .gb-ios-chat .gb-thread-id),:global(.gb-content .gb-ios-chat .gb-message-bubble time),:global(.gb-content .gb-ios-chat .gb-message-bubble>small){color:#405b47!important;opacity:1!important}
   :global(.gb-content .gb-ios-chat .gb-message-scroll){background:#f4f7f2!important;background-image:radial-gradient(#d6e0d3 .65px,transparent .65px)!important}
   :global(.gb-content .gb-ios-chat .gb-message-row.outgoing .gb-message-bubble){background:#dcefd4!important;color:#173b27!important;border:1px solid #c6dfbc!important}
   :global(.gb-content .gb-ios-chat .gb-message-row.incoming .gb-message-bubble){background:#fff!important;color:#172b20!important;border:1px solid #d7e2d4!important}
   .gb-settings-list .gb-sound-setting{display:grid;gap:7px}.gb-sound-setting button{justify-self:start;border:1px solid #cbdcc6;border-radius:10px;background:#eaf4e4;color:#174b32;padding:9px 12px;font-weight:750}
   @media(max-width:760px){:global(.gb-content .gb-ios-chat .gb-message-bubble p){font-size:15px!important;line-height:1.55!important}:global(.gb-content .gb-ios-chat .gb-message-bubble time){font-size:10px!important}}

  /* G-BEST dark flagship messaging workspace */
  .gb-ios-chat{--forest:#c9f36a;--deep:#102218;--lime:#c9f36a;--paper:#151c17;--line:#344238;background:#101612!important;color:#edf4eb!important}
  .gb-chat-top{background:linear-gradient(110deg,#202a23,#141b16)!important;border-bottom:1px solid #39473d!important;box-shadow:0 8px 24px #0003}
  .gb-chat-brand{color:#f2f7ef!important}.gb-brand-mark{background:linear-gradient(145deg,#d7ff7d,#83b92d)!important;color:#122018!important;box-shadow:0 4px 0 #557a20,0 8px 20px #0005!important}.gb-chat-brand small{color:#a4b4a5!important}
  .gb-admin-pill{background:#26362a!important;color:#d9f3bc!important;border:1px solid #53634b!important}.gb-admin-pill i{background:#c9f36a!important}.gb-top-link{color:#bdcbbb!important}
  .gb-chat-app{background:transparent!important}
  .gb-chat-sidebar,.gb-chat-main{background:linear-gradient(155deg,#202923 0%,#171f19 55%,#131a15 100%)!important;border:1px solid #3b493e!important;border-radius:20px!important;box-shadow:0 18px 48px #0005,inset 0 1px #ffffff0b!important;color:#edf4eb!important}
  .gb-sidebar-title{border-bottom:1px solid #354238!important}.gb-sidebar-title h1{color:#f0f5ed!important}.gb-sidebar-title p,.gb-inbox-meta,.gb-thread-preview,.gb-thread-line,.gb-thread-id{color:#a7b5a8!important}
  .gb-icon-btn{background:linear-gradient(145deg,#d7ff7d,#9bce43)!important;color:#13251a!important;box-shadow:0 6px 18px #0006!important}
  .gb-search{background:#111914!important;border:1px solid #3a4b3e!important;color:#aab8ab!important}.gb-search input{background:#111914!important;color:#f3f7f0!important}.gb-search input::placeholder{color:#829184!important}
  .gb-filter-row button{background:#202b23!important;border:1px solid #3c4c40!important;color:#c0cec0!important}.gb-filter-row button.active{background:#c9f36a!important;border-color:#c9f36a!important;color:#152319!important}
  .gb-inbox-meta{border-bottom:1px solid #344137!important}.gb-thread{background:transparent!important;border-bottom:1px solid #344137!important;color:#edf4eb!important}.gb-thread:hover,.gb-thread.selected{background:#2a382d!important}
  .gb-thread-copy strong,.gb-thread-line b{color:#f3f7ef!important}.gb-thread-id{color:#93a596!important}.gb-unread{background:#c9f36a!important;color:#142319!important}.gb-avatar,.gb-activity-avatar,.gb-head-avatar{border:2px solid #53664f!important}
  .gb-welcome{background:radial-gradient(ellipse at 50% 15%,#344b36 0%,#202b23 42%,#171f19 100%)!important;color:#edf4eb!important}.gb-welcome-icon{background:#2b3d2e!important;color:#d4f78a!important;box-shadow:0 8px 26px #0005!important}.gb-welcome h2{color:#f2f7ef!important}.gb-welcome p,.gb-welcome-stats small{color:#b5c3b5!important}.gb-welcome-stats b{color:#d4f78a!important}
  .gb-conversation-head{background:#202a23!important;border-bottom:1px solid #3a493d!important;color:#f2f7ef!important}.gb-person-title,.gb-person-title strong{color:#f3f7ef!important}.gb-status-chip{background:#2a3a2d!important;color:#d3f39a!important;border:1px solid #4b6049!important}
  .gb-back-btn,.gb-info-toggle{background:#29382d!important;color:#d7edc5!important;border:1px solid #455747!important}.gb-info-panel{background:#1a241d!important;border-left:1px solid #3b4a3e!important;color:#edf4eb!important}.gb-assignment-title,.gb-info-panel strong{color:#edf4eb!important}.gb-whatsapp-link{color:#d0f38a!important}
  .gb-message-scroll{background:radial-gradient(ellipse at 50% 0%,#26372a 0%,#18221b 62%,#141b16 100%)!important}.gb-message-row.incoming .gb-message-bubble{background:#29372d!important;color:#f0f5ed!important;border:1px solid #405044!important}.gb-message-row.outgoing .gb-message-bubble{background:linear-gradient(145deg,#38552f,#294329)!important;color:#f4f8ef!important;border:1px solid #607d4b!important}
  .gb-message-foot,.gb-read-state{color:#aab9a9!important}.gb-conversation-tools{background:#202a23!important;border-top:1px solid #39483c!important;color:#b9c8b9!important}.gb-conversation-tools button{background:#2a392e!important;color:#d9e8d4!important;border:1px solid #465747!important}
  .gb-composer{background:#202a23!important;border-top:1px solid #3c4b3f!important}.gb-composer textarea{background:#111914!important;border:1px solid #465849!important;color:#f4f7f1!important}.gb-composer textarea::placeholder{color:#8b9a8e!important}.gb-composer button[type=submit]{background:linear-gradient(145deg,#d7ff7d,#9acb40)!important;color:#152419!important}
  .gb-notice{background:#293a2b!important;color:#d8efb7!important;border:1px solid #455b40!important}.gb-empty,.gb-chat-loading{color:#b7c5b8!important}
  .gb-activity-screen{background:transparent!important;color:#edf4eb!important}
  .gb-activity-overview>div,.gb-activity-row,.gb-team-row,.gb-settings-card,.gb-settings-intro,.gb-settings-live,.gb-settings-group{background:linear-gradient(145deg,#253129,#1a231d)!important;border:1px solid #3c4b3f!important;box-shadow:0 10px 26px #0003,inset 0 1px #ffffff0a!important;color:#edf4eb!important}
  .gb-activity-overview small,.gb-activity-overview span,.gb-activity-heading p,.gb-activity-copy small,.gb-activity-meta,.gb-settings-card p,.gb-settings-group-title,.gb-settings-footnote{color:#a9b9aa!important}
  .gb-activity-overview b,.gb-activity-heading h2,.gb-activity-copy strong,.gb-team-row strong,.gb-settings-card h3,.gb-settings-intro h2{color:#f1f6ee!important}.gb-activity-overview b{color:#d1f58b!important}.gb-activity-arrow,.gb-settings-icon{color:#d2f18a!important}
  .gb-settings-card button,.gb-settings-return{background:#2a3b2e!important;color:#d9efc1!important;border:1px solid #4c6049!important}.gb-settings-sound,.gb-sound-setting{background:#1c271f!important;color:#eaf2e7!important;border-color:#3b4b3e!important}
  .gb-bottom-dock{background:linear-gradient(155deg,#2b3b31,#17271e 48%,#0b1510)!important;border-color:#607264!important}.gb-bottom-dock button{color:#c5d3c6!important}.gb-bottom-dock button.active{background:linear-gradient(145deg,#d9ff9b,#a8d95b)!important;color:#14251a!important;box-shadow:0 5px 16px #0005,inset 0 1px #fff!important}
  .gb-toast{background:#26372b!important;color:#eff7e8!important;border:1px solid #607455!important}
  @media(max-width:760px){.gb-chat-top{background:#18221b!important}.gb-chat-sidebar,.gb-chat-main{border-radius:0!important}}


  /* Final dark-theme consistency and desktop chat polish */
  :global(.gb-content .gb-ios-chat){background:#101612!important;color:#edf4eb!important}
  :global(.gb-content .gb-ios-chat .gb-chat-app){background:transparent!important}
  :global(.gb-content .gb-ios-chat .gb-chat-sidebar),
  :global(.gb-content .gb-ios-chat .gb-chat-main){background:linear-gradient(155deg,#202923 0%,#171f19 55%,#131a15 100%)!important;border:1px solid #3b493e!important;color:#edf4eb!important}
  :global(.gb-content .gb-ios-chat .gb-message-scroll){background:#17221a!important;background-image:radial-gradient(#405344 0.7px,transparent .7px)!important;background-size:20px 20px!important;color:#edf4eb!important}
  :global(.gb-content .gb-ios-chat .gb-message-row.incoming .gb-message-bubble){background:#2a392f!important;border:1px solid #46594a!important;color:#f3f7ef!important}
  :global(.gb-content .gb-ios-chat .gb-message-row.outgoing .gb-message-bubble){background:linear-gradient(145deg,#385b37,#29452d)!important;border:1px solid #58764c!important;color:#f6faef!important}
  :global(.gb-content .gb-ios-chat .gb-message-bubble p){color:#f0f5ec!important;opacity:1!important}
  :global(.gb-content .gb-ios-chat .gb-message-bubble>small){color:#c7e7a8!important;opacity:1!important}
  :global(.gb-content .gb-ios-chat .gb-message-bubble time),
  :global(.gb-content .gb-ios-chat .gb-message-foot),
  :global(.gb-content .gb-ios-chat .gb-read-state){color:#c1d0bf!important;opacity:1!important}
  :global(.gb-content .gb-ios-chat .gb-read-state.is-seen){color:#d6f69a!important}
  :global(.gb-content .gb-ios-chat .gb-conversation-head){background:#202a23!important;border-bottom:1px solid #3b4b3e!important}
  :global(.gb-content .gb-ios-chat .gb-person-title b){color:#f5f8f1!important;opacity:1!important}
  :global(.gb-content .gb-ios-chat .gb-person-title small){color:#b5c5b5!important;opacity:1!important}
  :global(.gb-content .gb-ios-chat .gb-status-chip){background:#2d412f!important;color:#d9f5ad!important;border:1px solid #536d4d!important}
  :global(.gb-content .gb-ios-chat .gb-head-avatar .gb-avatar){border:2px solid #c9f36a!important;box-shadow:0 0 0 3px #c9f36a22!important}
  :global(.gb-content .gb-ios-chat .gb-head-avatar>i),
  :global(.gb-content .gb-ios-chat .gb-avatar-wrap>i){border:2px solid #1b281e!important}
  :global(.gb-content .gb-ios-chat .gb-conversation-tools){background:#1d2921!important;border-top:1px solid #3a493d!important;color:#b8c8b8!important}
  :global(.gb-content .gb-ios-chat .gb-conversation-tools button){background:#2a3b2e!important;border:1px solid #4b614c!important;color:#e0efcf!important}
  :global(.gb-content .gb-ios-chat .gb-composer){display:flex!important;align-items:center!important;gap:10px!important;background:#18231b!important;border-top:1px solid #3a4b3d!important;padding:12px 16px 14px!important}
  :global(.gb-content .gb-ios-chat .gb-composer textarea){background:#101914!important;border:1px solid #465849!important;color:#f4f8ef!important;min-height:44px!important;border-radius:22px!important}
  :global(.gb-content .gb-ios-chat .gb-composer textarea::placeholder){color:#93a493!important}
  :global(.gb-content .gb-ios-chat .gb-composer .gb-attach){display:grid!important;place-items:center!important;width:42px!important;height:42px!important;flex:0 0 42px!important;border:1px solid #536b4e!important;border-radius:50%!important;background:#2a3d2c!important;color:#d8f59a!important;font-size:23px!important}
  :global(.gb-content .gb-ios-chat .gb-composer button[type=submit]){background:linear-gradient(145deg,#d8ff82,#9acb40)!important;color:#152319!important;box-shadow:0 5px 14px #0005!important}
  :global(.gb-content .gb-ios-chat .gb-file-input){display:none!important}
  :global(.gb-content .gb-ios-chat .gb-pending-files){background:#1b281f!important;border-top:1px solid #354638!important}
  :global(.gb-content .gb-ios-chat .gb-pending-files>span){background:#2a3b2e!important;border-color:#4b614c!important;color:#e3f2d3!important}
  :global(.gb-content .gb-ios-chat .gb-pending-files button){background:transparent!important;color:#ffc0a9!important}
  :global(.gb-content .gb-ios-chat .gb-message-attachments a){background:#24352a!important;border-color:#4a604b!important;color:#e0f0d2!important}
  :global(.gb-content .gb-ios-chat .gb-message-attachments a>span){background:#3b543b!important;color:#e4f6c7!important}
  :global(.gb-content .gb-ios-chat .gb-inbox-note){display:flex!important;align-items:flex-start!important;gap:10px!important;margin:12px 14px 14px!important;padding:12px!important;border:1px solid #3e5142!important;border-radius:12px!important;background:#202d24!important;color:#b7c8b8!important;white-space:normal!important}
  :global(.gb-content .gb-ios-chat .gb-inbox-note>span){flex:0 0 28px!important;width:28px!important;height:28px!important;background:#344a32!important;color:#d8f49b!important}
  :global(.gb-content .gb-ios-chat .gb-inbox-note>div){display:grid!important;gap:5px!important;min-width:0!important}
  :global(.gb-content .gb-ios-chat .gb-inbox-note b){display:block!important;color:#eff6e9!important;font-size:11px!important;line-height:1.4!important}
  :global(.gb-content .gb-ios-chat .gb-inbox-note small){display:block!important;color:#b3c3b3!important;font-size:10px!important;line-height:1.5!important}
  :global(.gb-content .gb-ios-chat .gb-thread-line b){color:#f1f6ed!important}
  :global(.gb-content .gb-ios-chat .gb-thread-line time),
  :global(.gb-content .gb-ios-chat .gb-thread-preview),
  :global(.gb-content .gb-ios-chat .gb-thread-id){color:#aebfae!important}
  :global(.gb-content .gb-ios-chat .gb-thread){background:transparent!important;color:#f1f6ed!important}
  :global(.gb-content .gb-ios-chat .gb-thread.selected),
  :global(.gb-content .gb-ios-chat .gb-thread:hover){background:#2a3b2e!important}
  :global(.gb-content .gb-ios-chat .gb-inbox-meta){color:#a9b9a9!important;border-color:#39483d!important}
  :global(.gb-content .gb-ios-chat .gb-search){background:#111a14!important;border-color:#405244!important}
  :global(.gb-content .gb-ios-chat .gb-search input){background:transparent!important;color:#f0f6ec!important}
  :global(.gb-content .gb-ios-chat .gb-search input::placeholder){color:#879989!important}
  :global(.gb-content .gb-ios-chat .gb-filter-row button){background:#202d24!important;border-color:#435546!important;color:#c4d2c2!important}
  :global(.gb-content .gb-ios-chat .gb-filter-row button.active){background:#c9f36a!important;color:#17251a!important;border-color:#c9f36a!important}
  :global(.gb-content .gb-ios-chat .gb-empty){color:#c0d0bf!important}
  :global(.gb-content .gb-ios-chat .gb-empty b){color:#f0f6eb!important}
  :global(.gb-content .gb-ios-chat .gb-empty small){color:#afc0af!important}
  :global(.gb-content .gb-ios-chat .gb-notice){background:#2a3c2c!important;color:#e0f3c7!important;border-color:#526c4a!important}
  :global(.gb-content .gb-ios-chat .gb-info-panel){background:#1b281f!important;border-color:#3e5042!important}
  :global(.gb-content .gb-ios-chat .gb-info-panel small),
  :global(.gb-content .gb-ios-chat .gb-info-panel label){color:#aebfae!important}
  :global(.gb-content .gb-ios-chat .gb-info-panel b){color:#eff6e9!important}
  :global(.gb-content .gb-ios-chat .gb-info-panel select){background:#111a14!important;color:#f0f6ec!important;border-color:#46594a!important}
  :global(.gb-content .gb-ios-chat .gb-activity-screen),
  :global(.gb-content .gb-ios-chat .gb-settings-list),
  :global(.gb-content .gb-ios-chat .gb-team-list),
  :global(.gb-content .gb-ios-chat .gb-activity-list){background:#151e18!important;color:#edf4eb!important}
  :global(.gb-content .gb-ios-chat .gb-activity-overview>div),
  :global(.gb-content .gb-ios-chat .gb-activity-row),
  :global(.gb-content .gb-ios-chat .gb-team-row),
  :global(.gb-content .gb-ios-chat .gb-settings-card),
  :global(.gb-content .gb-ios-chat .gb-settings-intro),
  :global(.gb-content .gb-ios-chat .gb-settings-live),
  :global(.gb-content .gb-ios-chat .gb-settings-group){background:linear-gradient(145deg,#253129,#1a231d)!important;border-color:#3c4b3f!important;color:#edf4eb!important}
  :global(.gb-content .gb-ios-chat .gb-activity-overview b),
  :global(.gb-content .gb-ios-chat .gb-activity-heading h2),
  :global(.gb-content .gb-ios-chat .gb-activity-copy strong),
  :global(.gb-content .gb-ios-chat .gb-team-row b),
  :global(.gb-content .gb-ios-chat .gb-settings-card b),
  :global(.gb-content .gb-ios-chat .gb-settings-intro h2),
  :global(.gb-content .gb-ios-chat .gb-settings-group-title h3){color:#f1f6ee!important}
  :global(.gb-content .gb-ios-chat .gb-activity-overview small),
  :global(.gb-content .gb-ios-chat .gb-activity-overview span),
  :global(.gb-content .gb-ios-chat .gb-activity-heading p),
  :global(.gb-content .gb-ios-chat .gb-activity-copy small),
  :global(.gb-content .gb-ios-chat .gb-activity-meta),
  :global(.gb-content .gb-ios-chat .gb-settings-card p),
  :global(.gb-content .gb-ios-chat .gb-settings-group-title p),
  :global(.gb-content .gb-ios-chat .gb-settings-footnote){color:#adbdad!important}
  :global(.gb-content .gb-ios-chat .gb-bottom-dock){background:linear-gradient(155deg,#2b3b31,#17271e 48%,#0b1510)!important}
  :global(.gb-content .gb-ios-chat .gb-bottom-dock button.active){background:linear-gradient(145deg,#d9ff9b,#a8d95b)!important;color:#14251a!important}
  @media(min-width:761px){
    :global(.gb-content .gb-ios-chat .gb-chat-app){height:calc(100dvh - 240px)!important;min-height:520px!important;max-width:1540px!important;grid-template-columns:minmax(300px,370px) minmax(0,1fr)!important}
    :global(.gb-content .gb-ios-chat .gb-chat-main){min-height:0!important}
    :global(.gb-content .gb-ios-chat .gb-message-scroll){min-height:0!important;scrollbar-color:#607564 #1a251d!important;scrollbar-width:thin!important}
    :global(.gb-content .gb-ios-chat .gb-composer){padding-bottom:14px!important}
    :global(.gb-content .gb-ios-chat .gb-bottom-dock){bottom:12px!important}
  }
  @media(max-width:760px){
    :global(.gb-content .gb-ios-chat .gb-message-scroll){background:#17221a!important;background-image:none!important}
    :global(.gb-content .gb-ios-chat .gb-composer){padding:9px 11px calc(9px + env(safe-area-inset-bottom))!important}
    :global(.gb-content .gb-ios-chat .gb-composer .gb-attach){width:38px!important;height:38px!important;flex-basis:38px!important}
    :global(.gb-content .gb-ios-chat .gb-inbox-note){margin:10px 12px 12px!important}
  }


  /* Keep the floating tab dock out of the active message composer on desktop and mobile. */
  :global(.gb-content .gb-ios-chat .gb-bottom-dock.gb-dock-chat-open){display:none!important}
  @media(min-width:761px){
    :global(.gb-content .gb-ios-chat .gb-chat-app){height:calc(100dvh - 218px)!important;min-height:500px!important;margin-top:18px!important}
    :global(.gb-content .gb-ios-chat .gb-chat-main){min-height:0!important;overflow:hidden!important}
    :global(.gb-content .gb-ios-chat .gb-conversation-head){flex:0 0 74px!important}
    :global(.gb-content .gb-ios-chat .gb-message-scroll){flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important}
    :global(.gb-content .gb-ios-chat .gb-conversation-tools){flex:0 0 auto!important}
    :global(.gb-content .gb-ios-chat .gb-composer){flex:0 0 auto!important;min-height:68px!important}
  }

  `}

  

  </style>
 </main>;
}
