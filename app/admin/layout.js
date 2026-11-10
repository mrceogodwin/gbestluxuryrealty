'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState,useEffect} from 'react';
import {useRouter} from 'next/navigation';
const groups=[
 {label:'OVERVIEW',items:[['/admin/super/overview','Executive overview','▦']]},
 {label:'PROPERTY OPERATIONS',items:[['/admin/super','Property portfolio','⌂'],['/admin/super/media','Media library','▧']]},
 {label:'CLIENT OPERATIONS',items:[['/admin/clients','Clients & payments','♙'],['/admin','Inspection bookings','◷']]},
 {label:'FINANCE',items:[['/admin/super/finance','Company finance centre','₦']]},
 {label:'PEOPLE & GOVERNANCE',items:[['/admin/super/staff','Staff & permissions','♧'],['/admin/super/activity','Activity & audit trail','≋']]},
 {label:'WEBSITE MANAGEMENT',items:[['/admin/super/homepage','Website studio','◫']]}
];
export default function SuperAdminLayout({children}){
 const path=usePathname(),router=useRouter(),[open,setOpen]=useState(false),[checking,setChecking]=useState(true),[signedIn,setSignedIn]=useState(false),[staff,setStaff]=useState(null);
 useEffect(()=>{if(path==='/admin/login'||path==='/staff/login'||path==='/staff/accept'){setChecking(false);return;}let alive=true;(async()=>{try{const a=await fetch('/api/admin/session',{cache:'no-store'}).then(r=>r.json());if(a.authenticated){if(alive){setStaff(null);setSignedIn(true);setChecking(false)}return;}const s=await fetch('/api/staff/session',{cache:'no-store'}).then(r=>r.json());if(!s.authenticated){router.replace('/staff/login');return;}if(alive){setStaff(s.staff);setSignedIn(true);setChecking(false)}}catch{router.replace('/staff/login')}})();return()=>{alive=false}},[path,router]);
 async function signOut(){if(staff)await fetch('/api/staff/session',{method:'DELETE'});else await fetch('/api/admin/session',{method:'DELETE'});router.replace(staff?'/staff/login':'/admin/login')}
 const access=new Set(staff?.permissions||[]);
 useEffect(()=>{if(!staff||checking)return;if(path.startsWith('/admin/super/staff')||path==='/admin/super/activity'){const fallback=[['dashboard.view','/admin/super/overview'],['properties.manage','/admin/super'],['inspections.view','/admin'],['clients.view','/admin/clients'],['payments.review','/admin/clients']].find(([k])=>access.has(k));router.replace(fallback?fallback[1]:'/staff/login');return;}let required=null;if(path==='/admin/super/overview')required='dashboard.view';else if(path==='/admin/super')required='properties.manage';else if(path.startsWith('/admin/super/media'))required='media.manage';else if(path.startsWith('/admin/super/homepage'))required='homepage.manage';else if(path==='/admin'||path.startsWith('/admin/inspections'))required=['inspections.view','inspections.manage'];else if(path==='/admin/clients')required=['clients.view','clients.manage','payments.review'];else if(path.startsWith('/admin/super/finance'))required='payments.review';else if(path==='/admin/super/activity')required='audit.view';else if(path.startsWith('/admin/super/staff'))required='staff.manage';if(required){const keys=Array.isArray(required)?required:[required];if(!keys.some(k=>access.has(k))){const fallback=[['dashboard.view','/admin/super/overview'],['properties.manage','/admin/super'],['inspections.view','/admin'],['inspections.manage','/admin'],['clients.view','/admin/clients'],['clients.manage','/admin/clients'],['payments.review','/admin/clients'],['media.manage','/admin/super/media'],['homepage.manage','/admin/super/homepage'],['audit.view','/admin/super/activity'],['staff.manage','/admin/super/staff']].find(([k])=>access.has(k));if(fallback)router.replace(fallback[1]);else router.replace('/staff/login');}}},[staff,checking,path,router]);
 const visibleGroups=staff?groups.map(g=>({...g,items:g.items.filter(([href])=>{if(href==='/admin/super/staff')return false;if(href==='/admin/super/overview')return access.has('dashboard.view');if(href==='/admin/super')return access.has('properties.manage');if(href==='/admin/super/media')return access.has('media.manage');if(href==='/admin/super/homepage')return access.has('homepage.manage');if(href==='/admin')return access.has('inspections.view')||access.has('inspections.manage');if(href==='/admin/clients')return access.has('clients.view')||access.has('clients.manage')||access.has('payments.review');if(href==='/admin/super/finance')return access.has('payments.review');if(href==='/admin/super/activity')return false;return false})})).filter(g=>g.items.length):groups;
 if(path==='/admin/login'||path==='/staff/login'||path==='/staff/accept')return <>{children}</>;
 if(checking||!signedIn)return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#edf2eb',color:'#194a32',fontFamily:'system-ui',fontWeight:700}}>SECURING ADMIN WORKSPACE…</div>;
 return <div className="gb-console">
 <style jsx global>{`
 .gb-console{--gc-ink:#eaf2e8;--gc-muted:#9cb2a0;--gc-line:#ffffff14;--gc-lime:#c9eb91;min-height:100vh;background:#edf1eb;color:#183526;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
 .gb-shell{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
 .gb-sidebar{position:sticky;top:0;height:100vh;overflow:auto;background:radial-gradient(ellipse at 0% 0%,#27563c 0,#173c2b 35%,#0b2118 100%);color:var(--gc-ink);padding:22px 15px;display:flex;flex-direction:column;z-index:40;box-shadow:12px 0 32px #102e2018,inset -1px 0 #ffffff10}
 .gb-brand{display:flex;align-items:center;gap:11px;padding:5px 9px 22px;border-bottom:1px solid var(--gc-line);text-decoration:none;color:white}
 .gb-mark{width:39px;height:39px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#e1f7b6,#9fc66d);color:#153a27;font-size:18px;font-weight:950;box-shadow:0 7px 16px #0004,inset 0 1px #fff}
 .gb-brand strong{display:block;font-size:14px;letter-spacing:.12em}.gb-brand small{display:block;color:#aac0ad;font-size:9px;letter-spacing:.18em;margin-top:3px}
 .gb-env{margin:17px 7px 9px;padding:10px 11px;border:1px solid #ffffff18;border-radius:11px;background:linear-gradient(135deg,#ffffff0d,#ffffff04);display:flex;align-items:center;gap:9px;color:#c8d8c8;font-size:10px;letter-spacing:.12em}
 .gb-env i{width:7px;height:7px;border-radius:50%;background:#aee278;box-shadow:0 0 0 4px #aee27820}
 .gb-navgroup{margin-top:19px}.gb-navlabel{padding:0 11px 8px;color:#7f9b85;font-size:9px;font-weight:800;letter-spacing:.2em}
 .gb-navlink{display:flex;align-items:center;gap:12px;min-height:42px;padding:0 11px;margin:3px 0;border:1px solid transparent;border-radius:10px;color:#c0d0c1;text-decoration:none;font-size:12px;font-weight:600;transition:all .18s}
 .gb-navlink:hover{background:#ffffff10;color:white;transform:translateX(2px)}
 .gb-navlink.active{background:linear-gradient(110deg,#d5eea8,#b5d98b);border-color:#f0ffd6;color:#173a27;box-shadow:0 7px 15px #0003,inset 0 1px #fff}
 .gb-navicon{width:20px;text-align:center;font-size:16px;opacity:.9}
 .gb-sidefoot{margin-top:auto;padding:18px 9px 5px;border-top:1px solid var(--gc-line);color:#819b87;font-size:10px;line-height:1.7}
 .gb-main{min-width:0}.gb-topbar{height:66px;background:#f8faf6;border-bottom:1px solid #dce5d9;display:flex;align-items:center;justify-content:space-between;padding:0 clamp(16px,3vw,34px);box-shadow:0 3px 12px #153d2708}
 .gb-crumb{font-size:11px;color:#718276;letter-spacing:.08em}.gb-crumb b{color:#234632}.gb-topright{display:flex;align-items:center;gap:10px;color:#6d7d70;font-size:11px}
 .gb-secure{border:1px solid #d8e5d2;background:#eff6e9;border-radius:99px;padding:7px 10px;color:#426b3d;font-weight:700}
 .gb-mobiletoggle{display:none;border:1px solid #d6e1d3;background:#fff;border-radius:9px;padding:8px 10px;color:#21452f;font-weight:800}
 .gb-content{min-width:0}.gb-console .gb-control>.gb-side{display:none!important}.gb-console .gb-control>.gb-main{padding:28px clamp(16px,3vw,38px) 50px!important;width:100%}.gb-console .gb-control{min-height:calc(100vh - 66px)}
 @media(max-width:850px){.gb-shell{grid-template-columns:1fr}.gb-sidebar{position:fixed;left:0;top:0;width:270px;transform:translateX(-105%);transition:transform .22s ease}.gb-sidebar.open{transform:translateX(0);box-shadow:20px 0 60px #07190f80}.gb-mobiletoggle{display:inline-flex}.gb-topbar{height:58px}.gb-navlink{min-height:46px}}
 @media(min-width:851px){.gb-sidebar{transform:none!important}}

 /* Flagship charcoal control room + explicit reset of the global public-site nav rules. */
 .gb-console{--gc-ink:#f4f5f2;--gc-muted:#9da5a1;--gc-line:#ffffff17;--gc-lime:#caff35;background:#111312;color:#f4f5f2}
 .gb-shell{background:radial-gradient(ellipse at 70% -10%,#303b34 0,transparent 42%),#111312}
 .gb-sidebar{background:linear-gradient(155deg,#202522 0%,#151917 48%,#0b0e0c 100%);border-right:1px solid #ffffff18;box-shadow:18px 0 44px #0008,inset -1px 0 #ffffff0c}
 .gb-brand{border-bottom:1px solid #ffffff18}
 .gb-mark{background:linear-gradient(145deg,#e7ff9a 0%,#b7e72b 48%,#799f17 100%);box-shadow:0 8px 20px #0008,inset 0 2px 2px #fff}
 .gb-env{background:linear-gradient(145deg,#ffffff12,#ffffff04);border-color:#ffffff20;color:#d5ded7;box-shadow:inset 0 1px #ffffff12,0 8px 20px #0004}
 .gb-navlabel{color:#818c85}
 .gb-console .gb-sidebar nav{display:block!important;position:static!important;height:auto!important;min-height:0!important;width:100%!important;padding:0!important;margin:0!important;background:transparent!important;border:0!important;box-shadow:none!important;overflow:visible!important}
 .gb-console .gb-sidebar nav .gb-navgroup{display:block!important;width:100%!important;margin-top:19px}
 .gb-navlink{display:flex!important;width:100%!important;min-height:44px!important;margin:3px 0!important;padding:0 12px!important;background:transparent!important;border:1px solid transparent!important;border-radius:10px!important;color:#c5cec8!important;font-size:12px!important;font-weight:600!important;box-shadow:none!important}
 .gb-navlink:hover{background:linear-gradient(100deg,#ffffff12,#ffffff05)!important;color:#fff!important;transform:translateX(2px)}
 .gb-navlink.active{background:linear-gradient(115deg,#d9ff70,#a9d82a)!important;border:1px solid #edffb8!important;color:#18200e!important;box-shadow:0 9px 20px #0008,inset 0 2px 2px #fff9,inset 0 -2px 4px #587b1b55!important}
 .gb-navicon{width:22px;flex:0 0 22px;text-align:center;font-size:16px;color:#d1f27a}
 .gb-navlink.active .gb-navicon{color:#1a270e}
 .gb-sidefoot{border-top:1px solid #ffffff18;color:#87928a}
 .gb-main{background:#111312}
 .gb-topbar{background:linear-gradient(180deg,#252a27,#1a1e1b)!important;border-bottom:1px solid #ffffff18!important;box-shadow:0 8px 24px #0005!important;color:#f2f4f0}
 .gb-crumb{color:#aab4ad}.gb-crumb b{color:#f2f4ed}.gb-topright{color:#aab4ad}
 .gb-secure{background:linear-gradient(145deg,#303a32,#202722)!important;border:1px solid #58664f!important;color:#d9f79b!important;box-shadow:inset 0 1px #ffffff20,0 4px 12px #0005}
 .gb-mobiletoggle{display:none;border:1px solid #59645c!important;background:linear-gradient(145deg,#3a423d,#202622)!important;border-radius:9px!important;padding:9px 12px!important;color:#e8f2df!important;box-shadow:0 5px 12px #0008,inset 0 1px #ffffff30!important}
 .gb-topright button{background:linear-gradient(145deg,#3a423d,#202622)!important;border:1px solid #59645c!important;color:#f0f4ed!important;box-shadow:0 5px 12px #0007,inset 0 1px #ffffff25!important}
 .gb-content{background:#111312;min-height:calc(100vh - 66px)}
 .gb-content>main{background:radial-gradient(ellipse at 80% 0%,#252d28 0%,transparent 42%),#111312!important;color:#edf2ed!important}
 .gb-content .panel,.gb-content .metric,.gb-content .stat,.gb-content .super-editor,.gb-content .calendar-panel,.gb-content .day-panel{background:linear-gradient(145deg,#272d29,#1b201d)!important;border:1px solid #ffffff19!important;color:#edf2ed!important;box-shadow:0 18px 36px #0007,inset 0 1px #ffffff12!important}
 .gb-content input,.gb-content select,.gb-content textarea{background:#111613!important;color:#f1f4ef!important;border:1px solid #47534a!important}
 .gb-content label,.gb-content p,.gb-content small,.gb-content .muted{color:#aab5ad}
 .gb-content button{box-shadow:0 7px 16px #0006,inset 0 1px #ffffff20}
 @media(max-width:850px){
  .gb-shell{grid-template-columns:minmax(0,1fr)}
  .gb-sidebar{position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:min(310px,86vw)!important;height:100dvh!important;max-height:100dvh!important;overflow-y:auto!important;overscroll-behavior:contain;transform:translateX(-110%)!important;transition:transform .25s cubic-bezier(.2,.8,.2,1)!important;z-index:100!important;padding:18px 14px calc(28px + env(safe-area-inset-bottom))!important;box-shadow:22px 0 70px #000b!important}
  .gb-sidebar.open{transform:translateX(0)!important}
  .gb-console .gb-sidebar nav{display:block!important;height:auto!important;overflow:visible!important}
  .gb-console .gb-sidebar nav .gb-navgroup{display:block!important}
  .gb-mobiletoggle{display:inline-flex!important;align-items:center;justify-content:center;min-width:42px;min-height:40px}
  .gb-topbar{height:60px!important;padding:0 12px!important}
  .gb-crumb{font-size:9px;letter-spacing:.04em}.gb-topright{gap:6px;font-size:9px}
  .gb-secure{padding:6px 7px;font-size:8px}
  .gb-topright button{padding:7px 8px!important;font-size:9px!important}
  .gb-content>main{min-height:calc(100dvh - 60px)!important}
 }


 .gb-content .ops,.gb-content .staff,.gb-content .audit,.gb-content .finance,.gb-content .media-room,.gb-content .client-admin-shell,.gb-content .admin-shell,.gb-content .super-shell{background:radial-gradient(ellipse at 80% 0%,#252d28 0%,transparent 42%),#111312!important;color:#edf2ed!important}
 .gb-content .ops .pagehead h1,.gb-content .staff h1,.gb-content .audit h1,.gb-content .finance h1,.gb-content .media-title,.gb-content .client-admin-shell h1,.gb-content .super-head h1{color:#f1f5ef!important}
 .gb-content .ops .eyebrow,.gb-content .staff .eyebrow,.gb-content .audit .eyebrow,.gb-content .finance .eyebrow{color:#caff70!important}
 .gb-content .ops .sub,.gb-content .ops .metric p,.gb-content .ops .metric span,.gb-content .ops .module p{color:#aab5ad!important}
 .gb-content .ops .metric strong,.gb-content .ops .metric a,.gb-content .ops .module h3{color:#eaf3e8!important}
 .gb-content .ops .hero,.gb-content .staff .hero,.gb-content .audit .hero,.gb-content .finance .hero{background:linear-gradient(145deg,#343d37,#1a211d)!important;border:1px solid #ffffff20!important;box-shadow:0 24px 50px #0009,inset 0 2px 2px #ffffff1a,inset 0 -5px 12px #0007!important;transform:perspective(1100px) rotateX(1deg)}
 .gb-content .ops .module,.gb-content .ops .quick{background:linear-gradient(145deg,#303833,#1b211d)!important;border:1px solid #ffffff1c!important;color:#eff4ec!important;box-shadow:0 16px 30px #0008,inset 0 1px #ffffff1a!important}
 .gb-content .ops .metric{background:linear-gradient(145deg,#303833,#1b211d)!important;color:#f0f5ed!important;border:1px solid #ffffff1c!important}
 .gb-content .ops .sectionline,.gb-content .ops .panel{border-color:#ffffff1b!important}
 .gb-content .ops button,.gb-content .staff button,.gb-content .audit button,.gb-content .finance button,.gb-content .super-shell button{background:linear-gradient(145deg,#d9ff70,#a9d82a)!important;color:#17210f!important;border:1px solid #edffb8!important;border-radius:9px!important;font-weight:850!important;box-shadow:0 8px 18px #0008,inset 0 2px 2px #fff9,inset 0 -3px 6px #668c1c66!important}
 .gb-content .ops a,.gb-content .staff a,.gb-content .audit a,.gb-content .finance a,.gb-content .super-shell a{color:#d9f79b}

 `}</style>
 <div className="gb-shell">
 <aside className={'gb-sidebar'+(open?' open':'')}>
 <Link className="gb-brand" href="/admin/super" onClick={()=>setOpen(false)}><span className="gb-mark">G</span><span><strong>G-BEST</strong><small>REALTY CONTROL ROOM</small></span></Link>
 <div className="gb-env"><i/> COMPANY CONTROL CONSOLE <span style={{marginLeft:'auto',color:'#829d89'}}>01</span></div>
 <nav aria-label="Super admin navigation">{visibleGroups.map(group=><div className="gb-navgroup" key={group.label}><div className="gb-navlabel">{group.label}</div>{group.items.map(([href,label,icon])=><Link key={href} href={href} onClick={()=>setOpen(false)} className={'gb-navlink'+((path===href||((href==='/admin/super/staff#activity')&&path==='/admin/super/staff')||(href!=='/admin'&&href!=='/admin/super'&&href!=='/admin/clients'&&href!=='/admin/super/homepage'&&href!=='/admin/super/media'&&path.startsWith(href+'/')))?' active':'')}><span className="gb-navicon">{icon}</span>{label}</Link>)}</div>)}</nav>
 <div className="gb-sidefoot">G-BEST LUXURY REALTY<br/>Management console · Secure workspace</div>
 </aside>
 {open&&<button type="button" aria-label="Close navigation drawer" onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,zIndex:90,border:0,borderRadius:0,background:'#000a',backdropFilter:'blur(5px)',cursor:'pointer'}}/>}
 <div className="gb-main">
 <header className="gb-topbar"><div style={{display:'flex',alignItems:'center',gap:12}}><button className="gb-mobiletoggle" onClick={()=>setOpen(v=>!v)} aria-label="Toggle navigation">☰</button><div className="gb-crumb">G-BEST <span style={{opacity:.45}}> / </span><b>{path==='/admin/super/homepage'?'HOMEPAGE STUDIO':path==='/admin/super/media'?'MEDIA LIBRARY':path==='/admin/clients'?'CLIENTS':path.startsWith('/admin/super/finance')?'FINANCE CENTRE':path==='/admin'?'INSPECTIONS':path==='/admin/super'?'PROPERTY OPERATIONS':path==='/admin/super/overview'?'CONTROL ROOM DASHBOARD':path.startsWith('/admin/super/staff')?'STAFF & PERMISSIONS':path==='/admin/super/activity'?'ACTIVITY & AUDIT LOG':path==='/admin/control'?'LEGACY CONTROL ROOM':'SYSTEM SETTINGS'}</b></div></div><div className="gb-topright"><span className="gb-secure">● {staff?'STAFF WORKSPACE':'ADMIN WORKSPACE'}</span><button onClick={signOut} style={{border:"1px solid #d8e5d2",background:"#fff",borderRadius:99,padding:"7px 10px",color:"#426b3d",fontWeight:700,fontSize:11}}>SIGN OUT</button></div></header>
 <main className="gb-content">{children}</main>
 </div></div></div>
}
