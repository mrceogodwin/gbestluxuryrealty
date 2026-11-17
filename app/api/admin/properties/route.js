import { NextResponse } from 'next/server';
import { getDatabasePool } from '../../../../lib/db';
import { authorizeAdminRequest } from '../../../../lib/admin-permissions';
import { isAdminRequest } from '../../../../lib/admin-auth';
import { ensureSiteTenants } from '../../../../lib/site-tenants';
import { getStaffSession } from '../../../../lib/staff-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const propertyCode = (id) => {
  const value = String(id ?? '');
  if (/^\d+$/.test(value)) return 'GB-' + value.padStart(8, '0');
  return 'GB-' + value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(-8).padStart(8, '0');
};

class ValidationError extends Error {}

async function readBody(req) {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Request body must be an object.');
    }
    return body;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid JSON body.');
  }
}

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

const isHttps = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

function validate(data, partial = false) {
  const out = {};
  const fields = {
    title: 120,
    location: 180,
    state: 80,
    property_type: 60,
    price: 100,
    size: 60,
    image_url: 1000,
    video_url: 1000,
    description: 2000,
    status: 20,
    slug: 140,
  };

  for (const [key, max] of Object.entries(fields)) {
    if (data[key] !== undefined) out[key] = clean(data[key], max);
  }

  if (data.images !== undefined) {
    if (!Array.isArray(data.images) || data.images.length > 30) {
      throw new ValidationError('Property gallery must contain up to 30 images.');
    }
    out.images = data.images.map((item) => clean(item, 1200)).filter(Boolean);
    if (out.images.some((item) => !isHttps(item))) {
      throw new ValidationError('Gallery images must use HTTPS URLs.');
    }
  }

  for (const key of ['beds', 'baths']) {
    if (data[key] !== undefined) {
      const value = Number(data[key]);
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new ValidationError('Bedrooms and bathrooms must be whole numbers from 0 to 100.');
      }
      out[key] = value;
    }
  }

  if (!partial) {
    for (const key of ['title', 'location', 'property_type']) {
      if (!out[key]) throw new ValidationError('Title, location and property type are required.');
    }
    out.slug =
      out.slug ||
      out.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    out.price = out.price || 'Price on request';
    out.status = out.status || 'draft';
  }

  for (const key of ['image_url', 'video_url']) {
    if (out[key] && !isHttps(out[key])) {
      throw new ValidationError(key + ' must use an HTTPS URL.');
    }
  }

  if (
    out.status &&
    !['draft', 'published', 'archived', 'available', 'reserved', 'sold', 'rented'].includes(out.status)
  ) {
    throw new ValidationError('Invalid listing status.');
  }

  if (out.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.slug)) {
    throw new ValidationError('Slug may contain lowercase letters, numbers and hyphens.');
  }

  return out;
}

function withLegacyFields(data) {
  if (data.price !== undefined) data.price_label = data.price;
  if (data.size !== undefined) data.size_label = data.size || null;
  if (data.beds !== undefined) data.bedrooms = data.beds;
  if (data.baths !== undefined) data.bathrooms = data.baths;
  if (data.images !== undefined) {
    data.image_url = data.images[0] || '';
  } else if (data.image_url !== undefined) {
    data.images = data.image_url ? [data.image_url] : [];
  }
  return data;
}

function errorResponse(error, operation) {
  if (error.code === '23505') {
    return NextResponse.json({ error: 'That listing slug already exists.' }, { status: 409 });
  }
  const validation = error instanceof ValidationError;
  console.error(operation, error.code || error.message);
  return NextResponse.json(
    {
      error: validation
        ? error.message
        : 'Could not process listing. Check the database connection and server logs.',
    },
    { status: validation ? 400 : 500 }
  );
}

async function targetTenant(pool, req, requested) {
  await ensureSiteTenants(pool);
  const admin = await isAdminRequest(req);
  let id = requested;

  if (!admin) {
    const staff = await getStaffSession(req);
    id = staff?.tenant_id;
  } else if (id === undefined || id === null || id === '') {
    const result = await pool.query(
      "SELECT id FROM public.site_tenants WHERE tenant_key='gbest' LIMIT 1"
    );
    id = result.rows[0]?.id;
  }

  const tenantId = Number(id);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) {
    throw new ValidationError('Choose a valid company workspace.');
  }

  const result = await pool.query(
    'SELECT id,tenant_key,display_name,status FROM public.site_tenants WHERE id=$1',
    [tenantId]
  );
  if (!result.rowCount) throw new ValidationError('Company workspace not found.');

  return { tenant: result.rows[0], admin };
}

