import {NextResponse} from 'next/server';
import {getDatabasePool} from '../../../lib/db';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{const p=getDatabasePool();const q=await p.query('SELECT video_url,title,description,updated_at FROM public.company_profile_video WHERE id=1');return NextResponse.json({video:q.rows[0]||null},{headers:{'Cache-Control':'no-store'}});}catch(e){if(e.code==='42P01')return NextResponse.json({video:null},{headers:{'Cache-Control':'no-store'}});console.error('Public company video GET',e.code||e.message);return NextResponse.json({error:'Could not load company video.'},{status:500,headers:{'Cache-Control':'no-store'}});}}
