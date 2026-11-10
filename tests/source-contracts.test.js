import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('public property reads never mutate the database schema', async () => {
  const code = await source('app/api/properties/route.js');
  assert.doesNotMatch(code, /\\b(?:CREATE|ALTER|DROP)\\s+(?:TABLE|INDEX|COLUMN)\\b/i);
  assert.match(code, /getDatabasePool/);
});

test('admin property API uses the shared pool and archives instead of deleting', async () => {
  const code = await source('app/api/admin/properties/route.js');
  assert.match(code, /getDatabasePool/);
  assert.doesNotMatch(code, /\\b(?:CREATE|ALTER|DROP)\\s+(?:TABLE|INDEX|COLUMN)\\b/i);
  assert.match(code, /status='archived'/);
  assert.doesNotMatch(code, /DELETE\\s+FROM\\s+public\\.properties/i);
});

test('inspection requests reject presentation-only sample property IDs', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.match(code, /Demo cards are for presentation only/);
  assert.match(code, /gb-00\[1-8\]/);
  assert.match(code, /status IN \\(\'published\',\'available\'\\)/);
});

test('inspection booking APIs share the Neon pool', async () => {
  for (const path of ['app/api/inspection-requests/route.js', 'app/api/admin/inspection-requests/route.js']) {
    const code = await source(path);
    assert.match(code, /getDatabasePool/);
    assert.doesNotMatch(code, /new Pool\\(/);
  }
});

test('inspection notification failures do not turn a saved request into a failed submission', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.match(code, /Inspection request saved but email queueing failed/);
  assert.match(code, /status:201/);
});

test('inspection outbox uses the shared Neon pool', async () => {
  const code = await source('lib/inspection-email-outbox.js');
  assert.match(code, /getDatabasePool\\(\\)\\.query/);
  assert.doesNotMatch(code, /new Pool\\(/);
});

test('payment reviewers receive only payment-related registration data', async () => {
  const code = await source('app/api/admin/client-registrations/route.js');
  assert.match(code, /hasStaffPermission\(staff,'payments\.review'\)/);
  assert.match(code, /canViewClientProfiles/);
  assert.match(code, /if\(!isSuperAdmin&&!canReviewPayments&&!canViewClientProfiles\)/);
  assert.match(code, /COALESCE\(full_name,concat_ws\(' ',surname,other_names\)\) AS full_name/);
  assert.match(code, /payment_reference,receipt_name,receipt_type,payment_status/);
  assert.doesNotMatch(code, /: \x60id,COALESCE\(full_name,concat_ws\(' ',surname,other_names\)\) AS full_name,surname,other_names,email,address,phone,nationality/);
});

test('client payment decisions record the authenticated reviewer, not a fixed admin identity', async () => {
  const code = await source('app/api/admin/client-registrations/route.js');
  assert.match(code, /const actorType=isSuperAdmin\?'super_admin':'staff'/);
  assert.match(code, /const actorEmail=staff\?\.email\|\|'master-admin'/);
  assert.match(code, /approved_by=CASE WHEN \$2='approved' THEN \$4 ELSE NULL END/);
  assert.match(code, /actor_type,actor_email,actor_staff_id/);
  assert.match(code, /a\.actor_email/);
});

test('public client registration rate limits are hashed and applied after receipt validation', async () => {
  const code = await source('app/api/client-registrations/route.js');
  assert.match(code, /createHmac/);
  assert.match(code, /createHmac\('sha256'/);
  assert.match(code, /client_registration_rate_limits/);
  assert.match(code, /consumeRegistrationRateLimit\(pool,emailRateKey,5\)/);
  assert.match(code, /consumeRegistrationRateLimit\(pool,ipRateKey,20\)/);
  assert.ok(code.indexOf("The uploaded receipt content does not match its file type") < code.indexOf("consumeRegistrationRateLimit(pool,emailRateKey,5)"));
  assert.doesNotMatch(code, /INSERT INTO public\.client_registration_rate_limits[^\n]*ip_address/);
});
