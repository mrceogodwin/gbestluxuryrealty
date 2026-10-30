-- G-BEST production database audit (READ ONLY)
-- Run this in the Neon SQL Editor before applying any schema migration.
-- These statements inspect metadata and existing records; they do not modify data.

-- 1) Confirm the properties and inspection tables exist and inspect their columns.
SELECT table_schema, table_name, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('properties', 'inspection_requests', 'inspection_email_outbox')
ORDER BY table_name, ordinal_position;

-- 2) Inspect constraints on the three application tables.
SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
       pg_get_constraintdef(c.oid) AS definition
FROM information_schema.table_constraints tc
JOIN pg_constraint c
  ON c.conname = tc.constraint_name
 AND c.conrelid = (quote_ident(tc.table_schema)||'.'||quote_ident(tc.table_name))::regclass
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('properties', 'inspection_requests', 'inspection_email_outbox')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 3) Inspect indexes, including any unique protection for inspection slots.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('properties', 'inspection_requests', 'inspection_email_outbox')
ORDER BY tablename, indexname;

-- 4) Count inspection requests by status without exposing client information.
SELECT status, count(*)::bigint AS request_count
FROM public.inspection_requests
GROUP BY status
ORDER BY status;

-- 5) Find duplicate active property/date/time slots, if the expected columns exist.
-- This is a diagnostic only. It does not delete or alter duplicate records.
SELECT property_id::text AS property_id, preferred_date::text AS preferred_date,
       preferred_time::text AS preferred_time, count(*)::bigint AS active_requests
FROM public.inspection_requests
WHERE lower(status::text) IN ('pending', 'contacted', 'confirmed')
GROUP BY property_id, preferred_date, preferred_time
HAVING count(*) > 1
ORDER BY active_requests DESC, preferred_date, preferred_time;

-- 6) Inspect outbox delivery state without exposing recipient addresses or message bodies.
SELECT status, count(*)::bigint AS message_count,
       min(next_attempt_at) AS earliest_next_attempt,
       max(attempts) AS highest_attempt_count
FROM public.inspection_email_outbox
GROUP BY status
ORDER BY status;
