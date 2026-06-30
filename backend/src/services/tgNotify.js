import axios from 'axios';
import { db } from '../db.js';

/* Читаем настройки уведомлений из app_settings.notifications.
   Поля: tg_chat_id (приоритет над env TELEGRAM_ADMIN_CHAT_ID),
         tg_bot_token (приоритет над env TELEGRAM_BOT_TOKEN). */
function getNotifyConfig() {
  let cfg = {};
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key='notifications'`).get();
    if (row) cfg = JSON.parse(row.value);
  } catch {}
  return {
    chat_id: cfg.tg_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID || null,
    bot_token: cfg.tg_bot_token || process.env.TELEGRAM_BOT_TOKEN || null,
    enabled: cfg.tg_enabled !== false,
  };
}

function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

/* Форматируем заказ для TG (HTML parse_mode). */
function formatOrder(order) {
  const items = (() => {
    try { return JSON.parse(order.items_json || '[]'); }
    catch { return []; }
  })();

  const itemsLines = items.map(it => {
    if (it.custom?.items?.length) {
      const sub = it.custom.items.map(s => `  • ${escapeHtml(s.title)} ×${s.qty}`).join('\n');
      return `• <b>${escapeHtml(it.name || 'Свой букет')}</b> — ${fmtMoney(it.custom.price)}\n${sub}`;
    }
    return `• <b>${escapeHtml(it.name || it.title || '?')}</b> ×${it.qty || 1} — ${fmtMoney((it.price || 0) * (it.qty || 1))}`;
  }).join('\n');

  const delivery = order.delivery_type === 'pickup'
    ? '🏪 Самовывоз'
    : `🚚 ${escapeHtml(order.customer_address || '')}`;

  const dateTime = [order.delivery_date, order.delivery_time]
    .filter(Boolean)
    .join(' ');

  return [
    `🌸 <b>Новый заказ #${order.id}</b>`,
    '',
    `👤 ${escapeHtml(order.customer_name || '')}`,
    `📱 ${escapeHtml(order.customer_phone || '')}`,
    `${delivery}`,
    dateTime ? `📅 ${escapeHtml(dateTime)}` : null,
    '',
    `<b>Состав:</b>`,
    itemsLines || '— пусто —',
    '',
    `💰 <b>Итого: ${fmtMoney(order.total_price)}</b>`,
    order.payment_status ? `💳 Оплата: ${escapeHtml(order.payment_status)}` : null,
    order.comment ? `\n💬 ${escapeHtml(order.comment)}` : null,
  ].filter(Boolean).join('\n');
}

export async function notifyOrder(orderId) {
  const cfg = getNotifyConfig();
  if (!cfg.enabled || !cfg.chat_id || !cfg.bot_token) {
    console.log('[tg] notify skipped — chat_id/bot_token not set');
    return { ok: false, reason: 'not_configured' };
  }
  const order = db.prepare(`SELECT * FROM orders WHERE id=?`).get(orderId);
  if (!order) return { ok: false, reason: 'order_not_found' };

  const text = formatOrder(order);
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`,
      { chat_id: cfg.chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 10_000 }
    );
    return { ok: true, message_id: res.data?.result?.message_id };
  } catch (e) {
    const msg = e.response?.data?.description || e.message;
    console.error('[tg] notify failed:', msg);
    return { ok: false, reason: msg };
  }
}

/* Уведомление о diff синхронизации с Posiflora.
   diff: { specs_added, specs_removed, bouquets_added, bouquets_removed } — массивы {id, title} */
export async function notifySyncDiff(diff) {
  const cfg = getNotifyConfig();
  if (!cfg.enabled || !cfg.chat_id || !cfg.bot_token) return { ok: false, reason: 'not_configured' };

  const lines = [];
  const block = (label, list) => {
    if (!list.length) return;
    lines.push(`<b>${label}</b>`);
    for (const x of list.slice(0, 10)) {
      lines.push(`• ${escapeHtml(x.title || x.id)}`);
    }
    if (list.length > 10) lines.push(`<i>...и ещё ${list.length - 10}</i>`);
    lines.push('');
  };

  lines.push('🔄 <b>Синхронизация с Posiflora</b>');
  lines.push('');
  block('🆕 Новые шаблоны (черновики):', diff.specs_added);
  block('🆕 Новые букеты на витрину (черновики):', diff.bouquets_added);
  block('🗑 Удалённые шаблоны:', diff.specs_removed);
  block('🗑 Удалённые букеты:', diff.bouquets_removed);

  if (diff.specs_added.length || diff.bouquets_added.length) {
    lines.push('<i>Новые позиции скрыты от мини-аппки — добавь фото/название и сними скрытие в админке.</i>');
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`,
      { chat_id: cfg.chat_id, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 10_000 }
    );
    return { ok: true };
  } catch (e) {
    console.error('[tg] sync diff notify failed:', e.response?.data?.description || e.message);
    return { ok: false, reason: e.response?.data?.description || e.message };
  }
}

/* Тестовое сообщение из админки — проверить что chat_id/токен живые */
export async function notifyTest() {
  const cfg = getNotifyConfig();
  if (!cfg.chat_id || !cfg.bot_token) {
    return { ok: false, reason: 'not_configured' };
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`,
      {
        chat_id: cfg.chat_id,
        text: '✅ <b>Тестовое уведомление</b>\nИВА — настройки сохранены, бот видит чат.',
        parse_mode: 'HTML',
      },
      { timeout: 10_000 }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.response?.data?.description || e.message };
  }
}
