import { Pool } from 'pg';

const pool = globalThis.__gbestPool || (globalThis.__gbestPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  ssl: { rejectUnauthorized: true }
}));

export async function queueInspectionEmails(messages) {
  for (const item of messages) {
    if (!item.to) continue;
    await pool.query(
      `INSERT INTO public.inspection_email_outbox
       (inspection_request_id, recipient_type, recipient_email, subject, html_body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (inspection_request_id, recipient_type) DO NOTHING`,
      [item.requestId, item.type, item.to, item.subject, item.html]
    );
  }
}

export async function deliverInspectionEmails(requestId) {
  const q = await pool.query(
    `SELECT id, recipient_email, subject, html_body, attempts
     FROM public.inspection_email_outbox
     WHERE inspection_request_id=$1 AND status IN ('pending','failed')
       AND next_attempt_at <= now()
     ORDER BY created_at ASC`,
    [requestId]
  );
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const item of q.rows) {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
      result.skipped++;
      continue;
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL,
          to: [item.recipient_email],
          subject: item.subject,
          html: item.html_body
        })
      });
      if (!response.ok) throw new Error('Email provider rejected the message (' + response.status + ')');
      await pool.query(
        `UPDATE public.inspection_email_outbox
         SET status='sent', attempts=attempts+1, last_error=NULL,
             sent_at=now(), updated_at=now()
         WHERE id=$1`,
        [item.id]
      );
      result.sent++;
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      const delayMinutes = Math.min(1440, 5 * (2 ** Math.min(attempts - 1, 8)));
      await pool.query(
        `UPDATE public.inspection_email_outbox
         SET status='failed', attempts=$2, last_error=$3,
             next_attempt_at=now()+($4 * interval '1 minute'), updated_at=now()
         WHERE id=$1`,
        [item.id, attempts, String(error.message || 'Delivery failed').slice(0, 500), delayMinutes]
      );
      result.failed++;
    }
  }
  return result;
}
