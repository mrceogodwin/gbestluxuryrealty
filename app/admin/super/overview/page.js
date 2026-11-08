'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';

const modules=[
 {key:'properties',label:'Property portfolio',description:'Listings, drafts and availability',href:'/admin/super',icon:'⌂'},
 {key:'clients',label:'Client registrations',description:'Client records and payment review',href:'/admin/clients',icon:'♙'},
 {key:'inspections',label:'Inspections & bookings',description:'Requests, confirmations and calendar',href:'/admin',icon:'◷'},
 {key:'media',label:'Media library',description:'Company property and brand assets',href:'/admin/super/media',icon:'▧'}
];

function Metric({label,value,detail,href,accent='green'}){
 return <article className="metric">
  <div className="metric-top"><span>{label}</span><i className={'metric-dot '+accent}/></div>
  <strong>{Number(value||0).toLocaleString()}</strong>
  <p>{detail}</p>
  <Link href={href}>OPEN MODULE <span>↗</span></Link>
 </article>;
}

export default function AdminOverview(){
 const [data,setData]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [lastUpdated,setLastUpdated]=useState(null);

 async function load(){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/admin/overview',{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||'Could not load company operations.');
   setData(result);setLastUpdated(new Date(result.generatedAt||Date.now()));
  }catch(err){setError(err.message||'Could not connect to the management database.');}
  finally{setBusy(false);}
 }

 useEffect(()=>{load();},[]);

 const totals=data?[
  {label:'PROPERTIES',value:data.properties.total,detail:(data.properties.published||0)+' published · '+(data.properties.drafts||0)+' drafts',href:'/admin/super'},
  {label:'CLIENTS',value:data.clients.total,detail:(data.clients.pending||0)+' payment reviews pending',href:'/admin/clients'},
  {label:'INSPECTIONS',value:data.inspections.total,detail:(data.inspections.pending||0)+' pending · '+(data.inspections.confirmed||0)+' confirmed',href:'/admin'},
  {label:'MEDIA ASSETS',value:data.media.total,detail:'Company library assets',href:'/admin/super/media'}
 ]:[];

 return <main className="ops">
  <style jsx>{`
   .ops{min-height:calc(100vh - 66px);background:#edf1eb;color:#172b20;padding:25px clamp(16px,2.6vw,34px) 42px}
   .wrap{max-width:1540px;margin:0 auto}
   .pagehead{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding:2px 0 19px;border-bottom:1px solid #d4ddd2}
   .eyebrow{font:800 9px/1.4 ui-monospace,SFMono-Regular,monospace;letter-spacing:.19em;color:#64806b}
   h1{font-size:clamp(23px,2.5vw,31px);letter-spacing:-.045em;line-height:1.1;margin:8px 0 5px;font-weight:760;color:#14281c}
   .sub{font-size:11px;color:#6d7b70;margin:0;line-height:1.6}
   .headtools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
   .live{display:flex;align-items:center;gap:8px;border:1px solid #d5e2d0;background:#f6faf3;color:#416447;border-radius:7px;padding:8px 10px;font-size:9px;font-weight:800;letter-spacing:.08em}
   .live i{width:6px;height:6px;border-radius:50%;background:#69a65a;box-shadow:0 0 0 3px #69a65a20}
   button{border:1px solid #cbd7c8;background:#fff;color:#284c34;border-radius:7px;padding:9px 12px;font-size:10px;font-weight:800}
   button:disabled{opacity:.55;cursor:wait}
   .sectionline{display:flex;align-items:center;justify-content:space-between;margin:22px 0 10px}
   .sectionline h2{font-size:10px;letter-spacing:.13em;margin:0;color:#52695a}
   .sectionline span{font:10px ui-monospace,monospace;color:#829087}
   .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}
   .metric{min-width:0;background:#fbfcfa;border:1px solid #dce4d9;border-radius:9px;padding:15px 16px 13px;box-shadow:0 2px 5px #102d1908}
   .metric-top{display:flex;justify-content:space-between;align-items:center;color:#6f7f72;font:800 9px ui-monospace,monospace;letter-spacing:.12em}
   .metric-dot{width:7px;height:7px;border-radius:50%;background:#83a96a}
   .metric-dot.amber{background:#c49b4e}.metric-dot.blue{background:#7796aa}
   .metric strong{display:block;font-size:32px;letter-spacing:-.06em;font-weight:750;margin:14px 0 3px;color:#1b3425}
   .metric p{font-size:10px;color:#7a877c;margin:0;min-height:15px}
   .metric a{display:flex;justify-content:space-between;align-items:center;margin-top:15px;padding-top:10px;border-top:1px solid #e7ece4;color:#3e6547;font:800 9px ui-monospace,monospace;letter-spacing:.08em}
   .metric a span{font-size:14px}
   .columns{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.75fr);gap:12px;margin-top:14px}
   .panel{background:#fbfcfa;border:1px solid #dce4d9;border-radius:9px;overflow:hidden}
   .panelhead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #e6ebe3}
   .panelhead h2{margin:0;font-size:10px;letter-spacing:.13em;color:#52695a}
   .panelhead small{font:9px ui-monospace,monospace;color:#89958b}
   .module{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:11px;align-items:center;padding:13px 16px;border-bottom:1px solid #edf0eb}
   .module:last-child{border-bottom:0}
   .moduleicon{width:31px;height:31px;display:grid;place-items:center;border:1px solid #dfe8da;border-radius:7px;background:#f1f6ed;color:#31583b;font-size:16px}
   .module strong{display:block;font-size:11px;color:#2a4030}.module p{margin:4px 0 0;font-size:9px;color:#859087}
   .module a{font:800 9px ui-monospace,monospace;letter-spacing:.05em;color:#4a704f;padding:7px 9px;border:1px solid #dbe5d6;border-radius:6px;white-space:nowrap}
   .quickgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:13px}
   .quick{min-height:72px;padding:11px;border:1px solid #e1e8de;border-radius:7px;background:#f7faf5;display:flex;flex-direction:column;justify-content:space-between}
   .quick span{font-size:17px;color:#507253}.quick strong{font-size:10px;color:#304a36}.quick small{font-size:8px;color:#879287}
   .systemrow{display:flex;justify-content:space-between;gap:12px;padding:11px 15px;border-top:1px solid #edf0eb;font-size:9px;color:#718074}
   .systemrow b{font-weight:750;color:#4b6550}
   .error{margin:14px 0;padding:12px 14px;background:#fff4f1;border:1px solid #efd6ce;border-radius:7px;color:#9b493a;font-size:11px}
   .empty{padding:24px 16px;color:#7b887e;font-size:11px}
   .foot{display:flex;justify-content:space-between;gap:12px;margin-top:16px;color:#8a958b;font:9px ui-monospace,monospace;letter-spacing:.04em}
   @media(max-width:950px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}}
   @media(max-width:520px){.ops{padding-top:17px}.pagehead{align-items:flex-start;flex-direction:column}.headtools{width:100%;justify-content:space-between}.metrics{gap:8px}.metric{padding:12px}.metric strong{font-size:27px}.metric p{font-size:9px}.quickgrid{grid-template-columns:1fr 1fr}.foot{flex-direction:column}}
  `}</style>

  <div className="wrap">
   <header className="pagehead">
    <div><div className="eyebrow">G-BEST / EXECUTIVE OPERATIONS / 01</div><h1>Operations overview</h1><p className="sub">Company-wide activity, portfolio performance and operational access.</p></div>
    <div className="headtools"><span className="live"><i/> SECURE ADMIN SESSION</span><button onClick={load} disabled={busy}>{busy?'SYNCING…':'↻  REFRESH DATA'}</button></div>
   </header>

   {error&&<div className="error" role="alert">{error}</div>}

   <div className="sectionline"><h2>BUSINESS SNAPSHOT</h2><span>{lastUpdated?'UPDATED '+lastUpdated.toLocaleTimeString():'WAITING FOR DATABASE'}</span></div>
   {data?<div className="metrics">
    <Metric label="PROPERTY PORTFOLIO" value={data.properties.total} detail={(data.properties.published||0)+' published · '+(data.properties.drafts||0)+' drafts'} href="/admin/super"/>
    <Metric label="CLIENT RECORDS" value={data.clients.total} detail={(data.clients.pending||0)+' payment reviews pending'} href="/admin/clients" accent="amber"/>
    <Metric label="INSPECTION PIPELINE" value={data.inspections.total} detail={(data.inspections.pending||0)+' pending · '+(data.inspections.confirmed||0)+' confirmed'} href="/admin" accent="blue"/>
    <Metric label="MEDIA LIBRARY" value={data.media.total} detail="Company library assets" href="/admin/super/media"/>
   </div>:<div className="panel empty">{busy?'Connecting to the company database…':'No live metrics are available. Refresh to retry.'}</div>}

   <div className="columns">
    <section className="panel">
     <div className="panelhead"><h2>OPERATIONAL MODULES</h2><small>LIVE MODULE ROUTING</small></div>
     {modules.map(item=><div className="module" key={item.key}><span className="moduleicon">{item.icon}</span><div><strong>{item.label}</strong><p>{item.description}</p></div><Link href={item.href}>OPEN ↗</Link></div>)}
    </section>
    <section className="panel">
     <div className="panelhead"><h2>QUICK OPERATIONS</h2><small>ADMIN SHORTCUTS</small></div>
     <div className="quickgrid">
      <Link className="quick" href="/admin/super"><span>⌂</span><strong>Manage properties</strong><small>INVENTORY</small></Link>
      <Link className="quick" href="/admin"><span>◷</span><strong>Review inspections</strong><small>SCHEDULING</small></Link>
      <Link className="quick" href="/admin/clients"><span>♙</span><strong>Client payments</strong><small>REGISTRATION</small></Link>
      <Link className="quick" href="/admin/super/staff"><span>⚙</span><strong>Staff & permissions</strong><small>ACCESS CONTROL</small></Link>
      <Link className="quick" href="/admin/super/media"><span>▧</span><strong>Media library</strong><small>ASSET MANAGEMENT</small></Link>
      <Link className="quick" href="/admin/super/activity"><span>≋</span><strong>Audit activity</strong><small>GOVERNANCE</small></Link>
     </div>
     <div className="systemrow"><span>Database connection</span><b>{data?'CONNECTED':'NOT CONNECTED'}</b></div>
     <div className="systemrow"><span>Metrics endpoint</span><b>/api/admin/overview</b></div>
    </section>
   </div>
   <footer className="foot"><span>G-BEST LUXURY REALTY · INTERNAL CONTROL CONSOLE</span><span>{lastUpdated?'LAST SYNC '+lastUpdated.toLocaleString():'NO SYNC RECORDED'}</span></footer>
  </div>
 </main>;
}
