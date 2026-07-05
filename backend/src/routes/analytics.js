import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

const VALID_EVENTS = new Set(['pageview', 'add_to_cart', 'begin_checkout', 'order_placed']);
const VALID_SOURCES = new Set(['site', 'miniapp']);

r.post('/track', (req, res) => {
  const { source, event, path, session_id, meta } = req.body || {};
  if (!VALID_SOURCES.has(source) || !VALID_EVENTS.has(event)) {
    return res.status(400).json({ error: 'bad source/event' });
  }
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim().slice(0, 64);
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  try {
    db.prepare(`
      INSERT INTO analytics_events (source, event, path, session_id, user_agent, ip, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      source,
      event,
      String(path || '').slice(0, 200),
      String(session_id || '').slice(0, 64),
      ua,
      ip,
      meta ? JSON.stringify(meta).slice(0, 2000) : null,
    );
  } catch (e) {
    console.error('[analytics] insert failed:', e.message);
  }
  res.json({ ok: true });
});

export default r;
