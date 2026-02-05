/* ============================================================
   IVA — Админ-панель  |  CRUD товаров, localStorage, Excel
   ============================================================ */

(() => {
  const ADMIN_PASS = "iva2025";
  const STORAGE_KEY = "iva_products";

  /* ── State ── */
  let products = [];
  let editingId = null;
  let confirmCallback = null;
  let dragSrcIdx = null;

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

  /* ── Helpers ── */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  function formatPrice(n) {
    return Number(n).toLocaleString("ru-RU") + " \u20BD";
  }

  function nextId() {
    return products.length ? Math.max(...products.map((p) => p.id)) + 1 : 1;
  }

  /* ── Auth ── */
  function checkAuth() {
    if (sessionStorage.getItem("iva_admin") === "1") {
      showPanel();
    }
  }

  function doLogin() {
    if (loginPass.value === ADMIN_PASS) {
      sessionStorage.setItem("iva_admin", "1");
      loginError.style.display = "none";
      showPanel();
    } else {
      loginError.style.display = "block";
      loginPass.value = "";
      loginPass.focus();
    }
  }

  function doLogout() {
    sessionStorage.removeItem("iva_admin");
    adminPanel.classList.remove("visible");
    loginScreen.classList.remove("hidden");
    loginPass.value = "";
  }

  function showPanel() {
    loginScreen.classList.add("hidden");
    adminPanel.classList.add("visible");
    loadProducts();
    renderList();
  }

  /* ── Data ── */
  function loadProducts() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { products = JSON.parse(stored); } catch { products = [..._DEFAULT_BOUQUETS]; }
    } else {
      products = [..._DEFAULT_BOUQUETS];
    }
  }

  function saveProducts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
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
      <div class="product-row" draggable="true" data-idx="${idx}">
        <span class="product-row__drag">⠿</span>
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

    setupDragDrop();
  }

  function categoryName(id) {
    const map = { bouquets:"Букеты", roses:"Розы", compose:"Композиции", gifts:"Подарки" };
    return map[id] || id;
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

  /* ── Drag & Drop ── */
  function setupDragDrop() {
    const rows = productList.querySelectorAll(".product-row");
    rows.forEach((row) => {
      row.addEventListener("dragstart", (e) => {
        dragSrcIdx = parseInt(row.dataset.idx);
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        rows.forEach((r) => r.classList.remove("drag-over"));
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetIdx = parseInt(row.dataset.idx);
        if (dragSrcIdx !== null && dragSrcIdx !== targetIdx) {
          const [moved] = products.splice(dragSrcIdx, 1);
          products.splice(targetIdx, 0, moved);
          saveProducts();
          renderList();
          toast("Порядок изменён");
        }
      });
    });
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

  function handleFormSubmit(e) {
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
      toast("Товар обновлён");
    } else {
      products.push(data);
      toast("Товар добавлен");
    }

    saveProducts();
    renderList();
    closeModal();
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
    showConfirm(`Удалить «${p ? p.name : "товар"}»?`, () => {
      products = products.filter((x) => x.id !== id);
      saveProducts();
      renderList();
      toast("Товар удалён");
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

    /* Ширина колонок */
    ws["!cols"] = [
      { wch: 5 },  // ID
      { wch: 28 }, // Название
      { wch: 10 }, // Цена
      { wch: 10 }, // Остаток
      { wch: 14 }, // Популярность
      { wch: 14 }, // Категория
      { wch: 14 }, // Категория_ID
      { wch: 8 },  // Бейдж
      { wch: 40 }, // Описание
      { wch: 10 }, // Размеры
      { wch: 60 }, // Фото
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
    reader.onload = (ev) => {
      try {
        if (typeof XLSX === "undefined") {
          toast("Ошибка: библиотека XLSX не загрузилась");
          return;
        }

        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);

        if (!rows.length) {
          toast("Файл пустой");
          return;
        }

        /* Маппинг колонок Excel → структура товара */
        const catMap = { "Букеты":"bouquets", "Розы":"roses", "Композиции":"compose", "Подарки":"gifts" };

        const imported = rows.map((r, i) => {
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

        products = imported;
        saveProducts();
        renderList();
        toast(`Импортировано ${imported.length} товаров`);
      } catch (err) {
        console.error(err);
        toast("Ошибка чтения Excel");
      }
    };
    reader.readAsArrayBuffer(file);
    importFile.value = "";
  }

  function doReset() {
    showConfirm("Сбросить все товары к исходным? Текущие изменения будут потеряны.", () => {
      products = [..._DEFAULT_BOUQUETS];
      saveProducts();
      renderList();
      toast("Товары сброшены к исходным");
    });
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

  /* ── Event Listeners ── */
  loginBtn.addEventListener("click", doLogin);
  loginPass.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  logoutBtn.addEventListener("click", doLogout);
  addProductBtn.addEventListener("click", openAddForm);
  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });
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

  /* ── Init ── */
  checkAuth();

  /* ── Public API (for inline onclick) ── */
  window.adminApp = {
    editProduct: openEditForm,
    confirmDelete,
  };
})();
