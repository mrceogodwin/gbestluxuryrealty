import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/admin/properties/[id]/media/route.js', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../app/admin/super/media-manager.js', import.meta.url), 'utf8');
const inspectionAdmin = readFileSync(new URL('../app/api/admin/inspection-requests/route.js', import.meta.url), 'utf8');

test('media API enforces server-side authorization and upload limits', () => {
  assert.match(route, /request\.headers\.get\('authorization'\) === 'Bearer ' \+ process\.env\.ADMIN_SECRET/);
  assert.match(route, /const MAX_BYTES = 5 \* 1024 \* 1024/);
  assert.match(route, /const MAX_ITEMS = 20/);
  assert.match(route, /matchesSignature\(mime, bytes\)/);
});

test('gallery resequencing uses a collision-free temporary range', () => {
  assert.match(route, /sort_order=sort_order\+20/);
  assert.ok(route.includes('0..39'));
  assert.match(route, /async function resequence\(/);
});

test('media deletion commits gallery state before attempting object cleanup', () => {
  const handler = route.slice(route.indexOf('export async function DELETE('));
  assert.ok(handler.indexOf("await connection.query('COMMIT')") < handler.indexOf('let storageWarning = null'));
  assert.match(handler, /Neon media object cleanup pending/);
  assert.ok(handler.includes('warning: [storageWarning, syncWarning]'));
});

test('admin gallery displays storage cleanup warnings', () => {
  assert.match(manager, /data\.warning \? message \+ ' ' \+ data\.warning : message/);
});

test('inspection cancellation requires removal of its shared calendar event first', () => {
  assert.match(inspectionAdmin, /async function deleteCalendarEvent\(/);
  assert.match(inspectionAdmin, /method:'DELETE'/);
  assert.ok(inspectionAdmin.includes("if(status==='cancelled')"));
  assert.ok(inspectionAdmin.includes('request was not cancelled because its calendar appointment could not be removed'));
  assert.match(inspectionAdmin, /calendar_event_id=NULL/);
});

test('cover selection and reorder validation happen after the property lock', () => {
  const cover = route.slice(route.indexOf("if (body.action === 'cover')"), route.indexOf("} else if (body.action === 'reorder')"));
  const reorderStart = route.indexOf("} else if (body.action === 'reorder')");
  const reorder = route.slice(reorderStart, route.indexOf("} else {", reorderStart));
  assert.ok(cover.indexOf('pg_advisory_xact_lock') < cover.indexOf('SELECT id FROM public.property_media'));
  assert.ok(reorder.indexOf('pg_advisory_xact_lock') < reorder.indexOf('SELECT id FROM public.property_media'));
  assert.match(reorder, /Gallery changed while you were editing/);
});

test('committed media operations report legacy synchronization warnings', () => {
  assert.match(route, /async function syncLegacyWithWarning/);
  assert.match(route, /Gallery saved, but the older property image fields could not be synchronized/);
});


test('cancellation commits status before external calendar cleanup', () => {
  const statusWrite = inspectionAdmin.indexOf("const q=await pool.query('UPDATE public.inspection_requests");
  const calendarCleanup = inspectionAdmin.indexOf("calendarRemoval=await deleteCalendarEvent(row)");
  assert.ok(statusWrite >= 0);
  assert.ok(calendarCleanup > statusWrite);
  assert.match(inspectionAdmin, /if\(calendarRemoval\.deleted\) row\.calendar_event_id=null/);
});


const inspectionAdminPage = readFileSync(new URL('../app/admin/page.js', import.meta.url), 'utf8');
test('admin can retry calendar cleanup for cancelled inspections', () => {
  assert.match(inspectionAdminPage, /x\.status==='cancelled'&&x\.calendar_event_id/);
  assert.match(inspectionAdminPage, /Retry calendar cleanup/);
});

const legalAdmin = readFileSync(new URL('../app/api/admin/legal-documents/route.js', import.meta.url), 'utf8');
const legalPublic = readFileSync(new URL('../app/api/legal-documents/route.js', import.meta.url), 'utf8');
const legalReader = readFileSync(new URL('../app/api/legal-documents/[slug]/route.js', import.meta.url), 'utf8');
const legalLibrary = readFileSync(new URL('../lib/legal-documents.js', import.meta.url), 'utf8');
const inspectionPublic = readFileSync(new URL('../app/api/inspection-requests/route.js', import.meta.url), 'utf8');
const bookingPage = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

test('legal document admin endpoints require the configured admin secret', () => {
  assert.match(legalAdmin, /authorization.*Bearer.*ADMIN_SECRET/);
  assert.match(legalAdmin, /status='published'/);
});
test('published document reader escapes text and supports print-to-PDF', () => {
  assert.match(legalReader, /replace\(\/\[&<>\]/);
  assert.match(legalReader, /window\.print\(\)/);
  assert.match(legalReader, /status='published'/);
});
test('legal document records preserve prior versions and client acceptance evidence', () => {
  assert.match(legalLibrary, /legal_document_revisions/);
  assert.match(legalLibrary, /legal_document_acceptances/);
  assert.match(legalLibrary, /content_sha256/);
  assert.match(legalLibrary, /document_version/);
});
test('public booking API rejects missing or stale required document acknowledgements', () => {
  assert.match(inspectionPublic, /Please read and accept every required agreement/);
  assert.match(inspectionPublic, /An agreement changed/);
  assert.match(inspectionPublic, /createHash\('sha256'\)/);
  assert.match(inspectionPublic, /legal_document_acceptances/);
});
test('inspection form displays published documents and blocks missing required acknowledgements', () => {
  assert.match(bookingPage, /api\/legal-documents/);
  assert.match(bookingPage, /acceptedDocs/);
  assert.match(bookingPage, /d\.required/);
  assert.match(bookingPage, /Read document/);
});
