-- G-BEST staff directory contact detail used for Super Admin assignment and escalation.
ALTER TABLE public.staff_accounts
  ADD COLUMN IF NOT EXISTS phone_number text;

CREATE INDEX IF NOT EXISTS staff_accounts_tenant_status_idx
  ON public.staff_accounts(tenant_id,status);
