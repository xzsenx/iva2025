import { Router } from 'express';
import { db } from '../db.js';
import { runSync } from '../sync.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const r = Router();

/* === Загрузка фото === */
const __admin_dirname = path.dirname(new URL(import.meta.url).pathname);
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'uploads')
                          : path.join(__admin_dirname, '..', '..', 'uploads'));
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.\w]/g, '').slice(0, 6) || '.jpg';
    cb(null, crypto.randomUUID() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('only images allowed'));
  },
});

// Basic auth middleware
r.use((req, res, next) => {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) return next();
  const auth = req.headers.authorization || '';
  const [scheme, b64] = auth.split(' ');
  if (scheme !== 'Basic' || !b64) {
    res.set('WWW-Authenticate', 'Basic realm="iva-admin"');
    return res.status(401).end();
  }
  const [user, pass] = Buffer.from(b64, 'base64').toString().split(':');
  if (user !== u || pass !== p) {
    res.set('WWW-Authenticate', 'Basic realm="iva-admin"');
    return res.status(401).end();
  }
  next();
});

// Все позиции из Posiflora — для админки
r.get('/specs', (req, res) => {
  const rows = db.prepare(`SELECT * FROM posiflora_specifications`).all();
  res.json(rows);
});

r.get('/bouquets', (req, res) => {
  const status = req.query.status;
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`SELECT id, title, amount, sale_amount, true_sale_amount, markup, discount, status, on_window_at FROM posiflora_bouquets ${where} ORDER BY on_window_at DESC LIMIT 500`).all(...params);
  // Добавляем поле price = розничная цена (как в Posiflora UI)
  const out = rows.map(r => ({
    ...r,
    price: (r.true_sale_amount && r.true_sale_amount > 0)
      ? r.true_sale_amount
      : (r.sale_amount || 0) + (r.markup || 0) - (r.discount || 0),
  }));
  res.json(out);
});

r.get('/inventory', (req, res) => {
  const cat = req.query.category;
  const where = cat ? 'WHERE category_title = ?' : '';
  const params = cat ? [cat] : [];
  const rows = db.prepare(`SELECT id, title, category_title, price_min, price_max FROM posiflora_inventory ${where} ORDER BY category_title, title`).all(...params);
  res.json(rows);
});

r.get('/categories', (req, res) => {
  const rows = db.prepare(`SELECT category_title, count(*) as c FROM posiflora_inventory GROUP BY category_title ORDER BY c DESC`).all();
  res.json(rows);
});

// Сохранить overlay (фото/описание/бэдж/категория мини-аппа)
r.post('/override', (req, res) => {
  const { source, source_id, title, description, photo_url, badge, category, sort_order, popularity, hidden } = req.body || {};
  if (!source || !source_id) return res.status(400).json({ error: 'source/source_id required' });
  db.prepare(`
    INSERT INTO catalog_overrides (source, source_id, title, description, photo_url, badge, category, sort_order, popularity, hidden)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, source_id) DO UPDATE SET
      title=excluded.title, description=excluded.description, photo_url=excluded.photo_url,
      badge=excluded.badge, category=excluded.category, sort_order=excluded.sort_order,
      popularity=excluded.popularity, hidden=excluded.hidden
  `).run(source, source_id, title || null, description || null, photo_url || null,
         badge || null, category || null, sort_order || 0, popularity || 0, hidden ? 1 : 0);
  res.json({ ok: true });
});

r.get('/overrides', (req, res) => {
  const rows = db.prepare(`SELECT * FROM catalog_overrides`).all();
  res.json(rows);
});

// Загрузка фото
r.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  /* ВАЖНО: сохраняем ОТНОСИТЕЛЬНЫЙ путь.
     Так URL не сломается при смене Railway-домена / переезде / mixed http-https.
     Фронт грузится с того же origin, что и /uploads — браузер сам сложит абсолютный URL. */
  const relPath = '/uploads/' + req.file.filename;
  res.json({ url: relPath, path: relPath, filename: req.file.filename, size: req.file.size });
});

// Удалить файл с диска по имени (вызывается из админки при удалении фото)
r.delete('/upload/:filename', (req, res) => {
  const name = req.params.filename;
  // защита от path traversal — только base name
  if (!name || name.includes('/') || name.includes('..')) {
    return res.status(400).json({ error: 'bad filename' });
  }
  const filePath = path.join(UPLOAD_DIR, name);
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true, deleted: name });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ ok: true, missing: name });
    res.status(500).json({ error: e.message });
  }
});

// Диагностика — что реально лежит на диске
r.get('/uploads-debug', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const stat = fs.statSync(UPLOAD_DIR);
    res.json({
      dir: UPLOAD_DIR,
      exists: true,
      writable: !!(stat.mode & 0o200),
      files_count: files.length,
      sample: files.slice(0, 10),
    });
  } catch (e) {
    res.status(500).json({ dir: UPLOAD_DIR, error: e.message });
  }
});

// Ручной триггер синка
r.post('/sync', async (req, res) => {
  try {
    const result = await runSync();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.get('/sync/history', (req, res) => {
  const rows = db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20`).all();
  res.json(rows.map(r => ({ ...r, counts: JSON.parse(r.counts_json || '{}') })));
});

export default r;
