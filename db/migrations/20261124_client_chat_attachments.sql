-- Adds structured, tenant-scoped file metadata to client chat messages.
-- Applied to the G-BEST Neon database on 2026-11-24.
ALTER TABLE public.client_chat_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
