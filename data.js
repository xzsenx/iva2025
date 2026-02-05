/* ======  IVA — каталог товаров  ====== */

const CATEGORIES = [
  { id: "all",       name: "Все"          },
  { id: "bouquets",  name: "Букеты"       },
  { id: "roses",     name: "Розы"         },
  { id: "compose",   name: "Композиции"   },
  { id: "gifts",     name: "Подарки"      },
];

/* ── Конфиг: GitHub-репозиторий ── */
const GITHUB_OWNER = "xzsenx";
const GITHUB_REPO  = "iva2025";
const GITHUB_FILE  = "products.json";
const GITHUB_BRANCH = "main";

/* URL для чтения (GitHub Pages — кэш ~5 мин) */
const PRODUCTS_URL = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/${GITHUB_FILE}`;

/* Дефолтные товары (фолбэк если fetch не удался) */
const _DEFAULT_BOUQUETS = [
  {id:1,name:"Лесной минимал",price:3200,popular:5,category:"bouquets",badge:"new",desc:"Лёгкий букет из эвкалипта и хлопка — идеальный подарок для любого случая.",sizes:["S","M","L"],stock:12,img:"https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=600&q=80"},
  {id:2,name:"Классика роз",price:2900,popular:10,category:"roses",badge:"hit",desc:"Букет из 25 свежих красных роз премиального сорта. Классика, проверенная временем.",sizes:["S","M","L"],stock:25,img:"https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=600&q=80"},
  {id:3,name:"Нежные пионы",price:4500,popular:7,category:"bouquets",badge:"season",desc:"Сезонный букет из пышных пионов: от нежно-розового до белого. Лимитированная серия.",sizes:["M","L"],stock:8,img:"https://images.unsplash.com/photo-1563241527-3004b7be0ffd?w=600&q=80"},
];

/* Глобальный массив товаров — заполняется асинхронно */
let BOUQUETS = [..._DEFAULT_BOUQUETS];

/* Загрузить товары с GitHub Pages */
async function fetchProducts() {
  try {
    const res = await fetch(PRODUCTS_URL + "?t=" + Date.now()); // обход кэша
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      BOUQUETS = data;
    }
  } catch (err) {
    console.log("fetchProducts fallback:", err.message);
    /* Если нет сети — попробуем localStorage */
    const local = localStorage.getItem("iva_products");
    if (local) {
      try { BOUQUETS = JSON.parse(local); } catch {}
    }
  }
  return BOUQUETS;
}

/* Совместимость — getProducts() для синхронного доступа */
function getProducts() {
  return BOUQUETS;
}
