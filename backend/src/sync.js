import { posiflora } from './posiflora.js';
import { db, upsertSpec, upsertBouquet, upsertInventory, saveSyncRun } from './db.js';

export async function runSync() {
  const startedAt = new Date().toISOString();
  const counts = { specs: 0, bouquets: 0, items: 0 };
  try {
    // 1. Specifications (шаблоны букетов)
    const specs = await posiflora.specifications();
    const tx1 = db.transaction((rows) => rows.forEach(upsertSpec));
    tx1(specs.data);
    counts.specs = specs.data.length;

    // 2. Bouquets (физические собранные — берём все, фильтр на фронте)
    const bouquets = await posiflora.bouquets();
    const tx2 = db.transaction((rows) => rows.forEach(upsertBouquet));
    tx2(bouquets.data);
    counts.bouquets = bouquets.data.length;

    // 3. Inventory items (для конструктора и допов)
    const inv = await posiflora.inventoryItems();
    const catTitles = new Map(
      inv.included.filter(i => i.type === 'categories').map(c => [c.id, c.attributes?.title])
    );
    const tx3 = db.transaction((items) => {
      for (const it of items) {
        const catId = it.relationships?.category?.data?.id;
        upsertInventory(it, catTitles.get(catId) || null, null);
      }
    });
    tx3(inv.data);
    counts.items = inv.data.length;

    saveSyncRun({ startedAt, finishedAt: new Date().toISOString(), ok: true, counts });
    return { ok: true, counts };
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message;
    saveSyncRun({ startedAt, finishedAt: new Date().toISOString(), ok: false, counts, error: msg });
    throw err;
  }
}
