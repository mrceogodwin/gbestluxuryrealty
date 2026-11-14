import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../lib/db';
import {resolveSiteTenant} from '../../../lib/site-tenants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ properties: [], source: 'demo' }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  try {
    const pool = getDatabasePool();
    const host=req.headers.get('x-forwarded-host')||req.headers.get('host')||'';
    const tenant=await resolveSiteTenant(pool,host);
    if(!tenant)return NextResponse.json({error:'This domain is not connected to an active company workspace.'},{status:404,headers:{'Cache-Control':'no-store'}});
    const q = await pool.query(`
      SELECT
        id::text AS id,
        CASE WHEN id::text ~ '^[0-9]+$' THEN 'GB-' || lpad(id::text, 8, '0') ELSE 'GB-' || right(upper(replace(id::text, '-', '')), 8) END AS property_code,
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
      WHERE tenant_id=$1 AND status IN ('published', 'available')
      ORDER BY updated_at DESC, id DESC
    `,[tenant.id]);

    const properties = q.rows.map((x) => ({
      ...x,
      id: String(x.id),
      name: x.title || 'Property listing',
      loc: (x.location || '') + (x.state ? ', ' + x.state : ''),
      type: x.property_type || 'Other',
      img: x.image_url || '',
      images: Array.isArray(x.images)?x.images:[],
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
