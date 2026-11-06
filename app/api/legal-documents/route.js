import {NextResponse} from 'next/server';
import {ensureLegalDocumentTables} from '../../../lib/legal-documents';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){try{const pool=await ensureLegalDocumentTables();const q=await pool.query("SELECT id,slug,title,category,body,file_url,required,version,published_at,published_by,change_summary,change_type,effective_at FROM public.legal_documents WHERE status='published' ORDER BY category,title");return NextResponse.json({documents:q.rows},{headers:{'Cache-Control':'no-store'}})}catch(e){console.error('Public legal documents failed',e.code||e.message);return NextResponse.json({error:'Documents are temporarily unavailable.'},{status:503})}}
