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

// Готовые шаблоны (Specifications) — показываем только если все компоненты в наличии
r.get('/templates', (req, res) => {
  const specs = db.prepare(`
    SELECT id, title, description, min_price, max_price
    FROM posiflora_specifications WHERE status='on'
  `).all();

  // Карта остатков: id позиции → available qty
  const invStock = new Map(
    db.prepare(`SELECT id, available FROM posiflora_inventory`).all()
      .map(r => [r.id, Number(r.available) || 0])
  );

  // Рецепты по spec, сгруппировано по variant: [{item_id, qty}]
  const recipes = db.prepare(`SELECT spec_id, variant_id, item_id, qty FROM posiflora_recipes`).all();
  const specVariants = new Map(); // spec_id → Map<variant_id, {item_id, qty}[]>
  for (const r of recipes) {
    if (!specVariants.has(r.spec_id)) specVariants.set(r.spec_id, new Map());
    const v = specVariants.get(r.spec_id);
    if (!v.has(r.variant_id)) v.set(r.variant_id, []);
    v.get(r.variant_id).push({ item_id: r.item_id, qty: Number(r.qty) || 1 });
  }

  // Сколько таких можно собрать из остатков? Берём max по вариантам.
  // Если рецепта нет — null (неизвестно).
  function maxCountForSpec(specId) {
    const variants = specVariants.get(specId);
    if (!variants || variants.size === 0) return null;
    let best = 0;
    for (const items of variants.values()) {
      let canBuild = Infinity;
      for (const { item_id, qty } of items) {
        const have = invStock.get(item_id) || 0;
        canBuild = Math.min(canBuild, Math.floor(have / qty));
      }
      if (canBuild === Infinity) canBuild = 0;
      if (canBuild > best) best = canBuild;
    }
    return best;
  }

  const ov = getOverrides('spec');
  const out = specs
    .map(s => {
      const max = maxCountForSpec(s.id);
      return { spec: s, max_count: max };
    })
    // если рецепт известен и max=0 — скрываем; если рецепта нет — показываем
    .filter(x => x.max_count === null || x.max_count > 0)
    .map(({ spec: s, max_count }) => applyOverride({
      id: `spec:${s.id}`,
      type: 'template',
      title: s.title,
      description: s.description,
      price: s.min_price || s.max_price || 0,
      category: 'bouquets',
      badge: null,
      popular: 5,
      img: null,
      max_count,
    }, ov.get(s.id))).filter(p => !p.hidden);
  res.json(out);
});

// Витрина — физически собранные
r.get('/showcase', (req, res) => {
  const bouquets = db.prepare(`
    SELECT id, title, sale_amount, true_sale_amount, markup, discount, on_window_at
    FROM posiflora_bouquets
    WHERE status='demonstrated'
    ORDER BY on_window_at DESC
  `).all();
  const ov = getOverrides('bouquet');
  const out = bouquets.map(b => {
    // Розничная = trueSaleAmount (то что показано в Posiflora UI).
    // Фолбэк для записей до миграции — sale_amount + markup - discount.
    const retail = (b.true_sale_amount != null && b.true_sale_amount > 0)
      ? b.true_sale_amount
      : (b.sale_amount || 0) + (b.markup || 0) - (b.discount || 0);
    return applyOverride({
      id: `bouquet:${b.id}`,
      type: 'bouquet',
      title: b.title,
      price: retail,
      stock: 1,
      category: 'showcase',
      badge: 'unique',
      popular: 8,
      img: null,
    }, ov.get(b.id));
  }).filter(p => !p.hidden);
  res.json(out);
});

// Стебли — для конструктора (категории Цветы/Зелень/Сухоцветы)
r.get('/stems', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max, available
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
    /* Сколько штук на складе — фронт лимитит + в UI показывает */
    stock: it.available == null ? null : Math.floor(Number(it.available)),
  }, ov.get(it.id)))
    /* Скрытые вручную + автоархив: пропали со склада → не показываем публично.
       Оверрайд (фото, название) не удаляется — вернётся сам когда придёт поставка. */
    .filter(p => !p.hidden && !(typeof p.stock === 'number' && p.stock <= 0));
  res.json(out);
});

// Упаковка — коробки/кашпо, подарочные пакеты
r.get('/wraps', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max, available
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
    stock: it.available == null ? null : Math.floor(Number(it.available)),
  }, ov.get(it.id)))
    .filter(p => !p.hidden && !(typeof p.stock === 'number' && p.stock <= 0));
  res.json(out);
});

// Ленты
r.get('/ribbons', (req, res) => {
  const items = db.prepare(`
    SELECT id, title, category_title, price_min, price_max, available
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
    stock: it.available == null ? null : Math.floor(Number(it.available)),
  }, ov.get(it.id)))
    .filter(p => !p.hidden && !(typeof p.stock === 'number' && p.stock <= 0));
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

// Наши шаблоны (созданные в админке) — max_count = min(остаток/qty)
r.get('/custom-templates', (req, res) => {
  const tmpls = db.prepare(`SELECT * FROM custom_templates WHERE hidden=0 AND COALESCE(archived,0)=0`).all();
  if (!tmpls.length) return res.json([]);
  const items = db.prepare(`SELECT template_id, item_id, qty FROM custom_template_items`).all();
  const byTmpl = new Map();
  for (const it of items) {
    if (!byTmpl.has(it.template_id)) byTmpl.set(it.template_id, []);
    byTmpl.get(it.template_id).push({ item_id: it.item_id, qty: Number(it.qty) || 1 });
  }
  const invStock = new Map(
    db.prepare(`SELECT id, available FROM posiflora_inventory`).all()
      .map(r => [r.id, Number(r.available) || 0])
  );
  const out = tmpls
    .map(t => {
      const list = byTmpl.get(t.id) || [];
      if (!list.length) return { tmpl: t, max_count: 0 };
      let max = Infinity;
      for (const { item_id, qty } of list) {
        const have = invStock.get(item_id) || 0;
        max = Math.min(max, Math.floor(have / qty));
      }
      if (max === Infinity) max = 0;
      return { tmpl: t, max_count: max };
    })
    .filter(x => x.max_count > 0)
    .map(({ tmpl: t, max_count }) => ({
      id: `ctmpl:${t.id}`,
      type: 'template',
      title: t.title,
      description: t.description,
      price: t.price,
      category: 'bouquets',
      badge: t.badge,
      popular: 7,
      img: t.photo_url || null,
      max_count,
    }));
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
