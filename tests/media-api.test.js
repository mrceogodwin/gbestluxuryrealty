import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/admin/properties/[id]/media/route.js', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../app/admin/super/media-manager.js', import.meta.url), 'utf8');

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
  const deleteHandler = route.slice(route.indexOf('export async function DELETE('));
  assert.ok(deleteHandler.indexOf("await connection.query('COMMIT')") < deleteHandler.indexOf('let storageWarning = null'));
  assert.match(deleteHandler, /Neon media object cleanup pending/);
  assert.match(deleteHandler, /warning: storageWarning/);
});

test('admin gallery displays storage cleanup warnings', () => {
  assert.match(manager, /data\.warning \? message \+ ' ' \+ data\.warning : message/);
});

const inspectionAdmin = readFileSync(new URL('../app/api/admin/inspection-requests/route.js', import.meta.url), 'utf8');

test('cancelling an inspection removes its shared Google Calendar event', () => {
  assert.match(inspectionAdmin, /async function deleteCalendarEvent\(/);
  assert.match(inspectionAdmin, /method:'DELETE'/);
  assert.match(inspectionAdmin, /status==='cancelled'&&row\.calendar_event_id/);
  assert.match(inspectionAdmin, /calendar_event_id=NULL/);
  assert.match(inspectionAdmin, /calendarRemoval\.reason/);
});
