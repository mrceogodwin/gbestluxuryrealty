import { NextResponse } from 'next/server';
import { getDatabasePool } from '@/lib/db';

export async function POST(request) {
  try {
    const origin = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (!origin || !host || new URL(origin).host !== host) {
      return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403 });
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 4096) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
    const body = await request.json();
    const email = String(body?.email || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    const pool = getDatabasePool();
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, source, subscribed_at, updated_at)
       VALUES ($1, 'homepage', NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL, updated_at = NOW()`,
      [email]
    );
    return NextResponse.json({ ok: true, message: 'You’re subscribed. Watch your inbox for G-BEST updates.' });
  } catch (error) {
    console.error('Newsletter subscription failed:', error);
    return NextResponse.json({ error: 'Subscriptions are temporarily unavailable. Please try again later.' }, { status: 503 });
  }
}
