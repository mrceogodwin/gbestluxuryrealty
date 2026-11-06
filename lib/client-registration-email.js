const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function sendClientRegistrationEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL || !to) {
    return { sent: false, reason: 'Email service is not configured.' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [to], subject, html })
    });
    if (!response.ok) {
      console.error('Client registration email provider error', response.status);
      return { sent: false, reason: 'Email provider rejected the message.' };
    }
    return { sent: true };
  } catch (error) {
    console.error('Client registration email failed', error.message);
    return { sent: false, reason: 'Email delivery could not be completed.' };
  }
}

export { escapeHtml };
