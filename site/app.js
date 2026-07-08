/* ============================================================
   IVA Site — каталог из API, корзина, чекаут через ЮKassa
   ============================================================ */

const API_BASE = window.IVA_API_BASE || '';
const CART_KEY = 'iva_cart_v1';
const PLACEHOLDER_IMG = 'https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=600&q=80';

const CATEGORIES = {
  all:      'Всё',
  showcase: 'Витрина',
  bouquets: 'Букеты',
  roses:    'Розы',
  compose:  'Композиции',
  gifts:    'Подарки'
};

const BADGES = {
  hit:    { label: 'Хит',     cls: '' },
  new:    { label: 'Новинка', cls: 'card__badge--sage' },
  season: { label: 'Сезон',   cls: 'card__badge--gold' },
  p:      { label: 'Premium', cls: 'card__badge--gold' },
  unique: { label: 'Уникальный', cls: 'card__badge--sage' }
};

let PRODUCTS = [];

/* ── Storage ── */
const loadCart = () => {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
};
const saveCart = (cart) => localStorage.setItem(CART_KEY, JSON.stringify(cart));

/* ── Money ── */
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const pluralBouquet = (n) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'сборок';
  if (b > 1 && b < 5) return 'сборки';
  if (b === 1) return 'сборка';
  return 'сборок';
};

/* ── Toast ── */
let toastTimer;
const toast = (msg) => {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
};

/* ── Cart ── */
const cartCount = () => loadCart().reduce((s, i) => s + i.qty, 0);
const cartTotal = () => loadCart().reduce((s, i) => s + i.qty * i.price, 0);

const updateCartBadge = () => {
  const n = cartCount();
  const el = document.getElementById('cartCount');
  if (!el) return;
  el.textContent = n;
  el.classList.toggle('visible', n > 0);
};

const addToCart = (product) => {
  const cart = loadCart();
  const id = String(product.id);
  const existing = cart.find(i => String(i.id) === id);
  if (existing) existing.qty += 1;
  else cart.push({
    id,
    name: product.name || product.title,
    price: product.price,
    img: product.img || PLACEHOLDER_IMG,
    qty: 1
  });
  saveCart(cart);
  updateCartBadge();
  renderCart();
  toast(`«${product.name || product.title}» добавлен в корзину`);
  track('add_to_cart', { id: product.id, name: product.name || product.title, price: product.price });
};

const updateQty = (id, delta) => {
  const cart = loadCart();
  const item = cart.find(i => String(i.id) === String(id));
  if (!item) return;
  item.qty = Math.max(0, item.qty + delta);
  saveCart(cart.filter(i => i.qty > 0));
  updateCartBadge();
  renderCart();
};

const removeFromCart = (id) => {
  saveCart(loadCart().filter(i => String(i.id) !== String(id)));
  updateCartBadge();
  renderCart();
};

const openDrawer = () => {
  document.getElementById('drawer')?.classList.add('open');
  document.getElementById('drawerBackdrop')?.classList.add('open');
  document.body.style.overflow = 'hidden';
};
const closeDrawer = () => {
  document.getElementById('drawer')?.classList.remove('open');
  document.getElementById('drawerBackdrop')?.classList.remove('open');
  document.body.style.overflow = '';
};

