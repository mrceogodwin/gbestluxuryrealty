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

test('admin cannot confirm an inspection after its property is sold or unpublished', async () => {
  const code = await source('app/api/admin/inspection-requests/route.js');
  assert.match(code, /SELECT status FROM public\.properties WHERE id=\$1 AND tenant_id=\$2/);
  assert.match(code, /!\['published','available'\]\.includes\(property\.rows\[0\]\.status\)/);
  assert.match(code, /property is no longer available for inspection/);
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
  assert.match(code, /Super Admin authentication is required/);
  assert.match(code, /UPDATE public\.business_contact_submissions/);
  assert.match(code, /SET status=\$3,admin_note=\$4/);
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

test('tenant fallback rejects arbitrary Vercel and production preview hostnames', async () => {
  const tenants = await source('lib/site-tenants.js');
  assert.match(tenants, /VERCEL_PROJECT_PRODUCTION_URL/);
  assert.match(tenants, /gbestluxuryrealty\.vercel\.app/);
  assert.doesNotMatch(tenants, /hostname\.endsWith\('\.vercel\.app'\)/);
  assert.match(tenants, /process\.env\.NODE_ENV!=='production'/);
  assert.doesNotMatch(tenants, /normalizeHostname\(process\.env\.VERCEL_URL/);
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


test('inspection schedule admin UI reflects fixed hours and 30-minute slots', async () => {
  const page = await source('app/admin/super/page.js');
  assert.match(page, /Opening time \(WAT\)[\s\S]*value="08:00" disabled readOnly/);
  assert.match(page, /Closing time \(WAT\)[\s\S]*value="18:00" disabled readOnly/);
  assert.match(page, /value="30 minutes" disabled readOnly/);
  assert.match(page, /fixed at Monday–Saturday, 08:00–18:00 WAT, in 30-minute slots/);
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


test('database active-slot index includes contacted inspections', async () => {
  const migration = await source('db/migrations/20261120_contacted_inspections_hold_slots.sql');
  assert.ok(migration.includes('DROP INDEX IF EXISTS public.inspection_requests_tenant_active_slot_unique'));
  assert.ok(migration.includes("status IN ('pending', 'contacted', 'confirmed')"));
});
test('pending, contacted and confirmed inspections all reserve their time slots', async () => {
  const booking = await source('app/api/inspection-requests/route.js');
  const availability = await source('lib/inspection-schedule.js');
  const approval = await source('app/api/admin/inspection-requests/route.js');
  for (const code of [booking,availability,approval]) assert.ok(code.includes("status IN ('pending','contacted','confirmed')"));
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
  assert.match(session, /payment_status IN \('approved','not_required','pending','rejected'\)/);
  assert.match(session, /client_status='active'/);
  assert.match(session, /Cache-Control/);
  assert.doesNotMatch(session, /SELECT\s+\*/i);
});

test('general client registration is free while inspection registration requires manual payment evidence', async () => {
  const page = await source('app/client-registration/page.js');
  const registration = await source('app/api/client-registrations/route.js');
  const migration = await source('db/migrations/20261119_client_registration_intent.sql');
  const inspection = await source('app/api/inspection-requests/route.js');
  const home = await source('app/page.js');
  assert.match(page, /General enquiries \/ private client messaging — FREE/);
  assert.match(page, /I want to arrange a physical property inspection — ₦15,000 manual verification/);
  assert.match(registration, /intent==='inspection'/);
  assert.match(registration, /intent==='inspection'\?'pending':'not_required'/);
  assert.match(registration, /registration_intent/);
  assert.match(migration, /payment_status IN \('pending','submitted','approved','rejected','not_required'\)/);
  assert.match(inspection, /registration_intent='inspection' AND r\.payment_status='approved'/);
  assert.match(home, /clientSession\.registrationIntent!=='inspection'\|\|clientSession\.paymentStatus!=='approved'/);
});

test('a rejected inspection upgrade does not lock an existing free client out of messaging', async () => {
  const registration = await source('app/api/client-registrations/route.js');
  const decision = await source('app/api/admin/client-registrations/route.js');
  const session = await source('app/api/client-auth/session/route.js');
  assert.match(registration, /prior\.registration_intent==='inspection'&&prior\.payment_status==='rejected'/);
  assert.match(decision, /\$2='approved' OR \$5='active'/);
  assert.match(session, /'pending','rejected'/);
});

test('homepage keeps the single floating Agent entry point without a duplicate hero chat CTA', async () => {
  const home = await source('app/page.js');
  const layout = await source('app/layout.js');
  const widget = await source('components/agent-chat-widget.js');
  assert.doesNotMatch(home, /hero-chat-cta|CHAT US NOW/);
  assert.match(layout, /AgentChatWidget/);
  assert.match(widget, /Talk to a human/);
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

test('Super Admin staff directory stores phone numbers and provides WhatsApp contact', async () => {
  const api = await source('app/api/admin/staff/route.js');
  const page = await source('app/admin/super/staff/page.js');
  const migration = await source('db/migrations/20261119_staff_contact_details.sql');
  assert.match(api, /phone_number/);
  assert.match(api, /staff\.phone_changed/);
  assert.match(page, /PHONE \/ WHATSAPP NUMBER/);
  assert.match(page, /https:\/\/wa\.me/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS phone_number text/);
});

test('staff presence is authenticated and heartbeat-based', async () => {
  const api = await source('app/api/staff/presence/route.js');
  const layout = await source('app/admin/layout.js');
  assert.match(api, /getStaffSession/);
  assert.match(api, /INSERT INTO public\.staff_presence/);
  assert.match(layout, /\/api\/staff\/presence/);
  assert.match(layout, /60000/);
});

test('Super Admin chat assignment exposes staff presence and contact shortcuts', async () => {
  const api = await source('app/api/admin/client-chat/route.js');
  const page = await source('app/admin/client-chat/page.js');
  assert.match(api, /assigned_staff_phone_number/);
  assert.match(api, /client_chat_participants/);
  assert.match(api, /client_chat_handover_events/);
  assert.match(page, /HUMAN ASSIGNMENT/);
  assert.match(page, /WHATSAPP/);
  assert.match(page, /ASSIGN/);
});

test('staff can only access client conversations assigned to or shared with them', async () => {
  const api = await source('app/api/admin/client-chat/route.js');
  const page = await source('app/admin/client-chat/page.js');
  const migration = await source('db/migrations/20261119_client_chat_runtime_compat.sql');
  assert.match(api, /c\.assigned_staff_id=\$4/);
  assert.match(api, /client_chat_participants/);
  assert.match(api, /client_chat_monitor_access/);
  assert.match(api, /staff_notifications/);
  assert.match(page, /setInterval\(load,30000\)/);
  assert.match(migration, /ALTER COLUMN assigned_staff_id TYPE uuid/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.staff_notifications/);
});

test('Super Admin client intelligence reports registrations, engagement, online presence and inspections', async () => {
  const api = await source('app/api/admin/overview/route.js');
  const page = await source('app/admin/super/overview/page.js');
  const home = await source('app/page.js');
  assert.match(api, /registered_total/);
  assert.match(api, /interacted_30d/);
  assert.match(api, /online_now/);
  assert.match(api, /inspection_total/);
  assert.match(api, /last_seen_at>now\(\)-interval '90 seconds'/);
  assert.match(page, /Client intelligence/);
  assert.match(page, /sec ago/);
  assert.match(home, /setInterval\(beat,90000\)/);
});

test('inspection approvals commit Neon status before queueing notification delivery', async () => {
  const admin = await source('app/api/admin/inspection-requests/route.js');
  assert.match(admin, /await client\.query\('COMMIT'\)/);
  assert.match(admin, /queueInspectionEmails\(/);
  assert.match(admin, /deliverInspectionEmails\(/);
  assert.match(admin, /catch\(notificationError\)/);
  assert.match(admin, /status was saved, but notification emails could not be queued/);
});

test('Google Calendar integration never blocks a saved inspection status when the calendar is unavailable', async () => {
  const admin = await source('app/api/admin/inspection-requests/route.js');
  assert.match(admin, /catch\(notificationError\)/);
  assert.match(admin, /Inspection status saved but email queueing failed/);
  assert.match(admin, /status was saved, but notification emails could not be queued/);
});

test('client login returns clients to the intended next page', async () => {
  const login = await source('app/client-login/page.js');
  assert.match(login, /window\.location\.href = next && next\.startsWith/);
  assert.match(login, /api\/client-auth\/verify-code/);
});


test('client OTP throttling does not trust client-supplied X-Forwarded-For', async () => {
  const code = await source('app/api/client-auth/request-code/route.js');
  assert.match(code, /x-vercel-forwarded-for/);
  assert.match(code, /x-real-ip/);
  assert.match(code, /isIP\(ip\)/);
  assert.doesNotMatch(code, /get\('x-forwarded-for'\)/i);
});


test('tenant bootstrap uses balanced PostgreSQL dollar-quoted DO blocks', async () => {
  const code = await source('lib/site-tenants.js');
  const opens = (code.match(/DO \$\$/g) || []).length;
  const closes = (code.match(/END \$\$/g) || []).length;
  assert.ok(opens > 0, 'tenant bootstrap contains guarded DO blocks');
  assert.equal(opens, closes, 'every DO block has a matching dollar-quote terminator');
  assert.doesNotMatch(code, /DO \$(?!\$)\s+BEGIN/);
});


test('staff can see and atomically claim only unassigned requested human handoffs', async () => {
  const api = await source('app/api/admin/client-chat/route.js');
  const page = await source('app/admin/client-chat/page.js');
  assert.match(api, /c\.assigned_staff_id IS NULL AND c\.handoff_status='requested'/);
  assert.match(api, /action==='claim'/);
  assert.match(api, /assigned_staff_id IS NULL AND handoff_status='requested' AND status='open'/);
  assert.match(api, /client_chat_participants/);
  assert.match(api, /'staff_joined','staff'/);
  assert.match(page, /CLAIM WAITING CHAT/);
  assert.match(page, /action\('claim'\)/);
  assert.match(page, /action:actionName/);
});


test('client chat staff identity and handover events remain tenant-scoped', async () => {
  const api = await source('app/api/client-chat/route.js');
  assert.match(api, /cp\.tenant_id=c\.tenant_id AND cp\.removed_at IS NULL/);
  assert.match(api, /a\.tenant_id=c\.tenant_id AND a\.status='active'/);
  assert.match(api, /a\.tenant_id=e\.tenant_id AND a\.status='active'/);
  assert.match(api, /e\.conversation_id=\$1 AND e\.tenant_id=\$2/);
});

test('available and sold property status is permission-controlled, tenant-scoped and reflected publicly', async () => {
  const adminApi = await source('app/api/admin/properties/route.js');
  const adminPage = await source('app/admin/super/page.js');
  const layout = await source('app/admin/layout.js');
  const publicApi = await source('app/api/properties/route.js');
  const home = await source('app/page.js');
  const styles = await source('app/globals.css');

  for (const method of ['GET','POST','PATCH']) {
    assert.ok(adminApi.includes('export async function ' + method + '(req)'));
  }
  assert.ok(adminApi.includes("authorizeAdminRequest(req, 'properties.manage')"));
  assert.ok(adminApi.includes('staff?.tenant_id'));
  assert.ok(adminApi.includes('WHERE p.tenant_id=$1'));
  assert.ok(layout.includes("href==='/admin/super')return access.has('properties.manage')"));
  assert.ok(adminPage.includes('value="available">🟢 AVAILABLE'));
  assert.ok(adminPage.includes('value="sold">🔴 SOLD'));
  assert.ok(adminPage.includes('saveListingStatus(x.id,e.target.value)'));
  assert.ok(publicApi.includes("status IN ('published', 'available', 'sold')"));
  assert.ok(home.includes("x.status==='sold'?'SOLD':'AVAILABLE'"));
  assert.ok(styles.includes('.property-availability.is-available{background:#e4f4d9'));
  assert.ok(styles.includes('.property-availability.is-sold{background:#fbe5e2'));
});

test('client email OTP is short-lived, single-use, rate-limited and fails closed without sender configuration', async () => {
  const request = await source('app/api/client-auth/request-code/route.js');
  const verify = await source('app/api/client-auth/verify-code/route.js');
  const mailer = await source('lib/client-registration-email.js');
  assert.match(request, /CLIENT_AUTH_SECRET/);
  assert.match(request, /createHmac\('sha256'/);
  assert.match(request, /randomInt\(0,1000000\)/);
  assert.match(request, /TTL_MINUTES=10/);
  assert.match(request, /email_count>=4/);
  assert.match(request, /ip_count>=12/);
  assert.match(request, /last_email_request[\s\S]*<60000/);
  assert.match(request, /used_at=now\(\)/);
  assert.match(verify, /attempts>=5/);
  assert.match(verify, /timingSafeEqual/);
  assert.match(verify, /expires_at/);
  assert.match(verify, /sameSite:'lax'/);
  assert.match(verify, /httpOnly:true/);
  assert.match(mailer, /RESEND_API_KEY/);
  assert.match(mailer, /RESEND_FROM_EMAIL/);
  assert.match(mailer, /if\s*\(\s*!process\.env\.RESEND_API_KEY\s*\|\|\s*!process\.env\.RESEND_FROM_EMAIL\s*\|\|\s*!to\s*\)/);
});


test('client chat mutations require manage permission and history returns newest 500 in chronological order', async () => {
  const adminChat = await source('app/api/admin/client-chat/route.js');
  const clientChat = await source('app/api/client-chat/route.js');
  const getHandler = adminChat.slice(adminChat.indexOf('export async function GET(req)'), adminChat.indexOf('export async function POST(req)'));
  const postHandler = adminChat.slice(adminChat.indexOf('export async function POST(req)'), adminChat.indexOf('export async function PATCH(req)'));
  const patchHandler = adminChat.slice(adminChat.indexOf('export async function PATCH(req)'));
  assert.ok(getHandler.includes("authorizeAdminRequest(req,['clients.view','clients.manage'])"));
  assert.ok(postHandler.includes("authorizeAdminRequest(req,'clients.manage')"));
  assert.ok(patchHandler.includes("authorizeAdminRequest(req,'clients.manage')"));
  assert.match(adminChat, /ORDER BY created_at DESC,id DESC LIMIT 500/);
  assert.match(adminChat, /messages\.rows\.reverse\(\)/);
  assert.match(clientChat, /ORDER BY m\.created_at DESC NULLS LAST,m\.id DESC LIMIT 500/);
  assert.match(clientChat, /q\.rows\.reverse\(\)/);
});

test('client OTP login rejects protocol-relative redirect destinations', async () => {
  const login = await source('app/client-login/page.js');
  assert.match(login, /next && next\.startsWith\('\/'\) && !next\.startsWith\('\/\/'\)/);
});


test('inspection cancellation remains an allowed status transition with notification delivery', async () => {
  const adminInspections = await source('app/api/admin/inspection-requests/route.js');
  assert.match(adminInspections, /allowedPrevious=\{[\s\S]*cancelled:\['pending','confirmed','contacted'\]/);
  assert.match(adminInspections, /queueInspectionEmails\(/);
  assert.match(adminInspections, /deliverInspectionEmails\(/);
});

test('mobile admin client chat reserves the admin shell and dock lanes while keeping the composer touch-ready', async () => {
  const page = await source('app/admin/client-chat/page.js');
  const layout = await source('app/admin/layout.js');
  assert.match(page, /height:calc\(100dvh - 60px\)/);
  assert.match(page, /height:calc\(100dvh - 240px\)/);
  assert.match(page, /gb-console \.gb-content>\.gb-ios-chat/);
  assert.match(page, /\.gb-composer\{display:flex!important/);
  assert.match(page, /font:16px\/1\.35/);
  assert.match(page, /env\(safe-area-inset-bottom\)/);
  assert.match(layout, /\.gb-topbar\{height:60px!important/);
});

test('client and public Agent chats preserve recent context and location-specific property follow-ups', async () => {
  const clientChat = await source('app/api/client-chat/route.js');
  const publicWidget = await source('components/agent-chat-widget.js');
  const agent = await source('app/api/agent/chat/route.js');
  assert.match(clientChat, /context:\[\.\.\.history\.rows\.reverse\(\)/);
  assert.match(publicWidget, /context:\[\.\.\.messages\.map/);
  assert.match(agent, /Benin City, Edo State/);
  assert.match(agent, /requestedArea&&filteredRanked\.length===0/);
  assert.match(agent, /greetingOnly&&/);
  assert.match(agent, /priorClientText/);
  assert.match(agent, /edoAlternatives/);
});

test('Control Room shows a responsive loading skeleton while authorised data is fetched', async () => {
  const page = await source('app/admin/super/overview/page.js');
  assert.match(page, /loading-skeleton/);
  assert.match(page, /role="status" aria-label="Loading authorised workspace"/);
  assert.match(page, /skeleton-departments/);
  assert.match(page, /prefers-reduced-motion:reduce/);
});

test('mobile admin chat keeps the composer visible and removes dock obstruction inside a conversation', async () => {
  const page = await source('app/admin/client-chat/page.js');
  assert.match(page, /className="gb-composer"/);
  assert.match(page, /gb-dock-chat-open/);
  assert.match(page, /gb-bottom-dock\.gb-dock-chat-open\{display:none!important\}/);
  assert.match(page, /messageScrollRef/);
  assert.match(page, /openRequest\.current\+\+/);
});

test('Agent follow-up greetings retain the client’s previous request', async () => {
  const agent = await source('app/api/agent/chat/route.js');
  assert.match(agent, /previousClientMessage/);
  assert.match(agent, /I still have your earlier message in mind/);
  assert.match(agent, /Would you like to continue with that request/);
});

test('Agent short acknowledgements continue the active property enquiry instead of resetting intake', async () => {
  const agent = await source('app/api/agent/chat/route.js');
  assert.match(agent, /previousAgentMessage/);
  assert.match(agent, /shortAck&&priorPropertyIntent/);
  assert.match(agent, /Great — is the property for purchase or rent/);
  assert.match(agent, /include nearby Edo locations such as Ekpoma and Auchi/);
});

test('admin login confirms its session cookie before opening the Control Room', async () => {
  const login = await source('app/admin/login/page.js');
  const layout = await source('app/admin/layout.js');
  assert.match(login, /fetch\('\/api\/admin\/session',\{cache:'no-store'\}\)/);
  assert.match(login, /session\.authenticated/);
  assert.match(login, /router\.refresh\(\)/);
  assert.match(layout, /setTimeout\(resolve,180\)/);
});

test('admin chat attachments use tenant-scoped signed storage and verified object metadata', async () => {
  const api = await source('app/api/admin/client-chat/route.js');
  const client = await source('app/api/client-chat/route.js');
  const page = await source('app/admin/client-chat/page.js');
  const widget = await source('components/agent-chat-widget.js');
  const migration = await source('db/migrations/20261124_client_chat_attachments.sql');
  assert.match(api, /attachment-presign/);
  assert.match(api, /attachment-complete/);
  assert.match(api, /HeadObjectCommand/);
  assert.match(api, /GetObjectCommand/);
  assert.match(client, /GetObjectCommand/);
  assert.match(api, /expiresIn:3600/);
  assert.ok(api.includes("prefix='chat/'+ctx.tenantId+'/'+id+'/"));
  assert.match(api, /attachments\) VALUES/);
  assert.match(client, /m\.attachments/);
  assert.match(page, /type="file" multiple/);
  assert.match(page, /gb-message-attachments/);
  assert.match(widget, /attachments:Array\.isArray\(m\.attachments\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS attachments jsonb/);
});

test('admin chat attachments are cleared when switching conversations and can be sent without text', async () => {
  const page = await source('app/admin/client-chat/page.js');
  const api = await source('app/api/admin/client-chat/route.js');
  assert.match(page, /setPendingFiles\(\[\]\)/);
  assert.match(page, /!draft\.trim\(\)&&!pendingFiles\.length/);
  assert.match(page, /attachment-presign/);
  assert.match(page, /attachment-complete/);
  assert.match(api, /message\|\|'Shared an attachment'/);
  assert.match(api, /inputAttachments\.length>5/);
});

test('Agent never carries an old property location or matching terms into unrelated account questions', async () => {
  const agent = await source('app/api/agent/chat/route.js');
  assert.match(agent, /accountHelpRequest=.*register\|sign up\|account\|login\|sign in/);
  assert.match(agent, /matchingText=explicitPropertyFollowup\?priorClientText/);
  assert.match(agent, /currentArea=accountHelpRequest\?null/);
  assert.match(agent, /areaAnswer&&agentAskedPropertyFollowup/);
});
