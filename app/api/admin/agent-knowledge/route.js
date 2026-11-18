import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../../lib/db';
import {isAdminRequest} from '../../../../lib/admin-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','Pragma':'no-cache'};
function cleanEntries(value){
 if(!Array.isArray(value)||value.length>100)throw new Error('Add up to 100 knowledge entries.');
 return value.map((x,i)=>{
  const question=String(x?.question||'').trim().slice(0,240),answer=String(x?.answer||'').trim().slice(0,1800),category=String(x?.category||'General').trim().slice(0,60);
  if(!question||!answer)throw new Error('Every entry needs both a question and an approved answer (entry '+(i+1)+').');
  return {id:String(x.id||'').slice(0,64)||'kb-'+(i+1),question,answer,category,keywords:String(x.keywords||'').trim().slice(0,300),active:x.active!==false};
 });
}
export async function GET(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Super Admin access required.'},{status:403,headers:noStore});
 try{
  const pool=getDatabasePool(),id=Number(req.nextUrl.searchParams.get('tenantId'));
  const q=await pool.query('SELECT id,display_name,brand_config FROM public.site_tenants WHERE ($1::bigint IS NULL OR id=$1) ORDER BY (tenant_key=\'gbest\') DESC LIMIT 1',[Number.isSafeInteger(id)&&id>0?id:null]);
  if(!q.rowCount)return NextResponse.json({error:'Company workspace not found.'},{status:404,headers:noStore});
  const brand=q.rows[0].brand_config||{};
  return NextResponse.json({tenant:{id:q.rows[0].id,name:q.rows[0].display_name},knowledge:Array.isArray(brand.agentKnowledge)?brand.agentKnowledge:[],avatarUrl:brand.agentAvatarUrl||''},{headers:noStore});
 }catch(e){console.error('Agent knowledge GET',e.code||e.message);return NextResponse.json({error:'Could not load Agent knowledge.'},{status:500,headers:noStore});}
}
export async function PUT(req){
 if(!await isAdminRequest(req))return NextResponse.json({error:'Super Admin access required.'},{status:403,headers:noStore});
 try{
  const body=await req.json(),id=Number(body.tenantId);
  if(!Number.isSafeInteger(id)||id<1)return NextResponse.json({error:'Select a company workspace.'},{status:400,headers:noStore});
  const knowledge=cleanEntries(body.knowledge||[]);
  const avatarUrl=String(body.avatarUrl||'').trim().slice(0,1200);
  if(avatarUrl&&!/^https:\/\//i.test(avatarUrl))return NextResponse.json({error:'Agent portrait must use a secure HTTPS image URL.'},{status:400,headers:noStore});
  const pool=getDatabasePool();
  const q=await pool.query(`UPDATE public.site_tenants SET brand_config=COALESCE(brand_config,'{}'::jsonb)||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING id,display_name`,[id,JSON.stringify({agentKnowledge:knowledge,agentAvatarUrl:avatarUrl})]);
  if(!q.rowCount)return NextResponse.json({error:'Company workspace not found.'},{status:404,headers:noStore});
  return NextResponse.json({ok:true,message:'Agent knowledge and profile saved.',knowledge,avatarUrl},{headers:noStore});
 }catch(e){console.error('Agent knowledge PUT',e.code||e.message);return NextResponse.json({error:e.message||'Could not save Agent knowledge.'},{status:400,headers:noStore});}
}