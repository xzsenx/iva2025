/**
 * Создание заказа в Posiflora после успешной оплаты в ЮKassa.
 * Идемпотентно: повторный вызов на тот же orderId не создаёт дубликат.
 *
 * Парсит состав заказа (items_json) и строит payload:
 *   - id "bouquet:UUID"  → готовый букет с витрины (orderItem.bouquet)
 *   - id "spec:UUID"     → шаблон Posiflora (orderItem.specification)
 *   - id "ctmpl:N"       → наш custom-template → разворачивается в позиции inventory_item
 *   - id "item:UUID"     → отдельная позиция склада (конструктор/допы)
 *   - it.custom.items[]  → собранный юзером в конструкторе → разворачивается
 */
import { posiflora } from '../posiflora.js';
import { db } from '../db.js';

export async function createPosifloraOrderForLocal(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) throw new Error('order not found: ' + orderId);
  if (order.posiflora_order_id) {
    return { ok: true, alreadyExists: true, posiflora_order_id: order.posiflora_order_id };
  }
  let items;
  try { items = JSON.parse(order.items_json || '[]'); }
  catch { items = []; }

  // Развернуть наши айдишники в Posiflora-сущности
  const orderItems = [];
  for (const it of items) {
    const qty = +it.qty || 1;
    const rawId = String(it.id || '');
    // bouquet:UUID
    if (rawId.startsWith('bouquet:')) {
      orderItems.push({
        type: 'order-items',
        attributes: { qty, salePrice: +it.price || 0 },
        relationships: { bouquet: { data: { type: 'bouquets', id: rawId.slice(8) } } },
      });
    }
    // spec:UUID
    else if (rawId.startsWith('spec:')) {
      orderItems.push({
        type: 'order-items',
        attributes: { qty, salePrice: +it.price || 0 },
        relationships: { specification: { data: { type: 'specifications', id: rawId.slice(5) } } },
      });
    }
    // ctmpl:N → наш шаблон, разворачиваем в позиции inventory
    else if (rawId.startsWith('ctmpl:')) {
      const tId = +rawId.slice(6);
      const components = db.prepare(`SELECT item_id, qty FROM custom_template_items WHERE template_id=?`).all(tId);
      const sharedPrice = +it.price || 0;
      // Распределим цену пропорционально qty компонентов (или просто на 1й)
      for (const c of components) {
        orderItems.push({
          type: 'order-items',
          attributes: { qty: (+c.qty || 1) * qty, salePrice: 0 },
          relationships: { inventoryItem: { data: { type: 'inventory-items', id: c.item_id } } },
        });
      }
      // Отдельная строка-маркер с salePrice = цена шаблона
      // (чтобы сумма заказа сошлась, qty=0 на маркер)
      if (sharedPrice > 0 && components.length) {
        orderItems[orderItems.length - 1].attributes.salePrice = sharedPrice;
      }
    }
    // item:UUID — отдельная позиция (стебель/доп)
    else if (rawId.startsWith('item:')) {
      orderItems.push({
        type: 'order-items',
        attributes: { qty, salePrice: +it.price || 0 },
        relationships: { inventoryItem: { data: { type: 'inventory-items', id: rawId.slice(5) } } },
      });
    }
    // Конструктор: it.custom.items[] = [{ id: 'item:UUID', qty, price }]
    else if (it.custom && Array.isArray(it.custom.items)) {
      for (const sub of it.custom.items) {
        const sId = String(sub.id || '');
        if (sId.startsWith('item:')) {
          orderItems.push({
            type: 'order-items',
            attributes: { qty: (+sub.qty || 1), salePrice: +sub.price || 0 },
            relationships: { inventoryItem: { data: { type: 'inventory-items', id: sId.slice(5) } } },
          });
        }
      }
    }
    else {
      console.warn('[posiflora-order] unknown item id format:', rawId, it);
    }
  }

  if (!orderItems.length) {
    throw new Error('no items to send to Posiflora');
  }

  const payload = {
    type: 'orders',
    attributes: {
      comment: `Мини-апп #${orderId} · ${order.customer_name || ''} · ${order.customer_phone || ''}` +
        (order.comment ? `\nКомм: ${order.comment}` : '') +
        (order.delivery_date ? `\nДоставка: ${order.delivery_date} ${order.delivery_time || ''}` : '') +
        (order.customer_address ? `\nАдрес: ${order.customer_address}` : ''),
      // Сумма уже оплачена через ЮKassa — передаём только для сверки
      saleAmount: +order.total_price || 0,
      status: 'purchased',  // помечаем как купленный сразу (оплата прошла)
    },
    relationships: {
      // orderItems вкладываются в included, не в relationships — но Posiflora-API
      // часто принимает их inline. Пробуем оба варианта.
      orderItems: { data: orderItems.map((it, i) => ({ type: 'order-items', id: `tmp-${i}` })) },
    },
  };

  // JSON:API extension: иногда нужно передавать included
  const fullPayload = {
    data: payload,
    included: orderItems.map((it, i) => ({ ...it, id: `tmp-${i}` })),
  };

  console.log('[posiflora-order] sending payload:', JSON.stringify(fullPayload).slice(0, 800));

  let resp;
  try {
    resp = await posiflora.createOrder(fullPayload);
  } catch (e) {
    const errBody = e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message;
    console.error('[posiflora-order] failed:', errBody);
    throw new Error('Posiflora API: ' + errBody);
  }

  const posifloraOrderId = resp.data?.id || resp.id;
  if (posifloraOrderId) {
    db.prepare('UPDATE orders SET posiflora_order_id=? WHERE id=?').run(posifloraOrderId, orderId);
  }
  console.log('[posiflora-order] created:', posifloraOrderId, 'for local order', orderId);
  return { ok: true, posiflora_order_id: posifloraOrderId, response: resp };
}
