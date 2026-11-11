import { NextResponse } from 'next/server';
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {getDatabasePool} from '../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
async function allowErrorReport(request){
 const secret=process.env.ADMIN_SECRET||process.env.DATABASE_URL;if(!secret)throw new Error('Error reporting throttle is not configured.');
 const raw=request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-real-ip')||'';let ip=raw.split(',')[0]?.trim()||'unknown';
 if(ip.startsWith('[')&&ip.endsWith(']'))ip=ip.slice(1,-1);if(!isIP(ip))ip='unknown';
 const key=createHmac('sha256',secret).update('client-error-ip:'+ip).digest('hex'),pool=getDatabasePool();
 await pool.query("CREATE TABLE IF NOT EXISTS public.client_error_rate_limits(attempt_key text PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,window_started_at timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz,updated_at timestamptz NOT NULL DEFAULT now())");
 const q=await pool.query("INSERT INTO public.client_error_rate_limits AS error_limit(attempt_key,attempts,window_started_at,blocked_until,updated_at) VALUES($1,1,now(),NULL,now()) ON CONFLICT(attempt_key) DO UPDATE SET attempts=CASE WHEN error_limit.window_started_at<now()-interval '15 minutes' THEN 1 ELSE error_limit.attempts+1 END,window_started_at=CASE WHEN error_limit.window_started_at<now()-interval '15 minutes' THEN now() ELSE error_limit.window_started_at END,blocked_until=CASE WHEN (CASE WHEN error_limit.window_started_at<now()-interval '15 minutes' THEN 1 ELSE error_limit.attempts+1 END)>30 THEN now()+interval '15 minutes' ELSE NULL END,updated_at=now() RETURNING blocked_until",[key]);
 return !q.rows[0]?.blocked_until;
}

export async function POST(request) {
  try {
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

    if(!await allowErrorReport(request))return NextResponse.json({received:false,error:'Too many error reports'},{status:429});

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
