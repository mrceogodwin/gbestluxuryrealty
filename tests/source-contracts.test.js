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
  assert.match(code, /GB-00\[1-8\]/i);
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

test('public contact submissions are validated and stored using parameterized SQL', async () => {
  const code = await source('app/api/contact/route.js');
  assert.match(code, /Request origin could not be verified/);
  assert.match(code, /INSERT INTO public\.business_contact_submissions/);
  assert.match(code, /\$1,\$2,\$3,\$4,\$5/);
  assert.match(code, /message\.length>5000/);
});

test('business contact administration is protected and supports status updates', async () => {
  const code = await source('app/api/admin/business-contacts/route.js');
  assert.match(code, /authorizeAdminRequest/);
  assert.match(code, /contacts\.view/);
  assert.match(code, /contacts\.manage/);
  assert.match(code, /UPDATE public\.business_contact_submissions/);
});

test('global white-label and audio settings are restricted to Super Admin', async () => {
  const code = await source('app/api/admin/homepage/route.js');
  assert.match(code, /Only the Super Admin can change global brand and audio settings/);
  assert.match(code, /site_settings/);
  assert.match(code, /site_audio/);
});

test('homepage exposes configured company branding, metadata and visitor-controlled audio', async () => {
  const code = await source('app/page.js');
  assert.match(code, /homepage\.site_settings/);
  assert.match(code, /siteSettings\.seoTitle/);
  assert.match(code, /siteSettings\.logoUrl/);
  assert.match(code, /gbest-audio-player/);
  assert.match(code, /controls loop=\{siteAudio\.audioLoop!==false\}/);
  assert.doesNotMatch(code, /<audio[^>]+autoPlay/);
});

test('media uploads enforce supported image and audio MIME types and file sizes', async () => {
  const code = await source('app/api/admin/media/route.js');
  assert.match(code, /function mediaPolicy/);
  assert.match(code, /audio/);
  assert.match(code, /webm/);
  assert.match(code, /actualSize/);
  assert.match(code, /25\*1024\*1024/);
});

test('white-label company registry resolves published branding by domain', async () => {
  const tenants = await source('lib/site-tenants.js');
  const publicRoute = await source('app/api/homepage/route.js');
  const registry = await source('app/api/admin/companies/route.js');
  assert.match(tenants, /CREATE TABLE IF NOT EXISTS public\.site_tenants/);
  assert.match(tenants, /resolveSiteTenant/);
  assert.match(tenants, /primary_domain/);
  assert.match(publicRoute, /resolveSiteTenant/);
  assert.match(publicRoute, /tenant\.brand_config/);
  assert.match(registry, /isAdminRequest/);
  assert.match(registry, /cleanTenantBrand/);
  assert.match(tenants, /status IN/);
});

test('company workspace management is reserved for Super Admin', async () => {
  const page = await source('app/admin/super/companies/page.js');
  const layout = await source('app/admin/layout.js');
  assert.match(page, /Company workspaces/);
  assert.match(page, /tenantKey/);
  assert.match(page, /primaryDomain/);
  assert.match(page, /still shared by the current application data model/);
  assert.match(layout, /__super_admin_only__/);
});


test('public property and booking endpoints enforce company ownership', async () => {
  const properties = await source('app/api/properties/route.js');
  const booking = await source('app/api/inspection-requests/route.js');
  const availability = await source('app/api/inspection-schedule/route.js');
  assert.match(properties, /resolveSiteTenant/);
  assert.match(properties, /tenant_id=\$1/);
  assert.match(booking, /resolveSiteTenant/);
  assert.match(booking, /tenant_id=\$2/);
  assert.match(booking, /inspection_requests\(tenant_id,full_name/);
  assert.match(availability, /getSchedule\(tenant\.id\)/);
});

test('property administration and inspection queues are tenant scoped', async () => {
  const properties = await source('app/api/admin/properties/route.js');
  const inspections = await source('app/api/admin/inspection-requests/route.js');
  const schedule = await source('app/api/admin/inspection-schedule/route.js');
  assert.match(properties, /ensureSiteTenants/);
  assert.match(properties, /WHERE p\.tenant_id=\$1/);
  assert.match(properties, /targetTenant/);
  assert.match(inspections, /WHERE r\.tenant_id=\$1/);
  assert.match(inspections, /You cannot manage another company/);
  assert.match(schedule, /inspection_schedule_tenant_settings/);
});

test('client registrations and payment receipts are isolated by company', async () => {
  const registrations = await source('app/api/client-registrations/route.js');
  const admin = await source('app/api/admin/client-registrations/route.js');
  const receipt = await source('app/api/admin/client-registrations/[id]/receipt/route.js');
  assert.match(registrations, /resolveSiteTenant/);
  assert.match(registrations, /receipt_data,tenant_id/);
  assert.match(admin, /WHERE tenant_id=\$1/);
  assert.match(admin, /another company’s registration/);
  assert.match(receipt, /another company’s receipt/);
});
