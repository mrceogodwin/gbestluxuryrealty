import { getDatabasePool } from './db';

let ready;
export async function ensureLegalDocumentTables(){
 if(ready)return ready;
 ready=(async()=>{const pool=getDatabasePool();const c=await pool.connect();try{
  await c.query('BEGIN');
  await c.query(`CREATE TABLE IF NOT EXISTS public.legal_documents (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
   title text NOT NULL, category text NOT NULL DEFAULT 'inspection',
   body text NOT NULL DEFAULT '', file_url text, required boolean NOT NULL DEFAULT true,
   status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
   version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
   updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
  )`);
  await c.query(`CREATE TABLE IF NOT EXISTS public.legal_document_revisions (
   id bigserial PRIMARY KEY, document_id uuid NOT NULL REFERENCES public.legal_documents(id),
   version integer NOT NULL, snapshot jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
   UNIQUE(document_id,version)
  )`);
  await c.query(`CREATE TABLE IF NOT EXISTS public.legal_document_acceptances (
   id bigserial PRIMARY KEY, inspection_request_id uuid NOT NULL REFERENCES public.inspection_requests(id) ON DELETE CASCADE,
   document_id uuid NOT NULL, document_version integer NOT NULL, document_title text NOT NULL,
   content_sha256 text NOT NULL, accepted boolean NOT NULL CHECK(accepted=true),
   accepted_at timestamptz NOT NULL DEFAULT now(), client_email text NOT NULL,
   UNIQUE(inspection_request_id,document_id)
  )`);
  await c.query('COMMIT');return pool;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}})();
 try{return await ready}catch(e){ready=undefined;throw e;}
}
