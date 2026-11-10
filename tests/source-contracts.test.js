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
  assert.match(code, /GB-00\[1-8\]/);
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

test('homepage footer social profiles are validated as HTTPS URLs', async () => {
  const code = await source('app/api/admin/homepage/route.js');
  assert.match(code, /'socialLinks'/);
  assert.match(code, /const platforms=\['instagram','facebook','x','linkedin','youtube','tiktok','whatsapp'\]/);
  assert.match(code, /Each social profile must be a valid HTTPS URL/);
});

test('public property cards and detail pages expose working share destinations', async () => {
  const home = await source('app/page.js');
  const detail = await source('app/property/[slug]/page.js');
  const share = await source('app/property/[slug]/SharePropertyButton.js');
  assert.match(home, /className="property-card-share"/);
  assert.match(home, /className="footer-socials"/);
  assert.match(home, /shareProperty\(detail\)/);
  assert.match(detail, /status IN \('published','available'\)/);
  assert.match(share, /navigator\.share/);
  assert.match(share, /clipboard/);
});

test('Super Admin can manage separate header and footer image logos', async () => {
  const editor = await source('app/admin/super/homepage/page.js');
  const api = await source('app/api/admin/homepage/route.js');
  const home = await source('app/page.js');
  assert.match(editor, /HEADER BRAND LOGO/);
  assert.match(editor, /FOOTER BRAND LOGO/);
  assert.match(editor, /headerLogoUrl/);
  assert.match(editor, /footerLogoUrl/);
  assert.match(api, /'headerLogoUrl','footerLogoUrl'/);
  assert.match(api, /Brand logo must be a valid HTTPS media URL/);
  assert.match(home, /homepage\.navigation\?\.headerLogoUrl/);
  assert.match(home, /homepage\.footer\?\.footerLogoUrl/);
  assert.match(home, /header-brand-logo/);
  assert.match(home, /footer-brand-logo/);
});

test('property card thumbnails open a full-screen detail viewer with the complete gallery', async () => {
  const home = await source('app/page.js');
  const api = await source('app/api/properties/route.js');
  const styles = await source('app/globals.css');
  assert.match(home, /className="property-image-open" onClick=\{\(\)=>SD\(x\)\}/);
  assert.match(home, /property-modal-thumbnails/);
  assert.match(home, /property-modal-image-controls/);
  assert.match(home, /property-modal-facts/);
  assert.match(home, /property-full-description/);
  assert.match(home, /ArrowRight/);
  assert.match(api, /images,/);
  assert.match(api, /status,/);
  assert.match(styles, /width:100vw!important;.*height:100dvh!important/s);
  assert.match(styles, /\.property-modal-thumbnails/);
});

test('mobile full-screen property viewer locks and restores background page scrolling', async () => {
  const home = await source('app/page.js');
  assert.match(home, /body\.style\.position='fixed'/);
  assert.match(home, /body\.style\.overflow='hidden'/);
  assert.match(home, /window\.scrollTo\(0,y\)/);
});

