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
  notifications: {
    tg_enabled: true,
    tg_chat_id: '',
    tg_bot_token: '',
  },
  site: {
    hero_eyebrow: 'Белгород · с 2019',
    hero_title_1: 'Цветы, в которых',
    hero_title_2: 'живёт настроение',
    hero_text: 'Авторские букеты из премиальных цветов. Собираем с любовью, доставляем в день заказа.',
    hero_image: 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=900&q=80',
    hero_badge_price: 'от 1 800 ₽',
    hero_badge_text: 'Доставка от 30 минут',
    about_image: 'https://images.unsplash.com/photo-1563241527-3004b7be0ffd?w=900&q=80',
    about_title_1: 'Букет — это',
    about_title_2: 'маленькая история',
    about_text_1: 'ИВА — это не просто магазин цветов. Это студия, где каждый букет собирается вручную, с вниманием к настроению того, кому он предназначен.',
    about_text_2: 'Работаем с премиальными поставщиками, отбираем цветы по утрам, собираем композиции в день доставки.',
  },
  contacts: {
    florist_phone: '+7 (930) 089-09-89',
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

/* Публичный GET не должен светить токен бота */
r.get('/', (req, res) => {
  const s = readAll();
  if (s.notifications) {
    s.notifications = { ...s.notifications, tg_bot_token: s.notifications.tg_bot_token ? '***' : '' };
  }
  res.json(s);
});

r.put('/', (req, res) => {
  const body = req.body || {};
  if (body.promo) writeKey('promo', body.promo);
  if (body.discount) writeKey('discount', body.discount);
  if (body.site) writeKey('site', body.site);
  if (body.contacts) writeKey('contacts', body.contacts);
  if (body.notifications) {
    /* токен === '***' значит фронт прислал маску — оставляем старый */
    const cur = (() => {
      try { return JSON.parse(db.prepare(`SELECT value FROM app_settings WHERE key='notifications'`).get()?.value || '{}'); }
      catch { return {}; }
    })();
    const next = { ...body.notifications };
    if (next.tg_bot_token === '***' || next.tg_bot_token === undefined) {
      next.tg_bot_token = cur.tg_bot_token || '';
    }
    writeKey('notifications', next);
  }
  const out = readAll();
  if (out.notifications) {
    out.notifications = { ...out.notifications, tg_bot_token: out.notifications.tg_bot_token ? '***' : '' };
  }
  res.json(out);
});

export default r;
