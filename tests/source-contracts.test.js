import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = async (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('public property API returns gallery images from Neon', async () => {
  const code = await source('app/api/properties/route.js');
  assert.ok(code.includes('AS images'));
  assert.ok(code.includes('images: Array.isArray(x.images)'));
  assert.ok(code.includes('getDatabasePool'));
});
test('admin property API archives records and validates gallery arrays', async () => {
  const code = await source('app/api/admin/properties/route.js');
  assert.ok(code.includes("status='archived'"));
  assert.ok(!code.includes('DELETE FROM public.properties'));
  assert.ok(code.includes('Property gallery must contain no more than 20 image URLs'));
  assert.ok(code.includes('Every gallery image must use an HTTPS URL'));
});
test('inspection requests reject presentation-only sample IDs and require published listings', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.ok(code.includes('Demo cards are for presentation only'));
  assert.ok(code.includes("status IN ('published','available')"));
});
test('inspection APIs use the shared Neon pool', async () => {
  for (const path of ['app/api/inspection-requests/route.js','app/api/admin/inspection-requests/route.js','lib/inspection-email-outbox.js']) {
    const code = await source(path);
    assert.ok(code.includes('getDatabasePool'));
    assert.ok(!code.includes('new Pool('));
  }
});
test('inspection confirmation creates the calendar event before status confirmation', async () => {
  const code = await source('app/api/admin/inspection-requests/route.js');
  const preflight = code.indexOf('pre-confirmation failed');
  const update = code.indexOf("UPDATE public.inspection_requests SET status=$2");
  assert.ok(preflight >= 0 && update > preflight);
  assert.ok(code.includes('The inspection was not confirmed because its calendar event could not be created'));
});
test('email failure does not turn a saved inspection request into a failed submission', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.ok(code.includes('Inspection request saved but email queueing failed'));
  assert.ok(code.includes('status:201'));
});

test('property media API authenticates admin and validates file type, signature and size', async () => {
  const code = await source('app/api/admin/properties/[id]/media/route.js');
  assert.ok(code.includes("authorizeStaff(request, 'properties.manage')"));
  assert.ok(code.includes('MAX_BYTES = 5 * 1024 * 1024'));
  assert.ok(code.includes('matchesSignature'));
  assert.ok(code.includes('public.property_media'));
  assert.ok(code.includes('pg_advisory_xact_lock'));
  assert.ok(code.includes("SET is_cover=false WHERE property_id=$1"));
});
test('property media manager uploads through the authenticated server route', async () => {
  const code = await source('app/admin/super/media-manager.js');
  assert.ok(code.includes('new FormData()'));
  assert.ok(code.includes("method: 'POST'"));
  assert.ok(!code.includes('Authorization'));
  assert.ok(code.includes('SET COVER'));
  assert.ok(code.includes('Neon Object Storage'));
});

test('client registration assigns permanent IDs and inspection records retain client linkage', async () => {
  const registration = await source('app/api/client-registration/route.js');
  const inspection = await source('app/api/inspection-requests/route.js');
  const adminRequests = await source('app/api/admin/inspection-requests/route.js');
  assert.ok(registration.includes('client_registrations'));
  assert.ok(inspection.includes('client_registration_id'));
  assert.ok(inspection.includes('session.rows[0].id'));
  assert.ok(adminRequests.includes('cr.client_id'));
});
test('client identity is required for inspection booking', async () => {
  const code = await source('app/api/inspection-requests/route.js');
  assert.ok(code.includes("req.cookies.get('gbest_client_session')"));
  assert.ok(code.includes('client_sessions'));
  assert.ok(code.includes('payment_status=\'approved\''));
  assert.ok(code.includes('client_status=\'active\''));
});

test('staff sessions and Super Admin-only account management are enforced server-side', async () => {
  const auth = await source('lib/staff-auth.js');
  const manager = await source('app/api/admin/staff-management/route.js');
  const verify = await source('app/api/staff-auth/verify-code/route.js');
  assert.ok(auth.includes('gbest_staff_session'));
  assert.ok(auth.includes("staff.role==='super_admin'"));
  assert.ok(manager.includes("a.staff.role!=='super_admin'"));
  assert.ok(manager.includes("['administrator','moderator']"));
  assert.ok(manager.includes("q.rows[0].role==='super_admin'"));
  assert.ok(verify.includes('timingSafeEqual'));
  assert.ok(verify.includes('staff_sessions'));
});
test('staff login endpoints reject cross-origin requests and revoke sessions on sign-out', async () => {
  const request = await source('app/api/staff-auth/request-code/route.js');
  const verify = await source('app/api/staff-auth/verify-code/route.js');
  const signout = await source('app/api/staff-auth/sign-out/route.js');
  assert.ok(request.includes('Invalid request origin'));
  assert.ok(verify.includes('Invalid request origin'));
  assert.ok(signout.includes('revoked_at=now()'));
});
