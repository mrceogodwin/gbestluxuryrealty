import { NextResponse } from 'next/server';
import { AwsClient } from 'aws4fetch';
import { getDatabasePool } from '../../../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'property-media';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 20;
const MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
};

async function authorized(request) {
  const { authorizeStaffOrLegacySuperAdmin } = await import('../../../../../../lib/staff-auth');
  return authorizeStaffOrLegacySuperAdmin(request, 'properties.manage');
}
function storageClient() {
  const env = process.env;
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_ENDPOINT_URL_S3) {
    throw new Error('Neon Object Storage is not configured on this deployment.');
  }
  return {
    client: new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      service: 's3',
      region: env.AWS_REGION || 'eu-central-1'
    }),
    endpoint: env.AWS_ENDPOINT_URL_S3.replace(/\/$/, '')
  };
}
function objectUrl(key) {
  const { endpoint } = storageClient();
  return endpoint + '/' + BUCKET + '/' + key.split('/').map(encodeURIComponent).join('/');
}
function matchesSignature(type, bytes) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (type === 'image/avif') return String.fromCharCode(...bytes.slice(4,12)).includes('ftypavif');
  if (type === 'video/mp4') return String.fromCharCode(...bytes.slice(4,8)) === 'ftyp';
  if (type === 'video/webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return false;
}
function publicUrl(key) { return objectUrl(key); }
async function resequence(connection, propertyId, ids) {
  // Move the current positions into a temporary range first. The DB check allows
  // 0..39; the API still caps galleries at 20 items (0..19).
  await connection.query(
    'UPDATE public.property_media SET sort_order=sort_order+20 WHERE property_id=$1',
    [propertyId]
  );
  for (let index = 0; index < ids.length; index++) {
    await connection.query(
      'UPDATE public.property_media SET sort_order=$1 WHERE id=$2 AND property_id=$3',
      [index, ids[index], propertyId]
    );
  }
}

async function getMedia(pool, id) {
  const result = await pool.query(
    'SELECT id::text, object_key, media_type, mime_type, file_size_bytes, sort_order, alt_text, is_cover, created_at FROM public.property_media WHERE property_id=$1 ORDER BY sort_order, created_at',
    [id]
  );
  return result.rows.map(row => ({ ...row, url: publicUrl(row.object_key), file_size_bytes: Number(row.file_size_bytes) }));
}
async function syncLegacy(pool, id) {
  const result = await pool.query(
    'SELECT object_key, media_type FROM public.property_media WHERE property_id=$1 ORDER BY sort_order, created_at',
    [id]
  );
  const images = result.rows.filter(row => row.media_type === 'image').map(row => publicUrl(row.object_key));
  const video = result.rows.find(row => row.media_type === 'video');
  await pool.query(
    'UPDATE public.properties SET images=$1, image_url=$2, video_url=$3, updated_at=now() WHERE id=$4',
    [images, images[0] || '', video ? publicUrl(video.object_key) : '', id]
  );
}

async function syncLegacyWithWarning(pool, id) {
  try {
    await syncLegacy(pool, id);
    return null;
  } catch (error) {
    console.error('Property media committed but legacy image fields need synchronization:', error?.message || error);
    return 'Gallery saved, but the older property image fields could not be synchronized. Refresh the admin panel and retry.';
  }
}
function failure(error) {
  console.error('Property media API:', error?.message || error);
  return NextResponse.json({ error: 'Property media operation failed. Please try again.' }, { status: 500 });
}

