import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSync } from './sync.js';
import products from './routes/products.js';
import orders from './routes/orders.js';
import admin from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
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

/* Раздаём статику фронтенда (index.html, app.js, data.js, style.css и т.д.) */
const FRONTEND_DIR = process.env.FRONTEND_DIR || path.join(__dirname, '..', '..');
app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[iva] backend on :${PORT}`);
  console.log(`[iva] serving frontend from ${FRONTEND_DIR}`);
});

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