export async function GET(req) {
  if (!await authorizeAdminRequest(req, 'properties.manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }

  try {
    const pool = getDatabasePool();
    const admin = await isAdminRequest(req);
    const url = new URL(req.url);
    const { tenant } = await targetTenant(pool, req, url.searchParams.get('tenantId') || undefined);
    const result = await pool.query(
      'SELECT p.*,t.tenant_key,t.display_name AS tenant_name FROM public.properties p JOIN public.site_tenants t ON t.id=p.tenant_id WHERE p.tenant_id=$1 ORDER BY p.updated_at DESC,p.id DESC',
      [tenant.id]
    );
    const tenants = admin
      ? (await pool.query(
          'SELECT id,tenant_key,display_name,status FROM public.site_tenants ORDER BY created_at ASC'
        )).rows
      : [tenant];

    return NextResponse.json(
      {
        properties: result.rows.map((item) => ({
          ...item,
          property_code: propertyCode(item.id),
        })),
        tenants,
        activeTenantId: tenant.id,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return errorResponse(error, 'Properties admin GET failed');
  }
}

export async function POST(req) {
  if (!await authorizeAdminRequest(req, 'properties.manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }

  try {
    const body = await readBody(req);
    const { tenant } = await targetTenant(getDatabasePool(), req, body.tenant_id);
    const data = withLegacyFields(validate(body));
    const pool = getDatabasePool();
    const keys = ['tenant_id', ...Object.keys(data)];
    const values = [tenant.id, ...Object.values(data)];
    const placeholders = keys.map((_, index) => '$' + (index + 1));
    const result = await pool.query(
      'INSERT INTO public.properties(' + keys.join(',') + ') VALUES(' + placeholders.join(',') + ') RETURNING *',
      values
    );

    return NextResponse.json(
      {
        property: {
          ...result.rows[0],
          property_code: propertyCode(result.rows[0].id),
        },
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return errorResponse(error, 'Properties admin POST failed');
  }
}

export async function PATCH(req) {
  if (!await authorizeAdminRequest(req, 'properties.manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }

  try {
    const body = await readBody(req);
    const id = String(body.id ?? '').trim();
    if (!id || id.length > 100) {
      return NextResponse.json({ error: 'Valid listing ID required.' }, { status: 400 });
    }

    delete body.id;
    const pool = getDatabasePool();
    const admin = await isAdminRequest(req);
    const existing = await pool.query(
      'SELECT tenant_id FROM public.properties WHERE id=$1',
      [id]
    );
    if (!existing.rowCount) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }

    const { tenant } = await targetTenant(
      pool,
      req,
      body.tenant_id ?? existing.rows[0].tenant_id
    );

    if (!admin && Number(existing.rows[0].tenant_id) !== Number(tenant.id)) {
      return NextResponse.json(
        { error: 'You cannot edit another company’s listing.' },
        { status: 403 }
      );
    }

    const data = withLegacyFields(validate(body, true));
    delete data.tenant_id;

    const keys = Object.keys(data);
    if (!keys.length && Number(existing.rows[0].tenant_id) === Number(tenant.id)) {
      return NextResponse.json({ error: 'No listing fields supplied.' }, { status: 400 });
    }

    const sets = keys.map((key, index) => key + '=$' + (index + 1));
    sets.push('tenant_id=$' + (keys.length + 1), 'updated_at=now()');

    const result = await pool.query(
      'UPDATE public.properties SET ' +
        sets.join(',') +
        ' WHERE id=$' + (keys.length + 2) +
        ' AND tenant_id=$' + (keys.length + 3) +
        ' RETURNING *',
      [...keys.map((key) => data[key]), tenant.id, id, existing.rows[0].tenant_id]
    );

    if (!result.rowCount) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }

    return NextResponse.json(
      {
        property: {
          ...result.rows[0],
          property_code: propertyCode(result.rows[0].id),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return errorResponse(error, 'Properties admin PATCH failed');
  }
}

export async function DELETE(req) {
  if (!await authorizeAdminRequest(req, 'properties.manage')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }

  try {
    const body = await readBody(req);
    const id = String(body.id ?? '').trim();
    if (!id || id.length > 100) {
      return NextResponse.json({ error: 'Valid listing ID required.' }, { status: 400 });
    }

    const pool = getDatabasePool();
    const existing = await pool.query(
      'SELECT tenant_id FROM public.properties WHERE id=$1',
      [id]
    );
    if (!existing.rowCount) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }

    const { tenant } = await targetTenant(
      pool,
      req,
      body.tenant_id ?? existing.rows[0].tenant_id
    );

    if (Number(existing.rows[0].tenant_id) !== Number(tenant.id)) {
      return NextResponse.json(
        { error: 'Listing does not belong to the selected company.' },
        { status: 404 }
      );
    }

    const result = await pool.query(
      "UPDATE public.properties SET status='archived',updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,status,tenant_id",
      [id, tenant.id]
    );
    if (!result.rowCount) {
      return NextResponse.json({ error: 'Listing not found.' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      ...result.rows[0],
      message: 'Listing archived. Its record and historical references have been preserved.',
    });
  } catch (error) {
    return errorResponse(error, 'Properties admin DELETE failed');
  }
}
