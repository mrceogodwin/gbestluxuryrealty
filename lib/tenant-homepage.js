import {ensureSiteTenants} from './site-tenants';
export async function ensureTenantHomepageTables(pool,tenantId){
 await ensureSiteTenants(pool);
 await pool.query(`CREATE TABLE IF NOT EXISTS public.homepage_tenant_sections(
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE RESTRICT,
  section_key text NOT NULL,label text NOT NULL,sort_order integer NOT NULL DEFAULT 0,
  draft_content jsonb NOT NULL DEFAULT '{}'::jsonb,published_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
  PRIMARY KEY(tenant_id,section_key))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS public.homepage_tenant_section_revisions(
  id bigserial PRIMARY KEY,tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE RESTRICT,
  section_key text NOT NULL,content jsonb NOT NULL,action text NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())`);
 await pool.query('CREATE INDEX IF NOT EXISTS homepage_tenant_revisions_idx ON public.homepage_tenant_section_revisions(tenant_id,section_key,changed_at DESC)');
 const owner=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");
 if(!owner.rowCount)throw new Error('Default G-BEST workspace is missing.');
 const legacy=await pool.query("SELECT to_regclass('public.homepage_sections') IS NOT NULL AS ready");
 if(legacy.rows[0]?.ready){
  await pool.query(`INSERT INTO public.homepage_tenant_sections(tenant_id,section_key,label,sort_order,draft_content,published_content,updated_at,published_at)
   SELECT $1,section_key,label,sort_order,draft_content,published_content,updated_at,published_at FROM public.homepage_sections
   ON CONFLICT(tenant_id,section_key) DO NOTHING`,[owner.rows[0].id]);
 }
 const legacyRevisions=await pool.query("SELECT to_regclass('public.homepage_section_revisions') IS NOT NULL AS ready");
 if(legacyRevisions.rows[0]?.ready){
  await pool.query(`INSERT INTO public.homepage_tenant_section_revisions(tenant_id,section_key,content,action,changed_at)
   SELECT $1,section_key,content,action,changed_at FROM public.homepage_section_revisions
   ON CONFLICT DO NOTHING`,[owner.rows[0].id]);
 }
 if(Number(tenantId)!==Number(owner.rows[0].id)){
  await pool.query(`INSERT INTO public.homepage_tenant_sections(tenant_id,section_key,label,sort_order,draft_content,published_content,updated_at,published_at)
   SELECT $1,section_key,label,sort_order,draft_content,published_content,now(),NULL
   FROM public.homepage_tenant_sections WHERE tenant_id=$2
   ON CONFLICT(tenant_id,section_key) DO NOTHING`,[tenantId,owner.rows[0].id]);
 }
}
