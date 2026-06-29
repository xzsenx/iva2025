/* ======  IVA — каталог товаров (источник: backend Posiflora-sync)  ====== */

const _DEFAULT_CATEGORIES = [
  { id: "bouquets",  name: "Букеты"  },
  { id: "showcase",  name: "Витрина" },
  { id: "gifts",     name: "Подарки" },
];

let CATEGORIES = (function() {
  const saved = localStorage.getItem("iva_categories");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) {
        return [{ id: "all", name: "Все" }, ...parsed];
      }
    } catch {}
  }
  return [{ id: "all", name: "Все" }, ..._DEFAULT_CATEGORIES];
})();

const API_BASE = localStorage.getItem("iva_api")
              || (location.hostname === "localhost" || location.hostname === "127.0.0.1"
                  ? "http://localhost:3001"
                  : `https://${location.hostname}`);

let BOUQUETS = [];
let STEMS = [];
let ADDONS = [];
let WRAPS = [];
let RIBBONS = [];

async function _fetchJSON(path) {
  const res = await fetch(API_BASE + path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function fetchProducts() {
  try {
    const [templates, customTmpls, showcase, stems, addons, wraps, ribbons] = await Promise.all([
      _fetchJSON("/api/products/templates").catch(() => []),
      _fetchJSON("/api/products/custom-templates").catch(() => []),
      _fetchJSON("/api/products/showcase").catch(() => []),
      _fetchJSON("/api/products/stems").catch(() => []),
      _fetchJSON("/api/products/addons").catch(() => []),
      _fetchJSON("/api/products/wraps").catch(() => []),
      _fetchJSON("/api/products/ribbons").catch(() => []),
    ]);

    const showcaseItems = showcase.map(b => ({
      id: b.id, name: b.title, price: b.price || 0, popular: b.popular || 8,
      category: "showcase", badge: b.badge || "new", desc: b.description || "",
      sizes: null, stock: b.stock ?? 1, img: b.img || null,
    }));

    const templateItems = [...templates, ...customTmpls].map(t => ({
      id: t.id, name: t.title, price: t.price || 0, popular: t.popular || 5,
      category: t.category || "bouquets", badge: t.badge || null,
      desc: t.description || "", sizes: null, stock: 99,
      img: t.img || null,
    }));

    const addonItems = addons
      .filter(a => !/ножниц|секатор|инструмент/i.test(a.title))
      .map(a => ({
        id: a.id, name: a.title, price: a.price || 0, popular: 3,
        category: "gifts", badge: null, desc: "", sizes: null, stock: 99,
        img: a.img || null,
      }));

    BOUQUETS = [...showcaseItems, ...templateItems, ...addonItems];
    STEMS = stems;
    ADDONS = addons;
    WRAPS = wraps;
    RIBBONS = ribbons;

    try { localStorage.setItem("iva_products", JSON.stringify(BOUQUETS)); } catch {}
  } catch (err) {
    console.log("fetchProducts fallback:", err.message);
    const local = localStorage.getItem("iva_products");
    if (local) { try { BOUQUETS = JSON.parse(local); } catch {} }
  }
  return BOUQUETS;
}

function getProducts() { return BOUQUETS; }
function getStems()    { return STEMS; }
function getAddons()   { return ADDONS; }
function getWraps()    { return WRAPS; }
function getRibbons()  { return RIBBONS; }