const renderCart = () => {
  const body = document.getElementById('cartBody');
  const foot = document.getElementById('cartFoot');
  if (!body || !foot) return;
  const cart = loadCart();
  if (!cart.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="empty__icon">
          <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
          </svg>
        </div>
        <div class="empty__title">Корзина пуста</div>
        <p>Добавьте букет из каталога</p>
      </div>`;
    foot.innerHTML = '';
    return;
  }
  body.innerHTML = cart.map(i => `
    <div class="cart-row">
      <div class="cart-row__img"><img src="${i.img}" alt="${i.name}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'"></div>
      <div>
        <div class="cart-row__name">${i.name}</div>
        <div class="cart-row__price">${money(i.price)}</div>
        <div class="qty">
          <button data-act="dec" data-id="${i.id}" aria-label="Меньше">−</button>
          <span>${i.qty}</span>
          <button data-act="inc" data-id="${i.id}" aria-label="Больше">+</button>
        </div>
      </div>
      <button class="cart-row__remove" data-act="rm" data-id="${i.id}" aria-label="Удалить">×</button>
    </div>
  `).join('');
  foot.innerHTML = `
    <div class="cart-total">
      <span class="cart-total__label">Итого</span>
      <span class="cart-total__sum">${money(cartTotal())}</span>
    </div>
    <a class="btn btn--primary btn--block" href="checkout.html">Оформить заказ</a>
  `;
  body.querySelectorAll('[data-act]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (b.dataset.act === 'inc') updateQty(id, 1);
      else if (b.dataset.act === 'dec') updateQty(id, -1);
      else if (b.dataset.act === 'rm') removeFromCart(id);
    });
  });
};

/* ── Catalog rendering ── */
const productCard = (p) => {
  const badge = p.badge && BADGES[p.badge]
    ? `<span class="card__badge ${BADGES[p.badge].cls}">${BADGES[p.badge].label}</span>`
    : '';
  const cat = CATEGORIES[p.category] || '';
  const img = p.img || PLACEHOLDER_IMG;
  const name = p.name || p.title;
  const idEnc = encodeURIComponent(p.id);
  return `
    <article class="card">
      <a href="product.html?id=${idEnc}" class="card__media" aria-label="${name}">
        ${badge}
        <img src="${img}" alt="${name}" loading="lazy" onerror="this.src='${PLACEHOLDER_IMG}'">
      </a>
      <div class="card__body">
        <div class="card__cat">${cat}</div>
        <h3 class="card__title"><a href="product.html?id=${idEnc}">${name}</a></h3>
        ${typeof p.max_count === 'number' ? `<div class="card__stock">осталось <b>${p.max_count}</b> ${pluralBouquet(p.max_count)}</div>` : ''}
        <div class="card__foot">
          <div class="card__price">${money(p.price)}</div>
          <button class="card__btn" data-add="${idEnc}" aria-label="В корзину">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
    </article>
  `;
};

const wireCardAdds = (root) => {
  root.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = decodeURIComponent(btn.dataset.add);
      const p = PRODUCTS.find(x => String(x.id) === id);
      if (p) addToCart(p);
    });
  });
};

const sortProducts = (list, mode) => {
  const copy = [...list];
  switch (mode) {
    case 'price_asc':  return copy.sort((a, b) => a.price - b.price);
    case 'price_desc': return copy.sort((a, b) => b.price - a.price);
    case 'new':        return copy.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    default:           return copy.sort((a, b) => (b.popular || 0) - (a.popular || 0));
  }
};

const renderCatalog = () => {
  const grid = document.getElementById('catalogGrid');
  const filtersEl = document.getElementById('filters');
  const sortEl = document.getElementById('sort');
  if (!grid || !filtersEl) return;

  const url = new URL(location.href);
  let activeCat = url.searchParams.get('cat') || 'all';
  let activeSort = sortEl?.value || 'popular';

  const presentCats = new Set(PRODUCTS.map(p => p.category).filter(Boolean));
  const cats = ['all', ...Object.keys(CATEGORIES).filter(k => k !== 'all' && presentCats.has(k))];

  filtersEl.innerHTML = cats.map(k =>
    `<button class="chip ${k === activeCat ? 'active' : ''}" data-cat="${k}">${CATEGORIES[k] || k}</button>`
  ).join('');

  const draw = () => {
    let list = activeCat === 'all' ? PRODUCTS : PRODUCTS.filter(p => p.category === activeCat);
    list = sortProducts(list, activeSort);
    if (!list.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty__title">Ничего не найдено</div><p>Попробуйте другую категорию</p></div>`;
      return;
    }
    grid.innerHTML = list.map(productCard).join('');
    wireCardAdds(grid);
  };

  filtersEl.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCat = btn.dataset.cat;
      filtersEl.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const u = new URL(location.href);
      if (activeCat === 'all') u.searchParams.delete('cat');
      else u.searchParams.set('cat', activeCat);
      history.replaceState(null, '', u);
      draw();
    });
  });
  sortEl?.addEventListener('change', () => { activeSort = sortEl.value; draw(); });
  draw();
};

