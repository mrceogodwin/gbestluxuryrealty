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
  assert.match(code, /isAdminRequest/);
  assert.match(code, /Only the Super Admin/);
  assert.match(code, /UPDATE public\.business_contact_submissions/);
  assert.match(code, /status=\$2/);
});

test('global brand settings are restricted while tenant audio remains editable', async () => {
  const code = await source('app/api/admin/homepage/route.js');
  assert.match(code, /key==='site_settings'&&!admin/);
  assert.match(code, /site_settings/);
  assert.match(code, /site_audio/);
  assert.doesNotMatch(code, /\['site_settings','site_audio'\]\.includes\(key\)/);
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
  assert.match(tenants, /SELECT id FROM public\.site_tenants WHERE tenant_key='gbest'/);
  assert.match(tenants, /Apply the tenant schema migration/);
  assert.doesNotMatch(tenants, /CREATE TABLE IF NOT EXISTS public\.site_tenants/);
  assert.match(tenants, /resolveSiteTenant/);
  assert.match(tenants, /primary_domain/);
  assert.match(publicRoute, /resolveSiteTenant/);
  assert.match(publicRoute, /tenant\.brand_config/);
  assert.match(registry, /isAdminRequest/);
  assert.match(registry, /cleanTenantBrand/);
  assert.match(tenants, /status='active'/);
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
  assert.match(api, /Schema is provisioned by database migrations/);
  assert.doesNotMatch(api, /ALTER TABLE public\.admin_media_assets/);
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


test('homepage drafts, published sections and revision history are isolated by tenant', async () => {
  const helper = await source('lib/tenant-homepage.js');
  const admin = await source('app/api/admin/homepage/route.js');
  const publicRoute = await source('app/api/homepage/route.js');
  const page = await source('app/admin/super/homepage/page.js');
  assert.match(helper, /homepage_tenant_sections/);
  assert.match(helper, /homepage_tenant_section_revisions/);
  assert.match(helper, /legacy_revision_id/);
  assert.match(admin, /WHERE tenant_id=\$1 AND section_key=\$2/);
  assert.match(admin, /homepage_tenant_section_revisions WHERE tenant_id=\$1/);
  assert.match(publicRoute, /homepage_tenant_sections WHERE tenant_id=\$1/);
  assert.match(page, /COMPANY WORKSPACE/);
  assert.match(admin, /key==='site_settings'&&!admin/);
});


test('company brand settings stay aligned with the tenant homepage template', async () => {
  const companies = await source('app/api/admin/companies/route.js');
  const homepage = await source('app/api/admin/homepage/route.js');
  const page = await source('app/admin/super/homepage/page.js');
  assert.match(companies, /ensureTenantHomepageTables/);
  assert.match(companies, /homepage_tenant_sections SET draft_content/);
  assert.match(homepage, /key==='site_settings'/);
  assert.match(page, /tenant_id:activeTenantId,objectKey:p\.objectKey/);
});


test('inspection schedule always enforces the agreed 30-minute duration', async () => {
  const schedule = await source('lib/inspection-schedule.js');
  const adminSchedule = await source('app/api/admin/inspection-schedule/route.js');
  assert.match(schedule, /workingDays:\[1,2,3,4,5,6\],startTime:'08:00',endTime:'18:00',slotMinutes:30/);
  assert.match(schedule, /slotMinutes:30/);
  assert.match(adminSchedule, /workingDays\.join\(','\)!=='1,2,3,4,5,6'/);
  assert.match(adminSchedule, /settings\.startTime!=='08:00'/);
  assert.match(adminSchedule, /settings\.endTime!=='18:00'/);
  assert.match(adminSchedule, /settings\.slotMinutes!==30/);
});

test('inspection approval revalidates schedule and slot conflicts inside the booking lock', async () => {
  const inspections = await source('app/api/admin/inspection-requests/route.js');
  assert.match(inspections, /pg_advisory_xact_lock\(hashtext\(\$1\),hashtext\('inspection-booking'\)\)/);
  assert.match(inspections, /SELECT id,tenant_id,status[\s\S]*FOR UPDATE/);
  assert.match(inspections, /getSchedule\(currentRow\.tenant_id\)/);
  assert.match(inspections, /duration===Number\(schedule\.slotMinutes\)/);
  assert.match(inspections, /id<>\$5/);
  assert.match(inspections, /Another request is holding the time/);
  assert.match(inspections, /client\.query\('COMMIT'\)/);
});

test('client session endpoint verifies tenant ownership and eligible active status', async () => {
  const session = await source('app/api/client-auth/session/route.js');
  assert.match(session, /gbest_client_session/);
  assert.match(session, /token_hash=\$1/);
  assert.match(session, /r\.tenant_id=\$2/);
  assert.match(session, /payment_status IN \('approved','not_required','pending'\)/);
  assert.match(session, /client_status='active'/);
  assert.match(session, /Cache-Control/);
  assert.doesNotMatch(session, /SELECT\s+\*/i);
});

test('general client registration is free while inspection registration requires manual payment evidence', async () => {
  const page = await source('app/client-registration/page.js');
  const registration = await source('app/api/client-registrations/route.js');
  const migration = await source('db/migrations/20261119_client_registration_intent.sql');
  const inspection = await source('app/api/inspection-requests/route.js');
  assert.match(page, /General enquiries \/ private client messaging — FREE/);
  assert.match(page, /I want to arrange a physical property inspection — ₦15,000 manual verification/);
  assert.match(registration, /intent==='inspection'/);
  assert.match(registration, /'not_required':'pending'/);
  assert.match(registration, /registration_intent/);
  assert.match(migration, /payment_status IN \('pending','submitted','approved','rejected','not_required'\)/);
  assert.match(inspection, /registration_intent='inspection' AND r\.payment_status='approved'/);
});

test('mobile Agent chat opens as a spacious near-full-screen conversation', async () => {
  const styles = await source('app/globals.css');
  assert.match(styles, /\.gb-agent-panel\{width:100%!important;height:calc\(100dvh - 16px\)!important/);
  assert.match(styles, /\.gb-agent-messages\{min-height:0;flex:1 1 auto;overflow-y:auto/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
});

test('client authentication endpoints never expose OTP hashes or session tokens', async () => {
  const verify = await source('app/api/client-auth/verify-code/route.js');
  const session = await source('app/api/client-auth/session/route.js');
  assert.match(verify, /httpOnly:true/);
  assert.match(verify, /token_hash/);
  assert.match(session, /createHash\('sha256'\)/);
  assert.doesNotMatch(session, /token_hash\s*:/i);
  assert.doesNotMatch(session, /code_hash\s*:/i);
});

test('inspection approvals create idempotent Google Calendar events and retain Neon as source of truth', async () => {
  const calendar = await source('lib/google-calendar.js');
  const admin = await source('app/api/admin/inspection-requests/route.js');
  assert.match(calendar, /GOOGLE_CLIENT_ID/);
  assert.match(calendar, /GOOGLE_CLIENT_SECRET/);
  assert.match(calendar, /GOOGLE_REFRESH_TOKEN/);
  assert.match(calendar, /GOOGLE_CALENDAR_ID/);
  assert.match(calendar, /timeZone:zone/);
  assert.match(calendar, /id,\s*summary:/);
  assert.match(admin, /createInspectionCalendarEvent/);
  assert.match(admin, /deleteInspectionCalendarEvent/);
  assert.match(admin, /calendar_event_id/);
  assert.match(admin, /Inspection confirmed, but the calendar event could not be created/);
});

test('Google Calendar integration never blocks a saved inspection status when the calendar is unavailable', async () => {
  const admin = await source('app/api/admin/inspection-requests/route.js');
  assert.match(admin, /catch\(calendarError\)/);
  assert.match(admin, /Inspection status saved but email queueing failed/);
  assert.match(admin, /status was saved, but notification emails could not be queued/);
});

test('client login returns approved clients directly to inspection booking', async () => {
  const login = await source('app/client-login/page.js');
  assert.match(login, /next&&next\\.startsWith\\('\/'\)/);
  assert.match(login, /api\/client-auth\/verify-code/);
});
