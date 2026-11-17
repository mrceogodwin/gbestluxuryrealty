-- G-BEST private client chat foundation. Apply only after review/approval on the target Neon branch.
CREATE TABLE IF NOT EXISTS public.client_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.client_registrations(id) ON DELETE CASCADE,
  assigned_staff_id text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, registration_id)
);
CREATE INDEX IF NOT EXISTS client_chat_conversations_tenant_activity_idx
  ON public.client_chat_conversations(tenant_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS client_chat_conversations_assignee_idx
  ON public.client_chat_conversations(tenant_id, assigned_staff_id, last_message_at DESC);
CREATE TABLE IF NOT EXISTS public.client_chat_access (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL REFERENCES public.client_registrations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_chat_access_registration_idx
  ON public.client_chat_access(tenant_id, registration_id, expires_at DESC);
CREATE TABLE IF NOT EXISTS public.client_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.client_chat_conversations(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('client','admin','staff')),
  sender_id text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS client_chat_messages_conversation_idx
  ON public.client_chat_messages(conversation_id, created_at ASC);
