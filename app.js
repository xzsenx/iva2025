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
    // Можно использовать tg.themeParams для адаптации цветов
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
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    window.scrollTo(0, 0);
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
          <button class="card__add-btn" onclick="event.stopPropagation(); app.quickAdd(${b.id})">
            В корзину
          </button>
        </div>
      </div>`
      )
      .join("");
  }

  /* ── Product Page ── */
  function showProduct(id) {
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
        <button class="btn btn--primary btn--lg" onclick="app.addToCart()">
          Добавить в корзину — ${formatPrice(b.price)}
        </button>
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
  }

  function addToCart() {
    if (!currentProduct) return;
    addItemToCart(currentProduct.id, selectedSize);
    toast("Добавлено в корзину");
    showCatalog();
  }

  function addItemToCart(id, size) {
    const key = `${id}_${size || ""}`;
    const existing = cart.find((i) => i.key === key);
    if (existing) {
      existing.qty++;
    } else {
      cart.push({ key, id, size, qty: 1 });
    }
    saveCart();
  }

  function changeQty(key, delta) {
    const item = cart.find((i) => i.key === key);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      cart = cart.filter((i) => i.key !== key);
    }
    saveCart();
    renderCart();
  }

  /* ── Cart Screen ── */
  function renderCart() {
    if (cart.length === 0) {
      els.cartBody.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty__icon">🛒</div>
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
        <div class="cart-item">
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

  /* ── Init ── */
  function init() {
    renderCategories();
    renderGrid();
    updateCartBadge();

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
    addToCart,
    selectSize,
    changeQty,
    submitOrder,
  };
})();
