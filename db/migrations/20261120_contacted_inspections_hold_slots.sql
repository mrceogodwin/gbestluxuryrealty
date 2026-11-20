-- Keep the database-level active-slot guard aligned with the application.
-- Contacted requests still hold their requested inspection time.
DROP INDEX IF EXISTS public.inspection_requests_tenant_active_slot_unique;
CREATE UNIQUE INDEX inspection_requests_tenant_active_slot_unique
  ON public.inspection_requests (tenant_id, preferred_date, preferred_time)
  WHERE preferred_time IS NOT NULL
    AND status IN ('pending', 'contacted', 'confirmed');
