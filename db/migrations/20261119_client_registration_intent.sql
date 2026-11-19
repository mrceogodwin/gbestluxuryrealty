-- G-BEST: separate free client access from inspection-registration payment.
-- Existing registrations retain the inspection/payment path for backward compatibility.
ALTER TABLE public.client_registrations
  ADD COLUMN IF NOT EXISTS registration_intent text NOT NULL DEFAULT 'inspection';

ALTER TABLE public.client_registrations
  DROP CONSTRAINT IF EXISTS client_registrations_registration_intent_check;
ALTER TABLE public.client_registrations
  ADD CONSTRAINT client_registrations_registration_intent_check
  CHECK (registration_intent IN ('general','inspection'));

ALTER TABLE public.client_registrations
  DROP CONSTRAINT IF EXISTS client_registrations_registration_fee_kobo_check;
ALTER TABLE public.client_registrations
  ADD CONSTRAINT client_registrations_registration_fee_kobo_check
  CHECK (registration_fee_kobo IN (0,1500000));
ALTER TABLE public.client_registrations
  ALTER COLUMN registration_fee_kobo SET DEFAULT 0;

ALTER TABLE public.client_registrations
  DROP CONSTRAINT IF EXISTS client_registrations_payment_status_check;
ALTER TABLE public.client_registrations
  ADD CONSTRAINT client_registrations_payment_status_check
  CHECK (payment_status IN ('pending','submitted','approved','rejected','not_required'));

CREATE INDEX IF NOT EXISTS client_registrations_tenant_intent_created_idx
  ON public.client_registrations(tenant_id,registration_intent,created_at DESC);
