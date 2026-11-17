-- G-BEST client email OTP authentication
-- Apply once to the Neon database before enabling client sign-in.
CREATE TABLE IF NOT EXISTS public.client_auth_challenges (
  id bigserial PRIMARY KEY,
  registration_id text NOT NULL,
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  client_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_auth_challenges ADD COLUMN IF NOT EXISTS client_ip text;
CREATE INDEX IF NOT EXISTS client_auth_challenges_email_created_idx
  ON public.client_auth_challenges(email_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS client_auth_challenges_ip_created_idx
  ON public.client_auth_challenges(client_ip, created_at DESC);
CREATE TABLE IF NOT EXISTS public.client_sessions (
  id bigserial PRIMARY KEY,
  registration_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_sessions_token_hash_uidx
  ON public.client_sessions(token_hash);
CREATE INDEX IF NOT EXISTS client_sessions_registration_idx
  ON public.client_sessions(registration_id, expires_at DESC);