export async function GET(request, { params }) {
  if (!await authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const pool = getDatabasePool();
    const property = await pool.query('SELECT id FROM public.properties WHERE id=$1', [id]);
    if (!property.rowCount) return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
    return NextResponse.json({ media: await getMedia(pool, id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(request, { params }) {
  if (!await authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let uploadedKey = null;
  try {
    const { id } = await params;
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Choose an image or video file.' }, { status: 400 });
    }
    const mime = String(file.type || '').toLowerCase();
    const extension = MIME[mime];
    if (!extension) return NextResponse.json({ error: 'Allowed formats: JPG, PNG, WebP, AVIF, MP4 and WebM.' }, { status: 400 });
    if (file.size < 1 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Each media file must be no larger than 5 MB.' }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesSignature(mime, bytes)) return NextResponse.json({ error: 'The file content does not match its declared file type.' }, { status: 400 });

    const key = 'properties/' + id + '/' + crypto.randomUUID() + '.' + extension;
    uploadedKey = key;
    const { client } = storageClient();
    const uploaded = await client.fetch(objectUrl(key), {
      method: 'PUT',
      headers: { 'content-type': mime },
      body: bytes
    });
    if (!uploaded.ok) throw new Error('Neon Object Storage rejected the upload (' + uploaded.status + ').');

    const pool = getDatabasePool();
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);
      const property = await connection.query('SELECT id FROM public.properties WHERE id=$1 FOR UPDATE', [id]);
      if (!property.rowCount) throw new Error('Property not found.');
      const count = Number((await connection.query('SELECT count(*)::int AS count FROM public.property_media WHERE property_id=$1', [id])).rows[0].count);
      if (count >= MAX_ITEMS) throw new Error('A property can have a maximum of 20 media items.');
      const order = Number((await connection.query('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM public.property_media WHERE property_id=$1', [id])).rows[0].next);
      const mediaType = mime.startsWith('image/') ? 'image' : 'video';
      const isCover = mediaType === 'image' && !(await connection.query('SELECT 1 FROM public.property_media WHERE property_id=$1 AND is_cover=true', [id])).rowCount;
      await connection.query(
        'INSERT INTO public.property_media (property_id, object_key, media_type, mime_type, file_size_bytes, sort_order, alt_text, is_cover) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, key, mediaType, mime, file.size, order, String(form.get('alt_text') || file.name || '').slice(0, 250), isCover]
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    uploadedKey = null;
    const warning = await syncLegacyWithWarning(pool, id);
    return NextResponse.json({ media: await getMedia(pool, id), warning }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (uploadedKey) {
      try {
        const { client } = storageClient();
        await client.fetch(objectUrl(uploadedKey), { method: 'DELETE' });
      } catch (cleanupError) {
        console.error('Neon media orphan cleanup failed:', cleanupError?.message || cleanupError);
      }
    }
    if (error?.message === 'Property not found.') return NextResponse.json({ error: error.message }, { status: 404 });
    if (error?.message === 'A property can have a maximum of 20 media items.') return NextResponse.json({ error: error.message }, { status: 409 });
    return failure(error);
  }
}

export async function PATCH(request, { params }) {
  if (!await authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const pool = getDatabasePool();
    if (body.action === 'cover') {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);
        const chosen = await connection.query(
          "SELECT id FROM public.property_media WHERE id=$1 AND property_id=$2 AND media_type='image' FOR UPDATE",
          [body.media_id, id]
        );
        if (!chosen.rowCount) {
          await connection.query('ROLLBACK');
          return NextResponse.json({ error: 'Image not found for this property.' }, { status: 404 });
        }
        await connection.query('UPDATE public.property_media SET is_cover=false WHERE property_id=$1', [id]);
        await connection.query('UPDATE public.property_media SET is_cover=true WHERE id=$1 AND property_id=$2', [body.media_id, id]);
        const orderedIds = await connection.query(
          'SELECT id FROM public.property_media WHERE property_id=$1 ORDER BY (id=$2) DESC, sort_order',
          [id, body.media_id]
        );
        await resequence(connection, id, orderedIds.rows.map(row => row.id));
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    } else if (body.action === 'reorder') {
      if (!Array.isArray(body.media_ids) || body.media_ids.length > MAX_ITEMS ||
          body.media_ids.some(value => typeof value !== 'string') ||
          new Set(body.media_ids).size !== body.media_ids.length) {
        return NextResponse.json({ error: 'Invalid gallery order.' }, { status: 400 });
      }
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);
        const existing = await connection.query('SELECT id FROM public.property_media WHERE property_id=$1 ORDER BY sort_order FOR UPDATE', [id]);
        if (existing.rowCount !== body.media_ids.length ||
            existing.rows.some(row => !body.media_ids.includes(row.id))) {
          await connection.query('ROLLBACK');
          return NextResponse.json({ error: 'Gallery changed while you were editing. Refresh and try again.' }, { status: 409 });
        }
        await resequence(connection, id, body.media_ids);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    } else {
      return NextResponse.json({ error: 'Unknown media action.' }, { status: 400 });
    }
    const warning = await syncLegacyWithWarning(pool, id);
    return NextResponse.json({ media: await getMedia(pool, id), warning });
  } catch (error) { return failure(error); }
}

export async function DELETE(request, { params }) {
  if (!await authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    if (!body?.media_id) return NextResponse.json({ error: 'Media item not found.' }, { status: 404 });
    const pool = getDatabasePool();
    const connection = await pool.connect();
    let objectKey = null;
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);
      const found = await connection.query(
        'SELECT object_key FROM public.property_media WHERE id=$1 AND property_id=$2 FOR UPDATE',
        [body.media_id, id]
      );
      if (!found.rowCount) {
        await connection.query('ROLLBACK');
        return NextResponse.json({ error: 'Media item not found.' }, { status: 404 });
      }
      objectKey = found.rows[0].object_key;
      await connection.query('DELETE FROM public.property_media WHERE id=$1 AND property_id=$2', [body.media_id, id]);
      const cover = await connection.query(
        "SELECT id FROM public.property_media WHERE property_id=$1 AND media_type='image' ORDER BY sort_order LIMIT 1",
        [id]
      );
      await connection.query('UPDATE public.property_media SET is_cover=false WHERE property_id=$1', [id]);
      if (cover.rowCount) {
        await connection.query('UPDATE public.property_media SET is_cover=true WHERE id=$1 AND property_id=$2', [cover.rows[0].id, id]);
      }
      const remaining = await connection.query(
        'SELECT id FROM public.property_media WHERE property_id=$1 ORDER BY sort_order',
        [id]
      );
      await resequence(connection, id, remaining.rows.map(row => row.id));
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    let storageWarning = null;
    try {
      const { client } = storageClient();
      const deleted = await client.fetch(objectUrl(objectKey), { method: 'DELETE' });
      if (!deleted.ok && deleted.status !== 404) storageWarning = 'The gallery item was removed, but its unused storage object needs cleanup.';
    } catch (storageError) {
      console.error('Neon media object cleanup pending:', storageError?.message || storageError);
      storageWarning = 'The gallery item was removed, but its unused storage object needs cleanup.';
    }
    const syncWarning = await syncLegacyWithWarning(pool, id);
    return NextResponse.json({ media: await getMedia(pool, id), warning: [storageWarning, syncWarning].filter(Boolean).join(' ') || null });
  } catch (error) { return failure(error); }
}
