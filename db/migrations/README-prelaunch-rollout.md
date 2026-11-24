# G-BEST pre-launch database rollout

Do not promote the pre-launch application branch to Production until the Production Neon main branch has the schema required by the application.

## Production migration order

Run these migrations against the Production Neon main branch only after taking a Neon restore point:

1. `20261118_client_handoff_presence.sql`
   - Adds staff profile-photo support, client/staff presence, chat participants, monitor access and handover history.
2. `20261118_client_chat_agent_messages.sql`
   - Allows persisted Agent replies in client chat.
3. `20261119_client_registration_intent.sql`
   - Separates free general client access from paid physical-inspection registration.
4. `20261119_staff_contact_details.sql`
   - Adds staff phone numbers for Super Admin escalation.
5. `20261119_client_chat_runtime_compat.sql`
   - Adds assignment metadata, safely converts the legacy assignee column to UUID, and creates staff assignment notifications.
6. `20261118_flagship_communications.sql`
   - Creates the staff-to-staff direct/group chat tables, assignment event history, communications audit and supporting indexes. It also ensures the staff notification table exists.

The flagship communications migration must run after `20261119_client_chat_runtime_compat.sql` so the assignee conversion first performs the strict UUID preflight instead of the older compatibility block's legacy fallback. The existing Production schema already contains the foundational client chat, OTP, finance ledger, tenant schedule and inspection-slot tables; verify those objects before considering any older baseline migration.

7. `20261122_tenant_contact_newsletter_finance.sql`
   - Adds tenant ownership to public contact submissions, finance ledger entries and finance audit history; existing rows are assigned to the G-BEST tenant.
   - Creates or upgrades newsletter subscriptions with tenant-scoped normalized-email uniqueness while preserving legacy subscriber rows.
   - Apply only after confirming the G-BEST tenant exists and taking a Neon restore point. Public contact, newsletter and finance APIs now expect this migration to be present; do not deploy those API changes before the migration has been applied and verified.

The migrations are designed to be repeatable where possible. Stop and review any migration error; do not force a partial schema change.

## Read-only preflight checks

Before applying the runtime compatibility migration, confirm that every non-null `client_chat_conversations.assigned_staff_id` value is a UUID:

```sql
SELECT id, assigned_staff_id
FROM public.client_chat_conversations
WHERE assigned_staff_id IS NOT NULL
  AND btrim(assigned_staff_id::text) <> ''
  AND btrim(assigned_staff_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
```

This query must return no rows immediately before the migration. The latest read-only preflight returned no non-UUID assignments. Re-run it immediately before applying the migration; do not rely on an earlier result.

## Post-migration checks

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='client_registrations'
  AND column_name IN ('registration_intent','registration_fee_kobo','payment_status');

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='staff_accounts'
  AND column_name IN ('avatar_url','phone_number');

SELECT to_regclass('public.client_presence'),
       to_regclass('public.staff_presence'),
       to_regclass('public.client_chat_participants'),
       to_regclass('public.client_chat_monitor_access'),
       to_regclass('public.client_chat_handover_events'),
       to_regclass('public.staff_notifications');
```

Verify the registration constraints accept `registration_fee_kobo=0` with `payment_status='not_required'`, and preserve the ₦15,000 / pending manual-verification path for inspection registration.

## Safety

- Preview is connected to an isolated Neon audit branch, not Production.
- Do not run Production migrations as part of a normal code deployment.
- Do not promote Production until the registration, OTP, chat, assignment, inspection-payment and booking flows pass end-to-end tests.
