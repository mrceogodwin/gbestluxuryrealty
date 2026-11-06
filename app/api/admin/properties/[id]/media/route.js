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

function authorized(request) {
  return Boolean(process.env.ADMIN_SECRET) &&
    request.headers.get('authorization') === 'Bearer ' + process.env.ADMIN_SECRET;
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
function failure(error) {
  console.error('Property media API:', error?.message || error);
  return NextResponse.json({ error: error?.message || 'Property media operation failed.' }, { status: 500 });
}

export async function GET(request, { params }) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const pool = getDatabasePool();
    const property = await pool.query('SELECT id FROM public.properties WHERE id=$1', [id]);
    if (!property.rowCount) return NextResponse.json({ error: 'Property not found.' }, { status: 404 });
    return NextResponse.json({ media: await getMedia(pool, id) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(request, { params }) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    await syncLegacy(pool, id);
    return NextResponse.json({ media: await getMedia(pool, id) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
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
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const pool = getDatabasePool();
    if (body.action === 'cover') {
      const chosen = await pool.query(
        "SELECT id FROM public.property_media WHERE id=$1 AND property_id=$2 AND media_type='image'",
        [body.media_id, id]
      );
      if (!chosen.rowCount) return NextResponse.json({ error: 'Image not found for this property.' }, { status: 404 });
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);
        await connection.query('UPDATE public.property_media SET is_cover=false WHERE property_id=$1', [id]);
        await connection.query('UPDATE public.property_media SET is_cover=true WHERE id=$1 AND property_id=$2', [body.media_id, id]);
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    } else if (body.action === 'reorder') {
      const existing = await pool.query('SELECT id FROM public.property_media WHERE property_id=$1 ORDER BY sort_order', [id]);
      if (!Array.isArray(body.media_ids) || existing.rowCount !== body.media_ids.length ||
          new Set(body.media_ids).size !== existing.rowCount ||
          existing.rows.some(row => !body.media_ids.includes(row.id))) {
        return NextResponse.json({ error: 'Invalid gallery order.' }, { status: 400 });
      }
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);
        await connection.query('UPDATE public.property_media SET sort_order=sort_order+100 WHERE property_id=$1', [id]);
        for (let index = 0; index < body.media_ids.length; index++) {
          await connection.query('UPDATE public.property_media SET sort_order=$1 WHERE id=$2 AND property_id=$3', [index, body.media_ids[index], id]);
        }
        await connection.query('COMMIT');
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally { connection.release(); }
    } else {
      return NextResponse.json({ error: 'Unknown media action.' }, { status: 400 });
    }
    await syncLegacy(pool, id);
    return NextResponse.json({ media: await getMedia(pool, id) });
  } catch (error) { return failure(error); }
}

export async function DELETE(request, { params }) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const body = await request.json();
    const pool = getDatabasePool();
    const found = await pool.query('SELECT object_key FROM public.property_media WHERE id=$1 AND property_id=$2', [body.media_id, id]);
    if (!found.rowCount) return NextResponse.json({ error: 'Media item not found.' }, { status: 404 });
    const { client } = storageClient();
    const deleted = await client.fetch(objectUrl(found.rows[0].object_key), { method: 'DELETE' });
    if (!deleted.ok && deleted.status !== 404) throw new Error('Could not delete the file from Neon Object Storage.');
    await pool.query('DELETE FROM public.property_media WHERE id=$1 AND property_id=$2', [body.media_id, id]);
    const cover = await pool.query(
      "SELECT id FROM public.property_media WHERE property_id=$1 AND media_type='image' ORDER BY sort_order LIMIT 1",
      [id]
    );
    if (cover.rowCount) await pool.query('UPDATE public.property_media SET is_cover=(id=$1) WHERE property_id=$2', [cover.rows[0].id, id]);
    const remaining = await pool.query('SELECT id FROM public.property_media WHERE property_id=$1 ORDER BY sort_order', [id]);
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('UPDATE public.property_media SET sort_order=sort_order+100 WHERE property_id=$1', [id]);
      for (let index = 0; index < remaining.rows.length; index++) {
        await connection.query('UPDATE public.property_media SET sort_order=$1 WHERE id=$2', [index, remaining.rows[index].id]);
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
    await syncLegacy(pool, id);
    return NextResponse.json({ media: await getMedia(pool, id) });
  } catch (error) { return failure(error); }
}
