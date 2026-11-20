-- G-BEST tenant-safe client identity and inspection schedule settings.
-- Existing registrations are preserved; uniqueness is scoped to each workspace.
BEGIN;

ALTER TABLE public.client_registrations
  DROP CONSTRAINT IF EXISTS client_registrations_email_normalized_key;

CREATE UNIQUE INDEX IF NOT EXISTS client_registrations_tenant_email_normalized_uidx
  ON public.client_registrations (tenant_id, email_normalized);

CREATE TABLE IF NOT EXISTS public.inspection_schedule_tenant_settings (
  tenant_id bigint PRIMARY KEY
    REFERENCES public.site_tenants(id) ON DELETE RESTRICT,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inspection_schedule_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
