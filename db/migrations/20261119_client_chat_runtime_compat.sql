BEGIN;

ALTER TABLE public.client_chat_conversations
  ADD COLUMN IF NOT EXISTS assigned_by text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_client_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_staff_message_at timestamptz;

DO $$
DECLARE current_type text;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='client_chat_conversations' AND column_name='assigned_staff_id';

  IF current_type IS NOT NULL AND current_type <> 'uuid' THEN
    IF EXISTS (
      SELECT 1 FROM public.client_chat_conversations
      WHERE assigned_staff_id IS NOT NULL
        AND btrim(assigned_staff_id::text) <> ''
        AND btrim(assigned_staff_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
      RAISE EXCEPTION 'Cannot convert client_chat_conversations.assigned_staff_id: non-UUID values exist. Review those assignments first.';
    END IF;
    ALTER TABLE public.client_chat_conversations
      ALTER COLUMN assigned_staff_id TYPE uuid
      USING NULLIF(btrim(assigned_staff_id::text),'')::uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_chat_conversations_assigned_staff_fk') THEN
    ALTER TABLE public.client_chat_conversations
      ADD CONSTRAINT client_chat_conversations_assigned_staff_fk
      FOREIGN KEY (assigned_staff_id) REFERENCES public.staff_accounts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='client_chat_conversations_priority_check') THEN
    ALTER TABLE public.client_chat_conversations
      ADD CONSTRAINT client_chat_conversations_priority_check
      CHECK (priority IN ('low','normal','high','urgent'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS client_chat_conversations_assignee_queue_idx
  ON public.client_chat_conversations(tenant_id,assigned_staff_id,status,last_message_at DESC NULLS LAST);

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
  ON public.staff_notifications(tenant_id,staff_id,read_at,created_at DESC);

COMMIT;
