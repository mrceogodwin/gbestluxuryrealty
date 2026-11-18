import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};
const SYSTEM=`You are Agent, the public AI property assistant for G-BEST Luxury Realty in Nigeria.
Be warm, concise, commercially helpful and honest. You can help visitors discover properties, understand listings, prepare for inspections and learn how to use this website.
Use ONLY the supplied live property records and company context for specific listing facts, availability and prices. Never invent property names, prices, addresses, ownership, legal status, availability or inspection slots. If a detail is absent or uncertain, say so and offer to connect the visitor with G-BEST staff.
Prices are shown exactly as recorded in the listing; clarify that listings and prices should be reconfirmed with G-BEST before payment. Do not ask visitors to pay into personal accounts or share passwords, OTPs or card details.
Basic questions are open to all visitors; do not require registration just to answer. For private enquiries, account-specific updates or sending a message to the G-BEST team, direct the visitor to client registration or sign-in.
Do not claim to be a human, lawyer, surveyor or property valuer. Encourage physical inspection and independent verification before commitment.`;
function safeText(x,max=1200){return String(x??'').trim().slice(0,max)}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403,headers:noStore});
 try{
  const body=await req.json().catch(()=>null),message=safeText(body?.message,1200);
  if(!message)return NextResponse.json({error:'Type a question for Agent.'},{status:400,headers:noStore});
  if(message.length>1200)return NextResponse.json({error:'Please keep your question under 1,200 characters.'},{status:400,headers:noStore});
  const history=Array.isArray(body?.history)?body.history.slice(-8).map(m=>({role:m?.role==='assistant'?'assistant':'user',content:safeText(m?.content,1200)})).filter(m=>m.content):[];
  const pool=getDatabasePool(),host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'G-BEST workspace is not available on this domain.'},{status:503,headers:noStore});
  const q=await pool.query(`SELECT title,location,state,property_type,
    COALESCE(NULLIF(price,'Price on request'),price_label,'Price on request') AS price,
    COALESCE(NULLIF(beds,0),bedrooms,0) AS bedrooms,
    COALESCE(NULLIF(baths,0),bathrooms,0) AS bathrooms,
    COALESCE(NULLIF(size,''),size_label,'') AS size,
    description,status,slug
   FROM public.properties
   WHERE tenant_id=$1 AND status IN ('published','available')
    AND COALESCE(description,'') !~* '(sample showcase listing|illustrative|design preview|test listing)'
   ORDER BY updated_at DESC,id DESC LIMIT 35`,[tenant.id]);
  const properties=q.rows.map(p=>({name:p.title,location:[p.location,p.state].filter(Boolean).join(', '),type:p.property_type,price:p.price,beds:Number(p.bedrooms||0),baths:Number(p.bathrooms||0),size:p.size,description:safeText(p.description,900),status:p.status,url:p.slug?'/properties/'+encodeURIComponent(p.slug):null}));
  const company=`Company: ${tenant.display_name||'G-BEST Luxury Realty'}. Market: Nigeria. Published property records currently available: ${properties.length}.\nLIVE LISTINGS (only these may be described as currently published):\n${JSON.stringify(properties)}`;
  if(!process.env.AI_GATEWAY_API_KEY){
   const matches=properties.filter(p=>(p.name+' '+p.location+' '+p.type+' '+p.description).toLowerCase().includes(message.toLowerCase().split(/\\s+/).filter(w=>w.length>3)[0]||'__none__')).slice(0,4);
   const fallback=properties.length?(`I can help you explore G-BEST’s ${properties.length} published listing(s). For accurate availability, pricing confirmation or a tailored shortlist, please tell me your preferred location, property type and budget. I’ll only quote details shown in our live listings.`):'I’m here to help with property searches and inspections. There are no published property listings available in the live catalogue right now. Tell me your preferred location and property type, or register to send a private enquiry to our team.';
   return NextResponse.json({reply:matches.length?'I found these published listings that may be relevant: '+matches.map(p=>p.name+' — '+p.location+' — '+p.price).join('; ')+'. Would you like more details or help arranging an inspection?':fallback,mode:'catalogue-fallback',needsConfiguration:true},{headers:noStore});
  }
  const model=process.env.AGENT_MODEL||'openai/gpt-5.6-sol';
  const response=await fetch('https://ai-gateway.vercel.sh/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.AI_GATEWAY_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0.25,max_tokens:650,messages:[{role:'system',content:SYSTEM+'\\n\\n'+company},...history,{role:'user',content:message}] }),signal:AbortSignal.timeout(25000)});
  if(!response.ok){const errorText=await response.text().catch(()=> '');console.error('Agent AI Gateway error',response.status,errorText.slice(0,400));return NextResponse.json({error:'Agent is temporarily unavailable. Please try again or contact G-BEST.'},{status:503,headers:noStore});}
  const data=await response.json(),reply=safeText(data?.choices?.[0]?.message?.content,5000);
  if(!reply)return NextResponse.json({error:'Agent could not prepare a response. Please try again.'},{status:503,headers:noStore});
  return NextResponse.json({reply,mode:'ai',model},{headers:noStore});
 }catch(e){console.error('Public Agent chat failed',e.code||e.message);return NextResponse.json({error:'Agent could not respond right now. Please try again shortly.'},{status:503,headers:noStore});}
}