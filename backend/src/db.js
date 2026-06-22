import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'iva.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS posiflora_specifications (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    status TEXT,
    public INTEGER,
    min_price REAL,
    max_price REAL,
    raw TEXT,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS posiflora_bouquets (
    id TEXT PRIMARY KEY,
    title TEXT,
    amount REAL,
    sale_amount REAL,
    true_sale_amount REAL,
    markup REAL,
    discount REAL,
    status TEXT,
    public INTEGER,
    on_window_at TEXT,
    raw TEXT,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS posiflora_inventory (
    id TEXT PRIMARY KEY,
    title TEXT,
    category_id TEXT,
    category_title TEXT,
    item_type TEXT,
    measure_id TEXT,
    price_min REAL,
    price_max REAL,
    available REAL,
    public INTEGER,
    raw TEXT,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS posiflora_recipes (
    spec_id TEXT,
    variant_id TEXT,
    item_id TEXT,
    qty REAL,
    PRIMARY KEY (spec_id, variant_id, item_id)
  );

  -- Наш «обвес» поверх Posiflora-сущностей
  CREATE TABLE IF NOT EXISTS catalog_overrides (
    source TEXT NOT NULL,   -- 'spec' | 'bouquet' | 'item'
    source_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    photo_url TEXT,
    badge TEXT,             -- hit | new | season | null
    category TEXT,          -- bouquets | roses | compose | gifts | custom
    sort_order INTEGER DEFAULT 0,
    popularity INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    PRIMARY KEY (source, source_id)
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT,
    finished_at TEXT,
    ok INTEGER,
    counts_json TEXT,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    customer_name TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    delivery_type TEXT,
    delivery_date TEXT,
    delivery_time TEXT,
    comment TEXT,
    total_price REAL,
    items_json TEXT,
    posiflora_order_id TEXT,
    yookassa_id TEXT,
    payment_status TEXT,
    status TEXT DEFAULT 'new'
  );
`);

/* Миграции для существующих БД */
function safeAlter(sql) {
  try { db.exec(sql); } catch (e) { /* column exists */ }
}
safeAlter(`ALTER TABLE orders ADD COLUMN yookassa_id TEXT`);
safeAlter(`ALTER TABLE orders ADD COLUMN payment_status TEXT`);
safeAlter(`ALTER TABLE posiflora_bouquets ADD COLUMN true_sale_amount REAL`);
safeAlter(`ALTER TABLE posiflora_bouquets ADD COLUMN markup REAL`);
safeAlter(`ALTER TABLE posiflora_bouquets ADD COLUMN discount REAL`);

/* Нормализация photo_url: было http(s)://domain/uploads/X → стало /uploads/X */
try {
  const rows = db.prepare(`SELECT source, source_id, photo_url FROM catalog_overrides WHERE photo_url LIKE 'http%/uploads/%'`).all();
  if (rows.length) {
    const upd = db.prepare(`UPDATE catalog_overrides SET photo_url=? WHERE source=? AND source_id=?`);
    const tx = db.transaction(() => {
      for (const r of rows) {
        const m = r.photo_url.match(/\/uploads\/.+$/);
        if (m) upd.run(m[0], r.source, r.source_id);
      }
    });
    tx();
    console.log(`[iva] migrated ${rows.length} absolute photo URLs → relative paths`);
  }
} catch (e) { console.error('[iva] photo_url migration failed:', e.message); }

export function upsertSpec(s) {
  const a = s.attributes;
  db.prepare(`INSERT INTO posiflora_specifications
    (id, title, description, status, public, min_price, max_price, raw, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description, status=excluded.status,
      public=excluded.public, min_price=excluded.min_price, max_price=excluded.max_price,
      raw=excluded.raw, synced_at=datetime('now')`)
    .run(s.id, a.title, a.description, a.status, a.public ? 1 : 0,
         a.minPrice, a.maxPrice, JSON.stringify(s));
}

export function upsertBouquet(b) {
  const a = b.attributes;
  // trueSaleAmount = финальная розничная цена (saleAmount + markup - discount).
  // Если поле отсутствует у нового букета — считаем сами как фолбэк.
  const markup = num(a.markup);
  const discount = num(a.discount);
  const computedRetail = num(a.saleAmount) + markup - discount;
  const trueSale = (a.trueSaleAmount != null) ? num(a.trueSaleAmount) : computedRetail;
  db.prepare(`INSERT INTO posiflora_bouquets
    (id, title, amount, sale_amount, true_sale_amount, markup, discount, status, public, on_window_at, raw, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, amount=excluded.amount, sale_amount=excluded.sale_amount,
      true_sale_amount=excluded.true_sale_amount, markup=excluded.markup, discount=excluded.discount,
      status=excluded.status, public=excluded.public, on_window_at=excluded.on_window_at,
      raw=excluded.raw, synced_at=datetime('now')`)
    .run(b.id, a.title, a.amount, a.saleAmount, trueSale, markup, discount,
         a.status, a.public ? 1 : 0, a.onWindowAt, JSON.stringify(b));
}

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

export function upsertInventory(it, catTitle, available) {
  const a = it.attributes;
  const catId = it.relationships?.category?.data?.id ?? null;
  const measureId = it.relationships?.measure?.data?.id ?? null;
  db.prepare(`INSERT INTO posiflora_inventory
    (id, title, category_id, category_title, item_type, measure_id, price_min, price_max, available, public, raw, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, category_id=excluded.category_id, category_title=excluded.category_title,
      item_type=excluded.item_type, measure_id=excluded.measure_id,
      price_min=excluded.price_min, price_max=excluded.price_max,
      available=excluded.available, public=excluded.public,
      raw=excluded.raw, synced_at=datetime('now')`)
    .run(it.id, a.title, catId, catTitle, a.itemType, measureId,
         a.priceMin, a.priceMax, available ?? null, a.public ? 1 : 0,
         JSON.stringify(it));
}

export function saveSyncRun(runInfo) {
  db.prepare(`INSERT INTO sync_runs (started_at, finished_at, ok, counts_json, error)
    VALUES (?, ?, ?, ?, ?)`)
    .run(runInfo.startedAt, runInfo.finishedAt, runInfo.ok ? 1 : 0,
         JSON.stringify(runInfo.counts || {}), runInfo.error || null);
}
