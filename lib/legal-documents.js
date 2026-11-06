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
  await c.query(`INSERT INTO public.legal_documents(slug,title,category,body,required,status)
   VALUES(
    'agency-commission-terms',
    'Agency Commission Agreement — 10%',
    'purchase',
    'G-BEST LUXURY REALTY — AGENCY COMMISSION AGREEMENT (DRAFT FOR LEGAL REVIEW)\\n\\nCOMMISSION RATE\\nThe agency commission rate is 10% (ten percent). This rate applies to property purchase transactions and to rental and lease transactions arranged or facilitated by G-BEST Luxury Realty.\\n\\nTRANSACTION-SPECIFIC DISCLOSURE\\nBefore a client becomes bound to a transaction, G-BEST must provide written transaction-specific terms identifying the amount against which the 10% commission is calculated, the party responsible for paying it, the payment due date or triggering event, and any applicable taxes or other charges. This draft does not assume or create those details.\\n\\nCLIENT ACKNOWLEDGEMENT\\nThe client acknowledges that the 10% agency commission rate applies to purchases, rentals and leases. The client should review the transaction-specific written terms and obtain independent legal advice before signing or paying.\\n\\nLEGAL REVIEW REQUIRED\\nThis is an unpublished working draft, not a final contract. A Nigerian property lawyer must review and complete the calculation basis, payer, payment timing, treatment of renewals, cancellations, refunds, taxes, and any exceptions before publication or client acceptance.',
    true,
    'draft'
   ) ON CONFLICT(slug) DO NOTHING`);
  await c.query('COMMIT');return pool;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}})();
 try{return await ready}catch(e){ready=undefined;throw e;}
}
