-- G-BEST Finance Centre schema
-- Additive, idempotent migration. Review and apply separately to the intended Neon database.
BEGIN;

CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type varchar(12) NOT NULL CHECK (entry_type IN ('income','expense')),
  category varchar(80) NOT NULL,
  description varchar(500) NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency varchar(3) NOT NULL DEFAULT 'NGN',
  reference varchar(120),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  recorded_by varchar(254) NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  property_id uuid,
  approval_status varchar(12) NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by varchar(254),
  approved_at timestamptz,
  approval_note varchar(500)
);

ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS property_id uuid,
  ADD COLUMN IF NOT EXISTS approval_status varchar(12) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by varchar(254),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note varchar(500);

CREATE TABLE IF NOT EXISTS public.finance_ledger_audit (
  id bigserial PRIMARY KEY,
  ledger_id uuid NOT NULL REFERENCES public.finance_ledger(id) ON DELETE CASCADE,
  action varchar(20) NOT NULL,
  actor varchar(254) NOT NULL,
  old_status varchar(12),
  new_status varchar(12),
  note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_ledger_entry_date_idx
  ON public.finance_ledger (entry_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS finance_ledger_approval_status_idx
  ON public.finance_ledger (approval_status);
CREATE INDEX IF NOT EXISTS finance_ledger_audit_ledger_created_idx
  ON public.finance_ledger_audit (ledger_id, created_at DESC);

COMMIT;
