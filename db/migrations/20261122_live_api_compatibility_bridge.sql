-- Temporary compatibility bridge for the currently live pre-tenant API deployment.
-- Remove these defaults and the global newsletter index after the tenant-aware
-- production deployment is confirmed READY and live.
DO $$
DECLARE gbest_id bigint; active_count integer;
BEGIN
 SELECT id INTO gbest_id FROM public.site_tenants WHERE tenant_key='gbest' AND status='active' LIMIT 1;
 SELECT count(*) INTO active_count FROM public.site_tenants WHERE status='active';
 IF gbest_id IS NULL OR active_count<>1 THEN
  RAISE EXCEPTION 'Compatibility bridge requires exactly one active tenant (G-BEST).';
 END IF;
 EXECUTE format('ALTER TABLE public.business_contact_submissions ALTER COLUMN tenant_id SET DEFAULT %s',gbest_id);
 EXECUTE format('ALTER TABLE public.finance_ledger ALTER COLUMN tenant_id SET DEFAULT %s',gbest_id);
 EXECUTE format('ALTER TABLE public.finance_ledger_audit ALTER COLUMN tenant_id SET DEFAULT %s',gbest_id);
END $$;
-- The previous live newsletter handler uses ON CONFLICT(email). This temporary
-- index preserves that handler until the tenant-aware API is deployed.
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_legacy_email_compat_uidx
 ON public.newsletter_subscribers(email);
