import { NextResponse } from 'next/server';
import { deliverDueInspectionEmails } from '@/lib/inspection-email-outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.get('authorization') || '';
  if (!secret || authorization !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }
  try {
    const result = await deliverDueInspectionEmails(50);
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('Inspection email retry cron failed', error.code || error.message);
    return NextResponse.json({ error: 'Retry batch failed' }, { status: 500 });
  }
}
