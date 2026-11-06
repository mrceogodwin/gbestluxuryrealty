import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ properties: [], source: 'demo' }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  try {
    const pool = getDatabasePool();
    const q = await pool.query(`
      SELECT
        id::text AS id,
        slug,
        title,
        location,
        state,
        property_type,
        COALESCE(NULLIF(price, 'Price on request'), price_label, 'Price on request') AS price,
        COALESCE(NULLIF(beds, 0), bedrooms, 0) AS beds,
        COALESCE(NULLIF(baths, 0), bathrooms, 0) AS baths,
        COALESCE(NULLIF(size, ''), size_label, '') AS size,
        COALESCE(NULLIF(image_url, ''), images[1], '') AS image_url,
        COALESCE(images, ARRAY[]::text[]) AS images,
        description,
        video_url
      FROM public.properties
      WHERE status IN ('published', 'available')
      ORDER BY updated_at DESC, id DESC
    `);

    const properties = q.rows.map((x) => ({
      ...x,
      id: String(x.id),
      name: x.title || 'Property listing',
      loc: (x.location || '') + (x.state ? ', ' + x.state : ''),
      type: x.property_type || 'Other',
      img: x.image_url || '',
      images: Array.isArray(x.images) ? x.images.filter(Boolean) : [],
      desc: x.description || '',
      beds: Number(x.beds || 0),
      baths: Number(x.baths || 0),
      size: x.size || '',
      price: x.price || 'Price on request'
    }));

    return NextResponse.json({ properties, source: 'database' }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Public properties GET failed', error.code || error.message);
    return NextResponse.json({ error: 'Could not load published properties.' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
