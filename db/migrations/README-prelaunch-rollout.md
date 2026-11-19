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

This query must return no rows. The current Production snapshot returned zero conversations, so there were no legacy assignee values to convert at the time of the audit.

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
