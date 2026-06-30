import { posiflora } from './posiflora.js';
import { db, upsertSpec, upsertBouquet, upsertInventory, replaceAllRecipes, saveSyncRun } from './db.js';
import { notifySyncDiff } from './services/tgNotify.js';

/* Помечаем новую позицию как hidden=1 (черновик) — чтобы она не попала на витрину
   до того, как админ добавит фото и название. */
function markAsDraft(source, sourceId, title) {
  db.prepare(`
    INSERT INTO catalog_overrides (source, source_id, hidden, title)
    VALUES (?, ?, 1, NULL)
    ON CONFLICT(source, source_id) DO NOTHING
  `).run(source, sourceId);
}

export async function runSync() {
  const startedAt = new Date().toISOString();
  const counts = { specs: 0, bouquets: 0, items: 0, recipes: 0 };
  const diff = { specs_added: [], specs_removed: [], bouquets_added: [], bouquets_removed: [] };
  try {
    /* Снимок до синхронизации */
    const prevSpecs = new Map(db.prepare(`SELECT id, title FROM posiflora_specifications`).all().map(r => [r.id, r.title]));
    const prevBouquets = new Map(db.prepare(`SELECT id, title FROM posiflora_bouquets`).all().map(r => [r.id, r.title]));

    // 1. Specifications (шаблоны букетов)
    const specs = await posiflora.specifications();
    const tx1 = db.transaction((rows) => rows.forEach(upsertSpec));
    tx1(specs.data);
    counts.specs = specs.data.length;

    /* diff: новые спеки */
    const freshSpecIds = new Set(specs.data.map(s => s.id));
    for (const s of specs.data) {
      if (!prevSpecs.has(s.id)) {
        diff.specs_added.push({ id: s.id, title: s.attributes?.title || '?' });
        markAsDraft('spec', s.id);
      }
    }
    for (const [id, title] of prevSpecs) {
      if (!freshSpecIds.has(id)) diff.specs_removed.push({ id, title });
    }

    // 2. Bouquets (физические собранные — берём все, фильтр на фронте)
    const bouquets = await posiflora.bouquets();
    const tx2 = db.transaction((rows) => rows.forEach(upsertBouquet));
    tx2(bouquets.data);
    counts.bouquets = bouquets.data.length;

    /* diff: новые букеты */
    const freshBouquetIds = new Set(bouquets.data.map(b => b.id));
    for (const b of bouquets.data) {
      if (!prevBouquets.has(b.id)) {
        diff.bouquets_added.push({ id: b.id, title: b.attributes?.title || '?' });
        markAsDraft('bouquet', b.id);
      }
    }
    for (const [id, title] of prevBouquets) {
      if (!freshBouquetIds.has(id)) diff.bouquets_removed.push({ id, title });
    }

    // 3. Inventory items (для конструктора и допов) — filter[available]=true,
    //    то есть приходят только позиции, которые сейчас есть в наличии
    const inv = await posiflora.inventoryItems();
    const catTitles = new Map(
      inv.included.filter(i => i.type === 'categories').map(c => [c.id, c.attributes?.title])
    );

    /* 3.1 Получаем остатки по каждой позиции через warehouse-movement.
       Берём первый store (обычно один — IVA). Для каждого item делаем GET и
       извлекаем remainderQty последнего движения. Параллельно по 8. */
    const stores = await posiflora.stores();
    const storeId = stores.data?.[0]?.id;
    const balanceMap = new Map();
    if (storeId) {
      const start = '2020-01-01';
      const end = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const items = inv.data;
      const concurrency = 8;
      let idx = 0, ok = 0, fail = 0;
      async function worker() {
        while (idx < items.length) {
          const i = idx++;
          const it = items[i];
          try {
            const r = await posiflora.warehouseMovement(it.id, storeId, start, end);
            const moves = r.data || [];
            if (moves.length === 0) {
              balanceMap.set(it.id, 0);
            } else {
              // Берём movement с самой поздней датой → его remainderQty = текущий остаток
              moves.sort((a, b) => new Date(b.attributes?.date || 0) - new Date(a.attributes?.date || 0));
              const last = moves[0];
              const qty = Number(last.attributes?.remainderQty || 0);
              balanceMap.set(it.id, qty);
            }
            ok++;
          } catch (e) {
            fail++;
            // 404 = у позиции нет движений → 0 остаток
            if (e.response?.status === 404) balanceMap.set(it.id, 0);
          }
        }
      }
      const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
      await Promise.all(workers);
      console.log(`[iva] balances synced: ${ok} ok / ${fail} fail / ${items.length} total`);
    } else {
      console.warn('[iva] no store found — skipping balance sync');
    }

    const tx3 = db.transaction((items) => {
      db.prepare('DELETE FROM posiflora_inventory').run();
      for (const it of items) {
        const catId = it.relationships?.category?.data?.id;
        const available = balanceMap.has(it.id) ? balanceMap.get(it.id) : null;
        upsertInventory(it, catTitles.get(catId) || null, available);
      }
    });
    tx3(inv.data);
    counts.items = inv.data.length;
    counts.balances = balanceMap.size;

    // 4. Рецепты шаблонов (spec_id + variant_id + item_id + qty)
    //    Без них нельзя понять, можно ли собрать шаблон из текущего наличия.
    try {
      const sviRes = await posiflora.specificationVariantItems();
      const rows = [];
      for (const r of sviRes.data) {
        const a = r.attributes || {};
        const rel = r.relationships || {};
        const specId = rel.specification?.data?.id
                    || rel.specificationVariant?.data?.id  // fallback если только variant
                    || null;
        const variantId = rel.specificationVariant?.data?.id || rel.variant?.data?.id || null;
        const itemId = rel.inventoryItem?.data?.id || rel.item?.data?.id || null;
        const qty = Number(a.quantity ?? a.qty ?? a.amount ?? 0);
        if (itemId && qty > 0) {
          rows.push({ spec_id: specId, variant_id: variantId, item_id: itemId, qty });
        }
      }
      // Если spec_id не вытащился из rel (api отдаёт только variant_id) — нужно
      // подтянуть spec_id из specification-variants отдельно.
      const needSpecLookup = rows.filter(r => !r.spec_id && r.variant_id);
      if (needSpecLookup.length) {
        try {
          const swv = await posiflora.specificationWithVariants();
          // в included обычно лежат variants с relationship → specification
          const variantToSpec = new Map();
          const variants = [...(swv.data || []), ...(swv.included || [])]
            .filter(x => /variant/i.test(x.type || ''));
          for (const v of variants) {
            const sid = v.relationships?.specification?.data?.id;
            if (v.id && sid) variantToSpec.set(v.id, sid);
          }
          for (const r of rows) {
            if (!r.spec_id && r.variant_id && variantToSpec.has(r.variant_id)) {
              r.spec_id = variantToSpec.get(r.variant_id);
            }
          }
        } catch (e) {
          console.warn('[iva] specWithVariants lookup failed:', e.message);
        }
      }
      const valid = rows.filter(r => r.spec_id && r.item_id);
      replaceAllRecipes(valid);
      counts.recipes = valid.length;
    } catch (e) {
      console.warn('[iva] recipe sync failed:', e.message);
      counts.recipes = 0;
    }

    saveSyncRun({ startedAt, finishedAt: new Date().toISOString(), ok: true, counts });

    /* TG-уведомление о изменениях (если есть) */
    if (diff.specs_added.length || diff.specs_removed.length ||
        diff.bouquets_added.length || diff.bouquets_removed.length) {
      try { await notifySyncDiff(diff); }
      catch (e) { console.warn('[tg] sync diff notify failed:', e.message); }
    }

    return { ok: true, counts, diff };
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message;
    saveSyncRun({ startedAt, finishedAt: new Date().toISOString(), ok: false, counts, error: msg });
    throw err;
  }
}
