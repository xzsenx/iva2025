import 'dotenv/config';
import express from 'express';
import compression from 'compression';
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
import analytics from './routes/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// За HTTPS-прокси Railway — без этого req.protocol = http и absolute-URL ломались
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '1mb' }));

/* Кеш-заголовки для статики:
   HTML/CSS/JS — no-cache: браузер ЕТаг-сверяется на каждый запрос
   (важно т.к. в именах нет хешей — иначе клиенты залипают на старой версии
   после деплоя до истечения TTL).
   Картинки/шрифты — 1 день (редко меняются). */
function staticCacheHeaders(res, filePath) {
  if (/\.(html|css|js)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  } else if (/\.(png|jpe?g|webp|avif|svg|ico|woff2?)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  }
}

/* Версия сборки — меняется при каждом рестарте сервера (т.е. при каждом деплое).
   Дописываем ?v=VERSION к style.css и app.js в HTML → браузер видит новый URL
   и сразу подтягивает свежий файл, минуя любой свой кеш. */
const BUILD_VERSION = String(Date.now());

/* Middleware перехватывает ответ и штампует версию на CSS/JS-ссылках */
function stampVersionMiddleware(rootDir) {
  return (req, res, next) => {
    /* Отвечаем только на / и *.html из статики */
    if (req.method !== 'GET') return next();
    const url = req.path;
    const isHtml = url === '/' || url.endsWith('/') || url.endsWith('.html') || !path.extname(url);
    if (!isHtml) return next();
    const relPath = url === '/' || url.endsWith('/') ? 'index.html'
                  : url.endsWith('.html') ? url.slice(1)
                  : url.slice(1) + '.html';
    const full = path.join(rootDir, relPath);
    fs.readFile(full, 'utf8', (err, html) => {
      if (err) return next();
      const stamped = html.replace(
        /(href|src)=["']([^"']+\.(?:css|js))(\?[^"']*)?["']/g,
        (m, attr, file, existing) => {
          if (/^https?:/.test(file)) return m;
          const sep = existing ? existing[0] === '?' ? '&' : '?' : '?';
          return `${attr}="${file}${existing || ''}${sep}v=${BUILD_VERSION}"`;
        }
      );
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(stamped);
    });
  };
}

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
app.use('/api/analytics', analytics);

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

/* Публичный сайт (iva2025/site) — корень домена */
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, '..', '..', 'site');
/* TG mini-app (iva2025 root: index.html, app.js, data.js, style.css, admin.*) — под /app */
const APP_DIR = process.env.APP_DIR || path.join(__dirname, '..', '..');

/* HTML сначала пропускаем через штамп версии, всё остальное — статика */
app.use('/app', stampVersionMiddleware(APP_DIR));
app.use('/app', express.static(APP_DIR, { extensions: ['html'], setHeaders: staticCacheHeaders }));
app.use(stampVersionMiddleware(SITE_DIR));
app.use(express.static(SITE_DIR, { extensions: ['html'], setHeaders: staticCacheHeaders }));

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[iva] backend on :${PORT}`);
  console.log(`[iva] site:    ${SITE_DIR}`);
  console.log(`[iva] miniapp: ${APP_DIR} (mounted at /app)`);
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
