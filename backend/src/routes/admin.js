import { Router } from 'express';
import { db } from '../db.js';
import { runSync } from '../sync.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import heicConvert from 'heic-convert';

const r = Router();

/* === Загрузка фото === */
const __admin_dirname = path.dirname(new URL(import.meta.url).pathname);
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'uploads')
                          : path.join(__admin_dirname, '..', '..', 'uploads'));
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

// Держим файл в памяти — будем конвертить HEIC и ресайзить большие
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB сырьё (iPhone HEIC бывают жирные)
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype) || /\.(heic|heif)$/i.test(file.originalname);
    cb(ok ? null : new Error('only images allowed'), ok);
  },
});

async function processImage(buf, originalName) {
  const ext = (path.extname(originalName) || '').toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';
  let input = buf;
  // HEIC → JPEG (Chrome/Firefox/TG не умеют heic)
  if (isHeic) {
    try {
      const jpeg = await heicConvert({ buffer: buf, format: 'JPEG', quality: 0.9 });
      input = Buffer.from(jpeg);
    } catch (e) {
      throw new Error('HEIC conversion failed: ' + e.message);
    }
  }
  // Ресайз/сжатие через sharp — макс 1600px по большей стороне, JPEG q85
  const out = await sharp(input)
    .rotate()  // учесть EXIF orientation
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return out;
}

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

