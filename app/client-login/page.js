'use client';

import { useEffect, useState } from 'react';

export default function ClientLogin() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [brand, setBrand] = useState({});
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/client-auth/session', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => { if (active && data?.authenticated) { const next = new URLSearchParams(window.location.search).get('next'); window.location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/client-dashboard'); } else if (active) setCheckingSession(false); }).catch(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/homepage', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (active && data?.sections?.site_settings) setBrand(data.sections.site_settings);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const companyName = brand.siteName || 'G-BEST Luxury Realty';

  async function requestCode(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/client-auth/request-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We could not request a sign-in code.');
      setSent(true);
      setMessage(data.message || 'If this email belongs to an active client account, a sign-in code will be sent.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/client-auth/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We could not verify that code.');
      setMessage(data.message || 'Sign-in successful. Opening your client portal…');
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/client-dashboard';
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setBusy(false);
    }
  }

  function changeEmail() {
    setSent(false);
    setCode('');
    setError('');
    setMessage('');
  }

  if (checkingSession) return <main className="client-access-page"><div className="client-access-loading">Checking your secure client session…</div></main>;

  return (
    <main className="client-access-page">
      <div className="client-access-wrap">
        <a className="client-access-back" href="/" aria-label="Back to G-BEST homepage">← <span>Back to website</span></a>
        <section className="client-access-card" aria-labelledby="client-access-title">
          <aside className="client-access-story">
            <a className="client-access-brand" href="/">
              <span className="client-access-monogram">G</span>
              <span><strong>G-BEST</strong><small>LUXURY REALTY</small></span>
            </a>
            <div className="client-access-story-copy">
              <p className="client-access-kicker">YOUR PROPERTY JOURNEY, CONNECTED</p>
              <h2>Welcome to a more <em>personal</em> property experience.</h2>
              <p>One secure place to follow your enquiries, speak with our team and keep your property plans moving.</p>
            </div>
            <div className="client-access-benefits">
              <div><span className="client-access-benefit-icon">01</span><span><b>Personal client space</b><small>Your enquiries and updates, together</small></span></div>
              <div><span className="client-access-benefit-icon">02</span><span><b>Direct team communication</b><small>Private messages with our team</small></span></div>
              <div><span className="client-access-benefit-icon">03</span><span><b>Inspection coordination</b><small>Follow eligible inspection requests</small></span></div>
            </div>
            <p className="client-access-story-foot">A MORE CONSIDERED WAY TO FIND YOUR PLACE.</p>
          </aside>

          <div className="client-access-form-panel">
            <div className="client-access-mobile-brand">
              <span className="client-access-monogram">G</span>
              <span><strong>G-BEST</strong><small>LUXURY REALTY</small></span>
            </div>
            <div className="client-access-form-content">
              <div className="client-access-overline"><span /> SECURE CLIENT ACCESS</div>
              <h1 id="client-access-title">{sent ? 'Check your inbox' : 'Client sign in'}</h1>
              <p className="client-access-intro">
                {sent
                  ? 'Enter the six-digit code sent to the email address linked to your active client account.'
                  : 'Sign in to continue your property journey, view updates and message our team securely.'}
              </p>

              <form className="client-access-form" onSubmit={sent ? verifyCode : requestCode}>
                <label className="client-access-field">
                  <span>Email address</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="you@example.com"
                    disabled={sent || busy}
                  />
                </label>

                {sent && (
                  <label className="client-access-field">
                    <span>Six-digit email code</span>
                    <input
                      className="client-access-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      autoComplete="one-time-code"
                      placeholder="000000"
                      aria-label="Six-digit email code"
                    />
                    <small className="client-access-field-hint">The code expires after 10 minutes and can only be used once.</small>
                  </label>
                )}

                {error && <p className="client-access-feedback is-error" role="alert">{error}</p>}
                {message && <p className="client-access-feedback is-success" role="status">{message}</p>}

                <button className="client-access-submit" type="submit" disabled={busy || (sent && code.length !== 6)}>
                  <span>{busy ? 'PLEASE WAIT…' : sent ? 'VERIFY & OPEN MY PORTAL' : 'EMAIL ME A SIGN-IN CODE'}</span>
                  <span aria-hidden="true">→</span>
                </button>
              </form>

              {sent && (
                <button className="client-access-text-button" type="button" onClick={changeEmail} disabled={busy}>
                  Use a different email address
                </button>
              )}

              <div className="client-access-divider"><span>NEW TO G-BEST?</span></div>
              <p className="client-access-register">Create your client account <a href="/client-registration">Register here <span aria-hidden="true">↗</span></a></p>
              <p className="client-access-privacy">Your sign-in is protected. Never share your one-time code with anyone.</p>
            </div>
            <div className="client-access-form-footer"><span>{companyName}</span><span>PRIVATE CLIENT PORTAL</span></div>
          </div>
        </section>
      </div>
    </main>
  );
}
