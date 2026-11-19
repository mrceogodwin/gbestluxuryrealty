-- G-BEST client registration and payment review schema
-- Additive, idempotent migration. Review and apply explicitly to the intended Neon database.
BEGIN;

CREATE TABLE IF NOT EXISTS public.client_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surname varchar(100) NOT NULL,
  other_names varchar(160) NOT NULL,
  address text NOT NULL,
  email varchar(254) NOT NULL,
  phone varchar(40) NOT NULL,
  nationality varchar(80) NOT NULL,
  state_of_origin varchar(100) NOT NULL,
  lga varchar(100) NOT NULL,
  occupation varchar(120) NOT NULL,
  property_type varchar(100) NOT NULL,
  price_range varchar(160) NOT NULL,
  preferred_location varchar(180) NOT NULL,
  property_description text,
  terms_accepted boolean NOT NULL DEFAULT false,
  fee_amount numeric(12,2),
  payment_reference varchar(120),
  receipt_name varchar(255),
  receipt_type varchar(100),
  receipt_data bytea,
  payment_status varchar(24) NOT NULL DEFAULT 'pending',
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Preserve compatibility with the existing client workspace and inspection gate.
ALTER TABLE public.client_registrations
  ADD COLUMN IF NOT EXISTS full_name varchar(260),
  ADD COLUMN IF NOT EXISTS client_id varchar(40),
  ADD COLUMN IF NOT EXISTS email_normalized varchar(254),
  ADD COLUMN IF NOT EXISTS registration_fee_kobo bigint,
  ADD COLUMN IF NOT EXISTS client_status varchar(24) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by varchar(254),
  ADD COLUMN IF NOT EXISTS fee_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_reference varchar(120),
  ADD COLUMN IF NOT EXISTS receipt_name varchar(255),
  ADD COLUMN IF NOT EXISTS receipt_type varchar(100),
  ADD COLUMN IF NOT EXISTS receipt_data bytea,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.client_registrations
  ALTER COLUMN approved_by TYPE varchar(254);

CREATE TABLE IF NOT EXISTS public.client_registration_rate_limits (
  rate_key varchar(64) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_registration_audit (
  id bigserial PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES public.client_registrations(id) ON DELETE CASCADE,
  old_status varchar(24),
  new_status varchar(24) NOT NULL,
  admin_note text,
  actor_type varchar(24) NOT NULL DEFAULT 'legacy_unknown',
  actor_email varchar(254) NOT NULL DEFAULT 'unknown',
  actor_staff_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_registration_audit
  ADD COLUMN IF NOT EXISTS actor_type varchar(24) NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS actor_email varchar(254) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS actor_staff_id uuid;

CREATE INDEX IF NOT EXISTS client_registrations_status_created_idx
  ON public.client_registrations(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS client_registrations_email_status_idx
  ON public.client_registrations(lower(email), payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS client_registration_audit_registration_changed_idx
  ON public.client_registration_audit(registration_id, changed_at DESC);

COMMIT;