test('property cards avoid floating image arrows and keep save/share/view actions separated', async () => {
  const home = await source('app/page.js');
  const styles = await source('app/globals.css');
  assert.doesNotMatch(home, /className="photo-open-hint"/);
  assert.doesNotMatch(home, /className="share-property"/);
  assert.match(home, /className="property-card-share"/);
  assert.match(home, /className="save-property"/);
  assert.match(styles, /\.property-card-actions\{display:flex/);
  assert.match(styles, /\.property-card \.save-property\{left:10px;bottom:10px/);
});

test('property management workspace loads when optional inspection and media permissions are absent', async () => {
  const page = await source('app/admin/super/page.js');
  assert.match(page, /async function optionalRequest/);
  assert.match(page, /r\.status===401\|\|r\.status===403/);
  assert.match(page, /setCanManageSchedule\(Boolean\(sd\)\)/);
  assert.match(page, /setCanManageMedia\(Boolean\(cv\)\)/);
  assert.match(page, /\{canManageSchedule&&<section className="super-editor schedule-editor"/);
  assert.match(page, /\{canManageMedia&&<section className="super-editor company-video-editor"/);
  assert.match(page, /Image uploads require Media Management permission/);
});

test('media library prevents deleting images still referenced by properties or homepage content', async () => {
  const api = await source('app/api/admin/media/route.js');
  const page = await source('app/admin/super/media/page.js');
  assert.match(api, /to_jsonb\(p\)::text LIKE '%' \|\| \$1 \|\| '%'/);
  assert.match(api, /draft_content,'\{\}'::jsonb\)::text LIKE/);
  assert.match(api, /published_content,'\{\}'::jsonb\)::text LIKE/);
  assert.match(api, /status:409/);
  assert.match(api, /Replace or remove that reference before deleting the file/);
  assert.match(page, /Images still referenced by property listings or homepage content will be protected/);
});

test('client profile viewers do not receive payment or receipt details without payments.review', async () => {
  const code = await source('app/api/admin/client-registrations/route.js');
  assert.match(code, /const canViewPaymentDetails=isSuperAdmin\|\|canReviewPayments/);
  const profileOnly = code.match(/: \x60(id,surname,other_names,address,email,phone,nationality,state_of_origin,lga,occupation,property_type,price_range,preferred_location,property_description,terms_accepted,created_at)\x60\s*:/);
  assert.ok(profileOnly, 'profile-only projection exists');
  for (const restrictedField of ['fee_amount','payment_reference','receipt_name','receipt_type','payment_status','admin_note','approved_by','approved_at','auditSelect']) {
    assert.doesNotMatch(profileOnly[1], new RegExp('\\b' + restrictedField + '\\b'));
  }
});

test('staff suspension and revocation invalidate all active staff sessions', async () => {
  const code = await source('app/api/admin/staff/route.js');
  assert.match(code, /if\(\['suspended','revoked'\]\.includes\(d\.status\)\)/);
  assert.match(code, /UPDATE public\.staff_sessions SET revoked_at=now\(\) WHERE staff_id=\$1 AND revoked_at IS NULL/);
  const auth = await source('lib/staff-auth.js');
  assert.match(auth, /s\.revoked_at IS NULL AND s\.expires_at>now\(\)/);
  assert.match(auth, /a\.status='active'/);
});

test('client profile-only staff cannot receive payment metrics in the workspace overview', async () => {
  const api = await source('app/api/admin/overview/route.js');
  const page = await source('app/admin/super/overview/page.js');
  assert.match(api, /admin\|\|granted\.has\('payments\.review'\)/);
  assert.match(api, /SELECT COUNT\(\*\)::int AS total,false AS payment_metrics_available FROM public\.client_registrations/);
  assert.match(page, /data\.clients\.payment_metrics_available\?/);
  assert.match(page, /'Client profiles available'/);
});

test('client profile workspace hides payment status and review controls without payment permission', async () => {
  const api = await source('app/api/admin/client-registrations/route.js');
  const page = await source('app/admin/clients/page.js');
  assert.match(api, /canReviewPayments:canViewPaymentDetails/);
  assert.match(page, /setCanReviewPayments\(Boolean\(d\.canReviewPayments\)\)/);
  assert.match(page, /canReviewPayments&&<span className=\{'client-pay-status '/);
  assert.match(page, /canReviewPayments&&<><p>Receipt:/);
});

test('master admin sessions support global revocation and enforce a two-hour maximum lifetime', async () => {
  const auth = await source('lib/admin-auth.js');
  const route = await source('app/api/admin/session/route.js');
  assert.match(auth, /sv===\(process\.env\.ADMIN_SESSION_VERSION\|\|'1'\)/);
  assert.match(auth, /d\.exp-d\.iat<=2\*60\*60\*1000/);
  assert.match(auth, /sv:process\.env\.ADMIN_SESSION_VERSION\|\|'1'/);
  assert.match(auth, /iat\+2\*60\*60\*1000/);
  assert.doesNotMatch(auth, /Bearer '\+process\.env\.ADMIN_SECRET/);
  assert.match(route, /maxAge:2\*60\*60/);
});

test('master admin login rejects missing or cross-origin Origin headers', async () => {
  const route = await source('app/api/admin/session/route.js');
  assert.match(route, /req\.headers\.get\('origin'\)!==req\.nextUrl\.origin/);
  assert.match(route, /Invalid request origin/);
});
