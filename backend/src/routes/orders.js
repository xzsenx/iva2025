import { Router } from 'express';
import { db } from '../db.js';
import { createPayment, getPayment } from '../yookassa.js';
import { createPosifloraOrderForLocal } from '../services/posifloraOrder.js';
import { notifyOrder, notifyTest } from '../services/tgNotify.js';

/* Идемпотентно шлём TG-уведомление о заказе. */
async function notifyOrderSafely(orderId) {
  /* Не дублируем — если уже слали, столбец notified_at заполнен */
  const row = db.prepare(`SELECT notified_at FROM orders WHERE id=?`).get(orderId);
  if (row?.notified_at) return;
  try {
    const r = await notifyOrder(orderId);
    if (r.ok) {
      db.prepare(`UPDATE orders SET notified_at = datetime('now') WHERE id=?`).run(orderId);
    }
  } catch (e) {
    console.error('[tg] notify error:', e.message);
  }
}

/* Идемпотентно отправить заказ в Posiflora. Безопасно вызывать несколько раз. */
async function pushToPosifloraSafely(orderId) {
  try {
    const r = await createPosifloraOrderForLocal(orderId);
    if (r.alreadyExists) console.log('[iva] order', orderId, 'already in Posiflora:', r.posiflora_order_id);
    else console.log('[iva] order', orderId, '→ Posiflora:', r.posiflora_order_id);
  } catch (e) {
    console.error('[iva] failed to push order', orderId, 'to Posiflora:', e.message);
    db.prepare(`UPDATE orders SET status = COALESCE(status,'paid')
                WHERE id=? AND posiflora_order_id IS NULL`).run(orderId);
  }
}

const r = Router();

/** POST /api/orders — создать заказ + платёж в ЮKassa, вернуть confirmation_url */
r.post('/', async (req, res) => {
  const { name, phone, address, delivery, date, time, comment, items, total, email } = req.body || {};
  if (!name || !phone || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'name, phone, items required' });
  }
  const totalNum = Number(total) || items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);

  /* 1. Сохраняем заказ локально (со статусом pending) */
  const info = db.prepare(`
    INSERT INTO orders
      (customer_name, customer_phone, customer_address, delivery_type, delivery_date, delivery_time, comment, total_price, items_json, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
  `).run(name, phone, address || '', delivery || 'delivery', date || '', time || '',
         comment || '', totalNum, JSON.stringify(items));
  const orderId = info.lastInsertRowid;

  /* 2. Создаём платёж в ЮKassa */
  try {
    /* Передаём ТОЛЬКО товарные позиции для чека — корректно для 54-ФЗ */
    const receiptItemsRaw = items.flatMap((it) => {
      if (it.custom && Array.isArray(it.custom.items)) {
        return it.custom.items.map((sub) => ({
          title: sub.title, qty: sub.qty, price: sub.price,
        }));
      }
      return [{ title: it.name || it.title || `Товар #${it.id}`, qty: it.qty || 1, price: it.price || 0 }];
    });

    /* Если есть скидка (total меньше суммы позиций) — масштабируем цены пропорционально,
       чтобы сумма чека = totalNum (54-ФЗ требует совпадения amount = сумма receipt items). */
    const rawSum = receiptItemsRaw.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 1), 0);
    let receiptItems = receiptItemsRaw;
    if (rawSum > 0 && totalNum < rawSum) {
      const k = totalNum / rawSum;
      receiptItems = receiptItemsRaw.map(it => ({
        ...it,
        price: Number((Number(it.price || 0) * k).toFixed(2)),
      }));
    }

    const payment = await createPayment({
      amount: totalNum,
      description: `Заказ #${orderId} — IVA`,
      items: receiptItems,
      phone,
      email,
      metadata: { order_id: String(orderId) },
    });

    db.prepare(`UPDATE orders SET yookassa_id = ?, payment_status = ? WHERE id = ?`)
      .run(payment.id, payment.status, orderId);

    res.json({
      id: orderId,
      yookassa_id: payment.id,
      confirmation_url: payment.confirmation?.confirmation_url,
      status: payment.status,
    });
  } catch (err) {
    const msg = err.response?.data || err.message;
    db.prepare(`UPDATE orders SET payment_status = 'error' WHERE id = ?`).run(orderId);
    console.error('[yookassa] create error:', msg);
    res.status(500).json({ error: 'payment failed', details: msg });
  }
});

