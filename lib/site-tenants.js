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
 await pool.query(`DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='properties_tenant_id_fkey' AND conrelid='public.properties'::regclass) THEN
   ALTER TABLE public.properties ADD CONSTRAINT properties_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT;
  END IF;
 END $`);
 const nullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='properties' AND column_name='tenant_id'");
 if(nullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.properties ALTER COLUMN tenant_id SET NOT NULL');
 await pool.query('CREATE INDEX IF NOT EXISTS properties_tenant_status_updated_idx ON public.properties(tenant_id,status,updated_at DESC)');
 const registrations=await pool.query("SELECT to_regclass('public.client_registrations') IS NOT NULL AS ready");
 if(registrations.rows[0]?.ready){
  await pool.query('ALTER TABLE public.client_registrations ADD COLUMN IF NOT EXISTS tenant_id bigint');
  await pool.query('UPDATE public.client_registrations SET tenant_id=$1 WHERE tenant_id IS NULL',[owner.rows[0].id]);
  await pool.query(`DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_registrations_tenant_id_fkey' AND conrelid='public.client_registrations'::regclass) THEN ALTER TABLE public.client_registrations ADD CONSTRAINT client_registrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT; END IF; END $`);
  const registrationNullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='client_registrations' AND column_name='tenant_id'");
  if(registrationNullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.client_registrations ALTER COLUMN tenant_id SET NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS client_registrations_tenant_created_idx ON public.client_registrations(tenant_id,created_at DESC)');
 }
 const bookings=await pool.query("SELECT to_regclass('public.inspection_requests') IS NOT NULL AS ready");
 if(bookings.rows[0]?.ready){
  await pool.query('ALTER TABLE public.inspection_requests ADD COLUMN IF NOT EXISTS tenant_id bigint');
  await pool.query('UPDATE public.inspection_requests SET tenant_id=$1 WHERE tenant_id IS NULL',[owner.rows[0].id]);
  await pool.query(`DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inspection_requests_tenant_id_fkey' AND conrelid='public.inspection_requests'::regclass) THEN ALTER TABLE public.inspection_requests ADD CONSTRAINT inspection_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT; END IF; END $`);
  const bookingNullable=await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_requests' AND column_name='tenant_id'");
  if(bookingNullable.rows[0]?.is_nullable==='YES')await pool.query('ALTER TABLE public.inspection_requests ALTER COLUMN tenant_id SET NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS inspection_requests_tenant_created_idx ON public.inspection_requests(tenant_id,created_at DESC)');
 }
}

export async function ensureSiteTenants(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS public.site_tenants(
  id bigserial PRIMARY KEY,
  tenant_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  primary_domain text UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  brand_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 await pool.query('CREATE INDEX IF NOT EXISTS site_tenants_status_idx ON public.site_tenants(status)');
 const siteUrl=normalizeHostname(process.env.SITE_URL||process.env.NEXT_PUBLIC_SITE_URL||'gbestluxuryrealty.vercel.app');
 const exists=await pool.query("SELECT to_regclass('public.homepage_sections') IS NOT NULL AS ready");
 let initialBrand=defaultBrand();
 if(exists.rows[0]?.ready){const legacy=await pool.query("SELECT published_content FROM public.homepage_sections WHERE section_key='site_settings' LIMIT 1");if(legacy.rows[0]?.published_content)initialBrand=legacy.rows[0].published_content;}
 await pool.query(`INSERT INTO public.site_tenants(tenant_key,display_name,primary_domain,brand_config)
 VALUES('gbest','G-BEST Luxury Realty',$1,$2::jsonb)
 ON CONFLICT(tenant_key) DO UPDATE SET
 display_name=CASE WHEN public.site_tenants.display_name='' THEN EXCLUDED.display_name ELSE public.site_tenants.display_name END,
 primary_domain=COALESCE(public.site_tenants.primary_domain,EXCLUDED.primary_domain),
 updated_at=now()`,[siteUrl,JSON.stringify(initialBrand)]);
 await ensureTenantPropertySchema(pool);
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
 const fields=['siteName','tagline','logoUrl','logoAlt','primaryColor','accentColor','pageBackgroundColor','textColor','fontFamily','seoTitle','seoDescription','seoImage','faviconUrl'];
 for(const key of fields){
  if(value[key]===undefined)continue;
  const v=String(value[key]??'').trim();
  if(['logoUrl','seoImage','faviconUrl'].includes(key)&&v&&!/^https:\/\//i.test(v))throw new Error(key+' must use an HTTPS URL.');
  if(['primaryColor','accentColor','pageBackgroundColor','textColor'].includes(key)&&v&&!/^#[0-9a-f]{6}$/i.test(v))throw new Error(key+' must be a six-digit hex colour.');
  if(key==='fontFamily'&&v&&!/^[a-zA-Z0-9 ,'"-]{1,120}$/.test(v))throw new Error('Font family contains unsupported characters.');
  const max=key==='seoDescription'?320:key==='seoTitle'?180:key==='logoUrl'||key==='seoImage'||key==='faviconUrl'?1200:500;
  out[key]=v.slice(0,max);
 }
 if(out.siteName!==undefined&&!out.siteName)throw new Error('Company name cannot be empty.');
 return out;
}
