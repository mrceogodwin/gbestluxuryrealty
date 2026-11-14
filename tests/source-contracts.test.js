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
  assert.match(code, /audioType/);
  assert.match(code, /actualSize/);
  assert.match(code, /25\*1024\*1024/);
});
