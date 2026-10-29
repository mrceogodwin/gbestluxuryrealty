'use client';

import { useEffect } from 'react';

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error('G-BEST page runtime error:', error);
  }, [error]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px 20px', background: '#f5f3eb', color: '#102d20', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: '100%', maxWidth: 620, background: '#fff', border: '2px solid #102d20', boxShadow: '8px 8px 0 #102d20', padding: 'clamp(24px, 5vw, 48px)' }}>
        <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.16em' }}>G-BEST / RECOVERY MODE</p>
        <h1 style={{ fontSize: 'clamp(32px, 7vw, 54px)', lineHeight: 1, margin: '24px 0 16px' }}>WE HIT A<br/>TECHNICAL ISSUE.</h1>
        <p style={{ lineHeight: 1.6 }}>The page encountered an unexpected error. Your request has not been submitted. Try loading the page again.</p>
        <button onClick={() => reset()} style={{ marginTop: 20, background: '#075b35', color: '#fff', border: 0, padding: '14px 20px', fontWeight: 800, cursor: 'pointer' }}>TRY AGAIN ↻</button>
        <button onClick={() => window.location.reload()} style={{ marginTop: 20, marginLeft: 10, background: '#f0cd61', color: '#102d20', border: '2px solid #102d20', padding: '12px 16px', fontWeight: 800, cursor: 'pointer' }}>RELOAD PAGE</button>
        {error?.digest && <p style={{ marginTop: 24, fontSize: 12, opacity: .7 }}>Reference: {error.digest}</p>}
      </section>
    </main>
  );
}
