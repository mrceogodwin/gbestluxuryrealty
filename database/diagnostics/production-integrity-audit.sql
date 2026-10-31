-- G-BEST production database audit (READ ONLY)
-- IMPORTANT: Run sections 1-3 first. They inspect metadata only.
-- Run sections 4, 5 and 6 individually ONLY after section 1 confirms
-- that the named table and every referenced column exist.
-- These statements do not modify schema or records.

-- 1) Confirm application tables and inspect their columns.
SELECT table_schema, table_name, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('properties', 'inspection_requests', 'inspection_email_outbox')
ORDER BY table_name, ordinal_position;

-- 2) Inspect constraints on the application tables.
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       pg_get_constraintdef(c.oid) AS definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c
  ON c.conname = tc.constraint_name
 AND c.conrelid = to_regclass(format('%I.%I', tc.table_schema, tc.table_name))
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('properties', 'inspection_requests', 'inspection_email_outbox')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 3) Inspect indexes, including any unique protection for inspection slots.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('properties', 'inspection_requests', 'inspection_email_outbox')
ORDER BY tablename, indexname;

-- 4) OPTIONAL: Run only if public.inspection_requests exists and has a status column.
SELECT status, count(*)::bigint AS request_count
FROM public.inspection_requests
GROUP BY status
ORDER BY status;

-- 5) OPTIONAL: Run only if inspection_requests has property_id,
-- preferred_date, preferred_time and status columns.
-- Diagnostic only: does not delete or alter duplicate records.
SELECT property_id::text AS property_id, preferred_date::text AS preferred_date,
       preferred_time::text AS preferred_time, count(*)::bigint AS active_requests
FROM public.inspection_requests
WHERE lower(status::text) IN ('pending', 'contacted', 'confirmed')
GROUP BY property_id, preferred_date, preferred_time
HAVING count(*) > 1
ORDER BY active_requests DESC, preferred_date, preferred_time;

-- 6) OPTIONAL: Run only if public.inspection_email_outbox exists and has
-- status, next_attempt_at and attempts columns.
-- Does not expose recipient addresses or message bodies.
SELECT status, count(*)::bigint AS message_count,
       min(next_attempt_at) AS earliest_next_attempt,
       max(attempts) AS highest_attempt_count
FROM public.inspection_email_outbox
GROUP BY status
ORDER BY status;