// Все позиции из Posiflora — для админки. Добавляем флаг availability + список не хватающих компонентов.
r.get('/specs', (req, res) => {
  const rows = db.prepare(`SELECT * FROM posiflora_specifications`).all();
  const invMap = new Map(db.prepare(`SELECT id, title FROM posiflora_inventory`).all().map(r => [r.id, r.title]));
  const recipes = db.prepare(`SELECT spec_id, variant_id, item_id FROM posiflora_recipes`).all();
  const specVariants = new Map();
  for (const rec of recipes) {
    if (!specVariants.has(rec.spec_id)) specVariants.set(rec.spec_id, new Map());
    const v = specVariants.get(rec.spec_id);
    if (!v.has(rec.variant_id)) v.set(rec.variant_id, []);
    v.get(rec.variant_id).push(rec.item_id);
  }
  const out = rows.map(s => {
    const variants = specVariants.get(s.id);
    if (!variants || !variants.size) {
      return { ...s, available: true, missing: null, has_recipe: false };
    }
    let available = false;
    let bestMissing = null;
    for (const items of variants.values()) {
      const missing = items.filter(id => !invMap.has(id));
      if (missing.length === 0) { available = true; bestMissing = []; break; }
      if (!bestMissing || missing.length < bestMissing.length) bestMissing = missing;
    }
    return {
      ...s,
      available,
      has_recipe: true,
      missing: available ? null : bestMissing.map(id => ({ id })),
    };
  });
  res.json(out);
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
  const rows = db.prepare(`SELECT id, title, category_title, price_min, price_max, available FROM posiflora_inventory ${where} ORDER BY category_title, title`).all(...params);
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

// Загрузка фото — конвертим HEIC, ресайзим, сохраняем как .jpg
r.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try {
    const processed = await processImage(req.file.buffer, req.file.originalname);
    const filename = crypto.randomUUID() + '.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), processed);
    const relPath = '/uploads/' + filename;
    res.json({
      url: relPath, path: relPath, filename,
      size: processed.length,
      original_size: req.file.size,
      original_type: req.file.mimetype,
    });
  } catch (e) {
    console.error('[iva] upload failed:', e.message);
    res.status(500).json({ error: e.message });
  }
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

// Диагностика — пробуем разные endpoints Posiflora чтобы найти балансы
r.get('/posiflora-debug-balances', async (req, res) => {
  const { posiflora } = await import('../posiflora.js');
  // Doc подсказал: Inventory-Items-API/operation/createAction
  // Actions — это операции (приход/расход/инвентаризация). Может через них узнаём остатки.
  const ITEM = '00264bd4-f74f-4f48-a546-fe78652eb5e0';
  const tries = [
    // Inventory item с include всех связей
    `/v1/inventory-items?filter[id]=${ITEM}&include=group,category,measure,logo,markdowns`,
    // Группы — может содержат summary с qty
    `/v1/inventory-groups`,
    `/v1/inventory-groups/1`,
    `/v1/inventory-groups/1/inventory-items`,
    `/v1/inventory-groups/1?include=inventoryItems`,
    // Маркдауны (скидки/уценки) — могут содержать кол-во
    `/v1/markdowns`,
    `/v1/inventory-markdowns`,
    // Меры
    `/v1/measures`,
    // Set Inventory Item Price существует — может Stock тоже
    `/v1/inventory-item-stocks`,
    `/v1/inventory-item-quantities`,
    `/v1/inventory-item-qty`,
    `/v1/qty`,
  ];
  const results = {};
  for (const path of tries) {
    try {
      // прямой call через posiflora.js — нужен внутренний доступ
      const axios = (await import('axios')).default;
      const tok = await (async () => {
        const r = await axios.post(process.env.POSIFLORA_BASE_URL + '/v1/sessions', {
          data: { type: 'sessions', attributes: { username: process.env.POSIFLORA_USERNAME, password: process.env.POSIFLORA_PASSWORD } },
        }, { headers: { 'Content-Type': 'application/vnd.api+json', Accept: 'application/vnd.api+json' }, timeout: 60000 });
        return r.data.data.attributes.accessToken;
      })();
      const r = await axios.get(process.env.POSIFLORA_BASE_URL + path, {
        params: { 'page[size]': 2 },
        headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.api+json' },
        timeout: 30000,
      });
      const d = r.data.data;
      results[path] = Array.isArray(d)
        ? { ok: true, count: d.length, sample: d[0] || null }
        : { ok: true, single: d, included: r.data.included };
    } catch (e) {
      results[path] = { ok: false, status: e.response?.status, msg: e.message.slice(0, 100) };
    }
  }
  res.json(results);
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

/* ============================================================
   НАШИ шаблоны букетов (создаются в админке)
   ============================================================ */

// Список — с availability + missing[]. По умолчанию активные, ?archived=1 → архив.
r.get('/custom-templates', (req, res) => {
  const archived = req.query.archived === '1' ? 1 : 0;
  const tmpls = db.prepare(`SELECT * FROM custom_templates WHERE COALESCE(archived,0)=? ORDER BY sort_order, created_at DESC`).all(archived);
  const itemsByTmpl = new Map();
  const allRows = db.prepare(`SELECT ct.template_id, ct.item_id, ct.qty,
                                     pi.title as item_title, pi.category_title, pi.price_max, pi.available as stock
                              FROM custom_template_items ct
                              LEFT JOIN posiflora_inventory pi ON pi.id = ct.item_id`).all();
  for (const r of allRows) {
    if (!itemsByTmpl.has(r.template_id)) itemsByTmpl.set(r.template_id, []);
    itemsByTmpl.get(r.template_id).push(r);
  }
  const invIds = new Set(db.prepare('SELECT id FROM posiflora_inventory').all().map(r => r.id));
  const out = tmpls.map(t => {
    const items = itemsByTmpl.get(t.id) || [];
    const missing = items.filter(i => !invIds.has(i.item_id));
    // Макс. кол-во букетов = min(stock / qty) по всем компонентам.
    // Если у хотя бы одного компонента qty не известно (stock NULL) — возвращаем null.
    let maxBouquets = null;
    if (items.length > 0 && missing.length === 0) {
      const haveAllStocks = items.every(i => i.stock != null && +i.stock > 0);
      if (haveAllStocks) {
        maxBouquets = Math.min(...items.map(i => Math.floor((+i.stock) / (+i.qty || 1))));
      }
    }
    return {
      ...t,
      items: items.map(i => ({
        item_id: i.item_id,
        qty: i.qty,
        title: i.item_title || '(удалено из Posiflora)',
        category: i.category_title,
        price_max: i.price_max,
        stock: i.stock,
        available: invIds.has(i.item_id),
      })),
      available: items.length > 0 && missing.length === 0,
      missing_count: missing.length,
      max_bouquets: maxBouquets,
    };
  });
  res.json(out);
});

// Создать / обновить
r.post('/custom-templates', (req, res) => {
  const { id, title, description, photo_url, price, badge, hidden, sort_order, items } = req.body || {};
  if (!title || !Array.isArray(items)) return res.status(400).json({ error: 'title and items[] required' });
  const tx = db.transaction(() => {
    let tId = id;
    if (tId) {
      db.prepare(`UPDATE custom_templates SET
        title=?, description=?, photo_url=?, price=?, badge=?, hidden=?, sort_order=?, updated_at=datetime('now')
        WHERE id=?`).run(
        title, description || null, photo_url || null, +price || 0, badge || null,
        hidden ? 1 : 0, +sort_order || 0, tId,
      );
    } else {
      const info = db.prepare(`INSERT INTO custom_templates
        (title, description, photo_url, price, badge, hidden, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        title, description || null, photo_url || null, +price || 0, badge || null,
        hidden ? 1 : 0, +sort_order || 0,
      );
      tId = info.lastInsertRowid;
    }
    db.prepare(`DELETE FROM custom_template_items WHERE template_id=?`).run(tId);
    const ins = db.prepare(`INSERT INTO custom_template_items (template_id, item_id, qty) VALUES (?, ?, ?)`);
    for (const it of items) {
      if (it.item_id && +it.qty > 0) ins.run(tId, it.item_id, +it.qty);
    }
    return tId;
  });
  const newId = tx();
  res.json({ ok: true, id: newId });
});

// Архивировать (мягкое удаление)
r.post('/custom-templates/:id/archive', (req, res) => {
  const id = +req.params.id;
  db.prepare(`UPDATE custom_templates SET archived=1, archived_at=datetime('now') WHERE id=?`).run(id);
  res.json({ ok: true });
});

// Восстановить из архива
r.post('/custom-templates/:id/restore', (req, res) => {
  const id = +req.params.id;
  db.prepare(`UPDATE custom_templates SET archived=0, archived_at=NULL WHERE id=?`).run(id);
  res.json({ ok: true });
});

// Удалить навсегда (только из архива)
r.delete('/custom-templates/:id', (req, res) => {
  const id = +req.params.id;
  db.prepare('DELETE FROM custom_template_items WHERE template_id=?').run(id);
  db.prepare('DELETE FROM custom_templates WHERE id=?').run(id);
  res.json({ ok: true });
});

// Поиск по inventory для пикера в админке
r.get('/inventory-search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const cat = req.query.category;
  let sql = `SELECT id, title, category_title, price_max FROM posiflora_inventory WHERE 1=1`;
  const params = [];
  if (q) { sql += ` AND lower(title) LIKE ?`; params.push('%' + q + '%'); }
  if (cat) { sql += ` AND category_title = ?`; params.push(cat); }
  sql += ` ORDER BY category_title, title LIMIT 50`;
  res.json(db.prepare(sql).all(...params));
});

r.get('/sync/history', (req, res) => {
  const rows = db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20`).all();
  res.json(rows.map(r => ({ ...r, counts: JSON.parse(r.counts_json || '{}') })));
});

export default r;
