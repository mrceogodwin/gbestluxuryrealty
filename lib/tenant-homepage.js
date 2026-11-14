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
  id bigserial PRIMARY KEY,legacy_revision_id bigint,tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE RESTRICT,
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
  await pool.query('ALTER TABLE public.homepage_tenant_section_revisions ADD COLUMN IF NOT EXISTS legacy_revision_id bigint');
  await pool.query(`DO $ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='homepage_tenant_legacy_revision_unique' AND conrelid='public.homepage_tenant_section_revisions'::regclass) THEN ALTER TABLE public.homepage_tenant_section_revisions ADD CONSTRAINT homepage_tenant_legacy_revision_unique UNIQUE(legacy_revision_id); END IF; END $`);
  await pool.query(`INSERT INTO public.homepage_tenant_section_revisions(legacy_revision_id,tenant_id,section_key,content,action,changed_at)
   SELECT id,$1,section_key,content,action,changed_at FROM public.homepage_section_revisions
   ON CONFLICT(legacy_revision_id) DO NOTHING`,[owner.rows[0].id]);
 }
 if(Number(tenantId)!==Number(owner.rows[0].id)){
  await pool.query(`INSERT INTO public.homepage_tenant_sections(tenant_id,section_key,label,sort_order,draft_content,published_content,updated_at,published_at)
   SELECT $1,section_key,label,sort_order,draft_content,published_content,now(),NULL
   FROM public.homepage_tenant_sections WHERE tenant_id=$2
   ON CONFLICT(tenant_id,section_key) DO NOTHING`,[tenantId,owner.rows[0].id]);
 }
 const brand=await pool.query('SELECT brand_config FROM public.site_tenants WHERE id=$1',[tenantId]);
 if(brand.rowCount&&brand.rows[0].brand_config){
  await pool.query("UPDATE public.homepage_tenant_sections SET draft_content=draft_content || $2::jsonb,published_content=published_content || $2::jsonb WHERE tenant_id=$1 AND section_key='site_settings'",[tenantId,JSON.stringify(brand.rows[0].brand_config)]);
 }
}
