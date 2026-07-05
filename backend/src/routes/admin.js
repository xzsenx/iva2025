import { Router } from 'express';
import { db } from '../db.js';
import { runSync } from '../sync.js';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { generateBouquetNames } from '../services/nameGen.js';

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
    // Макс. кол-во букетов = min(stock / qty) по всем компонентам с известным остатком.
    // Если у всех остаток NULL — оставляем null (покажем "В НАЛИЧИИ"). Если у кого-то 0 — 0.
    let maxBouquets = null;
    if (items.length > 0 && missing.length === 0) {
      const known = items.filter(i => i.stock != null);
      if (known.length > 0) {
        // Есть хотя бы один известный остаток → берём min по известным
        const perItem = known.map(i => Math.floor((+i.stock) / (+i.qty || 1)));
        maxBouquets = Math.max(0, Math.min(...perItem));
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

/* Клиенты — агрегация из orders по телефону */
r.get('/customers', (req, res) => {
  const rows = db.prepare(`
    SELECT
      customer_phone,
      MAX(customer_name) AS name,
      COUNT(*) AS orders_count,
      SUM(CASE WHEN payment_status='succeeded' OR status='paid' THEN total_price ELSE 0 END) AS revenue,
      MIN(created_at) AS first_order_at,
      MAX(created_at) AS last_order_at,
      MAX(delivery_type) AS last_delivery_type,
      MAX(customer_address) AS last_address
    FROM orders
    WHERE customer_phone IS NOT NULL AND customer_phone != ''
    GROUP BY customer_phone
    ORDER BY revenue DESC, orders_count DESC
    LIMIT 500
  `).all();
  res.json(rows);
});

/* Заказы клиента */
r.get('/customers/:phone/orders', (req, res) => {
  const phone = req.params.phone;
  const rows = db.prepare(`
    SELECT * FROM orders WHERE customer_phone = ? ORDER BY id DESC
  `).all(phone);
  res.json(rows.map(o => ({ ...o, items: JSON.parse(o.items_json || '[]') })));
});

/* Отмена заказа */
r.post('/orders/:id/cancel', async (req, res) => {
  const id = +req.params.id;
  const reason = String(req.body?.reason || '').slice(0, 500);
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(id);
  if (!order) return res.status(404).json({ error: 'not found' });
  db.prepare(`
    UPDATE orders
    SET status='cancelled', cancelled_at=datetime('now'), cancel_reason=?
    WHERE id=?
  `).run(reason, id);
  /* TODO: тут можно дёрнуть ЮKassa refund если payment_status=succeeded — пока просто помечаем */
  res.json({ ok: true });
});

/* Аналитика — цифры для дашборда */
r.get('/analytics', (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const start7d = new Date(now.getTime() - 7 * 86400000).toISOString();

  const paidFilter = `payment_status IN ('succeeded','waiting_for_capture') OR status='paid'`;

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS orders_total,
      SUM(total_price) AS revenue_total
    FROM orders WHERE ${paidFilter}
  `).get();

  const month = db.prepare(`
    SELECT COUNT(*) AS orders, SUM(total_price) AS revenue
    FROM orders WHERE (${paidFilter}) AND created_at >= ?
  `).get(startOfMonth);

  const today = db.prepare(`
    SELECT COUNT(*) AS orders, SUM(total_price) AS revenue
    FROM orders WHERE (${paidFilter}) AND created_at >= ?
  `).get(startOfDay);

  /* Выручка по дням за 7 дней */
  const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day,
           COUNT(*) AS orders,
           SUM(total_price) AS revenue
    FROM orders
    WHERE (${paidFilter}) AND created_at >= ?
    GROUP BY day ORDER BY day
  `).all(start7d);

  /* Топ товаров из items_json */
  const orders = db.prepare(`
    SELECT items_json FROM orders WHERE (${paidFilter}) AND created_at >= ?
  `).all(startOfMonth);
  const productCount = new Map();
  for (const o of orders) {
    let items = [];
    try { items = JSON.parse(o.items_json || '[]'); } catch {}
    for (const it of items) {
      const name = it.name || it.title || 'Без названия';
      productCount.set(name, (productCount.get(name) || 0) + (it.qty || 1));
    }
  }
  const topProducts = [...productCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, qty]) => ({ name, qty }));

  /* Трафик site/miniapp (за 7 дней) */
  const traffic = {};
  for (const src of ['site', 'miniapp']) {
    const views = db.prepare(`
      SELECT COUNT(*) AS c FROM analytics_events
      WHERE source=? AND event='pageview' AND ts >= ?
    `).get(src, start7d).c;
    const unique = db.prepare(`
      SELECT COUNT(DISTINCT session_id) AS c FROM analytics_events
      WHERE source=? AND event='pageview' AND ts >= ? AND session_id != ''
    `).get(src, start7d).c;
    const carts = db.prepare(`
      SELECT COUNT(*) AS c FROM analytics_events
      WHERE source=? AND event='add_to_cart' AND ts >= ?
    `).get(src, start7d).c;
    const checkouts = db.prepare(`
      SELECT COUNT(*) AS c FROM analytics_events
      WHERE source=? AND event='begin_checkout' AND ts >= ?
    `).get(src, start7d).c;
    const orders = db.prepare(`
      SELECT COUNT(*) AS c FROM analytics_events
      WHERE source=? AND event='order_placed' AND ts >= ?
    `).get(src, start7d).c;
    const topPages = db.prepare(`
      SELECT path, COUNT(*) AS views FROM analytics_events
      WHERE source=? AND event='pageview' AND ts >= ?
      GROUP BY path ORDER BY views DESC LIMIT 8
    `).all(src, start7d);
    traffic[src] = { views, unique, carts, checkouts, orders, top_pages: topPages };
  }

  /* Черновики (unpublished drafts) — сколько ждут ручного оформления */
  const draftsSpec = db.prepare(`
    SELECT COUNT(*) AS c FROM catalog_overrides
    WHERE source='spec' AND hidden=1 AND (title IS NULL OR title='') AND (photo_url IS NULL OR photo_url='')
  `).get().c;
  const draftsBouquet = db.prepare(`
    SELECT COUNT(*) AS c FROM catalog_overrides
    WHERE source='bouquet' AND hidden=1 AND (title IS NULL OR title='') AND (photo_url IS NULL OR photo_url='')
  `).get().c;

  res.json({
    totals: {
      orders: totals.orders_total || 0,
      revenue: totals.revenue_total || 0,
    },
    month: { orders: month.orders || 0, revenue: month.revenue || 0 },
    today: { orders: today.orders || 0, revenue: today.revenue || 0 },
    by_day: byDay.map(d => ({ ...d, revenue: Number(d.revenue) || 0 })),
    top_products: topProducts,
    drafts: { specs: draftsSpec, bouquets: draftsBouquet },
    traffic,
  });
});

