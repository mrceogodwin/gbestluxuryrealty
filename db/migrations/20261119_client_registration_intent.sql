BEGIN;

-- Existing rows are classified as inspection registrations for backward compatibility.
ALTER TABLE public.client_registrations
  ADD COLUMN IF NOT EXISTS registration_intent text NOT NULL DEFAULT 'inspection';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_registrations_registration_intent_check_v2') THEN
    ALTER TABLE public.client_registrations
      ADD CONSTRAINT client_registrations_registration_intent_check_v2
      CHECK (registration_intent IN ('general','inspection'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_registrations_registration_fee_kobo_check_v2') THEN
    ALTER TABLE public.client_registrations
      ADD CONSTRAINT client_registrations_registration_fee_kobo_check_v2
      CHECK (registration_fee_kobo IN (0,1500000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_registrations_payment_status_check_v2') THEN
    ALTER TABLE public.client_registrations
      ADD CONSTRAINT client_registrations_payment_status_check_v2
      CHECK (payment_status IN ('pending','submitted','approved','rejected','not_required'));
  END IF;
END $$;

ALTER TABLE public.client_registrations
  ALTER COLUMN registration_fee_kobo SET DEFAULT 0;

-- Replace legacy restrictions only after the broader checks are in place.
ALTER TABLE public.client_registrations
  DROP CONSTRAINT IF EXISTS client_registrations_registration_fee_kobo_check;
ALTER TABLE public.client_registrations
  DROP CONSTRAINT IF EXISTS client_registrations_payment_status_check;

CREATE INDEX IF NOT EXISTS client_registrations_tenant_intent_created_idx
  ON public.client_registrations(tenant_id,registration_intent,created_at DESC);

COMMIT;
