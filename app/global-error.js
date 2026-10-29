'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('G-BEST root runtime error:', error);
  }, [error]);

  return (
    <html lang="en-NG">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#f5f3eb', color: '#102d20', fontFamily: 'Arial, sans-serif' }}>
        <main style={{ width: '100%', maxWidth: 620, boxSizing: 'border-box', background: '#fff', border: '2px solid #102d20', boxShadow: '8px 8px 0 #102d20', padding: 'clamp(24px, 5vw, 48px)' }}>
          <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.16em' }}>G-BEST / RECOVERY MODE</p>
          <h1 style={{ fontSize: 'clamp(32px, 7vw, 54px)', lineHeight: 1, margin: '24px 0 16px' }}>WE HIT A<br/>TECHNICAL ISSUE.</h1>
          <p style={{ lineHeight: 1.6 }}>The website encountered an unexpected error. Try again to reload the application.</p>
          <button onClick={() => reset()} style={{ marginTop: 20, background: '#075b35', color: '#fff', border: 0, padding: '14px 20px', fontWeight: 800, cursor: 'pointer' }}>TRY AGAIN ↻</button>
          <button onClick={() => window.location.reload()} style={{ marginTop: 12, marginLeft: 10, background: '#f0cd61', color: '#102d20', border: '2px solid #102d20', padding: '12px 16px', fontWeight: 800, cursor: 'pointer' }}>RELOAD PAGE</button>
          {error?.digest && <p style={{ marginTop: 24, fontSize: 12, opacity: .7 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