r.get('/sync/history', (req, res) => {
  const rows = db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 20`).all();
  res.json(rows.map(r => ({
    ...r,
    counts: JSON.parse(r.counts_json || '{}'),
    diff: r.diff_json ? JSON.parse(r.diff_json) : null,
  })));
});

/* Последнее непрочитанное событие синхронизации (для плашки в админке) */
r.get('/sync/unread', (req, res) => {
  const row = db.prepare(`
    SELECT id, finished_at, diff_json
    FROM sync_runs
    WHERE ok=1 AND diff_json IS NOT NULL AND acknowledged_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get();
  if (!row) return res.json({ unread: null });
  const diff = JSON.parse(row.diff_json);
  const hasChanges = (diff.specs_added?.length || 0) + (diff.specs_removed?.length || 0)
                  + (diff.bouquets_added?.length || 0) + (diff.bouquets_removed?.length || 0);
  if (!hasChanges) return res.json({ unread: null });
  res.json({ unread: { id: row.id, finished_at: row.finished_at, diff } });
});

r.post('/sync/:id/ack', (req, res) => {
  db.prepare(`UPDATE sync_runs SET acknowledged_at = datetime('now') WHERE id = ?`).run(+req.params.id);
  res.json({ ok: true });
});

/* Генератор названий через DeepSeek.
   Принимает либо items: [{title, qty}], либо source/sourceId/id для подтягивания состава из БД. */
r.post('/generate-name', async (req, res) => {
  try {
    let items = req.body?.items;
    if (!Array.isArray(items) || !items.length) {
      const { source, sourceId } = req.body || {};
      if (source === 'spec' && sourceId) {
        const rows = db.prepare(`
          SELECT i.title, r.qty FROM posiflora_recipes r
          JOIN posiflora_inventory i ON i.id = r.item_id
          WHERE r.spec_id = ?`).all(sourceId);
        items = rows.map(x => ({ title: x.title, qty: x.qty }));
      } else if (source === 'ctmpl' && sourceId) {
        const rows = db.prepare(`
          SELECT i.title, ci.qty FROM custom_template_items ci
          JOIN posiflora_inventory i ON i.id = ci.item_id
          WHERE ci.template_id = ?`).all(sourceId);
        items = rows.map(x => ({ title: x.title, qty: x.qty }));
      }
    }
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'empty composition' });
    }
    const names = await generateBouquetNames(items);
    res.json({ names });
  } catch (e) {
    console.error('[gen-name]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default r;
