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
  const imgZone       = $("#imgZone");
  const imgFileInput  = $("#imgFileInput");
  const imgClearBtn   = $("#imgClearBtn");
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
    renderBadgeList();
    renderList();
  }

  /* ── GitHub Token ── */
  function authHeader() {
    if (!ghToken) return {};
    const prefix = ghToken.startsWith("github_pat_") ? "Bearer" : "token";
    return { "Authorization": `${prefix} ${ghToken}` };
  }

  function promptToken() {
    /* Показываем панель токена */
    const panel = $("#tokenPanel");
    const input = $("#tokenInput");
    if (panel) {
      panel.style.display = "block";
      if (input) { input.value = ghToken || ""; input.focus(); }
    }
  }

  function saveToken() {
    const input = $("#tokenInput");
    const panel = $("#tokenPanel");
    const t = input ? input.value.trim() : "";
    if (t && (t.startsWith("ghp_") || t.startsWith("github_pat_"))) {
      ghToken = t;
      localStorage.setItem(TOKEN_KEY, ghToken);
      if (panel) panel.style.display = "none";
      toast("Токен сохранён");
    } else if (t) {
      toast("Нужен ghp_... или github_pat_...");
    } else {
      if (panel) panel.style.display = "none";
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

  function badgeTag(badgeId) {
    if (!badgeId) return "";
    const b = badges.find(x => x.id === badgeId);
    if (!b) return `<span class="badge-sm" style="background:var(--cream-dim);color:#fff">${badgeId}</span>`;
    return `<span class="badge-sm" style="background:${b.color};color:#fff">${b.name}</span>`;
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
    clearImgPreview();
    editingId = null;
  }

  function openAddForm() {
    editingId = null;
    modalTitle.textContent = "Добавить товар";
    productForm.reset();
    clearImgPreview();
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

    setImgPreview(p.img || "");

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

  /* ── Image helpers ── */
  function setImgPreview(src) {
    if (src) {
      imgPreview.src = src;
      imgPreview.style.display = "block";
      imgZone.classList.add("has-img");
      imgPreview.onerror = () => clearImgPreview();
    } else {
      clearImgPreview();
    }
  }

  function clearImgPreview() {
    imgPreview.src = "";
    imgPreview.style.display = "none";
    imgZone.classList.remove("has-img");
    imgInput.value = "";
  }

  function updateImgPreview() {
    setImgPreview(imgInput.value.trim());
  }

  function compressImage(file, maxW, quality) {
    maxW = maxW || 1200;
    quality = quality || 0.82;
    return new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith("image/")) { toast("Это не картинка 🙄"); return; }
    toast("Сжимаем…");
    const b64 = await compressImage(file);
    imgInput.value = b64;
    setImgPreview(b64);
    toast("Фото загружено ✓");
  }

  /* ── Image drag & drop + file select ── */
  imgZone.addEventListener("click", function(e) {
    if (e.target === imgClearBtn) return;
    imgFileInput.click();
  });
  imgFileInput.addEventListener("change", function(e) {
    var file = e.target.files[0];
    if (file) handleImageFile(file);
    imgFileInput.value = "";
  });
  imgClearBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    clearImgPreview();
  });
  imgZone.addEventListener("dragover", function(e) {
    e.preventDefault();
    imgZone.classList.add("drag-over");
  });
  imgZone.addEventListener("dragleave", function() {
    imgZone.classList.remove("drag-over");
  });
  imgZone.addEventListener("drop", function(e) {
    e.preventDefault();
    imgZone.classList.remove("drag-over");
    var file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  });

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

  /* ── Badges ── */
  const BADGE_KEY = "iva_badges";
  const _DEFAULT_BADGES = [
    { id: "hit",    name: "Hit",   color: "#C9A4A0" },
    { id: "season", name: "Сезон", color: "#A8C5A0" },
    { id: "new",    name: "New",   color: "#C8B07A" },
  ];
  let badges = [];

  function loadBadges() {
    const saved = localStorage.getItem(BADGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length) { badges = parsed; return; }
      } catch {}
    }
    badges = [..._DEFAULT_BADGES];
  }

  function saveBadges() {
    localStorage.setItem(BADGE_KEY, JSON.stringify(badges));
  }

  function renderBadgeList() {
    const list = $("#badgeList");
    if (!list) return;
    list.innerHTML = badges.map((b, i) => `
      <div class="badge-row">
        <span class="badge-row__dot" style="background:${b.color}"></span>
        <span class="badge-row__id">${b.id}</span>
        <span class="badge-row__name">${b.name}</span>
        <button class="badge-row__del" onclick="adminApp.deleteBadge(${i})" title="Удалить">✕</button>
      </div>
    `).join("");
    updateBadgeSelect();
  }

  function updateBadgeSelect() {
    const sel = $("#fBadge");
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">Нет</option>' +
      badges.map(b => `<option value="${b.id}">${b.name}</option>`).join("");
    if (val) sel.value = val;
  }

  function addBadge() {
    const input = $("#newBadgeInput");
    const colorInput = $("#newBadgeColor");
    const name = input ? input.value.trim() : "";
    if (!name) { toast("Введите название"); if (input) input.focus(); return; }
    const tr = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"yo","ж":"zh","з":"z","и":"i","й":"j","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"};
    const id = name.toLowerCase()
      .split("").map(ch => tr[ch] !== undefined ? tr[ch] : ch).join("")
      .replace(/[^a-z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!id) { toast("Не удалось создать ID"); return; }
    if (badges.some(b => b.id === id)) { toast("Бейдж уже существует"); return; }
    const color = colorInput ? colorInput.value : "#C9A4A0";
    badges.push({ id, name, color });
    saveBadges();
    renderBadgeList();
    if (input) input.value = "";
    toast(`Бейдж «${name}» добавлен`);
  }

  function deleteBadge(idx) {
    const b = badges[idx];
    if (!b) return;
    const used = products.filter(p => p.badge === b.id).length;
    const msg = used
      ? `Удалить «${b.name}»? (${used} товаров с этим бейджем)`
      : `Удалить «${b.name}»?`;
    showConfirm(msg, () => {
      badges.splice(idx, 1);
      saveBadges();
      renderBadgeList();
      toast("Бейдж удалён");
    });
  }

  loadBadges();

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
  imgInput.addEventListener("input", updateImgPreview); // ввод URL вручную
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
  if (tokenBtn) tokenBtn.addEventListener("click", promptToken);
  const tokenSaveBtn = $("#tokenSaveBtn");
  if (tokenSaveBtn) tokenSaveBtn.addEventListener("click", saveToken);
  const tokenInput = $("#tokenInput");
  if (tokenInput) tokenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveToken(); });
  const addCatBtn = $("#addCatBtn");
  if (addCatBtn) addCatBtn.addEventListener("click", addCategory);
  const newCatInput = $("#newCatInput");
  if (newCatInput) newCatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addCategory(); });
  const addBadgeBtn = $("#addBadgeBtn");
  if (addBadgeBtn) addBadgeBtn.addEventListener("click", addBadge);
  const newBadgeInput = $("#newBadgeInput");
  if (newBadgeInput) newBadgeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addBadge(); });

  /* ── Tabs ── */
  function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach(function(btn) {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-panel").forEach(function(panel) {
      panel.classList.toggle("active", panel.id === "tab-" + tabId);
    });
    if (tabId === "stats") renderStats();
  }

  function statCard(label, value, sub, mod) {
    return '<div class="stat-card' + (mod ? ' stat-card--' + mod : '') + '">' +
      '<div class="stat-card__label">' + label + '</div>' +
      '<div class="stat-card__value">' + value + '</div>' +
      (sub ? '<div class="stat-card__sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function barRow(label, count, maxCount, color, extra) {
    var pct = maxCount ? Math.round(count / maxCount * 100) : 0;
    return '<div class="cat-stat-row">' +
      (extra || '') +
      '<span class="cat-stat-row__name">' + label + '</span>' +
      '<div class="cat-stat-bar"><div class="cat-stat-bar__fill" style="width:' + pct + '%;' + (color ? 'background:' + color : '') + '"></div></div>' +
      '<span class="cat-stat-row__count">' + count + ' шт.</span>' +
      '</div>';
  }

  function segRow(label, count, total, color) {
    var pct = total ? Math.round(count / total * 100) : 0;
    return '<div class="seg-row">' +
      '<span class="seg-row__label">' + label + '</span>' +
      '<div class="seg-row__bar"><div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:3px;transition:.4s ease"></div></div>' +
      '<span class="seg-row__meta">' + count + ' · ' + pct + '%</span>' +
    '</div>';
  }

  function renderStats() {
    const el = document.getElementById("statsPanel");
    if (!el) return;

    const total = products.length;
    if (total === 0) {
      el.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--cream-dim)"><div style="font-size:40px;margin-bottom:12px">📦</div><div>Товаров пока нет</div></div>';
      return;
    }

    const inStock   = products.filter(function(p) { return p.stock == null || p.stock > 0; }).length;
    const lowStock  = products.filter(function(p) { return p.stock != null && p.stock > 0 && p.stock <= 5; }).length;
    const noStock   = products.filter(function(p) { return p.stock != null && p.stock <= 0; }).length;
    const prices    = products.map(function(p) { return p.price; });
    const avgPrice  = Math.round(prices.reduce(function(s,v) { return s+v; }, 0) / total);
    const maxPrice  = Math.max.apply(null, prices);
    const minPrice  = Math.min.apply(null, prices);

    // Склад
    const warehouseValue = products.reduce(function(s,p) { return s + p.price * (p.stock || 0); }, 0);
    const stockItems = products.filter(function(p) { return p.stock != null; });
    const avgStock = stockItems.length ? Math.round(stockItems.reduce(function(s,p) { return s+p.stock; }, 0) / stockItems.length) : null;

    // Качество данных
    const noPhoto = products.filter(function(p) { return !p.img; }).length;
    const noDesc  = products.filter(function(p) { return !p.desc || !p.desc.trim(); }).length;

    // Ценовые сегменты
    const segLow  = products.filter(function(p) { return p.price < 2000; }).length;
    const segMid  = products.filter(function(p) { return p.price >= 2000 && p.price <= 4000; }).length;
    const segHigh = products.filter(function(p) { return p.price > 4000; }).length;

    // По категориям
    var byCat = {};
    products.forEach(function(p) { var n = categoryName(p.category); byCat[n] = (byCat[n]||0)+1; });
    var catEntries = Object.entries(byCat).sort(function(a,b) { return b[1]-a[1]; });
    var maxCat = catEntries.length ? catEntries[0][1] : 1;

    // По бейджам
    var byBadge = {};
    products.forEach(function(p) {
      if (p.badge) {
        var b = badges.find(function(x) { return x.id === p.badge; });
        var n = b ? b.name : p.badge;
        byBadge[n] = { count: (byBadge[n] ? byBadge[n].count : 0) + 1, color: b ? b.color : 'var(--pink)' };
      }
    });
    var badgeEntries = Object.entries(byBadge).sort(function(a,b) { return b[1].count - a[1].count; });
    var maxBadge = badgeEntries.length ? badgeEntries[0][1].count : 1;

    // Топ-5 по популярности
    var topPop = products.slice().sort(function(a,b) { return (b.popular||0)-(a.popular||0); }).slice(0,5);

    // Товары заканчиваются
    var lowStockList = products.filter(function(p) { return p.stock != null && p.stock > 0 && p.stock <= 5; })
      .sort(function(a,b) { return a.stock - b.stock; });

    var html = '';

    // ── Основные метрики ──
    html += '<div class="stats-section-title" style="padding-top:16px">Каталог</div>';
    html += '<div class="stats-grid">';
    html += statCard('Всего товаров', total, '');
    html += statCard('В наличии', inStock, '', 'accent');
    html += statCard('Мало (≤5 шт.)', lowStock, '', lowStock > 0 ? 'warn' : '');
    html += statCard('Нет в наличии', noStock, '', noStock > 0 ? 'danger' : '');
    html += statCard('Средняя цена', formatPrice(avgPrice), '');
    html += statCard('Диапазон цен', '<span style="font-size:15px">' + formatPrice(minPrice) + ' — ' + formatPrice(maxPrice) + '</span>', '');
    html += '</div>';

    // ── Склад ──
    html += '<div class="stats-section-title">Склад</div>';
    html += '<div class="stats-grid">';
    html += statCard('Стоимость склада', formatPrice(warehouseValue), 'цена × остаток', 'accent');
    html += statCard('Средний остаток', avgStock !== null ? avgStock + ' шт.' : '—', avgStock !== null ? 'по позициям с остатком' : 'остатки не указаны');
    html += statCard('Без фото', noPhoto, 'товаров без изображения', noPhoto > 0 ? 'warn' : '');
    html += statCard('Без описания', noDesc, 'товаров без текста', noDesc > 0 ? 'warn' : '');
    html += '</div>';

    // ── Ценовые сегменты ──
    html += '<div class="stats-section-title">Ценовые сегменты</div>';
    html += '<div style="padding:4px 20px 12px">';
    html += segRow('до 2 000 ₽', segLow, total, '#A8C5A0');
    html += segRow('2 000 — 4 000 ₽', segMid, total, '#C9A4A0');
    html += segRow('от 4 000 ₽', segHigh, total, '#C8B07A');
    html += '</div>';

    // ── По категориям ──
    if (catEntries.length) {
      html += '<div class="stats-section-title">По категориям</div>';
      catEntries.forEach(function(e) { html += barRow(e[0], e[1], maxCat, ''); });
    }

    // ── По бейджам ──
    if (badgeEntries.length) {
      html += '<div class="stats-section-title">По бейджам</div>';
      badgeEntries.forEach(function(e) { html += barRow(e[0], e[1].count, maxBadge, e[1].color); });
    }

    // ── Топ по популярности ──
    html += '<div class="stats-section-title">Топ по популярности</div>';
    html += '<div style="padding:0 20px 8px">';
    topPop.forEach(function(p, i) {
      var pop = p.popular || 0;
      html += '<div class="cat-stat-row">' +
        '<span style="font-size:11px;color:var(--cream-dim);min-width:22px;font-weight:700">#' + (i+1) + '</span>' +
        '<span class="cat-stat-row__name">' + p.name + '</span>' +
        '<div class="cat-stat-bar" style="width:60px"><div class="cat-stat-bar__fill" style="width:' + (pop*10) + '%;background:var(--pink)"></div></div>' +
        '<span style="font-size:12px;color:var(--pink-light);font-weight:700;min-width:30px;text-align:right">' + pop + '/10</span>' +
        '</div>';
    });
    html += '</div>';

    // ── Заканчиваются ──
    if (lowStockList.length) {
      html += '<div class="stats-section-title" style="color:var(--gold)">Заканчиваются</div>';
      html += '<div style="padding:0 20px 20px">';
      lowStockList.forEach(function(p) {
        html += '<div class="cat-stat-row">' +
          '<span class="cat-stat-row__name">' + p.name + '</span>' +
          '<span style="font-weight:700;color:var(--gold);font-size:13px">осталось ' + p.stock + ' шт.</span>' +
          '</div>';
      });
      html += '</div>';
    }

    // ── Аналитика просмотров ──
    var rawStats = null;
    try { rawStats = JSON.parse(localStorage.getItem('iva_stats') || 'null'); } catch {}
    if (rawStats && Object.keys(rawStats).length) {
      var statRows = Object.entries(rawStats).map(function(entry) {
        var id = parseInt(entry[0]);
        var s = entry[1];
        var p = products.find(function(x) { return x.id === id; });
        return { name: p ? p.name : '#' + id, views: s.views || 0, adds: s.adds || 0 };
      });
      statRows.sort(function(a, b) { return b.views - a.views; });
      var maxViews = statRows[0].views || 1;

      html += '<div class="stats-section-title">Просмотры и конверсия</div>';
      html += '<div style="padding:0 20px 24px;display:flex;flex-direction:column;gap:14px">';
      statRows.forEach(function(row) {
        var pct = Math.round(row.views / maxViews * 100);
        var conv = row.views ? Math.round(row.adds / row.views * 100) : 0;
        html += '<div style="display:flex;flex-direction:column;gap:5px">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
            '<span style="font-size:13px;font-weight:600;color:var(--cream)">' + row.name + '</span>' +
            '<span style="font-size:11px;color:var(--accent);font-weight:700">' + (row.views ? 'конв. ' + conv + '%' : '') + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:10px;color:var(--cream-dim);min-width:56px">👁 просмотры</span>' +
            '<div class="cat-stat-bar" style="flex:1"><div class="cat-stat-bar__fill" style="width:' + pct + '%;background:var(--pink-light)"></div></div>' +
            '<span style="font-size:12px;font-weight:700;color:var(--pink-light);min-width:28px;text-align:right">' + row.views + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:10px;color:var(--cream-dim);min-width:56px">🛒 в корзину</span>' +
            '<div class="cat-stat-bar" style="flex:1"><div class="cat-stat-bar__fill" style="width:' + (row.views ? Math.round(row.adds/maxViews*100) : 0) + '%;background:var(--accent)"></div></div>' +
            '<span style="font-size:12px;font-weight:700;color:var(--accent);min-width:28px;text-align:right">' + row.adds + '</span>' +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="stats-section-title">Просмотры и конверсия</div>';
      html += '<div style="text-align:center;padding:20px;color:var(--cream-dim);font-size:13px">Данных пока нет — откройте витрину и посмотрите букеты</div>';
    }

    el.innerHTML = html;
  }

  document.querySelectorAll(".tab-btn").forEach(function(btn) {
    btn.addEventListener("click", function() { switchTab(btn.dataset.tab); });
  });

  /* ── Init ── */
  checkAuth();

  /* ── Public API ── */
  window.adminApp = {
    editProduct: openEditForm,
    confirmDelete,
    moveProduct,
    deleteCat,
    deleteBadge,
  };
})();
