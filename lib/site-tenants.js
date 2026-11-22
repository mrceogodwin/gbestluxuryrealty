import {HOMEPAGE_DEFAULTS} from './homepage-content';

const defaultBrand=()=>({...HOMEPAGE_DEFAULTS.find(x=>x.key==='site_settings')?.content||{}});
export function normalizeHostname(value){
 const raw=String(value||'').split(',')[0].trim().toLowerCase();
 if(!raw)return '';
 try{return new URL(raw.includes('://')?raw:'https://'+raw).hostname.replace(/^www\./,'').replace(/\.$/,'');}
 catch{return '';}
}

async function ensureTenantPropertySchema(pool){
 const table=await pool.query("SELECT to_regclass('public.properties') IS NOT NULL AS ready");
 if(!table.rows[0]?.ready)return;
 await pool.query('ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS tenant_id bigint');
 const owner=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1");
 if(!owner.rowCount)throw new Error('Default G-BEST tenant is missing.');
 await pool.query('UPDATE public.properties SET tenant_id=$1 WHERE tenant_id IS NULL',[owner.rows[0].id]);
 await pool.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='properties_tenant_id_fkey' AND conrelid='public.properties'::regclass) THEN
   ALTER TABLE public.properties ADD CONSTRAINT properties_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT;
  END IF;
 END $$`);
 const nullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='properties' AND column_name='tenant_id'");
 if(nullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.properties ALTER COLUMN tenant_id SET NOT NULL');
 await pool.query('CREATE INDEX IF NOT EXISTS properties_tenant_status_updated_idx ON public.properties(tenant_id,status,updated_at DESC)');
 const registrations=await pool.query("SELECT to_regclass('public.client_registrations') IS NOT NULL AS ready");
 if(registrations.rows[0]?.ready){
  await pool.query('ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS tenant_id bigint');
  await pool.query('UPDATE public.client_registrations SET tenant_id=$1 WHERE tenant_id IS NULL',[owner.rows[0].id]);
  await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_registrations_tenant_id_fkey' AND conrelid='public.client_registrations'::regclass) THEN ALTER TABLE public.client_registrations ADD CONSTRAINT client_registrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT; END IF; END $$`);
  const registrationNullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='client_registrations' AND column_name='tenant_id'");
  if(registrationNullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.client_registrations ALTER COLUMN tenant_id SET NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS client_registrations_tenant_created_idx ON public.client_registrations(tenant_id,created_at DESC)');
 }
 const bookings=await pool.query("SELECT to_regclass('public.inspection_requests') IS NOT NULL AS ready");
 if(bookings.rows[0]?.ready){
  await pool.query('ALTER TABLE public.inspection_requests ADD COLUMN IF NOT EXISTS tenant_id bigint');
  await pool.query('UPDATE public.inspection_requests SET tenant_id=$1 WHERE tenant_id IS NULL',[owner.rows[0].id]);
  await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inspection_requests_tenant_id_fkey' AND conrelid='public.inspection_requests'::regclass) THEN ALTER TABLE public.inspection_requests ADD CONSTRAINT inspection_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT; END IF; END $$`);
  const bookingNullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_requests' AND column_name='tenant_id'");
  if(bookingNullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.inspection_requests ALTER COLUMN tenant_id SET NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS inspection_requests_tenant_created_idx ON public.inspection_requests(tenant_id,created_at DESC)');
 }
}

async function ensureTenantCompanyVideoSchema(pool,defaultTenantId){
 await pool.query(`CREATE TABLE IF NOT EXISTS public.company_profile_video_tenants(
  tenant_id bigint PRIMARY KEY REFERENCES public.site_tenants(id) ON DELETE RESTRICT,
  video_url text NOT NULL,title varchar(180) NOT NULL DEFAULT 'Company Featured Property Film',
  description text NOT NULL DEFAULT '',file_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL DEFAULT 'video/mp4',file_size bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now())`);
 const legacy=await pool.query("SELECT to_regclass('public.company_profile_video') IS NOT NULL AS ready");
 if(legacy.rows[0]?.ready){
  await pool.query(`INSERT INTO public.company_profile_video_tenants(tenant_id,video_url,title,description,file_name,mime_type,file_size,updated_at)
   SELECT $1,video_url,title,description,file_name,mime_type,file_size,updated_at FROM public.company_profile_video WHERE id=1
   ON CONFLICT(tenant_id) DO NOTHING`,[defaultTenantId]);
 }
}

async function ensureStaffTenantSchema(pool,defaultTenantId){
 const accounts=await pool.query("SELECT to_regclass('public.staff_accounts') IS NOT NULL AS ready");
 if(!accounts.rows[0]?.ready)return;
 await pool.query('ALTER TABLE public.staff_accounts ADD COLUMN IF NOT EXISTS tenant_id bigint');
 await pool.query('UPDATE public.staff_accounts SET tenant_id=$1 WHERE tenant_id IS NULL',[defaultTenantId]);
 await pool.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='staff_accounts_tenant_id_fkey' AND conrelid='public.staff_accounts'::regclass) THEN ALTER TABLE public.staff_accounts ADD CONSTRAINT staff_accounts_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT; END IF; END $$`);
 const nullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='staff_accounts' AND column_name='tenant_id'");
 if(nullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.staff_accounts ALTER COLUMN tenant_id SET NOT NULL');
 await pool.query('CREATE INDEX IF NOT EXISTS staff_accounts_tenant_status_idx ON public.staff_accounts(tenant_id,status,created_at DESC)');
 const events=await pool.query("SELECT to_regclass('public.staff_audit_events') IS NOT NULL AS ready");
 if(events.rows[0]?.ready){
  await pool.query('ALTER TABLE public.staff_audit_events ADD COLUMN IF NOT EXISTS tenant_id bigint');
  await pool.query('UPDATE public.staff_audit_events e SET tenant_id=a.tenant_id FROM public.staff_accounts a WHERE e.target_type=\'staff\' AND e.target_id::text=a.id::text AND e.tenant_id IS NULL');
  await pool.query('UPDATE public.staff_audit_events SET tenant_id=$1 WHERE tenant_id IS NULL',[defaultTenantId]);
  await pool.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='staff_audit_events_tenant_id_fkey' AND conrelid='public.staff_audit_events'::regclass) THEN ALTER TABLE public.staff_audit_events ADD CONSTRAINT staff_audit_events_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT; END IF; END $$`);
  await pool.query('CREATE INDEX IF NOT EXISTS staff_audit_events_tenant_created_idx ON public.staff_audit_events(tenant_id,created_at DESC)');
 }
}