/** Заявка на сборку букета (без оплаты) — с формы builder.html
    Сохраняем как заказ со статусом new_request, шлём уведомление в TG. */
r.post('/request', async (req, res) => {
  const { name, phone, address, delivery, date, time, budget, description, occasion, style, colors, comment } = req.body || {};
  if (!name || !phone || !description) {
    return res.status(400).json({ error: 'name/phone/description required' });
  }
  const items = [{
    name: 'Собрать букет — заявка',
    qty: 1,
    price: Number(budget) || 0,
    request: { budget, description, occasion, style, colors },
  }];
  const info = db.prepare(`
    INSERT INTO orders
      (customer_name, customer_phone, customer_address, delivery_type, delivery_date, delivery_time, comment, total_price, items_json, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new_request', 'no_payment')
  `).run(
    name, phone, address || '', delivery || 'delivery',
    date || '', time || '',
    [description, occasion && `Повод: ${occasion}`, style && `Стиль: ${style}`, colors && `Цвета: ${colors}`, comment].filter(Boolean).join('\n'),
    Number(budget) || 0,
    JSON.stringify(items),
  );
  const orderId = info.lastInsertRowid;
  notifyOrderSafely(orderId);
  res.json({ ok: true, id: orderId });
});

/** Webhook от ЮKassa — приходит после оплаты */
r.post('/webhook', async (req, res) => {
  const event = req.body;
  if (!event || !event.object?.id) {
    return res.status(400).json({ error: 'bad payload' });
  }
  const paymentId = event.object.id;
  const status = event.object.status;
  console.log('[yookassa webhook]', event.event, paymentId, status);

  /* Идемпотентно: всегда подтягиваем актуальный статус */
  let actual;
  try { actual = await getPayment(paymentId); }
  catch (e) { actual = event.object; }

  const orderRow = db.prepare(`SELECT * FROM orders WHERE yookassa_id = ?`).get(paymentId);
  if (!orderRow) {
    return res.status(200).json({ ok: true, note: 'order not found' });
  }
  db.prepare(`UPDATE orders SET payment_status = ?, status = ? WHERE id = ?`)
    .run(actual.status, actual.status === 'succeeded' ? 'paid' : orderRow.status, orderRow.id);

  /* Оплата прошла → отправляем заказ в Posiflora + уведомление в TG */
  if (actual.status === 'succeeded') {
    pushToPosifloraSafely(orderRow.id);
    notifyOrderSafely(orderRow.id);
  }

  res.json({ ok: true });
});

/* Тестовое сообщение в TG (из вкладки «Мини-апп» в админке) */
r.post('/notify-test', async (req, res) => {
  const r1 = await notifyTest();
  res.json(r1);
});

/** Получить актуальный статус заказа (для polling после редиректа) */
r.get('/:id/status', async (req, res) => {
  const row = db.prepare(`SELECT id, status, payment_status, yookassa_id FROM orders WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  /* Подтягиваем актуальный статус из ЮKassa */
  if (row.yookassa_id && row.payment_status !== 'succeeded') {
    try {
      const p = await getPayment(row.yookassa_id);
      if (p.status !== row.payment_status) {
        db.prepare(`UPDATE orders SET payment_status = ?, status = ? WHERE id = ?`)
          .run(p.status, p.status === 'succeeded' ? 'paid' : row.status, row.id);
        row.payment_status = p.status;
        if (p.status === 'succeeded') {
          pushToPosifloraSafely(row.id);
          notifyOrderSafely(row.id);
        }
      }
    } catch {}
  }
  res.json(row);
});

/* Ручная отправка заказа в Posiflora (если webhook не сработал / для тестов) */
r.post('/:id/push-to-posiflora', async (req, res) => {
  try {
    const result = await createPosifloraOrderForLocal(+req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.get('/', (req, res) => {
  const rows = db.prepare(`SELECT * FROM orders ORDER BY id DESC LIMIT 200`).all();
  res.json(rows.map(o => ({ ...o, items: JSON.parse(o.items_json || '[]') })));
});

export default r;
