'use client';
import {useEffect,useState} from 'react';
import {Children,cloneElement,isValidElement} from 'react';
function brandText(node,name){
 if(typeof node==='string')return node.replace(/G-BEST Luxury Realty/g,name).replace(/G-BEST/g,name);
 if(Array.isArray(node))return node.map((item,i)=>brandText(item,name));
 if(isValidElement(node))return cloneElement(node,{},brandText(node.props.children,name));
 return node;
}
export default function LegalLayout({title,updated,children}){
 const [brand,setBrand]=useState({});
 useEffect(()=>{let active=true;fetch('/api/homepage',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Brand settings unavailable');const d=await r.json();if(active)setBrand(d.sections?.site_settings||{});}).catch(()=>{});return()=>{active=false}},[]);
 const name=brand.siteName||'G-BEST Luxury Realty';
 const primary=brand.primaryColor||'#173b2b',accent=brand.accentColor||'#b6d879',background=brand.pageBackgroundColor||'#f4f3e9',color=brand.textColor||primary;
 return <main className="legal-page" style={{'--legal-primary':primary,'--legal-accent':accent,'--legal-background':background,'--legal-text':color,background,color,fontFamily:brand.fontFamily||'Inter,Arial,sans-serif'}}>
 <a className="legal-back" href="/">← {name.toUpperCase()} HOME</a><p className="eyebrow">{name.toUpperCase()} · {brand.tagline||'COMPANY INFORMATION'}</p><h1>{title}</h1><p className="legal-updated">Last updated: November 2026</p><div className="legal-content">{brandText(children,name)}</div><p className="legal-note">For questions about this page, please contact {name} through the website contact section.</p>
 <style jsx>{`.legal-page{min-height:100vh;padding:clamp(28px,7vw,90px);}.legal-page h1{color:var(--legal-primary)}.legal-back{color:var(--legal-primary)}.legal-page .eyebrow{color:var(--legal-accent)}.legal-content a{color:var(--legal-primary)}`}</style>
 </main>
}