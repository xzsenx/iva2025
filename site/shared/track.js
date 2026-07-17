/* Общий трекер аналитики — используется сайтом (site/*.html) и мини-апой (/app/index.html).
   Обе стороны раньше держали копии этого блока; см. site/app.js и /app.js — там теперь alias'ы.
   Публичное API: window.IvaTrack.init({source, apiBase}) и window.IvaTrack.track(event, meta). */
(() => {
  const sessionId = (() => {
    try {
      let s = localStorage.getItem('iva_sid');
      if (!s) {
        s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('iva_sid', s);
      }
      return s;
    } catch { return ''; }
  })();

  let config = { source: 'site', apiBase: '' };

  function init(opts) {
    if (opts?.source) config.source = opts.source;
    if (opts?.apiBase !== undefined) config.apiBase = opts.apiBase;
  }

  function track(event, meta) {
    try {
      const body = JSON.stringify({
        source: config.source,
        event,
        path: location.pathname + location.search,
        session_id: sessionId,
        meta: meta || undefined,
      });
      const url = (config.apiBase || '') + '/api/analytics/track';
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      }
    } catch { /* аналитика не должна ронять UI */ }
  }

  window.IvaTrack = { init, track, sessionId };
})();
