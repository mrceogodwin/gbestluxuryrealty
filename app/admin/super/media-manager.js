'use client';
import { useEffect, useRef, useState } from 'react';

export default function PropertyMediaManager({ propertyId }) {
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const input = useRef(null);
  const endpoint = '/api/admin/properties/' + encodeURIComponent(propertyId) + '/media';

  async function call(method = 'GET', body) {
    const response = await fetch(endpoint, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Media request failed.');
    return data;
  }
  async function refresh() {
    const data = await call();
    setMedia(data.media || []);
  }
  useEffect(() => {
    refresh().catch(error => setError(error.message));
  }, [propertyId, secret]);

  async function upload(files) {
    if (!files.length) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append('file', file);
        body.append('alt_text', file.name.replace(/\.[^.]+$/, ''));
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + secret },
          body,
          cache: 'no-store'
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Upload failed for ' + file.name);
        setMedia(data.media || []);
      }
      setNotice('Media uploaded successfully to Neon Object Storage.');
    } catch (error) {
      setError(error.message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function action(method, body, message) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await call(method, body);
      setMedia(data.media || []);
      setNotice(data.warning ? message + ' ' + data.warning : message);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const move = (from, to) => action('PATCH', {
    action: 'reorder',
    media_ids: media.map((item, index) => index === from ? media[to].id : index === to ? media[from].id : item.id)
  }, 'Gallery order updated.');

  return (
    <section className="property-media-manager">
      <div className="property-media-head">
        <div><strong>PROPERTY MEDIA</strong><small>{media.length}/20 · Neon Object Storage</small></div>
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'UPLOADING…' : '＋ ADD PHOTOS / VIDEO'}</button>
      </div>
      <input ref={input} hidden type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm" onChange={event => upload(event.target.files || [])} />
      <p className="property-media-help">JPG, PNG, WebP, AVIF, MP4 or WebM · 5 MB maximum per file</p>
      {error && <p className="property-media-error" role="alert">{error}</p>}
      {notice && <p className="property-media-notice" role="status">{notice}</p>}
      <div className="property-media-grid">
        {media.map((item, index) => (
          <article className="property-media-item" key={item.id}>
            <div className="property-media-preview">
              {item.media_type === 'video' ? <video src={item.url} controls preload="metadata" /> : <img src={item.url} alt={item.alt_text || 'Property image'} />}
            </div>
            <div className="property-media-meta">
              <small>{item.is_cover ? 'COVER IMAGE' : item.media_type.toUpperCase()}</small>
              <div className="property-media-actions">
                {item.media_type === 'image' && !item.is_cover && <button disabled={busy} onClick={() => action('PATCH', { action: 'cover', media_id: item.id }, 'Cover image updated.')}>SET COVER</button>}
                <button disabled={busy || index === 0} onClick={() => move(index, index - 1)}>←</button>
                <button disabled={busy || index === media.length - 1} onClick={() => move(index, index + 1)}>→</button>
                <button className="property-media-delete" disabled={busy} onClick={() => { if (window.confirm('Permanently delete this media file?')) action('DELETE', { media_id: item.id }, 'Media deleted.'); }}>DELETE</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
