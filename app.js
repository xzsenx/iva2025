/* ============================================================
   IVA — Цветочная студия  |  Mini-App Logic
   Навигация между экранами, корзина, карточка, оформление
   ============================================================ */

const app = (() => {
  /* ── State ── */
  let cart = JSON.parse(localStorage.getItem("iva_cart") || "[]");
  let currentCategory = "all";
  let currentSort = "popular";
  let currentProduct = null;
  let selectedSize = null;

  /* ── DOM refs ── */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const screens = {
    catalog:     $("#screen-catalog"),
    product:     $("#screen-product"),
    cart:        $("#screen-cart"),
    checkout:    $("#screen-checkout"),
    thanks:      $("#screen-thanks"),
    constructor: $("#screen-constructor"),
    order:       $("#screen-order"),
  };

  const els = {
    grid:         $("#grid"),
    categories:   $("#categories"),
    sort:         $("#sort"),
    cartCount:    $("#cartCount"),
    cartBody:     $("#cartBody"),
    cartFooter:   $("#cartFooter"),
    productPage:  $("#productPage"),
    checkoutForm: $("#checkoutForm"),
    checkoutTotal:$("#checkoutTotal"),
    addressField: $("#addressField"),
  };

  /* ── Telegram WebApp ── */
  const tg = window.Telegram && window.Telegram.WebApp;
  const IS_TG = !!(tg && tg.initData !== undefined);
  if (IS_TG) {
    document.documentElement.classList.add("is-tg");
    // Большой верхний отступ нужен только на телефонах (под статус-бар).
    // На TG Desktop/Web/планшетах эта "бровь" не нужна.
    const platform = String(tg.platform || "").toLowerCase();
    const isMobilePlatform = platform === "ios" || platform === "android";
    if (isMobilePlatform) document.documentElement.classList.add("is-tg-mobile");
  }

  if (tg) {
    try {
      tg.ready();
      tg.expand();
      /* Запросить полноэкранный режим (TG 7.7+) — без падения если метода нет */
      if (typeof tg.requestFullscreen === "function") {
        try { tg.requestFullscreen(); } catch {}
      }
      /* Подтверждение закрытия если есть несохранённое состояние */
      if (typeof tg.enableClosingConfirmation === "function") {
        tg.enableClosingConfirmation();
      }
      /* Отключить свайп-вниз для закрытия — мешает свайпам каталога */
      if (typeof tg.disableVerticalSwipes === "function") {
        tg.disableVerticalSwipes();
      }
      tg.setHeaderColor("#3D4F4C");
      tg.setBackgroundColor("#3D4F4C");
    } catch {}

    /* Динамический viewport — обновляем CSS-переменную при изменении высоты TG */
    const applyViewport = () => {
      const h = tg.viewportStableHeight || tg.viewportHeight || window.innerHeight;
      document.documentElement.style.setProperty("--tg-viewport-stable-height", h + "px");
      document.documentElement.style.setProperty("--tg-viewport-height", (tg.viewportHeight || h) + "px");
    };
    applyViewport();
    tg.onEvent && tg.onEvent("viewportChanged", applyViewport);

    /* Safe-area: в fullscreen TG прячет шапку → нужно отступать от статус-бара устройства.
       contentSafeAreaInset (TG 8.0+) — внутренние отступы (под шапку TG / статус-бар).
       safeAreaInset — отступы устройства (notch). Берём максимум для надёжности. */
    const applySafeArea = () => {
      const c = tg.contentSafeAreaInset || {};
      const s = tg.safeAreaInset || {};
      const top = Math.max(c.top || 0, s.top || 0);
      const bot = Math.max(c.bottom || 0, s.bottom || 0);
      // Минимум 12px сверху в fullscreen — чтобы заголовок не лип к статус-бару
      const isFullscreen = !!tg.isFullscreen;
      const topPx = (isFullscreen && top < 44 ? Math.max(top, 44) : top) + "px";
      document.documentElement.style.setProperty("--tg-safe-top", topPx);
      document.documentElement.style.setProperty("--tg-safe-bottom", (bot || 0) + "px");
    };
    applySafeArea();
    tg.onEvent && tg.onEvent("safeAreaChanged", applySafeArea);
    tg.onEvent && tg.onEvent("contentSafeAreaChanged", applySafeArea);
    tg.onEvent && tg.onEvent("fullscreenChanged", applySafeArea);
  }

  /* ── Haptic helper ── */
  function haptic(kind) {
    if (!tg || !tg.HapticFeedback) return;
    try {
      switch (kind) {
        case "light":   tg.HapticFeedback.impactOccurred("light"); break;
        case "medium":  tg.HapticFeedback.impactOccurred("medium"); break;
        case "heavy":   tg.HapticFeedback.impactOccurred("heavy"); break;
        case "soft":    tg.HapticFeedback.impactOccurred("soft"); break;
        case "rigid":   tg.HapticFeedback.impactOccurred("rigid"); break;
        case "success": tg.HapticFeedback.notificationOccurred("success"); break;
        case "warning": tg.HapticFeedback.notificationOccurred("warning"); break;
        case "error":   tg.HapticFeedback.notificationOccurred("error"); break;
        case "select":  tg.HapticFeedback.selectionChanged(); break;
      }
    } catch {}
  }
  window.haptic = haptic;

  /* ── Toast ── */
  let toastEl = document.createElement("div");
  toastEl.className = "toast";
  document.body.appendChild(toastEl);

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  /* ── Helpers ── */
  function formatPrice(n) {
    return n.toLocaleString("ru-RU") + " \u20BD";
  }

  function badgeHTML(badgeId) {
    if (!badgeId) return "";
    const saved = localStorage.getItem("iva_badges");
    let badges = [
      { id: "hit", name: "Hit", color: "#C9A4A0" },
      { id: "season", name: "Сезон", color: "#A8C5A0" },
      { id: "new", name: "New", color: "#C8B07A" },
    ];
    if (saved) { try { const p = JSON.parse(saved); if (Array.isArray(p) && p.length) badges = p; } catch {} }
    const b = badges.find(x => x.id === badgeId);
    if (!b) return `<span class="badge">${badgeId}</span>`;
    return `<span class="badge" style="background:${b.color};color:#fff">${b.name}</span>`;
  }

  /* ── Navigation ── */
  let catalogScrollY = 0;
  let screenHistory = ["catalog"];

  function currentScreenName() {
    for (const [name, el] of Object.entries(screens)) {
      if (el.classList.contains("active")) return name;
    }
    return "catalog";
  }

  /* TG BackButton — показываем если не на каталоге */
  function syncBackButton() {
    if (!tg || !tg.BackButton) return;
    try {
      if (screenHistory.length > 1) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch {}
  }

  function showScreen(name) {
    const prev = currentScreenName();
    /* Запоминаем скролл каталога перед уходом */
    if (prev === "catalog" && name !== "catalog") {
      catalogScrollY = window.scrollY;
    }
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    /* Если выходим из конструктора — пропускаем fade-анимацию следующего экрана */
    const target = screens[name];
    if (prev === "constructor" && target) {
      target.style.animation = "none";
      requestAnimationFrame(() => { target.style.animation = ""; });
    }
    target.classList.add("active");
    if (name === "catalog") {
      window.scrollTo(0, catalogScrollY);
    } else {
      window.scrollTo(0, 0);
    }
    /* Обновляем историю */
    if (name !== prev) {
      const idx = screenHistory.indexOf(name);
      if (idx !== -1) {
        screenHistory = screenHistory.slice(0, idx + 1);
      } else {
        screenHistory.push(name);
      }
    }
    syncBackButton();
  }

  function goBack() {
    if (screenHistory.length <= 1) return;
    haptic("light");
    screenHistory.pop();
    const prev = screenHistory[screenHistory.length - 1];
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[prev].classList.add("active");
    if (prev === "catalog") {
      window.scrollTo(0, catalogScrollY);
    } else {
      window.scrollTo(0, 0);
    }
    syncBackButton();
  }

  /* Подписка на нативный BackButton TG */
  if (tg && tg.BackButton) {
    try { tg.BackButton.onClick(() => goBack()); } catch {}
  }

  /* ── Swipe Back (iOS-style) ── */
  (function initSwipeBack() {
    let startX = 0;
    let startY = 0;
    let swiping = false;

    document.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      /* Только от левого края (первые 30px) */
      if (touch.clientX < 30 && screenHistory.length > 1) {
        startX = touch.clientX;
        startY = touch.clientY;
        swiping = true;
      }
    }, { passive: true });

    document.addEventListener("touchend", (e) => {
      if (!swiping) return;
      swiping = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      /* Свайп вправо > 80px и горизонтальнее чем вертикальный */
      if (dx > 80 && dx > dy * 1.5) {
        goBack();
      }
    }, { passive: true });
  })();

  /* ── Categories ── */
  function renderCategories() {
    els.categories.innerHTML = CATEGORIES.map(
      (c) =>
        `<button class="cat-pill${c.id === currentCategory ? " active" : ""}"
                data-cat="${c.id}">${c.name}</button>`
    ).join("");

    els.categories.querySelectorAll(".cat-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        if (cat === "custom") {
          showConstructor();
          return;
        }
        currentCategory = cat;
        renderCategories();
        renderGrid();
      });
    });
  }

  /* ── Filter & Sort ── */
  function getFilteredList() {
    /* Каждый раз читаем актуальные данные из localStorage (связь с админкой) */
    BOUQUETS = getProducts();
    let list = [...BOUQUETS];

    if (currentCategory !== "all") {
      list = list.filter((b) => b.category === currentCategory);
    }

    switch (currentSort) {
      case "popular":
        list.sort((a, b) => b.popular - a.popular);
        break;
      case "price_asc":
        list.sort((a, b) => a.price - b.price);
        break;
      case "price_desc":
        list.sort((a, b) => b.price - a.price);
        break;
      case "new":
        list.sort((a, b) => (b.badge === "new" ? 1 : 0) - (a.badge === "new" ? 1 : 0));
        break;
    }

    return list;
  }

  /* ── Product Grid ── */
  function getCartQty(productId) {
    return cart
      .filter((i) => i.id === productId)
      .reduce((s, i) => s + i.qty, 0);
  }

  function cardBottomHTML(b) {
    if (b.stock != null && b.stock <= 0) {
      return `<div class="card__stock card__stock--out">Нет в наличии</div>`;
    }
    const qty = getCartQty(b.id);
    const stockHTML = b.stock != null && b.stock <= 30
      ? `<div class="card__stock card__stock--low">Можно собрать: ${b.stock}</div>` : "";
    if (qty > 0) {
      const maxReached = b.stock != null && qty >= b.stock;
      return `${stockHTML}
        <div class="card__qty">
          <button class="card__qty-btn${qty === 1 ? " card__qty-btn--remove" : ""}"
                  onclick="event.stopPropagation(); app.cardMinus('${b.id}')">
            ${qty === 1 ? "✕" : "−"}
          </button>
          <span class="card__qty-num">${qty}</span>
          <button class="card__qty-btn${maxReached ? " card__qty-btn--disabled" : ""}"
                  onclick="event.stopPropagation(); app.cardPlus('${b.id}')"
                  ${maxReached ? "disabled" : ""}>+</button>
        </div>`;
    }
    return `${stockHTML}
      <button class="card__add-btn" onclick="event.stopPropagation(); app.quickAdd('${b.id}')">
        В корзину
      </button>`;
  }

  function updateCardBottom(id) {
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    const card = els.grid.querySelector(`.card[data-id="${id}"]`);
    if (!card) return;
    const info = card.querySelector(".card__info");
    // Remove old bottom (qty counter or add-btn or stock-out)
    const oldQty = info.querySelector(".card__qty");
    const oldBtn = info.querySelector(".card__add-btn");
    const oldStock = info.querySelector(".card__stock");
    if (oldQty) oldQty.remove();
    if (oldBtn) oldBtn.remove();
    if (oldStock) oldStock.remove();
    // Insert new bottom
    const temp = document.createElement("div");
    temp.innerHTML = cardBottomHTML(b);
    while (temp.firstChild) info.appendChild(temp.firstChild);
  }

  function renderGrid() {
    const list = getFilteredList();

    if (list.length === 0) {
      els.grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;opacity:.5">
        Товаров не найдено</div>`;
      return;
    }

    els.grid.innerHTML = list
      .map(
        (b, i) => `
      <div class="card" data-id="${b.id}" style="animation-delay:${i * 0.05}s" onclick="app.showProduct('${b.id}')">
        <div class="card__img-wrap${b.img ? '' : ' card__img-wrap--noimg'}">
          ${b.img
            ? `<img class="card__img" src="${b.img}" alt="${b.name}" loading="lazy">`
            : `Нет фото`}
          ${badgeHTML(b.badge)}
        </div>
        <div class="card__info">
          <div class="card__name">${b.name}</div>
          <div class="card__price">${formatPrice(b.price)}</div>
          ${cardBottomHTML(b)}
        </div>
      </div>`
      )
      .join("");
  }

  /* ── Analytics ── */
  const STATS_KEY = "iva_stats";

  function trackEvent(id, field) {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      const stats = raw ? JSON.parse(raw) : {};
      if (!stats[id]) stats[id] = { views: 0, adds: 0 };
      stats[id][field] = (stats[id][field] || 0) + 1;
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {}
  }

  /* ── Product Page ── */
  function showProduct(id) {
    BOUQUETS = getProducts();
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    trackEvent(id, "views");
    currentProduct = b;
    selectedSize = b.sizes ? b.sizes[0] : null;

    els.productPage.innerHTML = `
      <div class="product-hero">
        <img class="product-hero__img" src="${b.img}" alt="${b.name}">
        <button class="product-hero__back" onclick="app.showCatalog()">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>
      <div class="product-body">
        ${b.badge ? `<div class="product-body__badge">${badgeHTML(b.badge)}</div>` : ""}
        <h1 class="product-body__name">${b.name}</h1>
        <div class="product-body__price">${formatPrice(b.price)}</div>
        <p class="product-body__desc">${b.desc}</p>
        ${b.stock != null
          ? b.stock <= 0
            ? `<div class="product-body__stock product-body__stock--out">Нет в наличии</div>`
            : b.stock <= 5
              ? `<div class="product-body__stock product-body__stock--low">Осталось: ${b.stock} шт.</div>`
              : `<div class="product-body__stock">В наличии: ${b.stock} шт.</div>`
          : ""}
        ${
          b.sizes
            ? `<p class="sizes__label">Размер</p>
               <div class="sizes" id="sizeSelector">
                 ${b.sizes
                   .map(
                     (s) =>
                       `<button class="size-btn${s === selectedSize ? " active" : ""}"
                               data-size="${s}" onclick="app.selectSize('${s}')">${s}</button>`
                   )
                   .join("")}
               </div>`
            : ""
        }
      </div>
      <div class="product-actions">
        ${b.stock != null && b.stock <= 0
          ? `<button class="btn btn--primary btn--lg" disabled style="opacity:.5;cursor:not-allowed">Нет в наличии</button>`
          : `<button class="btn btn--primary btn--lg" onclick="app.addToCart()">Добавить в корзину — ${formatPrice(b.price)}</button>`}
      </div>
    `;

    showScreen("product");
  }

  function selectSize(s) {
    selectedSize = s;
    document.querySelectorAll(".size-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.size === s);
    });
  }

  /* ── Cart Logic ── */
  function saveCart() {
    localStorage.setItem("iva_cart", JSON.stringify(cart));
    updateCartBadge();
  }

  function updateCartBadge() {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    const el = els.cartCount;
    el.textContent = count;
    el.classList.toggle("visible", count > 0);
  }

  function cartSubtotal() {
    return cart.reduce((s, i) => {
      if (i.custom) return s + i.custom.price * i.qty;
      const b = BOUQUETS.find((x) => x.id === i.id);
      return s + (b ? b.price * i.qty : 0);
    }, 0);
  }
  function cartDiscountAmount() {
    return Math.round(cartSubtotal() * activeDiscountPercent() / 100);
  }
  function cartTotal() {
    return Math.max(0, cartSubtotal() - cartDiscountAmount());
  }

  function quickAdd(id) {
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    const size = b.sizes ? b.sizes[0] : null;
    addItemToCart(id, size);
    haptic("success");
    toast("Добавлено в корзину");
    updateCardBottom(id);
  }

  function cardPlus(id) {
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    const size = b.sizes ? b.sizes[0] : null;
    addItemToCart(id, size);
    haptic("light");
    updateCardBottom(id);
  }

  function cardMinus(id) {
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    const size = b.sizes ? b.sizes[0] : null;
    const key = `${id}_${size || ""}`;
    const item = cart.find((i) => i.key === key);
    if (!item) return;
    item.qty--;
    if (item.qty <= 0) {
      cart = cart.filter((i) => i.key !== key);
    }
    haptic("light");
    saveCart();
    updateCardBottom(id);
  }

  function addToCart() {
    if (!currentProduct) return;
    if (addItemToCart(currentProduct.id, selectedSize) === false) return;
    haptic("success");
    toast("Добавлено в корзину");
    updateCardBottom(currentProduct.id);
    showCatalog();
  }

  function addItemToCart(id, size) {
    const b = BOUQUETS.find((x) => x.id === id);
    /* Проверяем лимит по stock */
    if (b && b.stock != null) {
      const totalInCart = getCartQty(id);
      if (totalInCart >= b.stock) {
        toast("Максимум: " + b.stock + " шт.");
        return false;
      }
    }
    const key = `${id}_${size || ""}`;
    const existing = cart.find((i) => i.key === key);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({ key, id, size, qty: 1 });
    }
    saveCart();
    trackEvent("add_to_cart", { id, name: b ? b.name : "?", price: b ? b.price : 0 });
    return true;
  }

  function changeQty(key, delta) {
    const item = cart.find((i) => i.key === key);
    if (!item) return;

    /* Проверка stock при увеличении */
    if (delta > 0) {
      const b = BOUQUETS.find((x) => x.id === item.id);
      if (b && b.stock != null && getCartQty(item.id) >= b.stock) {
        toast("Максимум: " + b.stock + " шт.");
        return;
      }
    }

    const productId = item.id;
    item.qty += delta;
    if (item.qty <= 0) {
      cart = cart.filter((i) => i.key !== key);
      saveCart();
      renderCart();
      updateCardBottom(productId);
      return;
    }
    saveCart();
    updateCartItem(key);
    updateCardBottom(productId);
  }

  function updateCartItem(key) {
    const item = cart.find((i) => i.key === key);
    if (!item) return;
    const b = BOUQUETS.find((x) => x.id === item.id);
    if (!b) return;

    const row = els.cartBody.querySelector(`.cart-item[data-key="${key}"]`);
    if (!row) { renderCart(); return; }

    row.querySelector(".cart-item__price").textContent = formatPrice(b.price * item.qty);
    row.querySelector(".cart-item__qty").textContent = item.qty;

    const minusBtn = row.querySelector(".qty-btn:last-child");
    if (item.qty === 1) {
      minusBtn.classList.add("qty-btn--remove");
      minusBtn.innerHTML = "✕";
    } else {
      minusBtn.classList.remove("qty-btn--remove");
      minusBtn.innerHTML = "−";
    }

    /* Обновляем итого */
    const totalEl = els.cartFooter.querySelector(".cart-total__sum");
    if (totalEl) totalEl.textContent = formatPrice(cartTotal());
  }

  /* ── Cart Screen ── */
  function renderCart() {
    if (cart.length === 0) {
      /* После оформления юзер часто идёт в корзину — покажем плашку заказа тут тоже */
      let orderBadge = '';
      try {
        const lastId = localStorage.getItem('iva_last_order');
        if (lastId) {
          const cache = JSON.parse(localStorage.getItem('iva_order_cache_' + lastId) || 'null');
          const skip = cache?.status === 'cancelled' || cache?.payment_status === 'canceled';
          let deliveredExpired = false;
          if (cache?.status === 'delivered') {
            const upd = cache.status_updated_at;
            const doneAt = upd ? new Date(upd.replace(' ', 'T') + 'Z').getTime() : 0;
            deliveredExpired = !doneAt || (Date.now() - doneAt) > 24 * 3600_000;
          }
          if (!skip && !deliveredExpired) {
            const STATUS_LABELS = { pending:'Ждём оплату', paid:'Оплачен', assembling:'Собираем', assembled:'Собран', in_delivery:'В пути', delivered:'Доставлен' };
            const status = cache?.status || 'pending';
            const label = STATUS_LABELS[status] || 'Заказ в работе';
            orderBadge = `
              <div class="order-badge" onclick="app.showOrderStatus('${lastId}')" style="margin:0 0 20px;cursor:pointer">
                <div class="order-badge__icon">📦</div>
                <div class="order-badge__body">
                  <div class="order-badge__title">Заказ #${lastId} · ${label}</div>
                  <div class="order-badge__sub">Открыть страницу заказа</div>
                </div>
                <div class="order-badge__arrow">›</div>
              </div>`;
          }
        }
      } catch {}
      els.cartBody.innerHTML = orderBadge + `
        <div class="cart-empty">
          <div class="cart-empty__icon">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
          </div>
          <div class="cart-empty__text">Корзина пуста</div>
        </div>`;
      els.cartFooter.innerHTML = "";
      return;
    }

    els.cartBody.innerHTML = cart
      .map((item) => {
        if (item.custom) {
          const c = item.custom;
          const composition = c.items.map(i => `${i.title} ×${i.qty}`).join(", ");
          return `
        <div class="cart-item" data-key="${item.key}">
          <div class="cart-item__img" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);font-size:28px">🌷</div>
          <div class="cart-item__info">
            <div class="cart-item__name">${c.name}</div>
            <div class="cart-item__meta" style="font-size:12px;opacity:.7">${composition}</div>
            <div class="cart-item__price">${formatPrice(c.price * item.qty)}</div>
          </div>
          <div class="cart-item__controls">
            <button class="qty-btn qty-btn--remove" onclick="app.changeQty('${item.key}', -1)">✕</button>
          </div>
        </div>`;
        }
        const b = BOUQUETS.find((x) => x.id === item.id);
        if (!b) return "";
        return `
        <div class="cart-item" data-key="${item.key}">
          <img class="cart-item__img" src="${b.img}" alt="${b.name}">
          <div class="cart-item__info">
            <div class="cart-item__name">${b.name}</div>
            ${item.size ? `<div class="cart-item__meta">Размер: ${item.size}</div>` : ""}
            <div class="cart-item__price">${formatPrice(b.price * item.qty)}</div>
          </div>
          <div class="cart-item__controls">
            <button class="qty-btn" onclick="app.changeQty('${item.key}', 1)">+</button>
            <span class="cart-item__qty">${item.qty}</span>
            <button class="qty-btn${item.qty === 1 ? " qty-btn--remove" : ""}"
                    onclick="app.changeQty('${item.key}', -1)">
              ${item.qty === 1 ? "✕" : "−"}
            </button>
          </div>
        </div>`;
      })
      .join("");

    const pct = activeDiscountPercent();
    const discountAmt = cartDiscountAmount();
    const list = (APP_SETTINGS.discount && APP_SETTINGS.discount.promocodes) || [];
    const promocodesEnabled = list.length > 0;

    const promocodeBlock = promocodesEnabled ? `
      <div class="promocode-box">
        ${APPLIED_PROMOCODE
          ? `<div class="promocode-box__applied">
               <span>Промокод: <b>${APPLIED_PROMOCODE}</b></span>
               <button class="promocode-box__clear" onclick="app.clearPromocode()">✕</button>
             </div>`
          : `<form class="promocode-box__form" onsubmit="return app.applyPromocodeForm(event)">
               <input type="text" name="code" placeholder="Промокод" autocomplete="off">
               <button type="submit">Применить</button>
             </form>`}
      </div>` : "";

    const totalsBlock = `
      <div class="cart-totals">
        ${pct > 0 ? `
          <div class="cart-totals__row">
            <span>Сумма</span><span>${formatPrice(cartSubtotal())}</span>
          </div>
          <div class="cart-totals__row cart-totals__row--discount">
            <span>Скидка ${pct}%</span><span>−${formatPrice(discountAmt)}</span>
          </div>` : ""}
        <div class="cart-total">
          <span class="cart-total__label">Итого</span>
          <span class="cart-total__sum">${formatPrice(cartTotal())}</span>
        </div>
      </div>`;

    els.cartFooter.innerHTML = `
      ${promocodeBlock}
      ${totalsBlock}
      <button class="btn btn--primary btn--lg" onclick="app.showCheckout()">
        Оформить заказ
      </button>
    `;
  }

  function applyPromocodeForm(e) {
    e.preventDefault();
    const input = e.target.querySelector('input[name="code"]');
    const res = tryApplyPromocode(input.value);
    toast(res.message);
    return false;
  }

  function showCart() {
    renderCart();
    showScreen("cart");
  }

  /* ── Checkout ── */
  function showCheckout() {
    if (cart.length === 0) return;
    trackEvent("begin_checkout", { total: cartTotal(), items_count: cart.length });

    // Дата по умолчанию — завтра
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const dateInput = els.checkoutForm.querySelector('[name="date"]');
    if (dateInput) dateInput.value = dateStr;

    els.checkoutTotal.innerHTML = `
      <span>Итого</span>
      <span class="checkout-total__sum">${formatPrice(cartTotal())}</span>
    `;

    // Первичная привязка — только раз за жизнь формы
    if (!els.checkoutForm.dataset.wired) {
      els.checkoutForm.querySelectorAll('[name="delivery"]').forEach((r) => {
        r.addEventListener("change", syncCheckoutUI);
      });
      const chkGift = els.checkoutForm.querySelector('#chkGift');
      const chkAskAddr = els.checkoutForm.querySelector('#chkAskAddr');
      chkGift?.addEventListener('change', syncCheckoutUI);
      chkAskAddr?.addEventListener('change', syncCheckoutUI);
      els.checkoutForm.dataset.wired = '1';
    }
    syncCheckoutUI();

    showScreen("checkout");
  }

  /* Синхронизация состояния формы: доставка/самовывоз + gift-тумблеры. */
  function syncCheckoutUI() {
    const form = els.checkoutForm;
    const delivery = form.querySelector('[name="delivery"]:checked').value;
    const isDelivery = delivery === 'delivery';
    const chkGift = form.querySelector('#chkGift');
    const chkAskAddr = form.querySelector('#chkAskAddr');
    /* Самовывоз → gift не имеет смысла: снимаем и прячем тумблер */
    if (!isDelivery && chkGift?.checked) chkGift.checked = false;
    const giftRow = form.querySelector('#giftToggleRow');
    if (giftRow) giftRow.style.display = isDelivery ? '' : 'none';

    const isGift = !!chkGift?.checked;
    const askAddr = isGift && !!chkAskAddr?.checked;

    /* Адрес доставки: только если доставка И (не подарок или адрес известен) */
    const addrField = els.addressField;
    const addrLabel = form.querySelector('#addressLabel');
    const addrInput = form.querySelector('[name="address"]');
    const showAddr = isDelivery && !askAddr;
    if (addrField) addrField.style.display = showAddr ? 'flex' : 'none';
    if (addrLabel) addrLabel.textContent = isGift ? 'Адрес получателя' : 'Адрес';
    if (addrInput) addrInput.placeholder = isGift ? 'Куда доставить букет' : 'ул. Попова 23, кв. 5';

    /* Gift-блок */
    const giftBlock = form.querySelector('#giftBlock');
    if (giftBlock) giftBlock.style.display = isGift ? 'flex' : 'none';

    /* Время: если адрес уточняется у получателя — время тоже уточним у него */
    const timeField = form.querySelector('#timeField');
    const askNote = form.querySelector('#askTimeNote');
    const dateLabel = form.querySelector('#dateLabel');
    if (askAddr) {
      if (timeField) timeField.style.display = 'none';
      if (askNote) askNote.style.display = 'block';
      if (dateLabel) dateLabel.textContent = 'Желаемая дата';
    } else {
      if (timeField) timeField.style.display = '';
      if (askNote) askNote.style.display = 'none';
      if (dateLabel) dateLabel.textContent = 'Дата';
    }
  }

  /* ── Submit Order ── */
  async function submitOrder(e) {
    e.preventDefault();
    const fd = new FormData(els.checkoutForm);

    /* Готовим items — для обычных букетов и для кастомного с составом */
    const items = cart.map((i) => {
      if (i.custom) {
        return {
          id: i.id,
          name: i.custom.name,
          qty: i.qty,
          price: i.custom.price,
          custom: i.custom,   // содержит items[], note, wishes
        };
      }
      const b = BOUQUETS.find((x) => x.id === i.id);
      return {
        id: i.id,
        name: b ? b.name : "?",
        size: i.size,
        qty: i.qty,
        price: b ? b.price : 0,
      };
    });

    const isGift = !!els.checkoutForm.querySelector('#chkGift')?.checked;
    const askAddr = isGift && !!els.checkoutForm.querySelector('#chkAskAddr')?.checked;
    /* Если подарок и адрес не «уточним у получателя» — телефон получателя обязателен */
    if (isGift && !askAddr && !String(fd.get('recipient_phone') || '').trim()) {
      toast('Введите телефон получателя');
      return false;
    }
    const gift = isGift ? {
      enabled: true,
      recipient_name: String(fd.get('recipient_name') || '').trim(),
      recipient_phone: String(fd.get('recipient_phone') || '').trim(),
      ask_recipient_address: askAddr,
      is_surprise: !!els.checkoutForm.querySelector('#chkSurprise')?.checked,
      card_message: String(fd.get('card_message') || '').trim(),
    } : undefined;

    const order = {
      items,
      total: cartTotal(),
      name: fd.get("name"),
      phone: fd.get("phone"),
      delivery: fd.get("delivery"),
      address: fd.get("address") || "",
      date: fd.get("date"),
      time: askAddr ? "" : fd.get("time"),
      comment: fd.get("comment") || "",
      gift,
      /* TG user_id — чтобы бот мог пуш-нотификации о смене статуса слать */
      tg_user_id: tg?.initDataUnsafe?.user?.id || null,
      /* Юкасса вернёт юзера сюда после оплаты (в системный браузер) */
      return_url_template: location.origin + "/success.html?id={ORDER_ID}",
    };

    const submitBtn = els.checkoutForm.querySelector('[type="submit"]');
    const origText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Создаём платёж…";

    try {
      const resp = await fetch(API_BASE + "/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(order),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      trackEvent("order_placed", { order_id: data.id, total: order.total });

      /* Очищаем корзину до редиректа */
      cart = [];
      saveCart();
      els.checkoutForm.reset();

      /* КРИТИЧНО: сохраняем id, чтобы после возврата в апку не потерять заказ.
         Ключ переживает закрытие апки/перезапуск Telegram. */
      try { localStorage.setItem("iva_last_order", String(data.id)); } catch {}

      if (!data.confirmation_url) {
        showOrderStatus(data.id);
        return false;
      }
      /* Показываем внутренний экран статуса ДО открытия платежа —
         пока юзер оплачивает в браузере, мини-апа пуллит статус.
         Когда он вернётся в апку, увидит актуальное состояние. */
      showOrderStatus(data.id);
      /* Редирект на оплату (в системный браузер) */
      if (tg && tg.openLink) {
        tg.openLink(data.confirmation_url);
      } else {
        window.location.href = data.confirmation_url;
      }
      return false;
    } catch (err) {
      console.error("Ошибка создания платежа:", err);
      toast("Не удалось создать платёж: " + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
      return false;
    }
  }

  /* ── Show Catalog ── */
  function showCatalog() {
    showScreen("catalog");
  }

  /* ── Экран статуса заказа ── */
  /* SYNC: этот блок (ORDER_STEPS + showOrderStatus + poll + refreshOrderBadge)
     дублируется в /site/app.js — renderSuccess. При правках синхронизируй оба. */
  const ORDER_STEPS = [
    { key: 'paid',         label: 'Оплачен',  icon: '💳' },
    { key: 'assembling',   label: 'Собираем', icon: '🌸' },
    { key: 'assembled',    label: 'Собран',   icon: '🎁' },
    { key: 'in_delivery',  label: 'В пути',   icon: '🚚' },
    { key: 'delivered',    label: 'Доставлен',icon: '💚' },
  ];
  const STEP_INDEX = { pending:-1, paid:0, assembling:1, assembled:2, in_delivery:3, delivered:4 };
  let _orderPollTimer = null;
  let _orderCurrentId = null;

  function stopOrderPolling() {
    if (_orderPollTimer) { clearTimeout(_orderPollTimer); _orderPollTimer = null; }
  }

  function renderOrderStatus(data, id) {
    const body = document.getElementById('orderStatusBody');
    if (!body) return;
    const paid = data.payment_status === 'succeeded' || STEP_INDEX[data.status] >= 0;
    const cancelled = data.status === 'cancelled' || data.payment_status === 'canceled';
    const currentIdx = cancelled ? -1 : (STEP_INDEX[data.status] ?? 0);
    const money = (n) => (Number(n)||0).toLocaleString('ru-RU') + ' ₽';
    const humanDate = (row) => {
      if (!row?.delivery_date) return '';
      try {
        const [y,m,d] = row.delivery_date.split('-');
        return (`${d}.${m} · ${row.delivery_time || ''}`).trim();
      } catch { return row.delivery_date + ' ' + (row.delivery_time || ''); }
    };
    const timeline = ORDER_STEPS.map((s, i) => `
      <li class="tl__item ${i <= currentIdx ? 'is-done' : ''} ${i === currentIdx ? 'is-current' : ''}">
        <span class="tl__dot">${i <= currentIdx ? '✓' : s.icon}</span>
        <span class="tl__label">${s.label}</span>
      </li>
    `).join('');
    const photo = data.photo_url
      ? `<div class="order-photo"><img src="${data.photo_url}" alt=""></div>`
      : (currentIdx >= 1
          ? `<div class="order-photo order-photo--wait">🌷<span>Флорист собирает букет — фото появится тут</span></div>`
          : '');
    const florist = data.florist_phone
      ? `<a class="order-contact" href="tel:${data.florist_phone.replace(/[^\d+]/g,'')}">
          <span class="order-contact__label">Флорист · нужны правки?</span>
          <span class="order-contact__value">${data.florist_phone}</span>
        </a>` : '';
    const isWaitingPay = !paid && !cancelled;
    const headline = cancelled
      ? { icon:'✕', title:'Платёж не прошёл', sub:'Заказ #' + id + ' не оплачен', color:'#c96a6a' }
      : paid
        ? { icon:'✓', title:'Заказ #' + id + ' оплачен', sub: data.customer_name ? 'Спасибо, ' + data.customer_name + '!' : 'Спасибо!', color:'#8fb08a' }
        : { icon:'⏳', title:'Ждём оплату…', sub:'Как только пройдёт оплата, тут появится статус', color:'var(--cream-dim)' };
    const payCta = isWaitingPay ? `
      <div class="order-pay-cta">
        <div class="order-pay-cta__text">Если окно оплаты закрылось —<br>откройте его снова</div>
        <button class="order-pay-cta__btn" onclick="app.reopenPayment(${id})">Продолжить оплату</button>
      </div>` : '';
    body.innerHTML = `
      <div class="order-hero">
        <div class="order-hero__icon" style="color:${headline.color}">${headline.icon}</div>
        <h1 class="order-hero__title">${headline.title}</h1>
        <p class="order-hero__sub">${headline.sub}</p>
      </div>
      ${paid && !cancelled ? `<ul class="tl">${timeline}</ul>` : ''}
      ${payCta}
      ${photo}
      <div class="order-info">
        ${data.delivery_type === 'delivery'
          ? `<div class="order-info__row"><span>Доставка</span><b>${data.delivery_address || 'по указанному адресу'}</b></div>`
          : `<div class="order-info__row"><span>Способ</span><b>Самовывоз · ул. Есенина, 9 к3</b></div>`}
        ${data.delivery_date ? `<div class="order-info__row"><span>Когда</span><b>${humanDate(data)}</b></div>` : ''}
        ${data.total_price ? `<div class="order-info__row"><span>Сумма</span><b>${money(data.total_price)}</b></div>` : ''}
        ${data.is_gift && data.recipient_name ? `<div class="order-info__row"><span>Получатель</span><b>${data.recipient_name}</b></div>` : ''}
      </div>
      ${florist}
      <p class="order-hint">Можно закрыть апку — статус придёт SMS.<br>Заказ #${id} · ссылка на трек: <span style="color:var(--pink)">${location.origin}/success.html?id=${id}</span></p>
    `;
  }

  async function fetchOrderTrack(id) {
    const r = await fetch(API_BASE + `/api/orders/${id}/track`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* Открыть экран статуса + запустить пуллинг */
  function showOrderStatus(id, opts = {}) {
    if (!id) return;
    stopOrderPolling();
    _orderCurrentId = String(id);
    const cacheKey = 'iva_order_cache_' + id;
    /* Кэш из localStorage — сразу что-то показать */
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch {}
    if (cached) renderOrderStatus(cached, id);
    else renderOrderStatus({ status:'pending', payment_status:'pending' }, id);
    showScreen('order');
    let tries = 0;
    const poll = async () => {
      tries++;
      try {
        const d = await fetchOrderTrack(id);
        try { localStorage.setItem(cacheKey, JSON.stringify(d)); } catch {}
        renderOrderStatus(d, id);
        if (d.status === 'delivered' || d.status === 'cancelled' || d.payment_status === 'canceled') return;
      } catch {}
      const delay = tries < 10 ? 3000 : (tries < 30 ? 15000 : 60000);
      _orderPollTimer = setTimeout(poll, delay);
    };
    poll();
  }

  /* Открыть Юкассу заново (если юзер закрыл окно оплаты). */
  async function reopenPayment(id) {
    try {
      const d = await fetch(API_BASE + `/api/orders/${id}/status`, { cache: 'no-store' }).then(r => r.json());
      if (d.payment_status === 'succeeded') { showOrderStatus(id); return; }
      /* Ссылки на confirmation_url у нас нет в API — придётся создать новую платёжную сессию.
         Пока — просто говорим юзеру связаться с флористом. TODO: /api/orders/:id/reopen-payment */
      toast('Свяжитесь с флористом для повторной оплаты');
    } catch (e) { toast('Не удалось проверить оплату'); }
  }

  /* Плашка на главной если есть незавершённый заказ */
  function refreshOrderBadge() {
    const catalog = document.getElementById('screen-catalog');
    if (!catalog) return;
    const old = catalog.querySelector('#orderBadge'); if (old) old.remove();
    let lastId; try { lastId = localStorage.getItem('iva_last_order'); } catch {}
    if (!lastId) return;
    let cache = null; try { cache = JSON.parse(localStorage.getItem('iva_order_cache_' + lastId) || 'null'); } catch {}
    if (cache?.status === 'cancelled' || cache?.payment_status === 'canceled') return;
    /* Delivered держим ещё 24ч (клиенту приятно видеть галочку), потом убираем */
    if (cache?.status === 'delivered') {
      const upd = cache.status_updated_at;
      const doneAt = upd ? new Date(upd.replace(' ', 'T') + 'Z').getTime() : 0;
      if (!doneAt || (Date.now() - doneAt) > 24 * 3600_000) return;
    }
    const STATUS_LABELS = { pending:'Ждём оплату', paid:'Оплачен', assembling:'Собираем', assembled:'Собран', in_delivery:'В пути', delivered:'Доставлен' };
    const status = cache?.status || 'pending';
    const label = STATUS_LABELS[status] || 'Заказ в работе';
    const badge = document.createElement('div');
    badge.id = 'orderBadge';
    badge.className = 'order-badge';
    badge.innerHTML = `
      <div class="order-badge__icon">📦</div>
      <div class="order-badge__body">
        <div class="order-badge__title">Заказ #${lastId} · ${label}</div>
        <div class="order-badge__sub">Открыть страницу заказа</div>
      </div>
      <div class="order-badge__arrow">›</div>
    `;
    badge.addEventListener('click', () => showOrderStatus(lastId));
    /* Вставляем ПОСЛЕ хедера (иначе на iPhone плашка уезжает под Dynamic Island / TG bar) */
    const header = catalog.querySelector('.header');
    if (header && header.nextSibling) {
      catalog.insertBefore(badge, header.nextSibling);
    } else if (header) {
      catalog.appendChild(badge);
    } else {
      catalog.insertBefore(badge, catalog.firstChild);
    }
    /* Асинхронно обновим кэш из бэка — плашка обновится сама если юзер повторно вернётся */
    fetchOrderTrack(lastId).then(d => {
      localStorage.setItem('iva_order_cache_' + lastId, JSON.stringify(d));
      const t = badge.querySelector('.order-badge__title');
      if (t) t.textContent = `Заказ #${lastId} · ${STATUS_LABELS[d.status] || label}`;
    }).catch(() => {});
  }

  /* ── App settings (promo + скидки) ── */
  let APP_SETTINGS = {
    promo: { emoji: "🌿", title: "Букет дня", text: "Нежный минимал — сегодня со скидкой", hidden: false },
    discount: { enabled: false, percent: 0, label: "", promocodes: [] },
  };
  let APPLIED_PROMOCODE = (() => {
    try { return JSON.parse(localStorage.getItem("iva_applied_promocode") || "null"); }
    catch { return null; }
  })();

  async function loadAppSettings() {
    try {
      const res = await fetch(API_BASE + "/api/app-settings", { cache: "no-store" });
      if (res.ok) APP_SETTINGS = { ...APP_SETTINGS, ...(await res.json()) };
    } catch {}
    applyPromo();
    applySaleStrip();
  }

  function applyPromo() {
    const p = APP_SETTINGS.promo || {};
    const el = (id) => document.getElementById(id);
    if (p.emoji) el("promoEmoji").textContent = p.emoji;
    if (p.title) el("promoTitle").textContent = p.title;
    if (p.text)  el("promoText").textContent = p.text;
    el("promoBanner").style.display = p.hidden ? "none" : "";
  }

  function applySaleStrip() {
    const d = APP_SETTINGS.discount || {};
    const strip = document.getElementById("saleStrip");
    if (!strip) return;
    if (d.enabled && d.percent > 0) {
      const label = d.label || "Скидка на весь каталог";
      strip.innerHTML = `<span class="sale-strip__badge">−${d.percent}%</span><span>${label}</span>`;
      strip.style.display = "";
    } else {
      strip.style.display = "none";
    }
  }

  /* Активная скидка: либо глобальная, либо валидный промокод (что больше). */
  function activeDiscountPercent() {
    const d = APP_SETTINGS.discount || {};
    let pct = d.enabled && d.percent > 0 ? Number(d.percent) : 0;
    if (APPLIED_PROMOCODE && Array.isArray(d.promocodes)) {
      const found = d.promocodes.find(c => String(c.code || "").toUpperCase() === APPLIED_PROMOCODE.toUpperCase());
      if (found && found.percent > 0) pct = Math.max(pct, Number(found.percent));
    }
    return Math.min(100, Math.max(0, pct));
  }

  function tryApplyPromocode(codeRaw) {
    const code = String(codeRaw || "").trim();
    if (!code) {
      APPLIED_PROMOCODE = null;
      localStorage.removeItem("iva_applied_promocode");
      renderCart();
      return { ok: false, message: "Пустой код" };
    }
    const list = (APP_SETTINGS.discount && APP_SETTINGS.discount.promocodes) || [];
    const found = list.find(c => String(c.code || "").toUpperCase() === code.toUpperCase());
    if (!found) {
      return { ok: false, message: "Промокод не найден" };
    }
    APPLIED_PROMOCODE = found.code;
    localStorage.setItem("iva_applied_promocode", JSON.stringify(found.code));
    renderCart();
    return { ok: true, message: `−${found.percent}% применено` };
  }

  function clearPromocode() {
    APPLIED_PROMOCODE = null;
    localStorage.removeItem("iva_applied_promocode");
    renderCart();
  }

  /* ── Analytics beacon ── */
  /* Трекер аналитики теперь общий, см. /shared/track.js.
     HTML подключает его перед app.js. Тут alias под привычное имя trackEvent. */
  window.IvaTrack?.init({ source: 'miniapp', apiBase: API_BASE });
  function trackEvent(event, meta) { window.IvaTrack?.track(event, meta); }

  /* ── Init ── */
  async function init() {
    trackEvent("pageview");
    renderCategories();
    updateCartBadge();
    loadAppSettings();

    /* Пинг бэкенда (warm-up для Render Free) */
    fetch(API_BASE + "/health").catch(() => {});

    /* Если вернулись с ЮКасса — открываем экран заказа с последним id */
    const urlParams = new URLSearchParams(window.location.search);
    let lastOrderId; try { lastOrderId = localStorage.getItem("iva_last_order"); } catch {}
    if (urlParams.has("payment") || document.referrer.includes("yookassa.ru")) {
      cart = [];
      saveCart();
      window.history.replaceState({}, "", window.location.pathname);
      if (lastOrderId) {
        showOrderStatus(lastOrderId);
      } else {
        showScreen("thanks");
      }
    } else if (lastOrderId) {
      /* Плашка «Мой заказ» на главной, если есть незавершённый */
      refreshOrderBadge();
    }

    /* При возврате в апку (Telegram: viewportChanged / браузер: visibilitychange) —
       если открыт экран заказа, обновить статус немедленно (может юзер оплатил). */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (currentScreenName() === 'order' && _orderCurrentId) {
        fetchOrderTrack(_orderCurrentId).then(d => {
          try { localStorage.setItem('iva_order_cache_' + _orderCurrentId, JSON.stringify(d)); } catch {}
          renderOrderStatus(d, _orderCurrentId);
        }).catch(() => {});
      }
      refreshOrderBadge();
    });
    if (tg && tg.onEvent) {
      try { tg.onEvent('viewportChanged', () => refreshOrderBadge()); } catch {}
    }

    /* Загружаем товары с GitHub Pages, потом перерисовываем */
    await fetchProducts();
    renderGrid();

    els.sort.addEventListener("change", (e) => {
      currentSort = e.target.value;
      renderGrid();
    });
  }

  init();

  /* ── КОНСТРУКТОР БУКЕТА (мастер из 3 шагов) ── */
  let constructorStep = 1;
  let constructorState = {
    stems: {},      // { stemId: qty }
    wrapId: null,   // selected wrap
    ribbonId: null, // selected ribbon
    note: "",
    wishes: "",
  };
  /* фильтры/поиск/сортировка на шаге 1 */
  let constructorStemFilter = "all";
  let constructorStemSearch = "";
  let constructorStemSort = "name";

  function showConstructor() {
    constructorStep = 1;
    constructorState = { stems: {}, wrapId: null, ribbonId: null, note: "", wishes: "" };
    showScreen("constructor");
    renderConstructor();
  }


  function safe(id) { return String(id).replace(/'/g, "\\'"); }

  function noimgPlaceholder() {
    return `<div class="const-card__noimg">Нет фото</div>`;
  }

  function cardImageHTML(img, alt) {
    if (!img) return noimgPlaceholder();
    return `<img class="const-card__img" src="${img}" alt="${alt}" loading="lazy">`;
  }

  function renderConstructor() {
    /* update step dots */
    $$("#screen-constructor .constructor__step-dot").forEach(d => {
      const n = +d.dataset.step;
      d.classList.toggle("active", n === constructorStep);
      d.classList.toggle("done", n < constructorStep);
    });
    const titles = ["Цветы", "Упаковка и лента", "Записка и пожелания"];
    $("#constructorHeaderTitle").textContent = titles[constructorStep - 1];

    const body = $("#constructorBody");
    if (constructorStep === 1) body.innerHTML = renderStemsStep();
    else if (constructorStep === 2) body.innerHTML = renderWrapStep();
    else if (constructorStep === 3) body.innerHTML = renderNoteStep();

    /* attach textarea listeners on step 3 */
    if (constructorStep === 3) {
      $("#noteInput")?.addEventListener("input", (e) => { constructorState.note = e.target.value; });
      $("#wishesInput")?.addEventListener("input", (e) => { constructorState.wishes = e.target.value; });
    }

    /* search input on step 1 */
    if (constructorStep === 1) {
      const inp = $("#constStemSearch");
      if (inp) {
        inp.addEventListener("input", (e) => {
          constructorStemSearch = e.target.value;
          const cursor = e.target.selectionStart;
          renderConstructor();
          const reFocus = $("#constStemSearch");
          if (reFocus) { reFocus.focus(); try { reFocus.setSelectionRange(cursor, cursor); } catch {} }
        });
      }
    }

    renderConstructorNav();
  }

  function constructorSetStemFilter(cat) {
    constructorStemFilter = cat;
    renderConstructor();
  }
  function constructorSetStemSort(s) {
    constructorStemSort = s;
    renderConstructor();
  }

  function renderStemsStep() {
    const stems = (typeof getStems === "function" ? getStems() : []) || [];
    if (stems.length === 0) {
      return `<p class="constructor__step-sub" style="padding:40px;text-align:center">Стебли загружаются...</p>`;
    }

    /* Категории — собираем из данных + фиксированный "Все" */
    const catSet = Array.from(new Set(stems.map(s => s.category || "Прочее")));
    const order = ["Цветы", "Зелень", "Сухоцветы"];
    const cats = ["all", ...catSet.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })];

    /* Фильтрация */
    const q = constructorStemSearch.trim().toLowerCase();
    let filtered = stems.filter(s => {
      if (constructorStemFilter !== "all" && (s.category || "Прочее") !== constructorStemFilter) return false;
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });

    /* Сортировка */
    if (constructorStemSort === "price_asc") filtered.sort((a, b) => (a.price||0) - (b.price||0));
    else if (constructorStemSort === "price_desc") filtered.sort((a, b) => (b.price||0) - (a.price||0));
    else filtered.sort((a, b) => a.title.localeCompare(b.title, "ru"));

    return `
      <h3 class="constructor__step-title">Выберите цветы</h3>
      <p class="constructor__step-sub">Нажмите «+», чтобы добавить цветок в букет</p>

      <div class="const-controls">
        <div class="const-search">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-3.5-3.5"/></svg>
          <input id="constStemSearch" type="text" placeholder="Поиск по названию..." value="${constructorStemSearch.replace(/"/g, "&quot;")}">
        </div>
        <div class="const-filters">
          ${cats.map(c => `
            <button class="const-chip${constructorStemFilter === c ? " active" : ""}"
                    onclick="app.constructorSetStemFilter('${safe(c)}')">${c === "all" ? "Все" : c}</button>
          `).join("")}
        </div>
        <select class="const-sort" onchange="app.constructorSetStemSort(this.value)">
          <option value="name"       ${constructorStemSort === "name" ? "selected" : ""}>По умолчанию</option>
          <option value="price_asc"  ${constructorStemSort === "price_asc" ? "selected" : ""}>Цена ↑</option>
          <option value="price_desc" ${constructorStemSort === "price_desc" ? "selected" : ""}>Цена ↓</option>
        </select>
      </div>

      ${filtered.length === 0 ? `
        <p style="padding:40px;text-align:center;opacity:.5">Ничего не найдено</p>
      ` : `
        <div class="const-grid">
          ${filtered.map(s => {
            const qty = constructorState.stems[s.id] || 0;
            return `
              <div class="const-card${qty ? " selected" : ""}">
                ${cardImageHTML(s.img, s.title)}
                <div class="const-card__info">
                  <h4 class="const-card__title">${s.title}</h4>
                  <div class="const-card__price">${formatPrice(s.price || 0)}<span class="const-card__price-meta"> / шт</span></div>
                  <div class="const-card__qty-row">
                    ${qty > 0 ? `
                      <button class="const-card__qty-btn" onclick="app.constructorChange('${safe(s.id)}', -1)">−</button>
                      <span class="const-card__qty-num">${qty}</span>
                      <button class="const-card__qty-btn" onclick="app.constructorChange('${safe(s.id)}', 1)">+</button>
                    ` : `
                      <button class="const-card__qty-btn const-card__qty-btn--add" onclick="app.constructorChange('${safe(s.id)}', 1)">+ В букет</button>
                    `}
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `}
    `;
  }

  function renderWrapStep() {
    const wraps = (typeof getWraps === "function" ? getWraps() : []) || [];
    const ribbons = (typeof getRibbons === "function" ? getRibbons() : []) || [];

    return `
      <h3 class="constructor__step-title">Упаковка</h3>
      <p class="constructor__step-sub">Выберите оформление букета</p>
      ${wraps.length === 0 ? `<p style="padding:0 16px;opacity:.5">Нет вариантов упаковки</p>` : `
        <div class="const-grid">
          ${wraps.map(w => `
            <div class="const-card const-radio${constructorState.wrapId === w.id ? " selected" : ""}"
                 onclick="app.constructorSelectWrap('${safe(w.id)}')">
              <span class="const-radio__check">✓</span>
              ${cardImageHTML(w.img, w.title)}
              <div class="const-card__info">
                <h4 class="const-card__title">${w.title}</h4>
                <div class="const-card__price">${formatPrice(w.price || 0)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      `}
      <button class="const-skip" onclick="app.constructorSelectWrap(null)">Без упаковки</button>

      <h3 class="constructor__step-title">Лента</h3>
      <p class="constructor__step-sub">Выберите цвет ленты</p>
      ${ribbons.length === 0 ? `<p style="padding:0 16px 16px;opacity:.5">Нет вариантов ленты</p>` : `
        <div class="const-grid">
          ${ribbons.map(r => `
            <div class="const-card const-radio${constructorState.ribbonId === r.id ? " selected" : ""}"
                 onclick="app.constructorSelectRibbon('${safe(r.id)}')">
              <span class="const-radio__check">✓</span>
              ${cardImageHTML(r.img, r.title)}
              <div class="const-card__info">
                <h4 class="const-card__title">${r.title}</h4>
                <div class="const-card__price">${formatPrice(r.price || 0)}</div>
              </div>
            </div>
          `).join("")}
        </div>
      `}
      <button class="const-skip" onclick="app.constructorSelectRibbon(null)">Без ленты</button>
      <div style="height:120px"></div>
    `;
  }

  function renderNoteStep() {
    const summary = constructorSummary();
    return `
      <h3 class="constructor__step-title">Записка</h3>
      <div class="const-field">
        <label class="const-field__label">Что написать получателю (необязательно)</label>
        <textarea id="noteInput" placeholder="С Днём Рождения! Желаю...">${constructorState.note}</textarea>
      </div>

      <h3 class="constructor__step-title">Пожелания по букету</h3>
      <div class="const-field">
        <label class="const-field__label">Пример: «выщипать колючки у роз», «без шипов», «упаковать в крафт»</label>
        <textarea id="wishesInput" placeholder="Ваши пожелания флористу...">${constructorState.wishes}</textarea>
      </div>

      <div style="margin:24px 16px;padding:16px;background:rgba(255,255,255,.04);border-radius:12px">
        <div style="font-family:'Cormorant Garamond',serif;font-size:18px;color:#E8DDD0;margin-bottom:10px">Ваш букет:</div>
        ${summary.lines.map(l => `<div style="font-size:13px;color:rgba(255,255,255,.75);margin-bottom:3px">${l}</div>`).join("")}
        <div style="margin-top:12px;font-size:18px;font-weight:600;color:#fff">Итого: ${formatPrice(summary.total)}</div>
      </div>
      <div style="height:120px"></div>
    `;
  }

  function constructorSummary() {
    const stems = (typeof getStems === "function" ? getStems() : []) || [];
    const wraps = (typeof getWraps === "function" ? getWraps() : []) || [];
    const ribbons = (typeof getRibbons === "function" ? getRibbons() : []) || [];
    const lines = [];
    let total = 0, count = 0;
    for (const [id, qty] of Object.entries(constructorState.stems)) {
      const s = stems.find(x => x.id === id);
      if (!s) continue;
      const sub = (s.price || 0) * qty;
      total += sub; count += qty;
      lines.push(`• ${s.title} × ${qty} = ${formatPrice(sub)}`);
    }
    if (constructorState.wrapId) {
      const w = wraps.find(x => x.id === constructorState.wrapId);
      if (w) { total += w.price || 0; lines.push(`• Упаковка: ${w.title} — ${formatPrice(w.price || 0)}`); }
    }
    if (constructorState.ribbonId) {
      const r = ribbons.find(x => x.id === constructorState.ribbonId);
      if (r) { total += r.price || 0; lines.push(`• Лента: ${r.title} — ${formatPrice(r.price || 0)}`); }
    }
    return { lines, total, count };
  }

  function renderConstructorNav() {
    const s = constructorSummary();
    const nav = $("#constructorNav");
    const stepsTotal = 3;
    const last = constructorStep === stepsTotal;
    const canNext = constructorStep === 1 ? s.count > 0 : true;
    nav.innerHTML = `
      ${constructorStep > 1
        ? `<button class="const-nav__back" onclick="app.constructorBack()">Назад</button>`
        : ""}
      <button class="const-nav__next" ${canNext ? "" : "disabled"}
              onclick="${last ? "app.addConstructorBouquet()" : "app.constructorNext()"}">
        <span>${last ? "Добавить в корзину" : "Далее"}</span>
        ${s.count > 0 ? `<span class="const-nav__next-sum">${s.count} ${s.count === 1 ? "цветок" : s.count < 5 ? "цветка" : "цветков"} · ${formatPrice(s.total)}</span>` : ""}
      </button>
    `;
  }

  function constructorChange(stemId, delta) {
    const cur = constructorState.stems[stemId] || 0;
    const next = Math.max(0, cur + delta);
    if (next === 0) delete constructorState.stems[stemId];
    else constructorState.stems[stemId] = next;
    renderConstructor();
  }

  function constructorSelectWrap(wrapId) {
    constructorState.wrapId = (constructorState.wrapId === wrapId) ? null : wrapId;
    renderConstructor();
  }
  function constructorSelectRibbon(ribbonId) {
    constructorState.ribbonId = (constructorState.ribbonId === ribbonId) ? null : ribbonId;
    renderConstructor();
  }

  function constructorNext() {
    if (constructorStep < 3) {
      constructorStep++;
      renderConstructor();
      window.scrollTo(0, 0);
    }
  }
  function constructorBack() {
    if (constructorStep > 1) {
      constructorStep--;
      renderConstructor();
      window.scrollTo(0, 0);
    } else {
      showCatalog();
    }
  }

  function addConstructorBouquet() {
    const s = constructorSummary();
    if (s.count === 0) return;
    const stems = (typeof getStems === "function" ? getStems() : []) || [];
    const wraps = (typeof getWraps === "function" ? getWraps() : []) || [];
    const ribbons = (typeof getRibbons === "function" ? getRibbons() : []) || [];

    const items = Object.entries(constructorState.stems).map(([id, qty]) => {
      const x = stems.find(y => y.id === id);
      return { id, title: x?.title || id, qty, price: x?.price || 0, type: "stem" };
    });
    if (constructorState.wrapId) {
      const w = wraps.find(x => x.id === constructorState.wrapId);
      if (w) items.push({ id: w.id, title: w.title, qty: 1, price: w.price || 0, type: "wrap" });
    }
    if (constructorState.ribbonId) {
      const r = ribbons.find(x => x.id === constructorState.ribbonId);
      if (r) items.push({ id: r.id, title: r.title, qty: 1, price: r.price || 0, type: "ribbon" });
    }

    const customId = `custom:${Date.now()}`;
    cart.push({
      key: customId, id: customId, qty: 1, size: null,
      custom: {
        name: `Свой букет (${s.count} ${s.count === 1 ? "цветок" : s.count < 5 ? "цветка" : "цветков"})`,
        price: s.total,
        items,
        note: constructorState.note,
        wishes: constructorState.wishes,
      },
    });
    saveCart();
    toast("Букет добавлен в корзину");
    showCatalog();
  }

  /* ── Public API ── */
  return {
    showProduct,
    showCatalog,
    showCart,
    showCheckout,
    quickAdd,
    cardPlus,
    cardMinus,
    addToCart,
    selectSize,
    changeQty,
    submitOrder,
    showConstructor,
    constructorChange,
    constructorSelectWrap,
    constructorSelectRibbon,
    constructorNext,
    constructorBack,
    addConstructorBouquet,
    constructorSetStemFilter,
    constructorSetStemSort,
    applyPromocodeForm,
    clearPromocode,
    showOrderStatus,
    reopenPayment,
  };
})();
