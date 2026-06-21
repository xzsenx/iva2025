import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

function applyOverride(row, override) {
  if (!override) return row;
  return {
    ...row,
    title: override.title || row.title,
    description: override.description ?? row.description,
    img: override.photo_url || row.img,
    badge: override.badge || row.badge,
    category: override.category || row.category,
    popular: override.popularity ?? row.popular,
    sort_order: override.sort_order ?? row.sort_order,
    hidden: !!override.hidden,
  };
}

function getOverrides(source) {
  const rows = db.prepare('SELECT * FROM catalog_overrides WHERE source = ?').all(source);
  return new Map(rows.map(o => [o.source_id, o]));
}

// Готовые шаблоны (Specifications)
r.get('/templates', (req, res) => {
  const specs = db.prepare(`
    SELECT id, title, description, min_price, max_price
    FROM posiflora_specifications WHERE status='on'
  `).all();
  const ov = getOverrides('spec');
  const out = specs.map(s => applyOverride({
    id: `spec:${s.id}`,
    type: 'template',
    title: s.title,
    description: s.description,
    price: s.min_price || s.max_price || 0,
    category: 'bouquets',
    badge: null,
    popular: 5,
    img: null,
  }, ov.get(s.id))).filter(p => !p.hidden);
  res.json(out);
});

// Витрина — физически собранные
r.get('/showcase', (req, res) => {
  const bouquets = db.prepare(`
    SELECT id, title, sale_amount, on_window_at
    FROM posiflora_bouquets
    WHERE status='demonstrated'
    ORDER BY on_window_at DESC
  `).all();
  const ov = getOverrides('bouquet');
  const out = bouquets.map(b => applyOverride({
    id: `bouquet:${b.id}`,
    type: 'bouquet',
    title: b.title,
    price: b.sale_amount,
    stock: 1,
    category: 'showcase',
    badge: 'unique',
    popular: 8,
    img: null,
  }, ov.get(b.id))).filter(p => !p.hidden);
  res.json(out);
});

// Стебли — для конструктора (категории Цветы/Зелень/Сухоцветы)
r.get('/stems', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max
    FROM posiflora_inventory
    WHERE category_title IN ('Цветы','Зелень','Сухоцветы')
    ORDER BY category_title, title
  `).all();
  const ov = getOverrides('item');
  const out = items.map(it => applyOverride({
    id: `item:${it.id}`,
    type: 'stem',
    title: it.title,
    price: it.price_max || it.price_min || 0,
    category: it.category_title,
    img: null,
  }, ov.get(it.id))).filter(p => !p.hidden);
  res.json(out);
});

// Упаковка — коробки/кашпо, подарочные пакеты
r.get('/wraps', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max
    FROM posiflora_inventory
    WHERE category_title IN ('коробки/кашпо','Пакеты подарочные')
    ORDER BY price_max
  `).all();
  const ov = getOverrides('item');
  const out = items.map(it => applyOverride({
    id: `item:${it.id}`,
    type: 'wrap',
    title: it.title,
    price: it.price_max || it.price_min || 0,
    category: it.category_title,
    img: null,
  }, ov.get(it.id))).filter(p => !p.hidden);
  res.json(out);
});

// Ленты
r.get('/ribbons', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max
    FROM posiflora_inventory
    WHERE category_title = 'Лента' OR (title LIKE '%лент%' AND category_title != 'Цветы')
    ORDER BY price_max
  `).all();
  const ov = getOverrides('item');
  const out = items.map(it => applyOverride({
    id: `item:${it.id}`,
    type: 'ribbon',
    title: it.title,
    price: it.price_max || it.price_min || 0,
    category: it.category_title,
    img: null,
  }, ov.get(it.id))).filter(p => !p.hidden);
  res.json(out);
});

// Допы — шары, игрушки, свечи, открытки и т.д.
r.get('/addons', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max
    FROM posiflora_inventory
    WHERE category_title IN
      ('Шары','Игрушки','Свечи для торта','Цифры','Латекс','Фигуры','коробки/кашпо','Лента','Пакеты подарочные','Доп.товары','Сухоцветы')
    ORDER BY category_title, title
  `).all();
  const ov = getOverrides('item');
  const out = items.map(it => applyOverride({
    id: `item:${it.id}`,
    type: 'addon',
    title: it.title,
    price: it.price_max || it.price_min || 0,
    category: it.category_title,
    img: null,
  }, ov.get(it.id))).filter(p => !p.hidden);
  res.json(out);
});

// Единый /products — всё разом, для совместимости с фронтом
r.get('/', (req, res) => {
  res.json({
    templates: db.prepare(`SELECT count(*) as c FROM posiflora_specifications WHERE status='on'`).get().c,
    showcase: db.prepare(`SELECT count(*) as c FROM posiflora_bouquets WHERE status='demonstrated'`).get().c,
    stems: db.prepare(`SELECT count(*) as c FROM posiflora_inventory WHERE category_title IN ('Цветы','Зелень')`).get().c,
    addons: db.prepare(`SELECT count(*) as c FROM posiflora_inventory WHERE category_title NOT IN ('Цветы','Зелень')`).get().c,
    lastSync: db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`).get(),
  });
});

export default r;
