'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';

const modules=[
 {key:'properties',label:'Properties',description:'Add, edit, publish and archive company listings',href:'/admin/super',icon:'⌂'},
 {key:'clients',label:'Clients & payments',description:'Review registrations, receipts and payment decisions',href:'/admin/clients',icon:'♙'},
 {key:'inspections',label:'Inspections & calendar',description:'Approve visits and manage the company schedule',href:'/admin',icon:'◷'},
 {key:'staff',label:'People & permissions',description:'Invite staff and control what each person can do',href:'/admin/super/staff',icon:'♧'},
 {key:'media',label:'Media library',description:'Organise property photos and company assets',href:'/admin/super/media',icon:'▧'},
 {key:'homepage',label:'Website content studio',description:'Update homepage sections and public presentation',href:'/admin/super/homepage',icon:'▤'}
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


 return <main className="ops">
  <style jsx>{`
   .ops{min-height:calc(100vh - 66px);background:radial-gradient(ellipse at 80% -12%,#d8e7d0 0,transparent 34%),linear-gradient(135deg,#edf2eb 0%,#e8eee6 52%,#f4f6f1 100%);color:#172b20;padding:25px clamp(16px,2.6vw,34px) 42px}
   .wrap{max-width:1540px;margin:0 auto;perspective:1400px}
   .pagehead{position:relative}
   .pagehead:after{content:"";position:absolute;right:0;top:-12px;width:210px;height:90px;pointer-events:none;background:radial-gradient(ellipse,#c9dcbf88,transparent 70%);filter:blur(8px)}
   .metric{position:relative;transform:perspective(1000px) rotateX(2deg) translateZ(0);transition:transform .22s ease,box-shadow .22s ease}
   .metric:hover{transform:perspective(1000px) rotateX(0) translateY(-5px) translateZ(5px);box-shadow:0 22px 36px #102d1920,0 5px 10px #102d190b,inset 0 1px #fff}
   .panel{transform:perspective(1200px) rotateX(.35deg);transition:box-shadow .2s ease}
   .moduleicon{box-shadow:inset 0 1px #fff,0 3px 8px #183b2410}
   .quick{transform:perspective(700px) rotateX(1deg);transition:transform .2s,box-shadow .2s}
   .quick:hover{transform:perspective(700px) rotateX(0) translateY(-4px) translateZ(4px)}
   .pagehead h1{font-size:clamp(26px,3vw,38px);letter-spacing:-.055em}
   .sectionline{margin-top:26px}
   .module a,.metric a{transition:background .18s,color .18s}
   .module a:hover,.metric a:hover{background:#eaf2e5;color:#1d4e30}
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
   .metric{min-width:0;background:linear-gradient(145deg,#fff 0%,#f5f8f2 72%,#eaf1e6 100%);border:1px solid #d5e0d1;border-radius:13px;padding:17px 17px 14px;box-shadow:0 12px 24px #102d1910,0 3px 7px #102d1908,inset 0 1px #fff;transform:perspective(900px) rotateX(1deg);transition:transform .2s,box-shadow .2s}.metric:hover{transform:perspective(900px) translateY(-4px) rotateX(0);box-shadow:0 20px 32px #102d1920,0 5px 9px #102d190a,inset 0 1px #fff}
   .metric-top{display:flex;justify-content:space-between;align-items:center;color:#6f7f72;font:800 9px ui-monospace,monospace;letter-spacing:.12em}
   .metric-dot{width:7px;height:7px;border-radius:50%;background:#83a96a}
   .metric-dot.amber{background:#c49b4e}.metric-dot.blue{background:#7796aa}
   .metric strong{display:block;font-size:32px;letter-spacing:-.06em;font-weight:750;margin:14px 0 3px;color:#1b3425}
   .metric p{font-size:10px;color:#7a877c;margin:0;min-height:15px}
   .metric a{display:flex;justify-content:space-between;align-items:center;margin-top:15px;padding-top:10px;border-top:1px solid #e7ece4;color:#3e6547;font:800 9px ui-monospace,monospace;letter-spacing:.08em}
   .metric a span{font-size:14px}
   .actionbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}
   .actioncard{display:flex;align-items:center;gap:14px;padding:15px 17px;border:1px solid #d9e4d5;border-radius:12px;background:linear-gradient(145deg,#fff,#f3f7ef);box-shadow:0 9px 20px #102d190d}
   .actioncount{width:42px;height:42px;display:grid;place-items:center;border-radius:11px;background:#e8f1e2;color:#28583a;font-size:19px;font-weight:850;box-shadow:inset 0 1px #fff,0 3px 7px #163b2410}
   .actioncard strong{display:block;color:#284332;font-size:12px}.actioncard p{margin:4px 0 0;color:#778579;font-size:10px}
   .actioncard a{margin-left:auto;white-space:nowrap;color:#315f3d;font:800 9px ui-monospace,monospace;border:1px solid #d8e4d3;border-radius:7px;padding:8px 10px}
   .columns{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.75fr);gap:12px;margin-top:14px}
   .panel{background:linear-gradient(145deg,#fff,#f6f9f4);border:1px solid #d6e1d2;border-radius:13px;overflow:hidden;box-shadow:0 14px 28px #102d1910,0 3px 8px #102d1908,inset 0 1px #fff}
   .panelhead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid #e6ebe3}
   .panelhead h2{margin:0;font-size:10px;letter-spacing:.13em;color:#52695a}
   .panelhead small{font:9px ui-monospace,monospace;color:#89958b}
   .module{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:11px;align-items:center;padding:14px 16px;border-bottom:1px solid #edf0eb;transition:background .18s,transform .18s}.module:hover{background:#f2f7ef;transform:translateX(3px)}
   .module:last-child{border-bottom:0}
   .moduleicon{width:31px;height:31px;display:grid;place-items:center;border:1px solid #dfe8da;border-radius:7px;background:#f1f6ed;color:#31583b;font-size:16px}
   .module strong{display:block;font-size:11px;color:#2a4030}.module p{margin:4px 0 0;font-size:9px;color:#859087}
   .module a{font:800 9px ui-monospace,monospace;letter-spacing:.05em;color:#4a704f;padding:7px 9px;border:1px solid #dbe5d6;border-radius:6px;white-space:nowrap}
   .quickgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:13px}
   .quick{min-height:78px;padding:12px;border:1px solid #dce6d8;border-radius:10px;background:linear-gradient(145deg,#fff,#edf4e9);display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 5px 12px #163c200b,inset 0 1px #fff;transition:transform .18s,box-shadow .18s}.quick:hover{transform:translateY(-3px);box-shadow:0 12px 20px #163c2018}
   .quick span{font-size:17px;color:#507253}.quick strong{font-size:10px;color:#304a36}.quick small{font-size:8px;color:#879287}
   .systemrow{display:flex;justify-content:space-between;gap:12px;padding:11px 15px;border-top:1px solid #edf0eb;font-size:9px;color:#718074}
   .systemrow b{font-weight:750;color:#4b6550}
   .error{margin:14px 0;padding:12px 14px;background:#fff4f1;border:1px solid #efd6ce;border-radius:7px;color:#9b493a;font-size:11px}
   .empty{padding:24px 16px;color:#7b887e;font-size:11px}
   .foot{display:flex;justify-content:space-between;gap:12px;margin-top:16px;color:#8a958b;font:9px ui-monospace,monospace;letter-spacing:.04em}
   @media(max-width:950px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}}
   @media(max-width:520px){.actionbar{grid-template-columns:1fr}.actioncard{padding:12px}.actioncard a{font-size:8px;padding:7px}.ops{padding-top:17px}.pagehead{align-items:flex-start;flex-direction:column}.headtools{width:100%;justify-content:space-between}.metrics{gap:8px}.metric{padding:12px}.metric strong{font-size:27px}.metric p{font-size:9px}.quickgrid{grid-template-columns:1fr 1fr}.foot{flex-direction:column}}
  `}</style>

  <div className="wrap">
   <header className="pagehead">
    <div><div className="eyebrow">G-BEST / EXECUTIVE OPERATIONS / 01</div><h1>Welcome to your control room</h1><p className="sub">Your central workspace for properties, clients, inspections and the team. Choose a department below to get work done.</p></div>
    <div className="headtools"><span className="live"><i/> SECURE ADMIN SESSION</span><button onClick={load} disabled={busy}>{busy?'SYNCING…':'↻  REFRESH DATA'}</button></div>
   </header>

   {error&&<div className="error" role="alert">{error}</div>}

   <div className="sectionline"><h2>YOUR BUSINESS AT A GLANCE</h2><span>{lastUpdated?'UPDATED '+lastUpdated.toLocaleTimeString():'WAITING FOR DATABASE'}</span></div>
   {data?<div className="metrics">
    <Metric label="PROPERTY PORTFOLIO" value={data.properties.total} detail={(data.properties.published||0)+' published · '+(data.properties.drafts||0)+' drafts'} href="/admin/super"/>
    <Metric label="CLIENT RECORDS" value={data.clients.total} detail={(data.clients.pending||0)+' payment reviews pending'} href="/admin/clients" accent="amber"/>
    <Metric label="INSPECTION PIPELINE" value={data.inspections.total} detail={(data.inspections.pending||0)+' pending · '+(data.inspections.confirmed||0)+' confirmed'} href="/admin" accent="blue"/>
    <Metric label="MEDIA LIBRARY" value={data.media.total} detail="Images and brand assets stored for the website" href="/admin/super/media"/>
   </div>:<div className="panel empty">{busy?'Connecting to the company database…':'No live metrics are available. Refresh to retry.'}</div>}

   {data&&<><div className="sectionline"><h2>NEEDS YOUR ATTENTION</h2><span>LIVE WORK QUEUE</span></div><div className="actionbar"><article className="actioncard"><span className="actioncount">{Number(data.clients.pending||0).toLocaleString()}</span><div><strong>Client payments awaiting review</strong><p>Check submitted registrations and payment evidence.</p></div><Link href="/admin/clients">REVIEW ↗</Link></article><article className="actioncard"><span className="actioncount">{Number(data.inspections.pending||0).toLocaleString()}</span><div><strong>Inspection requests awaiting action</strong><p>Review requested visits and confirm the schedule.</p></div><Link href="/admin">OPEN DESK ↗</Link></article></div></>}
   <div className="columns">
    <section className="panel">
     <div className="panelhead"><h2>COMPANY WORKSPACE</h2><small>CHOOSE A DEPARTMENT</small></div>
     {modules.map(item=><div className="module" key={item.key}><span className="moduleicon">{item.icon}</span><div><strong>{item.label}</strong><p>{item.description}</p></div><Link href={item.href}>OPEN ↗</Link></div>)}
    </section>
    <section className="panel">
     <div className="panelhead"><h2>QUICK OPERATIONS</h2><small>COMMON TASKS</small></div>
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
