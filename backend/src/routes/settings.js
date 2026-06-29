import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

const DEFAULTS = {
  promo: {
    emoji: '🌿',
    title: 'Букет дня',
    text: 'Нежный минимал — сегодня со скидкой',
    hidden: false,
  },
  discount: {
    enabled: false,
    percent: 0,
    label: '',
    promocodes: [],
  },
};

function readAll() {
  const rows = db.prepare(`SELECT key, value FROM app_settings`).all();
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const row of rows) {
    try {
      const v = JSON.parse(row.value);
      if (out[row.key] && typeof out[row.key] === 'object' && !Array.isArray(out[row.key])) {
        out[row.key] = { ...out[row.key], ...v };
      } else {
        out[row.key] = v;
      }
    } catch {}
  }
  return out;
}

function writeKey(key, value) {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`)
    .run(key, JSON.stringify(value));
}

r.get('/', (req, res) => {
  res.json(readAll());
});

r.put('/', (req, res) => {
  const body = req.body || {};
  if (body.promo) writeKey('promo', body.promo);
  if (body.discount) writeKey('discount', body.discount);
  res.json(readAll());
});

export default r;