const renderPopular = () => {
  const grid = document.getElementById('popularGrid');
  if (!grid) return;
  const list = [...PRODUCTS].sort((a, b) => (b.popular || 0) - (a.popular || 0)).slice(0, 4);
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><p>Каталог загружается...</p></div>`;
    return;
  }
  grid.innerHTML = list.map(productCard).join('');
  wireCardAdds(grid);
};

const renderProduct = () => {
  const root = document.getElementById('productRoot');
  if (!root) return;
  const id = new URL(location.href).searchParams.get('id') || '';
  const p = PRODUCTS.find(x => String(x.id) === id);
  if (!p) {
    root.innerHTML = `<div class="empty"><div class="empty__title">Букет не найден</div><a class="btn btn--ghost" href="catalog.html" style="margin-top:16px">К каталогу</a></div>`;
    return;
  }
  const name = p.name || p.title;
  document.title = `${name} — ИВА`;
  const badge = p.badge && BADGES[p.badge]
    ? `<span class="card__badge ${BADGES[p.badge].cls}" style="position:static;display:inline-block;margin-bottom:16px">${BADGES[p.badge].label}</span>`
    : '';
  const img = p.img || PLACEHOLDER_IMG;
  root.innerHTML = `
    <div class="product-detail">
      <div class="product-detail__img"><img src="${img}" alt="${name}" onerror="this.src='${PLACEHOLDER_IMG}'"></div>
      <div>
        ${badge}
        <div class="product-detail__cat">${CATEGORIES[p.category] || ''}</div>
        <h1 class="product-detail__title">${name}</h1>
        <p class="product-detail__desc">${p.description || p.desc || 'Авторская композиция от флористов студии ИВА. Собираем вручную в день доставки из свежих премиальных цветов.'}</p>
        <div class="product-detail__price">${money(p.price)}</div>
        <button class="btn btn--primary btn--lg btn--block" id="buyBtn">Добавить в корзину</button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:32px;color:var(--cream-dim);font-size:13px">
          <div>✓ Доставка в день заказа</div>
          <div>✓ Фото перед отправкой</div>
          <div>✓ Свежесть гарантирована</div>
          <div>✓ Оплата онлайн через ЮKassa</div>
        </div>
      </div>
    </div>
  `;
  root.querySelector('#buyBtn').addEventListener('click', () => addToCart(p));

  const rel = document.getElementById('relatedGrid');
  if (rel) {
    const list = PRODUCTS.filter(x => String(x.id) !== id && x.category === p.category).slice(0, 4);
    const fallback = PRODUCTS.filter(x => String(x.id) !== id).slice(0, 4);
    const items = list.length ? list : fallback;
    rel.innerHTML = items.map(productCard).join('');
    wireCardAdds(rel);
  }
};

/* ── Checkout page ── */
const renderCheckout = () => {
  const root = document.getElementById('checkoutRoot');
  if (!root) return;
  const cart = loadCart();
  if (!cart.length) {
    root.innerHTML = `
      <div class="empty">
        <div class="empty__title">Корзина пуста</div>
        <p>Добавьте букет из каталога</p>
        <a class="btn btn--primary" href="catalog.html" style="margin-top:24px">К каталогу</a>
      </div>`;
    return;
  }
  const summary = cart.map(i => `
    <div class="cart-row" style="grid-template-columns:60px 1fr auto">
      <div class="cart-row__img" style="width:60px;height:60px"><img src="${i.img}" alt=""></div>
      <div>
        <div class="cart-row__name" style="font-size:15px">${i.name}</div>
        <div style="font-size:13px;color:var(--cream-dim)">${i.qty} × ${money(i.price)}</div>
      </div>
      <div style="font-weight:600;color:var(--pink-light)">${money(i.qty * i.price)}</div>
    </div>
  `).join('');

  root.innerHTML = `
    <div class="checkout-grid" style="display:grid;grid-template-columns:1.2fr 1fr;gap:48px;align-items:start">
      <form class="form" id="checkoutForm" novalidate>
        <h2 style="font-family:var(--font-serif);font-size:32px;margin-bottom:8px">Оформление</h2>
        <p style="margin-bottom:8px">Менеджер свяжется для подтверждения</p>

        <label class="field">
          <span class="field__label">Имя</span>
          <input class="input" name="name" type="text" placeholder="Анна" required>
          <span class="field__error">Введите имя</span>
        </label>
        <label class="field">
          <span class="field__label">Телефон</span>
          <input class="input" name="phone" type="tel" placeholder="+7 (___) ___-__-__" required>
          <span class="field__error">Введите номер</span>
        </label>
        <label class="field">
          <span class="field__label">Email (для чека)</span>
          <input class="input" name="email" type="email" placeholder="anna@example.com">
        </label>

        <div class="field">
          <span class="field__label">Доставка</span>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <label style="flex:1;min-width:140px;cursor:pointer">
              <input type="radio" name="delivery" value="delivery" checked style="display:none" data-radio>
              <span class="chip" style="display:flex;justify-content:center;width:100%">Доставка</span>
            </label>
            <label style="flex:1;min-width:140px;cursor:pointer">
              <input type="radio" name="delivery" value="pickup" style="display:none" data-radio>
              <span class="chip" style="display:flex;justify-content:center;width:100%">Самовывоз</span>
            </label>
          </div>
        </div>

        <label class="field" id="addrField">
          <span class="field__label">Адрес</span>
          <input class="input" name="address" type="text" placeholder="ул. Попова 23, кв. 5">
        </label>

        <div class="field toggle-row">
          <label class="toggle-lbl">
            <input type="checkbox" name="is_gift" id="chkGift">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-text">
              <b>Заказ другому человеку</b>
              <small>Букет получит не заказчик</small>
            </span>
          </label>
        </div>

        <div id="giftBlock" class="gift-block" style="display:none">
          <label class="field">
            <span class="field__label">Имя получателя</span>
            <input class="input" name="recipient_name" type="text" placeholder="Мария">
          </label>
          <label class="field">
            <span class="field__label">Телефон получателя</span>
            <input class="input" name="recipient_phone" type="tel" placeholder="+7 (___) ___-__-__">
          </label>

          <div class="field toggle-row">
            <label class="toggle-lbl">
              <input type="checkbox" name="ask_recipient_address" id="chkAskAddr">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-text">
                <b>Уточнить адрес у получателя</b>
                <small>Курьер созвонится и заберёт адрес</small>
              </span>
            </label>
          </div>

          <div class="field toggle-row">
            <label class="toggle-lbl">
              <input type="checkbox" name="is_surprise" id="chkSurprise">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-text">
                <b>Сюрприз</b>
                <small>Не раскрывать имя заказчика получателю</small>
              </span>
            </label>
          </div>

          <label class="field">
            <span class="field__label">Текст открытки</span>
            <textarea class="textarea" name="card_message" placeholder="С Днём Рождения, любимая!" rows="3"></textarea>
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label class="field">
            <span class="field__label">Дата</span>
            <input class="input" name="date" type="date" required>
          </label>
          <label class="field">
            <span class="field__label">Время</span>
            <select class="input" name="time">
              <option value="09-12">09:00 — 12:00</option>
              <option value="12-15">12:00 — 15:00</option>
              <option value="15-18">15:00 — 18:00</option>
              <option value="18-21">18:00 — 21:00</option>
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field__label">Комментарий</span>
          <textarea class="textarea" name="comment" placeholder="Открытка, пожелания флористу..."></textarea>
        </label>

        <button class="btn btn--primary btn--lg btn--block" type="submit" id="payBtn">Перейти к оплате</button>
        <p style="font-size:12px;color:var(--cream-faint);text-align:center;margin-top:8px">
          Оплата через ЮKassa. Безопасно через банк-эквайер.
        </p>
      </form>

      <aside class="contact-info" style="position:sticky;top:96px">
        <h3 style="font-family:var(--font-serif);font-size:24px;margin-bottom:20px">Ваш заказ</h3>
        ${summary}
        <div class="cart-total" style="margin-top:24px">
          <span class="cart-total__label">Итого</span>
          <span class="cart-total__sum">${money(cartTotal())}</span>
        </div>
      </aside>
    </div>
  `;

  const radios = root.querySelectorAll('[data-radio]');
  const syncUI = () => {
    radios.forEach(r => {
      const chip = r.parentElement.querySelector('.chip');
      chip.classList.toggle('active', r.checked);
    });
    const addr = root.querySelector('#addrField');
    const isDelivery = root.querySelector('[value="delivery"]').checked;
    const isGift = root.querySelector('#chkGift')?.checked;
    const askAddr = root.querySelector('#chkAskAddr')?.checked;
    /* Адрес виден: доставка + (не подарок ИЛИ не «уточним у получателя») */
    const showAddr = isDelivery && !(isGift && askAddr);
    if (addr) addr.style.display = showAddr ? 'flex' : 'none';
    /* Gift-блок */
    root.querySelector('#giftBlock').style.display = isGift ? 'block' : 'none';
  };
  radios.forEach(r => r.addEventListener('change', syncUI));
  root.querySelector('#chkGift')?.addEventListener('change', syncUI);
  root.querySelector('#chkAskAddr')?.addEventListener('change', syncUI);
  syncUI();

  root.querySelector('#checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    let valid = true;
    form.querySelectorAll('.field').forEach(f => f.classList.remove('is-error'));
    const required = ['name', 'phone', 'date'];
    required.forEach(n => {
      const f = form.querySelector(`[name="${n}"]`);
      if (!f.value.trim()) { f.closest('.field').classList.add('is-error'); valid = false; }
    });
    const phone = form.querySelector('[name="phone"]');
    if (phone.value.replace(/\D/g, '').length < 10) {
      phone.closest('.field').classList.add('is-error'); valid = false;
    }
    if (!valid) return;

    const btn = root.querySelector('#payBtn');
    btn.disabled = true;
    btn.textContent = 'Создаём платёж...';

    const cartNow = loadCart();
    const total = cartNow.reduce((s, i) => s + i.qty * i.price, 0);
    const isGift = form.querySelector('#chkGift')?.checked;
    const askAddr = form.querySelector('#chkAskAddr')?.checked;
    /* Валидация: если подарок и не «уточним у получателя» — нужен телефон получателя */
    if (isGift && !askAddr) {
      const rp = form.querySelector('[name="recipient_phone"]');
      if (rp && !rp.value.trim()) {
        rp.closest('.field').classList.add('is-error');
        toast('Введите телефон получателя');
        btn.disabled = false; btn.textContent = 'Перейти к оплате';
        return;
      }
    }
    const gift = isGift ? {
      enabled: true,
      recipient_name: form.recipient_name.value.trim(),
      recipient_phone: form.recipient_phone.value.trim(),
      ask_recipient_address: askAddr,
      is_surprise: form.querySelector('#chkSurprise')?.checked || false,
      card_message: form.card_message.value.trim(),
    } : undefined;
    const payload = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim() || undefined,
      address: form.address?.value.trim() || '',
      delivery: form.delivery.value,
      date: form.date.value,
      time: form.time.value,
      comment: form.comment.value.trim(),
      items: cartNow.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, ...(i.custom ? { custom: i.custom } : {}) })),
      total,
      gift,
    };

    track('begin_checkout', { total, items_count: cartNow.length });
    try {
      const r = await fetch(API_BASE + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok || !data.confirmation_url) throw new Error(data.error || 'payment failed');
      track('order_placed', { order_id: data.id, total });
      sessionStorage.setItem('iva_last_order', String(data.id));
      saveCart([]);
      location.href = data.confirmation_url;
    } catch (err) {
      console.error('checkout error', err);
      toast('Не удалось создать платёж. Попробуйте ещё раз.');
      btn.disabled = false;
      btn.textContent = 'Перейти к оплате';
    }
  });
};

/* ── Success page (polling) ── */
const renderSuccess = () => {
  const root = document.getElementById('successRoot');
  if (!root) return;
  const url = new URL(location.href);
  const orderId = url.searchParams.get('orderId') || sessionStorage.getItem('iva_last_order');
  if (!orderId) {
    root.innerHTML = `<div class="empty"><div class="empty__title">Заказ не найден</div><a class="btn btn--ghost" href="catalog.html" style="margin-top:16px">К каталогу</a></div>`;
    return;
  }

  const showState = (state) => {
    if (state === 'pending') {
      root.innerHTML = `
        <div class="empty">
          <div class="empty__icon" style="font-size:48px">⏳</div>
          <div class="empty__title">Проверяем оплату...</div>
          <p>Это займёт несколько секунд</p>
        </div>`;
    } else if (state === 'paid') {
      root.innerHTML = `
        <div class="empty">
          <div class="empty__icon" style="color:var(--accent);font-size:64px">✓</div>
          <div class="empty__title">Заказ #${orderId} оплачен!</div>
          <p>Менеджер свяжется в ближайшее время для подтверждения деталей.</p>
          <a class="btn btn--primary" href="index.html" style="margin-top:24px">На главную</a>
        </div>`;
    } else if (state === 'canceled') {
      root.innerHTML = `
        <div class="empty">
          <div class="empty__icon" style="color:var(--danger);font-size:64px">✕</div>
          <div class="empty__title">Платёж отменён</div>
          <p>Заказ #${orderId} не оплачен. Можно попробовать ещё раз.</p>
          <a class="btn btn--primary" href="checkout.html" style="margin-top:24px">К оформлению</a>
        </div>`;
    } else {
      root.innerHTML = `
        <div class="empty">
          <div class="empty__title">Заказ #${orderId}</div>
          <p>Статус: ${state}</p>
          <a class="btn btn--ghost" href="index.html" style="margin-top:24px">На главную</a>
        </div>`;
    }
  };

  showState('pending');
  let tries = 0;
  const poll = async () => {
    tries++;
    try {
      const r = await fetch(`${API_BASE}/api/orders/${orderId}/status`);
      const d = await r.json();
      if (d.payment_status === 'succeeded' || d.status === 'paid') return showState('paid');
      if (d.payment_status === 'canceled') return showState('canceled');
    } catch {}
    if (tries < 20) setTimeout(poll, 2000);
    else showState('pending');
  };
  poll();
};

/* ── Contact form ── */
const wireContactForm = () => {
  const form = document.getElementById('contactForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let valid = true;
    form.querySelectorAll('.field').forEach(f => f.classList.remove('is-error'));
    const name = form.querySelector('[name="name"]');
    const phone = form.querySelector('[name="phone"]');
    if (!name.value.trim()) { name.closest('.field').classList.add('is-error'); valid = false; }
    if (!phone.value.trim() || phone.value.replace(/\D/g, '').length < 10) {
      phone.closest('.field').classList.add('is-error'); valid = false;
    }
    if (!valid) return;
    toast('Сообщение отправлено! Скоро свяжемся');
    form.reset();
  });
};

/* ── Petals ── */
const seedPetals = () => {
  const c = document.getElementById('petals');
  if (!c) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (10 + Math.random() * 14) + 's';
    p.style.animationDelay = (Math.random() * 12) + 's';
    c.appendChild(p);
  }
};

const wireBurger = () => {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('nav');
  burger?.addEventListener('click', () => nav.classList.toggle('open'));
};

const wireCart = () => {
  document.getElementById('cartBtn')?.addEventListener('click', () => { renderCart(); openDrawer(); });
  document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
  document.getElementById('drawerBackdrop')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });
};

/* ── Boot ── */
const loadProducts = async () => {
  const tryFetch = async (path) => {
    try {
      const r = await fetch(API_BASE + path);
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  };

  const [showcase, templates] = await Promise.all([
    tryFetch('/api/products/showcase'),
    tryFetch('/api/products/templates'),
  ]);
  let list = [...showcase, ...templates].map(p => ({
    ...p,
    name: p.title || p.name,
    popular: p.popular || 5,
  }));

  if (!list.length) {
    // Fallback static
    try {
      const r = await fetch('products.json');
      const j = await r.json();
      list = j.map(p => ({ ...p, popular: p.popular || 5 }));
    } catch {}
  }

  PRODUCTS = list;
};

/* Custom dropdown: оборачиваем <select.sort> в нашу менюшку,
   нативный селект остаётся источником истины (value + change event). */
const enhanceSelect = (sel) => {
  if (!sel || sel.dataset.enhanced) return;
  sel.dataset.enhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'dropdown';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add('dropdown__native');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dropdown__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `
    <span class="dropdown__label"></span>
    <svg class="dropdown__chev" viewBox="0 0 12 8" width="12" height="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="1.5,1.5 6,6.5 10.5,1.5"/>
    </svg>`;
  wrap.appendChild(btn);

  const menu = document.createElement('div');
  menu.className = 'dropdown__menu';
  menu.setAttribute('role', 'listbox');
  wrap.appendChild(menu);

  const opts = [...sel.options];
  menu.innerHTML = opts.map(o =>
    `<button type="button" role="option" class="dropdown__opt" data-val="${o.value}">${o.textContent}</button>`
  ).join('');

  const label = btn.querySelector('.dropdown__label');
  const sync = () => {
    const cur = opts.find(o => o.value === sel.value) || opts[0];
    label.textContent = cur.textContent;
    menu.querySelectorAll('.dropdown__opt').forEach(b => {
      b.classList.toggle('is-active', b.dataset.val === sel.value);
    });
  };
  sync();

  const close = () => { wrap.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); };
  const open  = () => { wrap.classList.add('is-open');    btn.setAttribute('aria-expanded', 'true');  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.contains('is-open') ? close() : open();
  });
  menu.addEventListener('click', (e) => {
    const o = e.target.closest('.dropdown__opt');
    if (!o) return;
    sel.value = o.dataset.val;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    close();
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
};

/* Гидратация hero/about из /api/app-settings — админ меняет тексты/картинки в реальном времени */
const hydrateSiteContent = async () => {
  try {
    const s = await fetch('/api/app-settings', { cache: 'no-store' }).then(r => r.json());
    const site = s?.site || {};
    const setText = (sel, val) => { const el = document.querySelector(sel); if (el && val != null) el.textContent = val; };
    const setHTML = (sel, html) => { const el = document.querySelector(sel); if (el && html != null) el.innerHTML = html; };
    const setImg = (sel, val) => { const el = document.querySelector(sel); if (el && val) el.src = val; };

    if (site.hero_eyebrow != null) setText('.hero .eyebrow', site.hero_eyebrow);
    if (site.hero_title_1 || site.hero_title_2) {
      setHTML('.hero__title', `${site.hero_title_1 || ''}<br><em>${site.hero_title_2 || ''}</em>`);
    }
    if (site.hero_text != null) setText('.hero__text', site.hero_text);
    if (site.hero_image) setImg('.hero__image img', site.hero_image);
    if (site.hero_badge_price || site.hero_badge_text) {
      setHTML('.hero__badge', `<strong>${site.hero_badge_price || ''}</strong>${site.hero_badge_text || ''}`);
    }
    if (site.about_image) setImg('.about__img img', site.about_image);
    if (site.about_title_1 || site.about_title_2) {
      const h = document.querySelector('.about__text h2');
      if (h) h.innerHTML = `${site.about_title_1 || ''}<br>${site.about_title_2 || ''}`;
    }
    const paras = document.querySelectorAll('.about__text p');
    if (paras[0] && site.about_text_1) paras[0].textContent = site.about_text_1;
    if (paras[1] && site.about_text_2) paras[1].textContent = site.about_text_2;
  } catch {}
};

/* ===== Аналитика: beacon в /api/analytics/track ===== */
const _sessionId = (() => {
  try {
    let s = localStorage.getItem('iva_sid');
    if (!s) {
      s = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('iva_sid', s);
    }
    return s;
  } catch { return ''; }
})();
const track = (event, meta) => {
  try {
    const body = JSON.stringify({
      source: 'site', event,
      path: location.pathname + location.search,
      session_id: _sessionId, meta: meta || undefined,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/track', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch {}
};

document.addEventListener('DOMContentLoaded', async () => {
  track('pageview');
  seedPetals();
  wireBurger();
  wireCart();
  wireContactForm();
  updateCartBadge();
  renderCart();
  document.querySelectorAll('.sort').forEach(enhanceSelect);
  hydrateSiteContent();
  await loadProducts();
  renderPopular();
  renderCatalog();
  renderProduct();
  renderCheckout();
  renderSuccess();
});
