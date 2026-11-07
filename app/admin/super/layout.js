'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';
const groups=[
 {label:'WORKSPACE',items:[['/admin/super','Overview & listings','▦'],['/admin/super/media','Media library','▧'],['/admin/super/homepage','Homepage studio','◫']]},
 {label:'OPERATIONS',items:[['/admin','Inspections & bookings','◷'],['/admin/clients','Clients & registrations','♙']]},
 {label:'SYSTEM',items:[['/admin/super/settings','Website settings','⚙'],['/admin/super/activity','Activity & audit log','≋']]}
];
export default function SuperAdminLayout({children}){
 const path=usePathname(),[open,setOpen]=useState(false);
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
 .gb-content{min-width:0}
 @media(max-width:850px){.gb-shell{grid-template-columns:1fr}.gb-sidebar{position:fixed;left:0;top:0;width:270px;transform:translateX(-105%);transition:transform .22s ease}.gb-sidebar.open{transform:translateX(0);box-shadow:20px 0 60px #07190f80}.gb-mobiletoggle{display:inline-flex}.gb-topbar{height:58px}.gb-navlink{min-height:46px}}
 @media(min-width:851px){.gb-sidebar{transform:none!important}}
 `}</style>
 <div className="gb-shell">
 <aside className={'gb-sidebar'+(open?' open':'')}>
 <Link className="gb-brand" href="/admin/super" onClick={()=>setOpen(false)}><span className="gb-mark">G</span><span><strong>G-BEST</strong><small>REALTY CONTROL ROOM</small></span></Link>
 <div className="gb-env"><i/> COMPANY CONTROL CONSOLE <span style={{marginLeft:'auto',color:'#829d89'}}>01</span></div>
 <nav aria-label="Super admin navigation">{groups.map(group=><div className="gb-navgroup" key={group.label}><div className="gb-navlabel">{group.label}</div>{group.items.map(([href,label,icon])=><Link key={href} href={href} onClick={()=>setOpen(false)} className={'gb-navlink'+(path===href?' active':'')}><span className="gb-navicon">{icon}</span>{label}</Link>)}</div>)}</nav>
 <div className="gb-sidefoot">G-BEST LUXURY REALTY<br/>Management console · Secure workspace</div>
 </aside>
 <div className="gb-main">
 <header className="gb-topbar"><div style={{display:'flex',alignItems:'center',gap:12}}><button className="gb-mobiletoggle" onClick={()=>setOpen(v=>!v)} aria-label="Toggle navigation">☰</button><div className="gb-crumb">G-BEST <span style={{opacity:.45}}> / </span><b>{path==='/admin/super/homepage'?'HOMEPAGE STUDIO':path==='/admin/super/media'?'MEDIA LIBRARY':path==='/admin/clients'?'CLIENTS':path==='/admin'?'INSPECTIONS':path==='/admin/super'?'PROPERTY OPERATIONS':'SYSTEM SETTINGS'}</b></div></div><div className="gb-topright"><span className="gb-secure">● ADMIN WORKSPACE</span></div></header>
 <main className="gb-content">{children}</main>
 </div></div></div>
}
