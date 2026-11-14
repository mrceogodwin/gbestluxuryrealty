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


test('homepage property cards open a complete accessible property detail view', async () => {
  const page = await source('app/page.js');
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /property-modal-title/);
  assert.match(page, /property-modal-gallery-controls/);
  assert.match(page, /BOOK AN INSPECTION/);
  assert.match(page, /document\.body\.style\.overflow='hidden'/);
  assert.match(page, /onClick=\{e=>\{if\(!e\.target\.closest\('button,a,input,select,textarea'\)\)SD\(x\)\}\}/);
});

test('featured property orbit supports manual scrolling and touch-friendly compact mobile sizing', async () => {
  const page = await source('app/page.js');
  const styles = await source('app/globals.css');
  assert.match(page, /function scrollOrbit\(direction\)/);
  assert.match(page, /Previous properties/);
  assert.match(page, /Next properties/);
  assert.match(page, /ref=\{orbitWindowRef\}/);
  assert.match(styles, /scroll-snap-type:x mandatory/);
  assert.match(styles, /width:84px!important;height:84px!important/);
  assert.match(styles, /social-reels-section\{padding-top:28px!important/);
});

test('public property data includes all gallery images for the detail view', async () => {
  const route = await source('app/api/properties/route.js');
  assert.match(route, /COALESCE\(images, ARRAY\[\]::text\[\]\) AS images/);
  assert.match(route, /images: Array\.isArray\(x\.images\)/);
});


test('staff accounts, invitations and audit events are isolated by company', async () => {
  const tenants = await source('lib/site-tenants.js');
  const staffApi = await source('app/api/admin/staff/route.js');
  const staffAuth = await source('lib/staff-auth.js');
  const login = await source('app/api/staff/session/route.js');
  assert.match(tenants, /staff_accounts ADD COLUMN IF NOT EXISTS tenant_id/);
  assert.match(tenants, /staff_audit_events ADD COLUMN IF NOT EXISTS tenant_id/);
  assert.match(staffApi, /WHERE s\.tenant_id=\$1/);
  assert.match(staffApi, /WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE/);
  assert.match(staffApi, /INSERT INTO public\.staff_accounts\(tenant_id,/);
  assert.match(staffAuth, /a\.tenant_id/);
  assert.match(login, /tenant_id:staff\.tenant_id/);
});

test('staff access to property and client operations follows assigned workspace', async () => {
  const properties = await source('app/api/admin/properties/route.js');
  const inspections = await source('app/api/admin/inspection-requests/route.js');
  const schedule = await source('app/api/admin/inspection-schedule/route.js');
  const registrations = await source('app/api/admin/client-registrations/route.js');
  const receipt = await source('app/api/admin/client-registrations/[id]/receipt/route.js');
  for (const content of [properties,inspections,schedule,registrations,receipt]) assert.match(content,/getStaffSession/);
  assert.match(properties,/staff\?\.tenant_id/);
  assert.match(inspections,/staff\?\.tenant_id/);
  assert.match(registrations,/staff\?\.tenant_id/);
});


test('company staff managers can administer only their own workspace team', async () => {
  const api = await source('app/api/admin/staff/route.js');
  const layout = await source('app/admin/layout.js');
  assert.match(api, /authorizeAdminRequest\(req,'staff\.manage'\)/);
  assert.match(api, /if\(!admin\).*staff\?\.tenant_id/s);
  assert.match(api, /WHERE id=\$1 AND tenant_id=\$2 FOR UPDATE/);
  assert.match(layout, /href==='\/admin\/super\/staff'\)return access\.has\('staff\.manage'\)/);
  assert.doesNotMatch(layout, /path\.startsWith\('\/admin\/super\/staff'\)\|\|path==='\/admin\/super\/activity'/);
});


test('media library records and object storage keys are company isolated', async () => {
  const api = await source('app/api/admin/media/route.js');
  const page = await source('app/admin/super/media/page.js');
  assert.match(api, /admin_media_assets ADD COLUMN IF NOT EXISTS tenant_id/);
  assert.match(api, /WHERE tenant_id=\$1 ORDER BY created_at DESC/);
  assert.ok(api.includes("prefix='website/'+tenant.id+'/"));
  assert.match(api, /WHERE id=\$1 AND tenant_id=\$2/);
  assert.match(page, /COMPANY WORKSPACE/);
  assert.match(page, /tenant_id:body\.tenant_id\|\|activeTenantId/);
});


test('company hero videos are isolated by tenant and served by the requesting domain', async () => {
  const tenants = await source('lib/site-tenants.js');
  const admin = await source('app/api/admin/company-video/route.js');
  const publicRoute = await source('app/api/company-video/route.js');
  const page = await source('app/admin/super/company-video/page.js');
  assert.match(tenants, /company_profile_video_tenants/);
  assert.ok(admin.includes("prefix='company-video/'+tenant.id+'/"));
  assert.match(admin, /ON CONFLICT\(tenant_id\)/);
  assert.match(publicRoute, /resolveSiteTenant/);
  assert.match(publicRoute, /WHERE tenant_id=\$1/);
  assert.match(page, /COMPANY WORKSPACE/);
});
