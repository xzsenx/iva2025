import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSync } from './sync.js';
import products from './routes/products.js';
import orders from './routes/orders.js';
import admin from './routes/admin.js';
import settings from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// За HTTPS-прокси Railway — без этого req.protocol = http и absolute-URL ломались
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

const origins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: origins.includes('*') ? true : origins,
  credentials: true,
}));

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/products', products);
app.use('/api/orders', orders);
app.use('/api/admin', admin);
app.use('/api/app-settings', settings);

/* Загруженные фото (живут на persistent-волюме рядом с БД) */
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'uploads')
                          : path.join(__dirname, '..', 'uploads'));
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
// Проверка что директория реально на persistent volume — если нет, орём в лог
const isOnVolume = UPLOAD_DIR.startsWith('/data') || !!process.env.UPLOAD_DIR;
if (!isOnVolume && process.env.NODE_ENV === 'production') {
  console.error(`[iva] !!! UPLOAD_DIR=${UPLOAD_DIR} НЕ на persistent volume — фото пропадут при деплое.`);
  console.error(`[iva] !!! Подключи Railway volume на /data и поставь DB_PATH=/data/iva.db (uploads сам туда сядет).`);
}
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '30d',
  immutable: true,  // UUID-имена → файлы content-addressed, можно агрессивно кешить
  fallthrough: false,
}));

/* Раздаём статику фронтенда (index.html, app.js, data.js, style.css и т.д.) */
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', '..');
app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[iva] backend on :${PORT}`);
  console.log(`[iva] serving frontend from ${FRONTEND_DIR}`);
});

/* Graceful shutdown — Railway шлёт SIGTERM при swap'е деплоев.
   Без обработчика npm пишет "command failed" и пугает в логах. */
function shutdown(signal) {
  console.log(`[iva] received ${signal}, closing gracefully...`);
  server.close(() => {
    console.log('[iva] http closed, bye');
    process.exit(0);
  });
  // Если за 10с не закрылось — форсим
  setTimeout(() => {
    console.log('[iva] force exit after 10s');
    process.exit(0);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Sync на старте (если БД пустая) + крон каждый час
const lastSync = (await import('./db.js')).db
  .prepare(`SELECT id FROM sync_runs WHERE ok=1 ORDER BY id DESC LIMIT 1`).get();
if (!lastSync) {
  console.log('[iva] initial sync...');
  runSync().then(r => console.log('[iva] initial sync done', r.counts))
           .catch(e => console.error('[iva] initial sync failed', e.message));
}

cron.schedule('0 * * * *', () => {
  console.log('[iva] hourly sync...');
  runSync().then(r => console.log('[iva] sync done', r.counts))
           .catch(e => console.error('[iva] sync failed', e.message));
});
