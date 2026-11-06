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
