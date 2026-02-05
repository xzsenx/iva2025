/* ======  IVA — каталог товаров  ====== */

const CATEGORIES = [
  { id: "all",       name: "Все"          },
  { id: "bouquets",  name: "Букеты"       },
  { id: "roses",     name: "Розы"         },
  { id: "compose",   name: "Композиции"   },
  { id: "gifts",     name: "Подарки"      },
];

const _DEFAULT_BOUQUETS = [
  /* ── Букеты ── */
  {
    id: 1,
    name: "Лесной минимал",
    price: 3200,
    popular: 5,
    category: "bouquets",
    badge: "new",
    desc: "Лёгкий букет из эвкалипта и хлопка — идеальный подарок для любого случая.",
    sizes: ["S", "M", "L"],
    stock: 12,
    img: "https://images.unsplash.com/photo-1487530811176-3780de880c2d?w=600&q=80",
  },
  {
    id: 2,
    name: "Классика роз",
    price: 2900,
    popular: 10,
    category: "roses",
    badge: "hit",
    desc: "Букет из 25 свежих красных роз премиального сорта. Классика, проверенная временем.",
    sizes: ["S", "M", "L"],
    stock: 25,
    img: "https://images.unsplash.com/photo-1455659817273-f96807779a8a?w=600&q=80",
  },
  {
    id: 3,
    name: "Нежные пионы",
    price: 4500,
    popular: 7,
    category: "bouquets",
    badge: "season",
    desc: "Сезонный букет из пышных пионов: от нежно‑розового до белого. Лимитированная серия.",
    sizes: ["M", "L"],
    stock: 8,
    img: "https://images.unsplash.com/photo-1563241527-3004b7be0ffd?w=600&q=80",
  },
  {
    id: 4,
    name: "Белый каскад",
    price: 3800,
    popular: 8,
    category: "bouquets",
    badge: null,
    desc: "Воздушный букет из белых хризантем с гипсофилой — элегантность и свежесть.",
    sizes: ["S", "M", "L"],
    stock: 15,
    img: "https://images.unsplash.com/photo-1508610048659-a06b669e3321?w=600&q=80",
  },
  {
    id: 5,
    name: "Розы Дэвида Остина",
    price: 6200,
    popular: 9,
    category: "roses",
    badge: "hit",
    desc: "Пионовидные розы сорта Juliet: персиковые лепестки с ароматом жасмина.",
    sizes: ["S", "M", "L"],
    stock: 6,
    img: "https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=600&q=80",
  },
  {
    id: 6,
    name: "Монобукет лаванды",
    price: 2400,
    popular: 4,
    category: "bouquets",
    badge: "new",
    desc: "Натуральная лаванда из Прованса. Тонкий аромат и стильная крафт‑упаковка.",
    sizes: ["S", "M"],
    stock: 20,
    img: "https://images.unsplash.com/photo-1468327768560-75b778cbb551?w=600&q=80",
  },

  /* ── Композиции ── */
  {
    id: 7,
    name: "Цветы в шляпной коробке",
    price: 5500,
    popular: 6,
    category: "compose",
    badge: "hit",
    desc: "Роскошная коробка с миксом роз и эвкалипта. Не нужна ваза — подарок сразу готов.",
    sizes: ["M", "L"],
    stock: 5,
    img: "https://images.unsplash.com/photo-1561181286-d3fee7d55364?w=600&q=80",
  },
  {
    id: 8,
    name: "Корзина «Прованс»",
    price: 7200,
    popular: 3,
    category: "compose",
    badge: "season",
    desc: "Плетёная корзина с полевыми цветами, лимониумом и зеленью. Создаёт атмосферу юга Франции.",
    sizes: ["L"],
    stock: 3,
    img: "https://images.unsplash.com/photo-1471696035578-3d8c78d99571?w=600&q=80",
  },

  /* ── Подарки ── */
  {
    id: 9,
    name: "Свеча «Сандал и роза»",
    price: 1800,
    popular: 6,
    category: "gifts",
    badge: "new",
    desc: "Ароматическая свеча ручной работы из соевого воска. Горит 40 часов.",
    sizes: null,
    stock: 30,
    img: "https://images.unsplash.com/photo-1602028915047-37269d1a73f7?w=600&q=80",
  },
  {
    id: 10,
    name: "Набор «Для неё»",
    price: 4900,
    popular: 8,
    category: "gifts",
    badge: "hit",
    desc: "Мини‑букет + свеча + открытка ручной работы в стильной подарочной упаковке.",
    sizes: null,
    stock: 10,
    img: "https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?w=600&q=80",
  },
];

/* Если админка сохранила товары в localStorage — используем их.
   getProducts() — всегда возвращает актуальные данные (для динамической связки с админкой). */
function getProducts() {
  return JSON.parse(localStorage.getItem("iva_products") || "null") || _DEFAULT_BOUQUETS;
}
let BOUQUETS = getProducts();
