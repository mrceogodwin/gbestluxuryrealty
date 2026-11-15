'use client';
import {useEffect,useState} from 'react';
export default function InspectionSchedulePage(){
 const [settings,setSettings]=useState({workingDays:[1,2,3,4,5,6],startTime:'08:00',endTime:'18:00',slotMinutes:30,blockedDates:[],timezone:'Africa/Lagos'});
 const [tenant,setTenant]=useState(null),[tenants,setTenants]=useState([]),[tenantId,setTenantId]=useState('');
 const [blockedDate,setBlockedDate]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function load(id){
  setLoading(true);setError('');setMessage('');
  try{const url='/api/admin/inspection-schedule'+(id?'?tenantId='+encodeURIComponent(id):'');const r=await fetch(url,{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load inspection schedule');setSettings(d.settings);setTenant(d.tenant);setTenantId(String(d.activeTenantId||''));setTenants(d.tenants||[]);}
  catch(e){setError(e.message)}finally{setLoading(false)}
 }
 useEffect(()=>{load('')},[]);
 async function save(e){e.preventDefault();setSaving(true);setError('');setMessage('');try{const r=await fetch('/api/admin/inspection-schedule',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,tenant_id:tenantId})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save schedule');setSettings(d.settings);setMessage('Inspection schedule saved successfully. New bookings will use these settings.')}catch(e){setError(e.message)}finally{setSaving(false)}}
 function addBlocked(){if(!blockedDate)return;setSettings(s=>({...s,blockedDates:[...new Set([...s.blockedDates,blockedDate])].sort()}));setBlockedDate('')}
 function removeBlocked(date){setSettings(s=>({...s,blockedDates:s.blockedDates.filter(x=>x!==date)}))}
 const slots=Math.max(0,Math.floor((Number(settings.endTime.slice(0,2))*60+Number(settings.endTime.slice(3))-Number(settings.startTime.slice(0,2))*60-Number(settings.startTime.slice(3)))/Number(settings.slotMinutes||30)));
 return <main className="schedule-shell"><style jsx>{`
 .schedule-shell{min-height:100vh;background:#111512;color:#edf3ec;padding:clamp(16px,4vw,38px);max-width:1050px;margin:auto}
 .back{color:#c9ed70;text-decoration:none;font-size:10px;font-weight:800;letter-spacing:.08em}
 header{margin:25px 0}header .eyebrow{color:#c9ed70;font-size:9px;letter-spacing:.18em;font-weight:900}h1{font-size:clamp(27px,5vw,42px);letter-spacing:-.05em;margin:8px 0}header p{color:#aab5ad;font-size:12px;line-height:1.6;max-width:650px}
 .panel{background:linear-gradient(145deg,#222a24,#191f1b);border:1px solid #ffffff1c;border-radius:14px;padding:clamp(14px,3vw,22px);margin:14px 0;box-shadow:0 14px 34px #0004}
 .panel h2{font-size:15px;margin:0 0 5px}.hint{font-size:10px;color:#aab5ad;line-height:1.5;margin:0 0 15px}
 .days{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.day{display:flex;gap:8px;align-items:center;border:1px solid #ffffff20;border-radius:9px;padding:11px;background:#171d19;font-size:11px;color:#dce5dc;cursor:pointer}.day input{accent-color:#c9ed70;width:15px;height:15px}
 .fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.field label{display:block;font-size:9px;color:#aab5ad;font-weight:800;letter-spacing:.08em;margin-bottom:7px}.field input,.field select{width:100%;box-sizing:border-box;background:#131915;border:1px solid #ffffff28;border-radius:8px;padding:11px;color:#edf3ec;font-size:13px}
 .blocked-add{display:flex;gap:8px;flex-wrap:wrap}.blocked-add input{background:#131915;border:1px solid #ffffff28;border-radius:8px;padding:10px;color:#edf3ec}.blocked-add button,.save{background:#c9ed70;border:1px solid #e4ffad;border-radius:8px;padding:10px 15px;color:#17210f;font-size:10px;font-weight:900;cursor:pointer}
 .blocked-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.blocked{display:flex;align-items:center;gap:8px;background:#3b2925;border:1px solid #805044;border-radius:8px;padding:7px 9px;color:#ffd0c5;font-size:10px}.blocked button{background:none;border:0;color:#ffd0c5;font-size:15px;cursor:pointer}
 .summary{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.summary span{background:#151b17;border:1px solid #ffffff18;border-radius:8px;padding:10px;color:#c9ed70;font-size:10px;font-weight:800}
 .actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:18px 0}.error,.success{border-radius:8px;padding:11px;font-size:11px;margin:12px 0}.error{background:#402722;color:#ffc1b4}.success{background:#203525;color:#c8f0ad}
 .tenant{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#aab5ad;font-size:10px;margin-top:12px}.tenant select{background:#171d19;color:#edf3ec;border:1px solid #ffffff25;border-radius:8px;padding:9px}
 @media(max-width:600px){.days{grid-template-columns:repeat(2,minmax(0,1fr))}.fields{grid-template-columns:1fr}.panel{padding:14px}}
 `}</style>
 <a className="back" href="/admin/super/overview">← SUPER ADMIN CONTROL ROOM</a>
 <header><p className="eyebrow">PRIVATE OPERATIONS · BOOKING CONFIGURATION</p><h1>Inspection <i>schedule.</i></h1><p>Manage company inspection closure dates. G-BEST inspections operate Monday to Saturday, 8:00 AM to 6:00 PM, in Nigeria time (WAT), with fixed 30-minute appointments. All times use Nigeria time (WAT).</p>{tenants.length>1&&<div className="tenant">COMPANY WORKSPACE <select value={tenantId} onChange={e=>load(e.target.value)}>{tenants.map(t=><option key={t.id} value={t.id}>{t.display_name}</option>)}</select></div>}</header>
 {loading?<div className="panel">Loading schedule settings…</div>:<form onSubmit={save}>
 <section className="panel"><h2>Operating days</h2><p className="hint">The company inspection calendar follows the agreed operating schedule. These days are fixed.</p><div className="summary"><span>MONDAY – SATURDAY</span><span>SUNDAY · CLOSED</span></div></section>
 <section className="panel"><h2>Daily inspection hours</h2><p className="hint">Appointments must fit completely inside the company operating window.</p><div className="summary"><span>08:00 AM – 06:00 PM WAT</span><span>20 slots per working day</span><span>30 minutes · Fixed</span></div></section>
 <section className="panel"><h2>Blocked dates</h2><p className="hint">Add public holidays, company closures or dates when the inspection team is unavailable. Existing requests are not deleted.</p><div className="blocked-add"><input type="date" value={blockedDate} onChange={e=>setBlockedDate(e.target.value)}/><button type="button" onClick={addBlocked}>Add blocked date</button></div><div className="blocked-list">{settings.blockedDates.map(d=><span className="blocked" key={d}>{d}<button type="button" aria-label={'Remove '+d} onClick={()=>removeBlocked(d)}>×</button></span>)}</div></section>
 {error&&<div className="error" role="alert">{error}</div>}{message&&<div className="success" role="status">{message}</div>}<div className="actions"><button className="save" disabled={saving}>{saving?'Saving…':'Save inspection schedule'}</button><button type="button" className="back" onClick={()=>load(tenantId)}>Discard changes</button></div>
 </form>}
 </main>
}
