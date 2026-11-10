'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
const catalog=[
 {key:'properties',permission:'properties',title:'Properties',description:'Manage listings and availability',href:'/admin/super',icon:'⌂'},
 {key:'clients',permission:'clients',title:'Clients & payments',description:'Review client registrations and receipts',href:'/admin/clients',icon:'♙'},
 {key:'inspections',permission:'inspections',title:'Inspections',description:'Review requests and manage appointments',href:'/admin',icon:'◷'},
 {key:'media',permission:'media',title:'Media library',description:'Manage property photos and company assets',href:'/admin/super/media',icon:'▧'},
 {key:'finance',permission:'finance',title:'Company finance',description:'Review income, expenses and ledger',href:'/admin/super/finance',icon:'₦'},
 {key:'staff',permission:'staff',title:'Staff & permissions',description:'Invite employees and assign access',href:'/admin/super/staff',icon:'♧'},
 {key:'homepage',permission:'homepage',title:'Website content',description:'Update the public website',href:'/admin/super/homepage',icon:'▤'},
 {key:'activity',permission:'audit',title:'Activity & audit',description:'Review changes made across the system',href:'/admin/super/activity',icon:'≋'}
];
function Stat({label,value,detail,href}){return <Link href={href} className="stat"><span>{label}</span><strong>{value??0}</strong><small>{detail}</small></Link>}
export default function AdminOverview(){
 const [data,setData]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const load=useCallback(async()=>{setBusy(true);setError('');try{const r=await fetch('/api/admin/overview',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not load your workspace.');setData(d)}catch(e){setError(e.message||'Unable to load your workspace.')}finally{setBusy(false)}},[]);
 useEffect(()=>{load()},[load]);
 const permissions=new Set(data?.permissions||[]);
 const cards=catalog.filter(x=>x.key==='staff'?data?.isSuperAdmin: x.key==='homepage'?data?.isSuperAdmin: x.key==='activity'?data?.isSuperAdmin:permissions.has(x.permission));
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
  {data?.isSuperAdmin&&data.finance&&<section className="finance"><div><span>PAYMENTS VERIFIED</span><strong>{data.finance.approved_count||0}</strong></div><div><span>VERIFIED VALUE</span><strong>₦{Number(data.finance.approved_amount||0).toLocaleString('en-NG',{maximumFractionDigits:2})}</strong></div><div><span>AWAITING REVIEW</span><strong>{data.finance.pending_count||0}</strong></div></section>}
  <section className="section"><div className="sectionhead"><div><span className="eyebrow">{data?.isSuperAdmin?'COMPANY OPERATIONS':'YOUR ACCESS'}</span><h2>Departments</h2></div><small>{cards.length} available</small></div>
   {data&&cards.length?<div className="departments">{cards.map(x=><Link href={x.href} className="department" key={x.key}><span className="ico">{x.icon}</span><span className="copy"><strong>{x.title}</strong><small>{x.description}</small></span><span className="arrow">↗</span></Link>)}</div>:data?<p className="empty">No departments have been assigned to this account yet. Contact your Super Admin.</p>:null}
  </section>
  <footer>G-BEST LUXURY REALTY <span>·</span> SECURE WORKSPACE {data?.generatedAt?'· UPDATED '+new Date(data.generatedAt).toLocaleTimeString():''}</footer>
 </div>
 <style jsx>{`
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
 .section{margin-top:24px}.sectionhead{display:flex;align-items:end;justify-content:space-between;margin-bottom:10px}
 h2{font-size:21px;letter-spacing:-.03em;margin:4px 0 0}.sectionhead small{font-size:10px;color:#8f9d92}
 .departments{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
 .department{display:flex;align-items:center;gap:12px;min-width:0;padding:14px;border:1px solid #ffffff18;border-radius:12px;background:linear-gradient(140deg,#222a24,#191f1b);color:#f2f5ef;text-decoration:none;transition:border-color .15s,background .15s}
 .department:active{background:#2b352d}.department:hover{border-color:#9dc65b}
 .ico{width:36px;height:36px;flex:0 0 36px;border-radius:10px;display:grid;place-items:center;background:#d7f29a;color:#192516;font-size:19px}
 .copy{display:flex;flex-direction:column;gap:4px;min-width:0}.copy strong{font-size:13px}.copy small{font-size:10px;color:#9eaaa1;line-height:1.35}
 .arrow{margin-left:auto;color:#c9ed70;font-size:17px}
 .loading,.empty{padding:18px;border:1px solid #ffffff18;border-radius:11px;color:#aab5ad;font-size:12px;background:#1a201c}
 .error{margin:14px 0;padding:11px;border-radius:9px;background:#40231e;color:#ffd3c8;font-size:12px}
 footer{margin-top:28px;padding-top:13px;border-top:1px solid #ffffff16;color:#819087;font:9px ui-monospace,monospace;letter-spacing:.06em}footer span{color:#c9ed70}
 @media(max-width:720px){.dash{padding:16px 13px 26px}.head{align-items:flex-start;padding-bottom:16px}.head p{font-size:11px;max-width:260px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:14px 0}.stat{padding:11px;border-radius:10px}.stat strong{font-size:23px}.finance{gap:6px;padding:10px}.finance strong{font-size:14px}.finance span{font-size:8px}.section{margin-top:20px}.departments{grid-template-columns:1fr;gap:7px}.department{padding:12px}.copy strong{font-size:12px}.copy small{font-size:10px}}
 @media(max-width:360px){.head{gap:8px}.head button{padding:8px;font-size:10px}.finance{grid-template-columns:1fr}.finance div{flex-direction:row;justify-content:space-between;align-items:center}}
 `}</style></main>;
}