export async function ensureSiteTenants(pool){
 // Request-time tenant resolution must be read-only. Schema and seed data are
 // installed by controlled Neon migrations, not by public page/API requests.
 const tenant=await pool.query("SELECT id FROM public.site_tenants WHERE tenant_key='gbest' AND status='active' LIMIT 1");
 if(!tenant.rowCount)throw new Error('The G-BEST workspace is not initialized. Apply the tenant schema migration before serving requests.');
 const required=[
  'properties','client_registrations','inspection_requests','staff_accounts',
  'staff_audit_events','company_profile_video_tenants','homepage_tenant_sections',
  'homepage_tenant_section_revisions'
 ];
 const checks=await pool.query(
  "SELECT name,to_regclass('public.'||name) IS NOT NULL AS ready FROM unnest($1::text[]) AS name",
  [required]
 );
 const missing=checks.rows.filter(x=>!x.ready).map(x=>x.name);
 if(missing.length)throw new Error('Missing G-BEST tenant tables: '+missing.join(', '));
 return tenant.rows[0];
}
export async function resolveSiteTenant(pool,host){
 await ensureSiteTenants(pool);
 const hostname=normalizeHostname(host);
 if(!hostname)return null;
 const found=await pool.query("SELECT id,tenant_key,display_name,primary_domain,status,brand_config FROM public.site_tenants WHERE lower(primary_domain)=lower($1) AND status='active' LIMIT 1",[hostname]);
 if(found.rowCount)return found.rows[0];
 const configured=normalizeHostname(process.env.SITE_URL||process.env.NEXT_PUBLIC_SITE_URL||'');
 const vercel=normalizeHostname(process.env.VERCEL_URL||'');
 const isPreview=hostname==='localhost'||hostname==='127.0.0.1'||hostname.endsWith('.vercel.app');
 if(hostname===configured||hostname===vercel||isPreview){
  const fallback=await pool.query("SELECT id,tenant_key,display_name,primary_domain,status,brand_config FROM public.site_tenants WHERE tenant_key='gbest' AND status='active' LIMIT 1");
  return fallback.rows[0]||null;
 }
 return null;
}
export function cleanTenantBrand(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Brand settings must be an object.');
 const out={};
 const fields=['siteName','tagline','logoUrl','logoAlt','headerLogoUrl','footerLogoUrl','faviconUrl','primaryColor','accentColor','pageBackgroundColor','textColor','fontFamily','seoTitle','seoDescription','seoImage','contactPhone','contactPhoneDisplay','contactEmail','contactAddress','whatsappNumber','footerDescriptor','footerCopyright','footerAbout','headerAnnouncement','headerCtaText','headerCtaUrl','registrationBrandTitle','registrationBrandSubtitle','registrationEyebrow','registrationHeadline','registrationHeadlineAccent','registrationIntro','registrationMeta','registrationTermsText','registrationConsentLabel','registrationSuccessText','registrationSuccessEyebrow','registrationConsentHeading','registrationConsentEyebrow','tikTokUrl','facebookUrl','instagramUrl','youtubeUrl','linkedinUrl','xUrl'];
 for(const key of fields){
  if(value[key]===undefined)continue;
  const v=String(value[key]??'').trim();
  if(['logoUrl','seoImage','faviconUrl','headerLogoUrl','footerLogoUrl','tikTokUrl','facebookUrl','instagramUrl','youtubeUrl','linkedinUrl','xUrl'].includes(key)&&v&&!/^https:\/\//i.test(v))throw new Error(key+' must use an HTTPS URL.');
  if(['primaryColor','accentColor','pageBackgroundColor','textColor'].includes(key)&&v&&!/^#[0-9a-f]{6}$/i.test(v))throw new Error(key+' must be a six-digit hex colour.');
  if(key==='fontFamily'&&v&&!/^[a-zA-Z0-9 ,'"-]{1,120}$/.test(v))throw new Error('Font family contains unsupported characters.');
  const max=key==='seoDescription'?320:key==='seoTitle'?180:['logoUrl','seoImage','faviconUrl','headerLogoUrl','footerLogoUrl','tikTokUrl','facebookUrl','instagramUrl','youtubeUrl','linkedinUrl','xUrl'].includes(key)?1200:['registrationIntro','footerAbout','registrationTermsText'].includes(key)?2500:500;
  out[key]=v.slice(0,max);
 }
 if(out.siteName!==undefined&&!out.siteName)throw new Error('Company name cannot be empty.');
 return out;
}
