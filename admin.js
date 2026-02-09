/* ============================================================
   IVA — Админ-панель  |  CRUD товаров, GitHub API, Excel
   ============================================================ */

(() => {
  const ADMIN_PASS = "iva2025";
  const STORAGE_KEY = "iva_products";
  const TOKEN_KEY  = "iva_gh_token";

  /* GitHub API */
  const GH_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

  /* ── State ── */
  let products = [];
  let editingId = null;
  let confirmCallback = null;
  let ghToken = localStorage.getItem(TOKEN_KEY) || "";
  let fileSha = null; // SHA текущего файла на GitHub (нужен для обновления)

  /* ── DOM ── */
  const $ = (s) => document.querySelector(s);
  const loginScreen   = $("#loginScreen");
  const adminPanel    = $("#adminPanel");
  const loginPass     = $("#loginPass");
  const loginError    = $("#loginError");
  const loginBtn      = $("#loginBtn");
  const logoutBtn     = $("#logoutBtn");
  const productList   = $("#productList");
  const productCount  = $("#productCount");
  const addProductBtn = $("#addProductBtn");
  const modalOverlay  = $("#modalOverlay");
  const modalTitle    = $("#modalTitle");
  const modalClose    = $("#modalClose");
  const productForm   = $("#productForm");
  const imgInput      = $("#fImg");
  const imgPreview    = $("#imgPreview");
  const exportBtn     = $("#exportBtn");
  const importBtn     = $("#importBtn");
  const importFile    = $("#importFile");
  const resetBtn      = $("#resetBtn");
  const confirmOverlay= $("#confirmOverlay");
  const confirmText   = $("#confirmText");
  const confirmOk     = $("#confirmOk");
  const confirmCancel = $("#confirmCancel");
  const toastEl       = $("#toast");
  const syncStatus    = $("#syncStatus");

  /* ── Helpers ── */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function formatPrice(n) {
    return Number(n).toLocaleString("ru-RU") + " \u20BD";
  }

  function nextId() {
    return products.length ? Math.max(...products.map((p) => p.id)) + 1 : 1;
  }

  function setSyncStatus(text, color) {
    if (syncStatus) {
      syncStatus.textContent = text;
      syncStatus.style.color = color || "var(--cream-dim)";
    }
  }

  /* ── Auth (24h persistent via localStorage + cookie fallback) ── */
  const AUTH_KEY = "iva_admin_auth";
  const AUTH_TTL = 24 * 60 * 60 * 1000; // 24 часа

  function setAuthCookie() {
    const expires = new Date(Date.now() + AUTH_TTL).toUTCString();
    document.cookie = `${AUTH_KEY}=1; expires=${expires}; path=/; SameSite=Lax`;
  }
  function getAuthCookie() {
    return document.cookie.split("; ").some(c => c.startsWith(AUTH_KEY + "="));
  }
  function clearAuthCookie() {
    document.cookie = `${AUTH_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }

  function checkAuth() {
    /* Проверяем localStorage */
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      try {
        const { ts } = JSON.parse(saved);
        if (Date.now() - ts < AUTH_TTL) { showPanel(); return; }
      } catch {}
      localStorage.removeItem(AUTH_KEY);
    }
    /* Фолбэк — cookie (если localStorage очистился, напр. в WebView) */
    if (getAuthCookie()) { showPanel(); return; }
  }

  function doLogin() {
    if (loginPass.value === ADMIN_PASS) {
      localStorage.setItem(AUTH_KEY, JSON.stringify({ ts: Date.now() }));
      setAuthCookie();
      loginError.style.display = "none";
      showPanel();
    } else {
      loginError.style.display = "block";
      loginPass.value = "";
      loginPass.focus();
    }
  }

  function doLogout() {
    localStorage.removeItem(AUTH_KEY);
    clearAuthCookie();
    adminPanel.classList.remove("visible");
    loginScreen.classList.remove("hidden");
    loginPass.value = "";
  }

  async function showPanel() {
    loginScreen.classList.add("hidden");
    adminPanel.classList.add("visible");

    /* Проверяем токен */
    if (!ghToken) {
      promptToken();
    }

    await loadProducts();
    renderCatList();
    renderList();
  }

  /* ── GitHub Token ── */
  function authHeader() {
    if (!ghToken) return {};
    const prefix = ghToken.startsWith("github_pat_") ? "Bearer" : "token";
    return { "Authorization": `${prefix} ${ghToken}` };
  }

  function promptToken() {
    const t = prompt(
      "Введи GitHub Personal Access Token:\n\n" +
      "Классический: ghp_...\nFine-grained: github_pat_...\n\n" +
      "Создай на: github.com/settings/tokens"
    );
    if (t && (t.trim().startsWith("ghp_") || t.trim().startsWith("github_pat_"))) {
      ghToken = t.trim();
      localStorage.setItem(TOKEN_KEY, ghToken);
      toast("Токен сохранён");
    } else if (t) {
      toast("Неверный формат токена (нужен ghp_... или github_pat_...)");
    }
  }

  /* ── Data: Load from GitHub ── */
  async function loadProducts() {
    setSyncStatus("Загрузка...", "var(--gold)");
    try {
      /* Читаем через GitHub API (чтобы получить SHA) */
      const res = await fetch(GH_API, {
        headers: authHeader(),
      });
      if (res.ok) {
        const data = await res.json();
        fileSha = data.sha;
        const raw = atob(data.content.replace(/\n/g, ""));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const content = new TextDecoder("utf-8").decode(bytes);
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          products = parsed;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
          setSyncStatus("Синхронизировано ✓", "var(--accent)");
          return;
        }
      }
    } catch (err) {
      console.log("GitHub load error:", err);
    }

    /* Фолбэк — localStorage или дефолт */
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { products = JSON.parse(stored); } catch { products = [..._DEFAULT_BOUQUETS]; }
    } else {
      products = [..._DEFAULT_BOUQUETS];
    }
    setSyncStatus("Офлайн (локальные данные)", "var(--danger)");
  }

  /* ── Data: Save to GitHub ── */
  async function saveProducts() {
    /* Всегда сохраняем локально */
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));

    /* Пушим на GitHub */
    if (!ghToken) {
      setSyncStatus("Нет токена — только локально", "var(--danger)");
      toast("Сохранено локально (нет GitHub-токена)");
      return;
    }

    setSyncStatus("Публикация...", "var(--gold)");

    try {
      /* Получаем актуальный SHA перед записью (избегаем 409 Conflict) */
      try {
        const shaRes = await fetch(GH_API, {
          headers: authHeader(),
        });
        if (shaRes.ok) {
          const shaData = await shaRes.json();
          fileSha = shaData.sha;
        }
      } catch {}

      const content = btoa(unescape(encodeURIComponent(JSON.stringify(products, null, 2))));

      const body = {
        message: "Обновление товаров из админки",
        content: content,
        branch: GITHUB_BRANCH,
      };
      if (fileSha) body.sha = fileSha;

      const res = await fetch(GH_API, {
        method: "PUT",
        headers: {
          ...authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        fileSha = data.content.sha;
        setSyncStatus("Опубликовано ✓", "var(--accent)");
        toast("Сохранено и опубликовано на сайт");
      } else {
        const err = await res.json();
        console.error("GitHub save error:", err);
        setSyncStatus("Ошибка публикации", "var(--danger)");
        toast("Ошибка GitHub: " + (err.message || res.status));
      }
    } catch (err) {
      console.error("GitHub save error:", err);
      setSyncStatus("Ошибка сети", "var(--danger)");
      toast("Сохранено локально, ошибка сети");
    }
  }

  /* ── Render List ── */
  function renderList() {
    productCount.textContent = `${products.length} товаров`;

    if (products.length === 0) {
      productList.innerHTML = `<div style="text-align:center;padding:60px;color:var(--cream-dim)">
        <div style="font-size:40px;margin-bottom:16px">📦</div>
        <div>Товаров пока нет</div>
      </div>`;
      return;
    }

    productList.innerHTML = products
      .map(
        (p, idx) => `
      <div class="product-row" data-idx="${idx}">
        <div class="product-row__order">
          <button class="btn-arrow" onclick="adminApp.moveProduct(${idx},-1)" ${idx === 0 ? "disabled" : ""}>▲</button>
          <button class="btn-arrow" onclick="adminApp.moveProduct(${idx},1)" ${idx === products.length - 1 ? "disabled" : ""}>▼</button>
        </div>
        <img class="product-row__img" src="${p.img}" alt="${p.name}"
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2256%22 height=%2256%22><rect fill=%22%234A5E5A%22 width=%2256%22 height=%2256%22/><text x=%2228%22 y=%2232%22 text-anchor=%22middle%22 fill=%22%23EDE6DA%22 font-size=%2220%22>🌸</text></svg>'">
        <div class="product-row__info">
          <div class="product-row__name">${p.name}</div>
          <div class="product-row__meta">
            <span class="product-row__price">${formatPrice(p.price)}</span>
            <span>${categoryName(p.category)}</span>
            ${stockTag(p.stock)}
            ${badgeTag(p.badge)}
          </div>
        </div>
        <div class="product-row__actions">
          <button class="btn btn--outline btn--sm" onclick="adminApp.editProduct(${p.id})">✎</button>
          <button class="btn btn--danger btn--sm" onclick="adminApp.confirmDelete(${p.id})">✕</button>
        </div>
      </div>`
      )
      .join("");
  }

  function categoryName(id) {
    const cat = categories.find(c => c.id === id);
    return cat ? cat.name : id;
  }

  function badgeTag(badge) {
    if (!badge) return "";
    const labels = { hit:"Hit", season:"Сезон", new:"New" };
    return `<span class="badge-sm badge-sm--${badge}">${labels[badge]}</span>`;
  }

  function stockTag(stock) {
    if (stock == null) return "";
    if (stock <= 0) return `<span style="color:var(--danger);font-weight:600">нет</span>`;
    if (stock <= 5) return `<span style="color:var(--gold);font-weight:600">${stock} шт.</span>`;
    return `<span style="color:var(--accent)">${stock} шт.</span>`;
  }

  /* ── Reorder (up/down buttons) ── */
  async function moveProduct(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= products.length) return;
    [products[idx], products[newIdx]] = [products[newIdx], products[idx]];
    renderList();
    await saveProducts();
  }

  /* ── Modal ── */
  function openModal() {
    modalOverlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    modalOverlay.classList.remove("open");
    document.body.style.overflow = "";
    productForm.reset();
    imgPreview.classList.remove("visible");
    editingId = null;
  }

  function openAddForm() {
    editingId = null;
    modalTitle.textContent = "Добавить товар";
    productForm.reset();
    imgPreview.classList.remove("visible");
    $("#fPopular").value = 5;
    $("#fStock").value = 10;
    openModal();
  }

  function openEditForm(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = id;
    modalTitle.textContent = "Редактировать товар";

    $("#fId").value       = p.id;
    $("#fName").value     = p.name;
    $("#fPrice").value    = p.price;
    $("#fStock").value    = p.stock != null ? p.stock : "";
    $("#fPopular").value  = p.popular || 5;
    $("#fCategory").value = p.category;
    $("#fBadge").value    = p.badge || "";
    $("#fDesc").value     = p.desc || "";
    $("#fImg").value      = p.img || "";
    $("#fSizeS").checked  = p.sizes && p.sizes.includes("S");
    $("#fSizeM").checked  = p.sizes && p.sizes.includes("M");
    $("#fSizeL").checked  = p.sizes && p.sizes.includes("L");

    if (p.img) {
      imgPreview.src = p.img;
      imgPreview.classList.add("visible");
    } else {
      imgPreview.classList.remove("visible");
    }

    openModal();
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    const sizes = [];
    if ($("#fSizeS").checked) sizes.push("S");
    if ($("#fSizeM").checked) sizes.push("M");
    if ($("#fSizeL").checked) sizes.push("L");

    const stockVal = $("#fStock").value;

    const data = {
      id:       editingId || nextId(),
      name:     $("#fName").value.trim(),
      price:    parseInt($("#fPrice").value) || 0,
      popular:  parseInt($("#fPopular").value) || 5,
      category: $("#fCategory").value,
      badge:    $("#fBadge").value || null,
      desc:     $("#fDesc").value.trim(),
      sizes:    sizes.length ? sizes : null,
      stock:    stockVal !== "" ? parseInt(stockVal) : null,
      img:      $("#fImg").value.trim(),
    };

    if (editingId) {
      const idx = products.findIndex((p) => p.id === editingId);
      if (idx !== -1) products[idx] = data;
    } else {
      products.push(data);
    }

    closeModal();
    renderList();
    await saveProducts();
  }

  /* ── Delete ── */
  function showConfirm(text, callback) {
    confirmText.textContent = text;
    confirmCallback = callback;
    confirmOverlay.classList.add("open");
  }
  function hideConfirm() {
    confirmOverlay.classList.remove("open");
    confirmCallback = null;
  }

  function confirmDelete(id) {
    const p = products.find((x) => x.id === id);
    showConfirm(`Удалить «${p ? p.name : "товар"}»?`, async () => {
      products = products.filter((x) => x.id !== id);
      renderList();
      await saveProducts();
    });
  }

  /* ── Export Excel ── */
  function doExport() {
    if (typeof XLSX === "undefined") {
      toast("Ошибка: библиотека XLSX не загрузилась");
      return;
    }

    const rows = products.map((p) => ({
      "ID":          p.id,
      "Название":    p.name,
      "Цена":        p.price,
      "Остаток":     p.stock != null ? p.stock : "",
      "Популярность":p.popular,
      "Категория":   categoryName(p.category),
      "Категория_ID":p.category,
      "Бейдж":       p.badge || "",
      "Описание":    p.desc || "",
      "Размеры":     p.sizes ? p.sizes.join(",") : "",
      "Фото URL":    p.img || "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 5 }, { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
      { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 40 }, { wch: 10 }, { wch: 60 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Товары");
    XLSX.writeFile(wb, "iva-products.xlsx");
    toast("Excel экспортирован");
  }

  /* ── Import Excel ── */
  function doImport() {
    importFile.click();
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        if (typeof XLSX === "undefined") { toast("Ошибка: XLSX не загрузилась"); return; }

        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);

        if (!rows.length) { toast("Файл пустой"); return; }

        const catMap = {};
        categories.forEach(c => { catMap[c.name] = c.id; });

        products = rows.map((r, i) => {
          const sizesStr = (r["Размеры"] || "").toString().trim();
          const sizes = sizesStr ? sizesStr.split(",").map((s) => s.trim()).filter(Boolean) : null;
          return {
            id:       r["ID"] ? parseInt(r["ID"]) : i + 1,
            name:     (r["Название"] || "").toString().trim(),
            price:    parseInt(r["Цена"]) || 0,
            stock:    r["Остаток"] !== "" && r["Остаток"] != null ? parseInt(r["Остаток"]) : null,
            popular:  parseInt(r["Популярность"]) || 5,
            category: r["Категория_ID"] || catMap[r["Категория"]] || "bouquets",
            badge:    r["Бейдж"] ? r["Бейдж"].toString().trim().toLowerCase() : null,
            desc:     (r["Описание"] || "").toString().trim(),
            sizes:    sizes,
            img:      (r["Фото URL"] || r["Фото"] || "").toString().trim(),
          };
        });

        renderList();
        await saveProducts();
        toast(`Импортировано ${products.length} товаров`);
      } catch (err) {
        console.error(err);
        toast("Ошибка чтения Excel");
      }
    };
    reader.readAsArrayBuffer(file);
    importFile.value = "";
  }

  function doReset() {
    showConfirm("Сбросить все товары к исходным? Текущие изменения будут потеряны.", async () => {
      products = [..._DEFAULT_BOUQUETS];
      renderList();
      await saveProducts();
    });
  }

  function changeToken() {
    promptToken();
  }

  /* ── Image preview ── */
  function updateImgPreview() {
    const url = imgInput.value.trim();
    if (url) {
      imgPreview.src = url;
      imgPreview.classList.add("visible");
      imgPreview.onerror = () => imgPreview.classList.remove("visible");
    } else {
      imgPreview.classList.remove("visible");
    }
  }

  /* ── Categories ── */
  const CAT_KEY = "iva_categories";
  let categories = []; // без "all"

  function loadCategories() {
    const saved = localStorage.getItem(CAT_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) { categories = parsed; return; }
      } catch {}
    }
    categories = [..._DEFAULT_CATEGORIES];
  }

  function saveCategories() {
    localStorage.setItem(CAT_KEY, JSON.stringify(categories));
    /* Обновляем глобальный CATEGORIES для витрины */
    CATEGORIES = [{ id: "all", name: "Все" }, ...categories];
  }

  function renderCatList() {
    const catList = $("#catList");
    if (!catList) return;
    catList.innerHTML = categories.map((c, i) => `
      <div class="cat-row">
        <span class="cat-row__id">${c.id}</span>
        <span class="cat-row__name">${c.name}</span>
        <button class="cat-row__del" onclick="adminApp.deleteCat(${i})" title="Удалить">✕</button>
      </div>
    `).join("");
    updateCategorySelect();
  }

  function updateCategorySelect() {
    const sel = $("#fCategory");
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
    if (val) sel.value = val;
  }

  function addCategory() {
    const input = $("#newCatInput");
    const name = input ? input.value.trim() : "";
    if (!name) { toast("Введите название"); if (input) input.focus(); return; }
    const tr = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"zh","з":"z","и":"i","й":"j","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"};
    const id = name.toLowerCase()
      .split("").map(ch => tr[ch] !== undefined ? tr[ch] : ch).join("")
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!id) { toast("Не удалось создать ID"); return; }
    if (categories.some(c => c.id === id)) { toast("Категория уже существует"); return; }
    categories.push({ id, name });
    saveCategories();
    renderCatList();
    if (input) input.value = "";
    toast(`Категория «${name}» добавлена`);
  }

  function deleteCat(idx) {
    const cat = categories[idx];
    if (!cat) return;
    const used = products.filter(p => p.category === cat.id).length;
    const msg = used
      ? `Удалить «${cat.name}»? (${used} товаров в этой категории)`
      : `Удалить «${cat.name}»?`;
    showConfirm(msg, () => {
      categories.splice(idx, 1);
      saveCategories();
      renderCatList();
      toast("Категория удалена");
    });
  }

  loadCategories();

  /* ── Promo Banner ── */
  const promoEmojiInput = $("#promoEmoji");
  const promoTitleInput = $("#promoTitle");
  const promoTextInput  = $("#promoText");
  const promoSaveBtn    = $("#promoSaveBtn");

  function loadPromo() {
    const saved = localStorage.getItem("iva_promo");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p.emoji) promoEmojiInput.value = p.emoji;
        if (p.title) promoTitleInput.value = p.title;
        if (p.text)  promoTextInput.value  = p.text;
      } catch {}
    }
  }

  function savePromo() {
    const data = {
      emoji: promoEmojiInput.value.trim(),
      title: promoTitleInput.value.trim(),
      text:  promoTextInput.value.trim(),
    };
    localStorage.setItem("iva_promo", JSON.stringify(data));
    toast("Промо-баннер сохранён");
  }

  promoSaveBtn.addEventListener("click", savePromo);
  loadPromo();

  /* ── Event Listeners ── */
  loginBtn.addEventListener("click", doLogin);
  loginPass.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  logoutBtn.addEventListener("click", doLogout);
  addProductBtn.addEventListener("click", openAddForm);
  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("mousedown", (e) => { if (e.target === modalOverlay) closeModal(); });
  productForm.addEventListener("submit", handleFormSubmit);
  imgInput.addEventListener("input", updateImgPreview);
  exportBtn.addEventListener("click", doExport);
  importBtn.addEventListener("click", doImport);
  importFile.addEventListener("change", handleImport);
  resetBtn.addEventListener("click", doReset);
  confirmOk.addEventListener("click", () => {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });
  confirmCancel.addEventListener("click", hideConfirm);

  const tokenBtn = $("#tokenBtn");
  if (tokenBtn) tokenBtn.addEventListener("click", changeToken);
  const addCatBtn = $("#addCatBtn");
  if (addCatBtn) addCatBtn.addEventListener("click", addCategory);
  const newCatInput = $("#newCatInput");
  if (newCatInput) newCatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addCategory(); });

  /* ── Init ── */
  checkAuth();

  /* ── Public API ── */
  window.adminApp = {
    editProduct: openEditForm,
    confirmDelete,
    moveProduct,
    deleteCat,
  };
})();
