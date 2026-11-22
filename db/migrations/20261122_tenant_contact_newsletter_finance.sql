-- Tenant isolation for contact enquiries, newsletter subscriptions and finance.
-- Apply only through the approved Neon production migration workflow.
DO $$
DECLARE gbest_id bigint;
BEGIN
 SELECT id INTO gbest_id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1;
 IF gbest_id IS NULL THEN RAISE EXCEPTION 'G-BEST tenant missing; aborting.'; END IF;

 ALTER TABLE public.business_contact_submissions ADD COLUMN IF NOT EXISTS tenant_id bigint;
 UPDATE public.business_contact_submissions SET tenant_id=gbest_id WHERE tenant_id IS NULL;
 ALTER TABLE public.business_contact_submissions ALTER COLUMN tenant_id SET NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='business_contact_submissions_tenant_id_fkey' AND conrelid='public.business_contact_submissions'::regclass) THEN
  ALTER TABLE public.business_contact_submissions ADD CONSTRAINT business_contact_submissions_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT;
 END IF;

 ALTER TABLE public.finance_ledger ADD COLUMN IF NOT EXISTS tenant_id bigint;
 UPDATE public.finance_ledger SET tenant_id=gbest_id WHERE tenant_id IS NULL;
 ALTER TABLE public.finance_ledger ALTER COLUMN tenant_id SET NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='finance_ledger_tenant_id_fkey' AND conrelid='public.finance_ledger'::regclass) THEN
  ALTER TABLE public.finance_ledger ADD CONSTRAINT finance_ledger_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT;
 END IF;

 ALTER TABLE public.finance_ledger_audit ADD COLUMN IF NOT EXISTS tenant_id bigint;
 UPDATE public.finance_ledger_audit a SET tenant_id=l.tenant_id FROM public.finance_ledger l WHERE a.ledger_id=l.id AND a.tenant_id IS NULL;
 UPDATE public.finance_ledger_audit SET tenant_id=gbest_id WHERE tenant_id IS NULL;
 ALTER TABLE public.finance_ledger_audit ALTER COLUMN tenant_id SET NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='finance_ledger_audit_tenant_id_fkey' AND conrelid='public.finance_ledger_audit'::regclass) THEN
  ALTER TABLE public.finance_ledger_audit ADD CONSTRAINT finance_ledger_audit_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS business_contact_submissions_tenant_created_idx ON public.business_contact_submissions(tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS finance_ledger_tenant_date_idx ON public.finance_ledger(tenant_id,entry_date DESC,created_at DESC);
CREATE INDEX IF NOT EXISTS finance_ledger_tenant_status_idx ON public.finance_ledger(tenant_id,approval_status);
CREATE INDEX IF NOT EXISTS finance_ledger_audit_tenant_created_idx ON public.finance_ledger_audit(tenant_id,created_at DESC);

-- Create or upgrade the newsletter table while preserving legacy subscribers.
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint,
 email varchar(254) NOT NULL,
 email_normalized varchar(254),
 source varchar(40) NOT NULL DEFAULT 'homepage',
 subscribed_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 unsubscribed_at timestamptz
);
ALTER TABLE public.newsletter_subscribers ADD COLUMN IF NOT EXISTS tenant_id bigint;
ALTER TABLE public.newsletter_subscribers ADD COLUMN IF NOT EXISTS email_normalized varchar(254);
DO $$
DECLARE gbest_id bigint; c record;
BEGIN
 SELECT id INTO gbest_id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1;
 UPDATE public.newsletter_subscribers SET tenant_id=COALESCE(tenant_id,gbest_id),email_normalized=COALESCE(email_normalized,lower(btrim(email)));
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.newsletter_subscribers'::regclass AND contype='u'
 LOOP
  IF (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM unnest((SELECT conkey FROM pg_constraint WHERE conname=c.conname AND conrelid='public.newsletter_subscribers'::regclass)) k(attnum) JOIN pg_attribute a ON a.attrelid='public.newsletter_subscribers'::regclass AND a.attnum=k.attnum)=ARRAY['email']::text[] THEN
   EXECUTE format('ALTER TABLE public.newsletter_subscribers DROP CONSTRAINT %I',c.conname);
  END IF;
 END LOOP;
 ALTER TABLE public.newsletter_subscribers ALTER COLUMN tenant_id SET NOT NULL;
 ALTER TABLE public.newsletter_subscribers ALTER COLUMN email_normalized SET NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='newsletter_subscribers_tenant_id_fkey' AND conrelid='public.newsletter_subscribers'::regclass) THEN
  ALTER TABLE public.newsletter_subscribers ADD CONSTRAINT newsletter_subscribers_tenant_id_fkey FOREIGN KEY(tenant_id) REFERENCES public.site_tenants(id) ON DELETE RESTRICT;
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_tenant_email_uidx ON public.newsletter_subscribers(tenant_id,email_normalized);
CREATE INDEX IF NOT EXISTS newsletter_subscribers_tenant_active_idx ON public.newsletter_subscribers(tenant_id,subscribed_at DESC) WHERE unsubscribed_at IS NULL;
