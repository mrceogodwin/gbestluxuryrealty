import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {resolveSiteTenant} from '../../../../lib/site-tenants';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};
function safeText(x,max=1200){return String(x??'').trim().slice(0,max)}
export async function POST(req){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403,headers:noStore});
 try{
  const body=await req.json().catch(()=>null),message=safeText(body?.message,1200);
  if(!message)return NextResponse.json({error:'Type a question for Agent.'},{status:400,headers:noStore});
  if(message.length>1200)return NextResponse.json({error:'Please keep your question under 1,200 characters.'},{status:400,headers:noStore});
  const pool=getDatabasePool(),host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'',tenant=await resolveSiteTenant(pool,host);
  if(!tenant)return NextResponse.json({error:'G-BEST workspace is not available on this domain.'},{status:503,headers:noStore});
  const brandResult=await pool.query('SELECT brand_config FROM public.site_tenants WHERE id=$1 LIMIT 1',[tenant.id]);
  const agentKnowledge=Array.isArray(brandResult.rows[0]?.brand_config?.agentKnowledge)?brandResult.rows[0].brand_config.agentKnowledge.filter(x=>x&&x.active!==false):[];
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
  {
   const normalise=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9₦]+/g,' ').trim();
   const stop=new Set(['what','where','when','which','with','from','this','that','have','does','there','their','about','show','tell','please','want','need','looking','find','property','properties','listing','listings','price','cost','much','your','you','for','and','the','are','can','how','get','any','all','our','g','best']);
   const words=normalise(message).split(/\\s+/).filter(w=>w.length>2&&!stop.has(w));
   const ranked=properties.map(p=>{
    const hay=normalise([p.name,p.location,p.type,p.price,p.size,p.description].join(' '));
    const tokens=new Set(hay.split(/\\s+/));
    const score=words.reduce((n,w)=>n+(tokens.has(w)?3:hay.includes(w)?1:0),0);
    return {...p,_score:score};
   }).filter(p=>p._score>0).sort((a,b)=>b._score-a._score).slice(0,5);
   const knowledge=agentKnowledge;
   const knowledgeMatch=knowledge.map(x=>{
    const hay=normalise([x.question,x.category,x.keywords].join(' '));
    const tokens=new Set(hay.split(/\\s+/));
    const score=words.reduce((n,w)=>n+(tokens.has(w)?3:hay.includes(w)?1:0),0);
    return {...x,_score:score};
   }).filter(x=>x._score>0).sort((a,b)=>b._score-a._score)[0];
   const n=normalise(message);
   const wantsRent=/\\b(rent|rental|lease|tenant)\\b/.test(n);
   const wantsBuy=/\\b(buy|purchase|sale|sell)\\b/.test(n);
   const wantsLand=/\\b(land|plot|plots)\\b/.test(n);
   const wantsApartment=/\\b(apartment|flat|bedsit)\\b/.test(n);
   const wantsInspection=/\\b(inspect|inspection|view|viewing|visit)\\b/.test(n);
   const wantsPrice=/\\b(price|cost|how much|budget|₦|naira)\\b/.test(n);
   const relevant=properties.filter(p=>(!wantsLand||normalise(p.type+' '+p.name).includes('land'))&&(!wantsApartment||normalise(p.type+' '+p.name).match(/apartment|flat/))&&(!wantsRent||normalise(p.description+' '+p.name).includes('rent'))&&(!wantsBuy||normalise(p.description+' '+p.name).match(/sale|buy/)));
   let reply='';
   if(knowledgeMatch&&knowledgeMatch._score>=3)reply=knowledgeMatch.answer;\n   else if(wantsInspection)reply='I can help you arrange a physical inspection. Choose a property from our published listings, then use its inspection request option. The team confirms the appointment; please do not treat a request as confirmed until G-BEST approves it.';
   else if(ranked.length){
    const found=ranked.map(p=>p.name+' — '+p.location+' — '+p.type+' — '+p.price+(p.beds?' — '+p.beds+' bedroom(s)':'')+(p.url?' — '+p.url:'')).join('\\n');
    reply='Here are the closest matches in G-BEST’s live published catalogue:\\n'+found+'\\n\\nWould you like details about one of these, or should I narrow the search by location, property type or budget? Listing details and prices should be reconfirmed with our team before payment.';
   }else if((wantsLand||wantsApartment||wantsRent||wantsBuy)&&relevant.length===0){
    reply='I couldn’t find a published listing matching those requirements in the live catalogue right now. Tell me your preferred city or area and budget, and I can help narrow down what to ask our team for.';
   }else if(/\\b(hello|hi|hey|good morning|good afternoon|good evening)\\b/.test(n)){
    reply='Hello and welcome to G-BEST Luxury Realty. I’m Agent. I can help you explore published properties, understand the inspection process or get started. Are you looking to buy, rent or list a property?';
   }else if(/\\b(register|sign up|account|login|sign in)\\b/.test(n)){
    reply='You can create a free client profile at /client-registration or sign in at /client-login. Registration is only needed for private client messaging and account-specific services; you can ask me general questions without registering.';
   }else if(/\\b(who are you|what can you do|help)\\b/.test(n)){
    reply='I’m Agent, the G-BEST property assistant. I can search the live published catalogue, share recorded listing details, explain how inspections work and guide you around the website. I won’t invent missing property facts.';
   }else if(properties.length){
    reply='I can help with G-BEST property searches and inspections. There are '+properties.length+' published listing(s) in the live catalogue. Tell me a city or neighbourhood, whether you want to buy or rent, your preferred property type and your budget. I’ll match your request against the listings available.';
   }else{
    reply='I can help with G-BEST property searches and inspections, but there are no published properties in the live catalogue at the moment. You can still ask about the inspection process or tell me what kind of property you’re looking for.';
   }
   return NextResponse.json({reply,mode:'knowledge-engine',listingMatches:ranked.length,knowledgeMatched:Boolean(knowledgeMatch&&knowledgeMatch._score>=3)},{headers:noStore});
  }
  return NextResponse.json({reply:'Agent knowledge service is ready.'},{headers:noStore});
 }catch(e){console.error('Public Agent chat failed',e.code||e.message);return NextResponse.json({error:'Agent could not respond right now. Please try again shortly.'},{status:503,headers:noStore});}
}