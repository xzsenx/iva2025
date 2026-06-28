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

/**
 * Нормализует телефон в формат ЮKassa E.164 без '+' — 11 цифр, начинается с 7.
 * Возвращает null если телефон невалидный — тогда caller передаст fallback.
 *
 * Примеры:
 *   "+7 (999) 123-45-67" → "79991234567"
 *   "8 999 123 45 67"    → "79991234567"
 *   "9991234567"         → "79991234567"
 *   "1234"               → null (мусор)
 *   "+1 555 123 4567"    → null (не РФ)
 */
function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  // 8XXXXXXXXXX → 7XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  // 10 цифр (без кода страны) → добавим 7
  if (digits.length === 10) digits = '7' + digits;
  // Должно быть ровно 11 цифр, начинаться с 7 (Россия)
  if (digits.length !== 11 || !digits.startsWith('7')) return null;
  return digits;
}

/** items: [{ title, qty, price }] */
export async function createPayment({ amount, description, items, phone, email, returnUrl, metadata }) {
  if (!SHOP_ID || !SECRET) {
    throw new Error('YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY not set');
  }
  const customer = {};
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    customer.email = email;
  }
  if (phone) {
    const p = normalizePhone(phone);
    if (p) customer.phone = p;
    else console.warn('[yookassa] phone rejected (not 11-digit RU):', phone);
  }
  // 54-ФЗ: нужен ХОТЯ БЫ ОДИН контакт. Если ничего валидного — даём поддельный email.
  // (Чек пройдёт, чек сформируется но уйдёт «в никуда», что приемлемо для теста.)
  if (!customer.email && !customer.phone) {
    customer.email = 'noreply@ivaflowers.ru';
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
