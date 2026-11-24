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
  const body=await req.json().catch(()=>null),message=safeText(body?.message,1200),context=Array.isArray(body?.context)?body.context.slice(-8).map(x=>({sender_type:String(x?.sender_type||''),body:safeText(x?.body,1200)})):[];
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
    description,status,slug,image_url,images
   FROM public.properties
   WHERE tenant_id=$1 AND status IN ('published','available')
    AND COALESCE(description,'') !~* '(sample showcase listing|illustrative|design preview|test listing)'
   ORDER BY updated_at DESC,id DESC LIMIT 35`,[tenant.id]);
  const properties=q.rows.map(p=>({name:p.title,location:[p.location,p.state].filter(Boolean).join(', '),type:p.property_type,price:p.price,beds:Number(p.bedrooms||0),baths:Number(p.bathrooms||0),size:p.size,description:safeText(p.description,900),status:p.status,image:p.image_url||(Array.isArray(p.images)?p.images[0]:null),images:Array.isArray(p.images)?p.images.slice(0,5):[],url:p.slug?'/properties/'+encodeURIComponent(p.slug):null}));
  const company=`Company: ${tenant.display_name||'G-BEST Luxury Realty'}. Market: Nigeria. Published property records currently available: ${properties.length}.\nLIVE LISTINGS (only these may be described as currently published):\n${JSON.stringify(properties)}`;
  {
   const normalise=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9₦]+/g,' ').trim();
   const priorClientText=context.filter(x=>x.sender_type==='client').slice(0,-1).map(x=>x.body).join(' ');\n   const priorAgentText=context.filter(x=>x.sender_type==='agent').map(x=>x.body).join(' ');\n   const stop=new Set(['what','where','when','which','with','from','this','that','have','does','there','their','about','show','tell','please','want','need','looking','find','property','properties','listing','listings','price','cost','much','your','you','for','and','the','are','can','how','get','any','all','our','g','best']);
   const words=normalise(priorClientText+' '+message).split(/\s+/).filter(w=>w.length>2&&!stop.has(w));
   const ranked=properties.map(p=>{
    const hay=normalise([p.name,p.location,p.type,p.price,p.size,p.description].join(' '));
    const tokens=new Set(hay.split(/\s+/));
    const score=words.reduce((n,w)=>n+(tokens.has(w)?3:hay.includes(w)?1:0),0);
    return {...p,_score:score};
   }).filter(p=>p._score>0).sort((a,b)=>b._score-a._score).slice(0,5);
   const knowledge=agentKnowledge;
   const knowledgeMatch=knowledge.map(x=>{
    const hay=normalise([x.question,x.category,x.keywords].join(' '));
    const tokens=new Set(hay.split(/\s+/));
    const score=words.reduce((n,w)=>n+(tokens.has(w)?3:hay.includes(w)?1:0),0);
    return {...x,_score:score};
   }).filter(x=>x._score>0).sort((a,b)=>b._score-a._score)[0];
   const n=normalise(message);
   const fullEnquiry=normalise(priorClientText+' '+message);
   const greetingOnly=/^(hello|hi|hey|good morning|good afternoon|good evening)[.! ]*$/.test(n);
   const shortAck=/^(ok|okay|alright|thanks|thank you|noted|sure|fine)[.! ]*$/.test(n);
   const locationNames=['Benin City, Edo State','Lagos','Abuja','Port Harcourt','Ibadan','Enugu','Owerri','Asaba','Warri','Uyo','Calabar','Akure','Abeokuta','Kaduna','Kano'];
   const requestedArea=locationNames.find(name=>{const token=normalise(name).split(' ')[0];return n.includes(normalise(name))||(token==='benin'&&/\bbenin\b/.test(n))||(token!=='benin'&&new RegExp('\b'+token+'\b').test(n))})
    ||locationNames.find(name=>{const token=normalise(name).split(' ')[0];return normalise(priorClientText).includes(normalise(name))||(token==='benin'&&/\bbenin\b/.test(normalise(priorClientText)))});
   const wantsHouse=/\b(house|home|duplex|bungalow|terrace|detached|semi detached)\b/.test(fullEnquiry);
   const wantsProperty=/\b(property|properties|house|home|land|plot|apartment|flat|duplex|bungalow|villa|real estate)\b/.test(n);
   const priorPropertyIntent=/\b(property|properties|house|home|land|plot|apartment|flat|duplex|buy|rent|looking for)\b/.test(normalise(priorClientText));
   const wantsRent=/\b(rent|rental|lease|tenant)\b/.test(n);
   const wantsBuy=/\b(buy|purchase|sale|sell)\b/.test(n);
   const wantsLand=/\b(land|plot|plots)\b/.test(n);
   const wantsApartment=/\b(apartment|flat|bedsit)\b/.test(n);
   const wantsInspection=/\b(inspect|inspection|view|viewing|visit)\b/.test(n);
   const wantsPrice=/\b(price|cost|how much|budget|₦|naira)\b/.test(n);
   const budgetMatch=message.match(/(?:under|below|maximum|max|budget(?: of)?|up to|less than|not more than)\s*(?:₦|ngn|n)?\s*([\d,.]+)\s*(billion|bn|million|m|thousand|k)?/i)||message.match(/₦\s*([\d,.]+)\s*(billion|bn|million|m|thousand|k)?/i);
   const multiplier={billion:1e9,bn:1e9,million:1e6,m:1e6,thousand:1e3,k:1e3};
   const budgetLimit=budgetMatch?Number(budgetMatch[1].replace(/,/g,''))*(multiplier[String(budgetMatch[2]||'').toLowerCase()]||1):null;
   const priceNumber=value=>{const m=String(value||'').replace(/,/g,'').match(/(?:₦|NGN|N)?\s*([\d.]+)\s*(billion|bn|million|m|thousand|k)?/i);return m?Number(m[1])*(multiplier[String(m[2]||'').toLowerCase()]||1):null};
   const relevant=properties.filter(p=>(!requestedArea||normalise(p.location).includes(normalise(requestedArea).split(' ')[0]))&&(!wantsLand||normalise(p.type+' '+p.name).includes('land'))&&(!wantsApartment||normalise(p.type+' '+p.name).match(/apartment|flat/))&&(!wantsHouse||normalise(p.type+' '+p.name+' '+p.description).match(/house|home|duplex|bungalow|terrace|detached/))&&(!wantsRent||normalise(p.description+' '+p.name).includes('rent'))&&(!wantsBuy||normalise(p.description+' '+p.name).match(/sale|buy/))&&(!budgetLimit||priceNumber(p.price)===null||priceNumber(p.price)<=budgetLimit));
   const filteredRanked=ranked.filter(p=>relevant.some(r=>r.name===p.name)&&(!budgetLimit||(priceNumber(p.price)!==null&&priceNumber(p.price)<=budgetLimit)));
   let reply='';
   if(knowledgeMatch&&knowledgeMatch._score>=3)reply=knowledgeMatch.answer;
   else if(wantsInspection)reply='I can help you arrange a physical inspection. Choose a property from our published listings, then use its inspection request option. The team confirms the appointment; please do not treat a request as confirmed until G-BEST approves it.';
   else if(greetingOnly&&/hello|welcome|good (morning|afternoon|evening)/i.test(priorAgentText))reply='Hello again — I’m here to help. Are you looking to buy or rent, and which city or area should I search?';
   else if(shortAck)reply='You’re welcome. Whenever you’re ready, send me the area, whether you want to buy or rent, and your budget. I’ll use those details to narrow the published listings.';
   else if(requestedArea&&filteredRanked.length===0)reply='I checked the live published catalogue for '+requestedArea+'. I do not have a matching published listing in that area to show right now. Are you looking to buy or rent, and what budget should I use? I can also help you send the request to our team for confirmation of upcoming options.';
   else if(wantsHouse&&requestedArea&&filteredRanked.length===0)reply='I understand you want a house in '+requestedArea+'. I do not have a matching published house listing to show right now. Would you like to buy or rent, and what budget range should I use?';
   else if(filteredRanked.length){
    const found=filteredRanked.map(p=>p.name+' — '+p.location+' — '+p.type+' — '+p.price+(p.beds?' — '+p.beds+' bedroom(s)':'')+(p.url?' — '+p.url:'')+(p.image?' — Photo: '+p.image:'')).join('\n');
    reply='Here are the closest matches in G-BEST’s live published catalogue:\n'+found+'\n\nWould you like details about one of these, or should I narrow the search by location, property type or budget? Listing details and prices should be reconfirmed with our team before payment.';
   }else if(budgetLimit&&relevant.length&&filteredRanked.length===0){
    reply='I found listings that may fit the property type, but their recorded prices are missing or above your stated budget. I won’t label them as budget matches without a verifiable price. Would you like to raise the budget or ask our team to confirm current prices?';
   }else if((wantsLand||wantsApartment||wantsRent||wantsBuy)&&relevant.length===0){
    reply='I couldn’t find a published listing matching those requirements in the live catalogue right now. Tell me your preferred city or area and budget, and I can help narrow down what to ask our team for.';
   }else if(/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(n)){
    reply='Hello and welcome to G-BEST Luxury Realty. I’m Agent. I can help you explore published properties, understand the inspection process or get started. Are you looking to buy, rent or list a property?';
   }else if(/\b(register|sign up|account|login|sign in)\b/.test(n)){
    reply='You can create a free client profile at /client-registration or sign in at /client-login. Registration is only needed for private client messaging and account-specific services; you can ask me general questions without registering.';
   }else if(/\b(who are you|what can you do|help)\b/.test(n)){
    reply='I’m Agent, the G-BEST property assistant. I can search the live published catalogue, share recorded listing details, explain how inspections work and guide you around the website. I won’t invent missing property facts.';
   }else if((wantsProperty||priorPropertyIntent)&&!requestedArea){
    reply='I can help you find the right property. Which city or neighbourhood should I search, are you looking to buy or rent, and what budget range should I use?';
   }else if(properties.length){
    reply='I can help with G-BEST property searches and inspections. Tell me the city or neighbourhood, whether you want to buy or rent, your preferred property type and your budget. I’ll check those details against the live published catalogue.';
   }else{
    reply='I can help with G-BEST property searches and inspections, but there are no published properties in the live catalogue at the moment. You can still ask about the inspection process or tell me what kind of property you’re looking for.';
   }
   const suggestHuman=/\b(human|real person|speak to (someone|staff)|talk to (someone|staff)|sales representative|customer service|speak with (an agent|staff))\b/i.test(message)||/\bcomplaint|specific booking issue|payment dispute\b/i.test(message);
   return NextResponse.json({reply,mode:'knowledge-engine',listingMatches:filteredRanked.length,knowledgeMatched:Boolean(knowledgeMatch&&knowledgeMatch._score>=3),suggestHuman},{headers:noStore});
  }
  return NextResponse.json({reply:'Agent knowledge service is ready.'},{headers:noStore});
 }catch(e){console.error('Public Agent chat failed',e.code||e.message);return NextResponse.json({error:'Agent could not respond right now. Please try again shortly.'},{status:503,headers:noStore});}
}