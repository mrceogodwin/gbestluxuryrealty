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
  assert.ok(code.includes("status IN ('published', 'available')"));
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
  assert.ok(code.includes("request.headers.get('authorization')"));
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
  assert.ok(code.includes("Authorization: 'Bearer ' + secret"));
  assert.ok(code.includes('SET COVER'));
  assert.ok(code.includes('Neon Object Storage'));
});
