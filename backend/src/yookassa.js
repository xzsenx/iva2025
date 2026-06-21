import axios from 'axios';
import crypto from 'node:crypto';

const SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const SECRET = process.env.YOOKASSA_SECRET_KEY;
const RETURN_URL = process.env.YOOKASSA_RETURN_URL || 'https://t.me/';

const api = axios.create({
  baseURL: 'https://api.yookassa.ru/v3',
  auth: { username: SHOP_ID, password: SECRET },
  timeout: 30000,
});

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 11) return digits;
  if (digits.length === 10) return '7' + digits;
  return digits;
}

/** items: [{ title, qty, price }] */
export async function createPayment({ amount, description, items, phone, email, returnUrl, metadata }) {
  if (!SHOP_ID || !SECRET) {
    throw new Error('YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY not set');
  }
  const customer = {};
  if (email) customer.email = email;
  if (phone) {
    const p = normalizePhone(phone);
    if (p) customer.phone = p;
  }
  if (!customer.email && !customer.phone) {
    customer.phone = '79999999999'; // fallback — иначе чек не пройдёт
  }

  // Receipt items — 54-ФЗ
  const receiptItems = (items || []).map((it) => ({
    description: String(it.title || '').slice(0, 128) || 'Товар',
    quantity: String(it.qty || 1),
    amount: { value: Number(it.price || 0).toFixed(2), currency: 'RUB' },
    vat_code: 1,                 // НДС не облагается (упрощёнка)
    payment_subject: 'commodity',
    payment_mode: 'full_payment',
  }));

  const body = {
    amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: returnUrl || RETURN_URL,
    },
    description: String(description || 'Заказ IVA').slice(0, 128),
    receipt: { customer, items: receiptItems },
    metadata: metadata || {},
  };

  const res = await api.post('/payments', body, {
    headers: { 'Idempotence-Key': crypto.randomUUID() },
  });
  return res.data;
}

export async function getPayment(id) {
  const res = await api.get(`/payments/${id}`);
  return res.data;
}
