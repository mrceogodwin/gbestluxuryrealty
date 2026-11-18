-- G-BEST flagship communications foundation.
-- Additive migration only. Review and apply to a Neon test branch before any production use.

-- Client conversations: ownership, assignment history and operational status.
ALTER TABLE public.client_chat_conversations
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_client_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_staff_message_at timestamptz;

CREATE INDEX IF NOT EXISTS client_chat_conversations_queue_idx
  ON public.client_chat_conversations(tenant_id, status, priority, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS client_chat_conversations_assignee_queue_idx
  ON public.client_chat_conversations(tenant_id, assigned_staff_id, status, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.client_chat_assignment_events (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.client_chat_conversations(id) ON DELETE CASCADE,
  from_staff_id uuid REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  to_staff_id uuid REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('super_admin','staff','system')),
  actor_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_chat_assignment_events_conversation_idx
  ON public.client_chat_assignment_events(tenant_id, conversation_id, created_at DESC);

-- Staff-only direct and group conversations. These records are deliberately
-- separate from client_chat_conversations and are never exposed to clients.
CREATE TABLE IF NOT EXISTS public.staff_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  conversation_type text NOT NULL CHECK (conversation_type IN ('direct','group')),
  title text,
  created_by uuid REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (conversation_type='direct' AND title IS NULL) OR
    (conversation_type='group' AND length(trim(COALESCE(title,''))) BETWEEN 2 AND 100)
  )
);
CREATE INDEX IF NOT EXISTS staff_chat_conversations_tenant_activity_idx
  ON public.staff_chat_conversations(tenant_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.staff_chat_members (
  conversation_id uuid NOT NULL REFERENCES public.staff_chat_conversations(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_accounts(id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted_until timestamptz,
  PRIMARY KEY (conversation_id, staff_id)
);
CREATE INDEX IF NOT EXISTS staff_chat_members_inbox_idx
  ON public.staff_chat_members(tenant_id, staff_id, conversation_id);

CREATE TABLE IF NOT EXISTS public.staff_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.staff_chat_conversations(id) ON DELETE CASCADE,
  sender_staff_id uuid NOT NULL REFERENCES public.staff_accounts(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','system')),
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_chat_messages_history_idx
  ON public.staff_chat_messages(tenant_id, conversation_id, created_at DESC);

-- Durable notification inbox for assignments, mentions and new team messages.
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_accounts(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (notification_type IN ('chat_assigned','chat_reassigned','team_message','group_added','announcement')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  reference_type text,
  reference_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_notifications_inbox_idx
  ON public.staff_notifications(tenant_id, staff_id, read_at, created_at DESC);

-- Audit every staff-visible communication action without copying private message bodies.
CREATE TABLE IF NOT EXISTS public.staff_communications_audit (
  id bigserial PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES public.site_tenants(id) ON DELETE CASCADE,
  actor_staff_id uuid REFERENCES public.staff_accounts(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('super_admin','staff','system')),
  action text NOT NULL,
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_communications_audit_tenant_idx
  ON public.staff_communications_audit(tenant_id, created_at DESC);
