'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
const catalog=[
 {key:'properties',permission:'properties',title:'Properties',description:'Manage listings and availability',href:'/admin/super',icon:'⌂'},
 {key:'clients',permission:'clients',title:'Clients & payments',description:'Review client registrations and receipts',href:'/admin/clients',icon:'♙'},
 {key:'client-chat',permission:'clients',title:'Client messages',description:'Reply to private Agent conversations',href:'/admin/client-chat',icon:'✉'},
 {key:'contacts',permission:'contacts',title:'Business contacts',description:'Review enquiries submitted through the contact page',href:'/admin/super/contacts',icon:'✉'},
 {key:'inspections',permission:'inspections',title:'Inspections',description:'Review requests and manage appointments',href:'/admin',icon:'◷'},
 {key:'media',permission:'media',title:'Media library',description:'Manage property photos and company assets',href:'/admin/super/media',icon:'▧'},
 {key:'finance',permission:'finance',title:'Company finance',description:'Review income, expenses and ledger',href:'/admin/super/finance',icon:'₦'},
 {key:'staff',permission:'staff',title:'Staff & permissions',description:'Invite employees and assign access',href:'/admin/super/staff',icon:'♧'},
 {key:'brand-studio',permission:'homepage',title:'Brand & Website Studio',description:'Company logo, identity, contact details, colours and footer',href:'/admin/super/website',icon:'◈'},
 {key:'homepage',permission:'homepage',title:'Homepage content',description:'Edit homepage sections, imagery and publishing',href:'/admin/super/homepage',icon:'▤'},
 {key:'media',permission:'media',title:'Media library',description:'Manage company logos, photos and creative assets',href:'/admin/super/media',icon:'▧'},
 {key:'activity',permission:'audit',title:'Activity & audit',description:'Review changes made across the system',href:'/admin/super/activity',icon:'≋'}
];
function ago(value,now){const seconds=Math.max(0,Math.floor((now-new Date(value).getTime())/1000));if(seconds<60)return seconds+' sec ago';const minutes=Math.floor(seconds/60);if(minutes<60)return minutes+' min ago';const hours=Math.floor(minutes/60);if(hours<24)return hours+' hr ago';return Math.floor(hours/24)+' days ago';}
function Stat({label,value,detail,href}){return <Link href={href} className="stat" style={{display:'block',minWidth:0,padding:14,border:'1px solid #ffffff24',borderRadius:12,background:'linear-gradient(145deg,#242d26,#19201b)',color:'#f2f5ef',textDecoration:'none',boxSizing:'border-box'}}><span style={{display:'block',width:'100%',margin:'0 0 8px',color:'#b7c5b8',fontSize:9,lineHeight:1.3,letterSpacing:'.13em',fontWeight:850}}>{label}</span><strong style={{display:'block',width:'100%',margin:'0 0 7px',color:'#e9f4df',fontSize:27,lineHeight:1.05,fontWeight:850,letterSpacing:'-.04em'}}>{Number(value??0).toLocaleString('en-NG')}</strong><small style={{display:'block',width:'100%',margin:0,color:'#aab7ac',fontSize:10,lineHeight:1.4,whiteSpace:'normal',overflowWrap:'anywhere'}}>{detail}</small></Link>}
export default function AdminOverview(){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[clock,setClock]=useState(Date.now());
 const load=useCallback(async()=>{setBusy(true);setError('');try{const r=await fetch('/api/admin/overview',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not load your workspace.');setData(d)}catch(e){setError(e.message||'Unable to load your workspace.')}finally{setBusy(false)}},[]);
 useEffect(()=>{load()},[load]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{const timer=setInterval(()=>load(),30000);return()=>clearInterval(timer)},[load]);
 const permissions=new Set(data?.permissions||[]);
 const cards=catalog.filter(x=>x.key==='staff'?data?.isSuperAdmin: x.key==='homepage'||x.key==='brand-studio'?data?.isSuperAdmin: x.key==='activity'?data?.isSuperAdmin: x.key==='contacts'?data?.isSuperAdmin:permissions.has(x.permission));
 const stats=[];
 if(data?.properties)stats.push({label:'PROPERTIES',value:data.properties.total,detail:(data.properties.published||0)+' published',href:'/admin/super'});
 if(data?.clients)stats.push({label:'CLIENTS',value:data.clients.total,detail:(data.clients.pending||0)+' payment reviews pending',href:'/admin/clients'});
 if(data?.inspections)stats.push({label:'INSPECTIONS',value:data.inspections.total,detail:(data.inspections.pending||0)+' awaiting review',href:'/admin'});
 if(data?.media)stats.push({label:'MEDIA ASSETS',value:data.media.total,detail:'In company library',href:'/admin/super/media'});
 return <main className="dash"><div className="inner">
  <header className="head"><div><span className="eyebrow">G-BEST / WORKSPACE</span><h1>{data?.isSuperAdmin?'Control room':'Your workspace'}</h1><p>{data?.isSuperAdmin?'A clear view of company operations.':'Your assigned departments and daily work.'}</p></div><button onClick={load} disabled={busy}>{busy?'Updating…':'Refresh'}</button></header>
  {error&&<div className="error" role="alert">{error}</div>}
  {busy&&!data?<div className="loading">Loading your authorised workspace…</div>:null}
  {data&&stats.length>0&&<section className="stats" aria-label="Workspace summary">{stats.map(x=><Stat key={x.label} {...x}/>)}</section>}
  {data?.isSuperAdmin&&data.finance&&<section className="finance" style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12,padding:15,border:'1px solid #ffffff20',borderRadius:13,background:'linear-gradient(145deg,#202821,#171d19)'}}><div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:8,minWidth:0}}><span style={{display:'block',fontSize:9,lineHeight:1.35,letterSpacing:'.1em',fontWeight:850,color:'#aab9ac'}}>PAYMENTS VERIFIED</span><strong style={{display:'block',fontSize:17,lineHeight:1.15,color:'#d7f49b'}}>{Number(data.finance.approved_count||0).toLocaleString('en-NG')}</strong></div><div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:8,minWidth:0}}><span style={{display:'block',fontSize:9,lineHeight:1.35,letterSpacing:'.1em',fontWeight:850,color:'#aab9ac'}}>VERIFIED VALUE</span><strong style={{display:'block',fontSize:17,lineHeight:1.15,color:'#d7f49b',overflowWrap:'anywhere'}}>₦{Number(data.finance.approved_amount||0).toLocaleString('en-NG',{maximumFractionDigits:2})}</strong></div><div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:8,minWidth:0}}><span style={{display:'block',fontSize:9,lineHeight:1.35,letterSpacing:'.1em',fontWeight:850,color:'#aab9ac'}}>AWAITING REVIEW</span><strong style={{display:'block',fontSize:17,lineHeight:1.15,color:'#d7f49b'}}>{Number(data.finance.pending_count||0).toLocaleString('en-NG')}</strong></div></section>}
  {data?.isSuperAdmin&&data.clientActivity&&<section className="client-intel">
   <div className="client-intel-heading"><div><span className="eyebrow">CLIENT OPERATIONS / LIVE PULSE</span><h2>Client intelligence</h2><p>Registration, engagement, inspections and recent activity. Online status expires automatically after 90 seconds without a heartbeat.</p></div><span className="client-intel-refresh">Refreshes every 30 sec</span></div>
   <div className="client-intel-stats">
    <div><small>REGISTERED CLIENTS</small><strong>{Number(data.clientActivity.summary?.registered_total||0).toLocaleString('en-NG')}</strong><span>{Number(data.clientActivity.summary?.joined_7d||0).toLocaleString('en-NG')} joined in 7 days</span></div>
    <div><small>ACTIVE · LAST 30 DAYS</small><strong>{Number(data.clientActivity.summary?.interacted_30d||0).toLocaleString('en-NG')}</strong><span>Registered clients active on the app</span></div>
    <div><small>ONLINE NOW</small><strong>{Number(data.clientActivity.summary?.online_now||0).toLocaleString('en-NG')}</strong><span>Live heartbeat · 90 sec expiry</span></div>
    <div><small>INSPECTION BOOKINGS</small><strong>{Number(data.clientActivity.summary?.inspection_total||0).toLocaleString('en-NG')}</strong><span>{Number(data.clientActivity.summary?.inspection_pending||0).toLocaleString('en-NG')} awaiting review</span></div>
   </div>
   <div className="client-intel-columns">
    <div className="client-intel-panel"><h3>ONLINE CLIENTS <span>{data.clientActivity.online?.length||0}</span></h3>{(data.clientActivity.online||[]).length===0?<p className="client-intel-empty">No registered clients are currently online.</p>:(data.clientActivity.online||[]).map(x=><div className="client-intel-row" key={x.id}><div><b>{x.full_name}</b><small>{x.email}</small></div><time>{ago(x.last_seen_at,clock)}</time></div>)}</div>
    <div className="client-intel-panel"><h3>RECENT CLIENT ACTIVITY <span>{data.clientActivity.recent?.length||0}</span></h3>{(data.clientActivity.recent||[]).length===0?<p className="client-intel-empty">New registrations, messages and inspection requests will appear here.</p>:(data.clientActivity.recent||[]).map((x,i)=><div className="client-intel-row" key={x.activity_type+'-'+x.email+'-'+x.happened_at+'-'+i}><div><b>{x.full_name||'G-BEST client'}</b><small>{x.description} · {x.activity_type}</small></div><time>{ago(x.happened_at,clock)}</time></div>)}</div>
   </div>
  </section>}
  <section className="section"><div className="sectionhead"><div><span className="eyebrow">{data?.isSuperAdmin?'COMPANY OPERATIONS':'YOUR ACCESS'}</span><h2>Departments</h2></div><small>{cards.length} available</small></div>
   {data&&cards.length?<div className="departments">{cards.map(x=><Link href={x.href} className="department" key={x.key}><span className="ico">{x.icon}</span><span className="copy"><strong>{x.title}</strong><small>{x.description}</small></span><span className="arrow">↗</span></Link>)}</div>:data?<p className="empty">No departments are assigned to this account yet. Your Super Admin controls access.</p>:null}
  </section>
  <footer>G-BEST LUXURY REALTY <span>·</span> SECURE WORKSPACE {data?.generatedAt?'· UPDATED '+new Date(data.generatedAt).toLocaleTimeString('en-NG',{timeZone:'Africa/Lagos',hour:'numeric',minute:'2-digit',hour12:true}):''}</footer>
 </div>
 <style jsx>{`
 .client-intel{margin:20px 0 24px;padding:16px;border:1px solid #ffffff20;border-radius:14px;background:linear-gradient(145deg,#202821,#171d19)}
 .client-intel-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px}
 .client-intel-heading h2{font-size:23px;margin:5px 0;color:#f2f5ef}
 .client-intel-heading p{font-size:11px;line-height:1.5;color:#aab5ad;margin:5px 0 0;max-width:620px}
 .client-intel-refresh{font-size:9px;color:#c9ed70;letter-spacing:.1em;font-weight:800}
 .client-intel-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:12px}
 .client-intel-stats>div{min-width:0;padding:13px;border:1px solid #ffffff18;border-radius:10px;background:#111713}
 .client-intel-stats small{display:block;font-size:8px;line-height:1.35;letter-spacing:.12em;color:#aab5ad;font-weight:850}
 .client-intel-stats strong{display:block;font-size:25px;line-height:1.1;color:#d9f79b;margin:7px 0}
 .client-intel-stats span{display:block;font-size:9px;line-height:1.4;color:#9eaaa1}
 .client-intel-columns{display:grid;grid-template-columns:1fr 1fr;gap:10px}
 .client-intel-panel{min-width:0;padding:12px;border:1px solid #ffffff18;border-radius:10px;background:#111713}
 .client-intel-panel h3{display:flex;justify-content:space-between;gap:10px;margin:0 0 8px;color:#d9f79b;font-size:9px;letter-spacing:.12em}
 .client-intel-panel h3 span{color:#aab5ad}
 .client-intel-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #ffffff12}
 .client-intel-row>div{display:grid;gap:3px;min-width:0}
 .client-intel-row b{font-size:11px;color:#eef3ed;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .client-intel-row small{font-size:9px;color:#9eaaa1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .client-intel-row time{font-size:9px;color:#c9ed70;white-space:nowrap}
 .client-intel-empty{font-size:10px;color:#9eaaa1;padding:10px 0}
 .dash{min-height:calc(100dvh - 60px);padding:clamp(16px,3vw,34px);background:#111512;color:#f2f5ef}
 .inner{max-width:1120px;margin:0 auto}
 .head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-bottom:22px;border-bottom:1px solid #ffffff19}
 .eyebrow{font:800 9px/1.4 ui-monospace,monospace;letter-spacing:.17em;color:#c9ee72}
 h1{font-size:clamp(26px,4vw,38px);letter-spacing:-.05em;margin:7px 0 4px;line-height:1.1}
 .head p{font-size:13px;color:#a4afa6;margin:0;line-height:1.5}
 button{border:1px solid #d8f68d;border-radius:9px;padding:10px 14px;background:#c9ed70;color:#17210f;font-size:11px;font-weight:800;white-space:nowrap}
 button:disabled{opacity:.65}
 .stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:20px 0}
 .stat{min-width:0;padding:14px;border:1px solid #ffffff18;border-radius:12px;background:#1d241f;color:inherit;text-decoration:none;display:flex;flex-direction:column;gap:6px}
 .stat span,.finance span{font-size:9px;letter-spacing:.12em;color:#a2afa5;font-weight:800}
 .stat strong{font-size:26px;line-height:1.1;letter-spacing:-.04em;color:#e9f4df}
 .stat small{font-size:10px;color:#9ba89e;line-height:1.35}
 .finance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 22px;padding:13px;border:1px solid #ffffff16;border-radius:12px;background:#191f1b}
 .finance div{display:flex;flex-direction:column;gap:7px;min-width:0}.finance strong{font-size:17px;overflow-wrap:anywhere;color:#d7f49b}
 .section{margin-top:24px;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important}.sectionhead{background:transparent!important}.sectionhead{display:flex;align-items:end;justify-content:space-between;margin-bottom:10px}
 h2{font-size:21px;letter-spacing:-.03em;margin:4px 0 0}.sectionhead small{font-size:10px;color:#8f9d92}
 .departments{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
 .department{display:flex;align-items:center;gap:12px;min-width:0;padding:14px;border:1px solid #ffffff18;border-radius:12px;background:linear-gradient(140deg,#222a24,#191f1b);color:#f2f5ef;text-decoration:none;transition:border-color .15s,background .15s}
 .department:active{background:#2b352d}.department:hover{border-color:#9dc65b}
 .ico{width:36px;height:36px;flex:0 0 36px;border-radius:10px;display:grid;place-items:center;background:#d7f29a;color:#192516;font-size:19px}
 .copy{display:flex;flex-direction:column;gap:4px;min-width:0}.copy strong{font-size:13px}.copy small{font-size:10px;color:#9eaaa1;line-height:1.35}
 .arrow{margin-left:auto;color:#c9ed70;font-size:17px}
 .loading,.empty{padding:16px;background:#1a201c;border:1px solid #ffffff18;border-radius:11px;color:#aab5ad;font-size:12px}
 .error{margin:14px 0;padding:11px;border-radius:9px;background:#40231e;color:#ffd3c8;font-size:12px}
 footer{margin-top:28px;padding-top:13px;border-top:1px solid #ffffff16;color:#819087;font:9px ui-monospace,monospace;letter-spacing:.06em}footer span{color:#c9ed70}
 @media(max-width:720px){.client-intel{padding:12px}.client-intel-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.client-intel-columns{grid-template-columns:1fr}.client-intel-row b{white-space:normal}.dash{padding:16px 13px 26px}.head{align-items:flex-start;padding-bottom:16px}.head p{font-size:11px;max-width:260px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0}.stat{padding:11px;border-radius:10px}.stat strong{font-size:23px}.finance{gap:6px;padding:10px}.finance strong{font-size:14px}.finance span{font-size:8px}.section{margin-top:20px}.departments{grid-template-columns:1fr;gap:7px}.department{padding:12px}.copy strong{font-size:12px}.copy small{font-size:10px}}
 @media(max-width:600px){.dash section[aria-label='Client activity and live presence']{padding:12px!important}.dash section[aria-label='Client activity and live presence']>div:nth-of-type(2){grid-template-columns:1fr!important}.dash section[aria-label='Client activity and live presence']>div:nth-of-type(2)>div:first-child{order:1}.dash section[aria-label='Client activity and live presence']>div:nth-of-type(2)>div:last-child{order:2}}
 @media(max-width:360px){.head{gap:8px}.head button{padding:8px;font-size:10px}.finance{grid-template-columns:1fr}.finance div{flex-direction:row;justify-content:space-between;align-items:center}}

 /* Mobile layout hardening: isolate this workspace from legacy admin/global styles. */
 .dash .stats{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;align-items:stretch!important}
 .dash .stats{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;align-items:stretch!important}
 .dash a.stat{display:grid!important;grid-template-rows:auto auto 1fr!important;grid-template-columns:minmax(0,1fr)!important;align-content:start!important;justify-items:start!important;gap:7px!important;min-width:0!important;min-height:104px!important;box-sizing:border-box!important;overflow:hidden!important;padding:14px!important;border:1px solid #ffffff24!important;border-radius:12px!important;background:linear-gradient(145deg,#242d26,#19201b)!important;color:#f2f5ef!important;text-decoration:none!important;white-space:normal!important;line-height:1.35!important}
 .dash a.stat .stat-label{display:block!important;grid-row:1!important;grid-column:1!important;width:100%!important;margin:0!important;color:#b7c5b8!important;font-size:9px!important;line-height:1.3!important;letter-spacing:.13em!important;font-weight:850!important}
 .dash a.stat .stat-value{display:block!important;grid-row:2!important;grid-column:1!important;width:100%!important;margin:0!important;color:#e9f4df!important;font-size:27px!important;line-height:1.05!important;font-weight:850!important;letter-spacing:-.04em!important}
 .dash a.stat .stat-detail{display:block!important;grid-row:3!important;grid-column:1!important;width:100%!important;margin:0!important;color:#aab7ac!important;font-size:10px!important;line-height:1.35!important;white-space:normal!important;overflow-wrap:anywhere!important}
 .dash .finance{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important;margin:0 0 24px!important;padding:15px!important;border:1px solid #ffffff20!important;border-radius:13px!important;background:linear-gradient(145deg,#202821,#171d19)!important}
 .dash .finance div{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:8px!important;min-width:0!important}
 .dash .finance span{display:block!important;color:#aab9ac!important;font-size:9px!important;line-height:1.35!important;letter-spacing:.12em!important;font-weight:850!important}
 .dash .finance strong{display:block!important;color:#d7f49b!important;font-size:clamp(15px,2.2vw,21px)!important;line-height:1.15!important;overflow-wrap:anywhere!important;white-space:normal!important}
 .dash .department{display:grid!important;grid-template-columns:42px minmax(0,1fr) 20px!important;align-items:center!important;gap:12px!important;min-width:0!important;min-height:88px!important;box-sizing:border-box!important;padding:14px!important;border:1px solid #ffffff24!important;border-radius:13px!important;background:linear-gradient(145deg,#242d26,#191f1b)!important;color:#f2f5ef!important;text-decoration:none!important;box-shadow:0 8px 22px #0003!important}
 .dash .department .copy{display:flex!important;flex-direction:column!important;gap:5px!important;min-width:0!important}
 .dash .department .copy strong{display:block!important;font-size:13px!important;line-height:1.3!important;color:#f2f5ef!important}
 .dash .department .copy small{display:block!important;font-size:10px!important;line-height:1.4!important;color:#aab5ad!important;white-space:normal!important}
 .dash .department .arrow{display:block!important;text-align:right!important;color:#c9ed70!important;font-size:20px!important}
 .dash .sectionhead{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:12px!important;margin:0 0 12px!important;padding:0!important;background:transparent!important}
 .dash .sectionhead h2{display:block!important;margin:5px 0 0!important;color:#f2f5ef!important;font-size:22px!important;line-height:1.15!important;font-weight:800!important;letter-spacing:-.03em!important;visibility:visible!important;opacity:1!important}
 .dash .sectionhead small{color:#aab5ad!important;font-size:10px!important}
 .dash .departments{display:grid!important;grid-template-columns:1fr!important;gap:10px!important}
 .dash .department{display:flex!important;align-items:center!important;gap:12px!important;min-height:78px!important;box-sizing:border-box!important;padding:13px!important;border:1px solid #ffffff22!important;border-radius:12px!important;background:linear-gradient(140deg,#222a24,#191f1b)!important;color:#f2f5ef!important;text-decoration:none!important;box-shadow:0 8px 20px #0003!important}
 .dash .department .ico{display:grid!important;place-items:center!important;flex:0 0 40px!important;width:40px!important;height:40px!important;border-radius:10px!important;background:#d7f29a!important;color:#192516!important}
 .dash .department .copy{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;gap:4px!important;min-width:0!important}
 .dash .department .copy strong{display:block!important;color:#f2f5ef!important;font-size:13px!important;line-height:1.3!important}
 .dash .department .copy small{display:block!important;color:#aab5ad!important;font-size:10px!important;line-height:1.4!important;white-space:normal!important}
 .dash .department .arrow{display:block!important;flex:0 0 auto!important;margin-left:auto!important;color:#c9ed70!important;font-size:19px!important}
 .dash .empty{display:block!important;margin:0!important;padding:16px!important;background:#1a201c!important;border:1px solid #ffffff20!important;border-radius:11px!important;color:#b8c4ba!important;font-size:12px!important;line-height:1.5!important}
 .dash footer{min-height:88px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:12px!important;padding:20px 12px!important;background:#080a08!important;border:1px solid #ffffff13!important;border-radius:10px!important;color:#b7c1b8!important;text-align:center!important;line-height:1.6!important}
 @media(max-width:720px){.dash{padding:18px 14px 30px!important}.dash .head{align-items:flex-start!important}.dash .head h1{font-size:clamp(27px,8vw,36px)!important}.dash .stats{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}.dash a.stat{min-height:100px!important;padding:12px!important}.dash .finance{gap:8px!important;padding:12px!important}.dash .finance span{font-size:8px!important}.dash .finance strong{font-size:clamp(13px,3.6vw,17px)!important}.dash .section{margin-top:24px!important}.dash .sectionhead h2{font-size:21px!important}.dash .departments{grid-template-columns:1fr!important;gap:9px!important}.dash .department{min-height:82px!important;padding:13px!important}}
 `}</style></main>;
}