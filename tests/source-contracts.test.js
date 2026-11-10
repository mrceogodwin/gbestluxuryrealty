import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('public property reads never mutate the database schema', async () => {
  const code = await source('app/api/properties/route.js');
  assert.doesNotMatch(code, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|COLUMN)\b/i);
  assert.match(code, /getDatabasePool/);
});

test('admin property API uses the shared pool and archives instead of deleting', async () => {
  const code = await source('app/api/admin/properties/route.js');
  assert.match(code, /getDatabasePool/);
  assert.doesNotMatch(code, /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|COLUMN)\b/i);
  assert.match(code, /status='archived'/);
  assert.doesNotMatch(code, /DELETE\s+FROM\s+public\.properties/i);
});

test('inspection requests reject presentation-only sample property IDs', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.match(code, /Demo cards are for presentation only/);
  assert.match(code, /gb-00\[1-8\]/);
  assert.match(code, /status IN \(\'published\',\'available\'\)/);
});

test('inspection booking APIs share the Neon pool', async () => {
  for (const path of ['app/api/inspection-requests/route.js', 'app/api/admin/inspection-requests/route.js']) {
    const code = await source(path);
    assert.match(code, /getDatabasePool/);
    assert.doesNotMatch(code, /new Pool\(/);
  }
});

test('inspection notification failures do not turn a saved request into a failed submission', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.match(code, /Inspection request saved but email queueing failed/);
  assert.match(code, /status:201/);
});

test('inspection outbox uses the shared Neon pool', async () => {
  const code = await source('lib/inspection-email-outbox.js');
  assert.match(code, /getDatabasePool\(\)\.query/);
  assert.doesNotMatch(code, /new Pool\(/);
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

test('finance ledger API remains Super Admin-only for every method', async () => {
  const code = await source('app/api/admin/finance-ledger/route.js');
  for (const method of ['GET','POST','PATCH']) {
    const match = code.match(new RegExp('export async function ' + method + '[\\s\\S]*?(?=export async function |$)'));
    assert.ok(match, method + ' handler exists');
    assert.match(match[0], /isAdminRequest\(req\)/);
    assert.match(match[0], /Only the Super Admin can access the company finance centre/);
  }
  assert.doesNotMatch(code, /authorizeAdminRequest/);
});

test('registration rate-limit upsert uses its PostgreSQL target alias consistently', async () => {
  const code = await source('app/api/client-registrations/route.js');
  const upsert = code.slice(code.indexOf('INSERT INTO public.client_registration_rate_limits'), code.indexOf('RETURNING attempts'));
  assert.match(upsert, /AS rate_limit/);
  assert.match(upsert, /rate_limit\.window_started_at/);
  assert.match(upsert, /rate_limit\.attempts/);
  assert.doesNotMatch(upsert, /public\.client_registration_rate_limits\./);
});

test('payment receipt retrieval requires the payment-review permission', async () => {
  const code = await source('app/api/admin/client-registrations/[id]/receipt/route.js');
  assert.match(code, /authorizeAdminRequest\(req,'payments\.review'\)/);
  assert.match(code, /Cache-Control.*no-store/);
  assert.match(code, /X-Content-Type-Options.*nosniff/);
});

test('only the authenticated Super Admin can invite staff or change staff permissions', async () => {
  const code = await source('app/api/admin/staff/route.js');
  for (const method of ['GET','POST','PATCH']) {
    const match = code.match(new RegExp('export async function ' + method + '[\\s\\S]*?(?=export async function |$)'));
    assert.ok(match, method + ' handler exists');
    assert.match(match[0], /isAdminRequest\(req\)/);
  }
  assert.doesNotMatch(code, /getStaffSession/);
  assert.match(code, /staff_account_permissions/);
  assert.match(code, /current\.role==='super_admin'/);
});

test('staff dashboard cannot receive company finance metrics, even with payment-review access', async () => {
  const code = await source('app/api/admin/overview/route.js');
  assert.match(code, /finance:admin/);
  assert.match(code, /can\.finance\?safeQuery/);
  assert.match(code, /clients:admin\|\|granted\.has\('clients\.view'\)\|\|granted\.has\('payments\.review'\)/);
  assert.match(code, /staff:admin,homepage:admin,audit:admin/);
});

test('payment-only reviewers receive a reduced registration projection', async () => {
  const code = await source('app/api/admin/client-registrations/route.js');
  const paymentProjection = code.match(/: `id,COALESCE\(full_name[\s\S]*?`;/);
  assert.ok(paymentProjection, 'payment-only projection exists');
  for (const restrictedField of ['address','phone','nationality','state_of_origin','lga','occupation','preferred_location','property_description']) {
    assert.doesNotMatch(paymentProjection[0], new RegExp('\\b' + restrictedField + '\\b'));
  }
  assert.match(paymentProjection[0], /payment_reference/);
  assert.match(paymentProjection[0], /receipt_name/);
  assert.match(paymentProjection[0], /payment_status/);
});

test('registration throttling does not trust client-supplied X-Forwarded-For', async () => {
  const code = await source('app/api/client-registrations/route.js');
  assert.match(code, /x-vercel-forwarded-for/);
  assert.match(code, /x-real-ip/);
  assert.doesNotMatch(code, /get\('x-forwarded-for'\)/i);
});
