import { NextResponse } from 'next/server';
import {enforcePublicRateLimit} from '../../../lib/public-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
export async function POST(request) {
  try {
    const rate=await enforcePublicRateLimit(request,{scope:'client-error-report',limit:20,windowMinutes:15});
    if(!rate.allowed)return NextResponse.json({received:false,error:'Too many reports. Try again later.'},{status:429,headers:{'Retry-After':'900','Cache-Control':'no-store'}});
    if(request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({received:false,error:'Invalid request origin'},{status:403});
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ received: false, error: 'Payload too large' }, { status: 413 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ received: false, error: 'Payload too large' }, { status: 413 });
    }

    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ received: false, error: 'Invalid payload' }, { status: 400 });
    }


    const safe = {
      digest: typeof body.digest === 'string' ? body.digest.slice(0, 120) : '',
      message: typeof body.message === 'string' ? body.message.slice(0, 1000) : '',
      name: typeof body.name === 'string' ? body.name.slice(0, 120) : '',
      path: typeof body.path === 'string' ? body.path.slice(0, 300) : '',
      userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 300) : '',
      at: new Date().toISOString(),
    };
    console.error('[G-BEST CLIENT EXCEPTION]', JSON.stringify(safe));
    return NextResponse.json({ received: true }, { status: 202 });
  } catch {
    return NextResponse.json({ received: false }, { status: 400 });
  }
}
