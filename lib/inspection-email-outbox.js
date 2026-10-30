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
       ON CONFLICT (inspection_request_id, recipient_type) DO UPDATE SET
         recipient_email=EXCLUDED.recipient_email,
         subject=EXCLUDED.subject,
         html_body=EXCLUDED.html_body,
         status='pending', attempts=0, last_error=NULL,
         next_attempt_at=now(), sent_at=NULL, updated_at=now()
       WHERE inspection_email_outbox.status='sent'
          OR inspection_email_outbox.subject IS DISTINCT FROM EXCLUDED.subject`,
      [item.requestId, item.type, item.to, item.subject, item.html]
    );
  }
}

export async function deliverInspectionEmails(requestId) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    const pending = await pool.query(
      `SELECT count(*)::int AS count FROM public.inspection_email_outbox
       WHERE inspection_request_id=$1 AND status IN ('pending','failed') AND next_attempt_at <= now()`,
      [requestId]
    );
    result.skipped = pending.rows[0]?.count || 0;
    return result;
  }

  // Select candidates, then claim each with a conditional update. Only one
  // concurrent worker can move a due row's retry time into the lease window.
  const candidates = await pool.query(
    `SELECT id FROM public.inspection_email_outbox
     WHERE inspection_request_id=$1 AND status IN ('pending','failed')
       AND next_attempt_at <= now()
     ORDER BY created_at ASC`,
    [requestId]
  );

  for (const candidate of candidates.rows) {
    const claimed = await pool.query(
      `UPDATE public.inspection_email_outbox
       SET next_attempt_at=now()+interval '10 minutes',
           attempts=attempts+1, updated_at=now()
       WHERE id=$1 AND status IN ('pending','failed') AND next_attempt_at <= now()
       RETURNING id,recipient_email,subject,html_body,attempts`,
      [candidate.id]
    );
    if (!claimed.rowCount) continue;
    const item = claimed.rows[0];
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
         SET status='sent', last_error=NULL, sent_at=now(), updated_at=now()
         WHERE id=$1 AND status IN ('pending','failed')`,
        [item.id]
      );
      result.sent++;
    } catch (error) {
      const attempts = Number(item.attempts || 1);
      const delayMinutes = Math.min(1440, 5 * (2 ** Math.min(attempts - 1, 8)));
      await pool.query(
        `UPDATE public.inspection_email_outbox
         SET status='failed', last_error=$2,
             next_attempt_at=now()+($3 * interval '1 minute'), updated_at=now()
         WHERE id=$1 AND status IN ('pending','failed')`,
        [item.id, String(error.message || 'Delivery failed').slice(0, 500), delayMinutes]
      );
      result.failed++;
    }
  }
  return result;
}


export async function deliverDueInspectionEmails(limit = 50) {
  const q = await pool.query(
    `SELECT DISTINCT inspection_request_id
     FROM public.inspection_email_outbox
     WHERE status IN ('pending','failed') AND next_attempt_at <= now()
     ORDER BY inspection_request_id
     LIMIT $1`,
    [Math.max(1, Math.min(100, Number(limit) || 50))]
  );
  const totals = { requests: q.rowCount, sent: 0, failed: 0, skipped: 0 };
  for (const row of q.rows) {
    const result = await deliverInspectionEmails(row.inspection_request_id);
    totals.sent += result.sent;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
  }
  return totals;
}
