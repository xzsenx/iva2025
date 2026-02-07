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
    catalog:  $("#screen-catalog"),
    product:  $("#screen-product"),
    cart:     $("#screen-cart"),
    checkout: $("#screen-checkout"),
    thanks:   $("#screen-thanks"),
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
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#3D4F4C");
      tg.setBackgroundColor("#3D4F4C");
    } catch {}
  }

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

  function badgeHTML(badge) {
    if (!badge) return "";
    const labels = { hit: "Hit", season: "Сезон", new: "New" };
    return `<span class="badge badge--${badge}">${labels[badge]}</span>`;
  }

  /* ── Navigation ── */
  let catalogScrollY = 0;

  function showScreen(name) {
    /* Запоминаем скролл каталога перед уходом */
    if (screens.catalog.classList.contains("active") && name !== "catalog") {
      catalogScrollY = window.scrollY;
    }
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    if (name === "catalog") {
      window.scrollTo(0, catalogScrollY);
    } else {
      window.scrollTo(0, 0);
    }
  }

  /* ── Categories ── */
  function renderCategories() {
    els.categories.innerHTML = CATEGORIES.map(
      (c) =>
        `<button class="cat-pill${c.id === currentCategory ? " active" : ""}"
                data-cat="${c.id}">${c.name}</button>`
    ).join("");

    els.categories.querySelectorAll(".cat-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentCategory = btn.dataset.cat;
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
    const stockHTML = b.stock != null && b.stock <= 5
      ? `<div class="card__stock card__stock--low">Осталось: ${b.stock}</div>` : "";
    if (qty > 0) {
      const maxReached = b.stock != null && qty >= b.stock;
      return `${stockHTML}
        <div class="card__qty">
          <button class="card__qty-btn${qty === 1 ? " card__qty-btn--remove" : ""}"
                  onclick="event.stopPropagation(); app.cardMinus(${b.id})">
            ${qty === 1 ? "✕" : "−"}
          </button>
          <span class="card__qty-num">${qty}</span>
          <button class="card__qty-btn${maxReached ? " card__qty-btn--disabled" : ""}"
                  onclick="event.stopPropagation(); app.cardPlus(${b.id})"
                  ${maxReached ? "disabled" : ""}>+</button>
        </div>`;
    }
    return `${stockHTML}
      <button class="card__add-btn" onclick="event.stopPropagation(); app.quickAdd(${b.id})">
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
      <div class="card" data-id="${b.id}" style="animation-delay:${i * 0.05}s" onclick="app.showProduct(${b.id})">
        <div class="card__img-wrap">
          <img class="card__img" src="${b.img}" alt="${b.name}" loading="lazy">
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

  /* ── Product Page ── */
  function showProduct(id) {
    BOUQUETS = getProducts();
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
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

  function cartTotal() {
    return cart.reduce((s, i) => {
      const b = BOUQUETS.find((x) => x.id === i.id);
      return s + (b ? b.price * i.qty : 0);
    }, 0);
  }

  function quickAdd(id) {
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    const size = b.sizes ? b.sizes[0] : null;
    addItemToCart(id, size);
    toast("Добавлено в корзину");
    updateCardBottom(id);
  }

  function cardPlus(id) {
    const b = BOUQUETS.find((x) => x.id === id);
    if (!b) return;
    const size = b.sizes ? b.sizes[0] : null;
    addItemToCart(id, size);
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
    saveCart();
    updateCardBottom(id);
  }

  function addToCart() {
    if (!currentProduct) return;
    if (addItemToCart(currentProduct.id, selectedSize) === false) return;
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
      els.cartBody.innerHTML = `
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

    els.cartFooter.innerHTML = `
      <div class="cart-total">
        <span class="cart-total__label">Итого</span>
        <span class="cart-total__sum">${formatPrice(cartTotal())}</span>
      </div>
      <button class="btn btn--primary btn--lg" onclick="app.showCheckout()">
        Оформить заказ
      </button>
    `;
  }

  function showCart() {
    renderCart();
    showScreen("cart");
  }

  /* ── Checkout ── */
  function showCheckout() {
    if (cart.length === 0) return;

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

    // Toggle address field
    els.checkoutForm.querySelectorAll('[name="delivery"]').forEach((r) => {
      r.addEventListener("change", toggleAddress);
    });
    toggleAddress();

    showScreen("checkout");
  }

  function toggleAddress() {
    const val = els.checkoutForm.querySelector('[name="delivery"]:checked').value;
    els.addressField.style.display = val === "delivery" ? "flex" : "none";
  }

  /* ── Submit Order ── */
  function submitOrder(e) {
    e.preventDefault();
    const fd = new FormData(els.checkoutForm);

    const order = {
      items: cart.map((i) => {
        const b = BOUQUETS.find((x) => x.id === i.id);
        return {
          name: b ? b.name : "?",
          size: i.size,
          qty: i.qty,
          price: b ? b.price : 0,
        };
      }),
      total: cartTotal(),
      name: fd.get("name"),
      phone: fd.get("phone"),
      delivery: fd.get("delivery"),
      address: fd.get("address") || "",
      date: fd.get("date"),
      time: fd.get("time"),
      comment: fd.get("comment") || "",
    };

    // Отправить через Telegram WebApp.sendData
    if (tg) {
      try {
        tg.sendData(JSON.stringify(order));
      } catch (err) {
        console.log("TG sendData error:", err);
      }
    } else {
      // Для тестирования вне Telegram
      console.log("ORDER:", JSON.stringify(order, null, 2));
      alert("Заказ отправлен (тестовый режим).\nПроверьте консоль.");
    }

    // Очистить корзину
    cart = [];
    saveCart();
    els.checkoutForm.reset();
    showScreen("thanks");
    return false;
  }

  /* ── Show Catalog ── */
  function showCatalog() {
    showScreen("catalog");
  }

  /* ── Promo Banner ── */
  function loadPromo() {
    const saved = localStorage.getItem("iva_promo");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        const el = (id) => document.getElementById(id);
        if (p.emoji) el("promoEmoji").textContent = p.emoji;
        if (p.title) el("promoTitle").textContent = p.title;
        if (p.text)  el("promoText").textContent = p.text;
        if (p.hidden) el("promoBanner").style.display = "none";
      } catch {}
    }
  }

  /* ── Init ── */
  async function init() {
    renderCategories();
    updateCartBadge();
    loadPromo();

    /* Загружаем товары с GitHub Pages, потом перерисовываем */
    await fetchProducts();
    renderGrid();

    els.sort.addEventListener("change", (e) => {
      currentSort = e.target.value;
      renderGrid();
    });
  }

  init();

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
  };
})();
