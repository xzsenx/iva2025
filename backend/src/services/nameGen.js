import axios from 'axios';

const DS_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const DS_KEY = process.env.DEEPSEEK_API_KEY;
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const PROMPT = `Ты — поэт-флорист цветочной студии «ИВА» в Белгороде.
По составу букета придумай 5 названий: коротких, благозвучных, романтичных, в духе авторской русской флористики.
Без банальностей вроде «Нежность» или «Романтика». Без эмодзи.
Можно нежные русские слова, имена, природные образы, лёгкие иностранные слова (Aurora, Vento, Étoile) — но в меру.
Каждое название — 1–3 слова, до 25 символов.

Состав букета:
{COMPOSITION}

Верни ровно 5 названий, каждое с новой строки, без нумерации, без кавычек.`;

/* items: [{title, qty}] */
export async function generateBouquetNames(items, opts = {}) {
  if (!DS_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const list = (items || []).filter(i => i.title);
  if (!list.length) throw new Error('пустой состав');

  const composition = list
    .map(i => `— ${i.title}${i.qty ? ` × ${i.qty}` : ''}`)
    .join('\n');

  const prompt = PROMPT.replace('{COMPOSITION}', composition);

  const res = await axios.post(
    `${DS_BASE}/chat/completions`,
    {
      model: DS_MODEL,
      messages: [
        { role: 'system', content: 'Ты помощник флориста.' },
        { role: 'user', content: prompt },
      ],
      temperature: opts.temperature ?? 0.9,
      max_tokens: 200,
    },
    {
      headers: { Authorization: `Bearer ${DS_KEY}` },
      timeout: 30_000,
    }
  );

  const text = res.data?.choices?.[0]?.message?.content || '';
  const names = text
    .split('\n')
    .map(s => s.trim().replace(/^[\d.\-)\s]+/, '').replace(/^["«»]+|["«»]+$/g, '').trim())
    .filter(s => s && s.length <= 40)
    .slice(0, 5);

  if (!names.length) throw new Error('пустой ответ от модели');
  return names;
}

/* Нормализация сокращённого названия от поставщика в человекочитаемое.
   Пример: «куст. роза» → «Роза кустовая», «голландец куст.роза (малиновая)» → «Роза кустовая малиновая». */
const NORMALIZE_PROMPT = `Расшифруй сокращённое поставщиком название цветка «{RAW}» в понятное для клиента.
Правила:
— сокращения расшифровывай: «куст.» → «кустовая/кустовой», «пионов.» → «пионовидная», «эквадор.» → «эквадорская», «голланд.», «голландец» → «голландская».
— уточняющий цвет в скобках оставляй как прилагательное: «(малиновая)» → «малиновая».
— капитализация: первое слово с заглавной, остальные строчные.
— соблюдай род: Роза — жен., Гладиолус, Василёк, Тюльпан — муж., Ромашка — жен.
— название 1–4 слова, до 32 символов.
— без кавычек, без эмодзи, без слова «цветок» и без артикулов.
Верни ровно 3 варианта, каждый с новой строки, без нумерации.`;

export async function normalizeFlowerName(rawTitle) {
  if (!DS_KEY) throw new Error('DEEPSEEK_API_KEY not set');
  const raw = String(rawTitle || '').trim();
  if (!raw) throw new Error('пустое название');

  const prompt = NORMALIZE_PROMPT.replace('{RAW}', raw);
  const res = await axios.post(
    `${DS_BASE}/chat/completions`,
    {
      model: DS_MODEL,
      messages: [
        { role: 'system', content: 'Ты редактор каталога цветов. Отвечай кратко и по делу.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 120,
    },
    {
      headers: { Authorization: `Bearer ${DS_KEY}` },
      timeout: 30_000,
    }
  );

  const text = res.data?.choices?.[0]?.message?.content || '';
  const names = text
    .split('\n')
    .map(s => s.trim().replace(/^[\d.\-)\s]+/, '').replace(/^["«»]+|["«»]+$/g, '').trim())
    .filter(s => s && s.length <= 40)
    .slice(0, 3);

  if (!names.length) throw new Error('пустой ответ от модели');
  return names;
}
