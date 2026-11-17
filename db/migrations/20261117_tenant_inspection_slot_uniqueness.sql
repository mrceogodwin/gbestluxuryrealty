-- Scope active inspection slot uniqueness to each company workspace.
-- Existing inspection requests are retained.
BEGIN;

DROP INDEX IF EXISTS public.inspection_requests_active_slot_unique;

CREATE UNIQUE INDEX IF NOT EXISTS inspection_requests_tenant_active_slot_unique
  ON public.inspection_requests (tenant_id, preferred_date, preferred_time)
  WHERE preferred_time IS NOT NULL
    AND status IN ('pending', 'confirmed');

COMMIT;
