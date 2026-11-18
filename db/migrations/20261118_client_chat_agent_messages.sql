-- Persist Agent replies in the same authenticated client thread.
ALTER TABLE public.client_chat_messages DROP CONSTRAINT IF EXISTS client_chat_messages_sender_type_check;
ALTER TABLE public.client_chat_messages ADD CONSTRAINT client_chat_messages_sender_type_check CHECK (sender_type IN ('client','admin','staff','agent'));
