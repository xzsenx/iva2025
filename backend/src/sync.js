import { posiflora } from './posiflora.js';
import { db, upsertSpec, upsertBouquet, upsertInventory, replaceAllRecipes, saveSyncRun } from './db.js';

export async function runSync() {
  const startedAt = new Date().toISOString();
  const counts = { specs: 0, bouquets: 0, items: 0, recipes: 0 };
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

    // 3. Inventory items (для конструктора и допов) — filter[available]=true,
    //    то есть приходят только позиции, которые сейчас есть в наличии
    const inv = await posiflora.inventoryItems();
    const catTitles = new Map(
      inv.included.filter(i => i.type === 'categories').map(c => [c.id, c.attributes?.title])
    );
    const tx3 = db.transaction((items) => {
      // Очищаем таблицу — оставляем только реально доступные позиции
      db.prepare('DELETE FROM posiflora_inventory').run();
      for (const it of items) {
        const catId = it.relationships?.category?.data?.id;
        upsertInventory(it, catTitles.get(catId) || null, null);
      }
    });
    tx3(inv.data);
    counts.items = inv.data.length;

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
    return { ok: true, counts };
  } catch (err) {
    const msg = err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message;
    saveSyncRun({ startedAt, finishedAt: new Date().toISOString(), ok: false, counts, error: msg });
    throw err;
  }
}
