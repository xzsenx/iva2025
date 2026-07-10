/* Генерация OG-превью для соцсетей (1200×630).
   Запуск: node scripts/gen-og.js
   Кладёт файл в site/og.png. */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', 'site', 'og.png');

const BG = '#2f4a3a';
const CREAM = '#ede6da';
const PINK = '#e6b8b0';

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${BG}"/>

  <!-- Веточка с листиками (стилизованная под лого ИВА) -->
  <g transform="translate(410, 130)" stroke="${CREAM}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.9">
    <path d="M100 360 C90 280 110 200 90 120 C80 70 105 30 100 10"/>
    <path d="M95 320 C60 310 30 330 10 350 C50 350 85 340 95 320 Z" fill="${CREAM}" fill-opacity="0.12"/>
    <path d="M100 250 C140 240 175 260 200 280 C160 280 115 270 100 250 Z" fill="${CREAM}" fill-opacity="0.12"/>
    <path d="M95 180 C60 170 30 190 10 210 C50 210 85 200 95 180 Z" fill="${CREAM}" fill-opacity="0.12"/>
    <path d="M100 110 C140 100 170 110 190 130 C150 130 115 120 100 110 Z" fill="${CREAM}" fill-opacity="0.12"/>
    <path d="M100 50 C75 40 55 50 40 65 C70 65 90 60 100 50 Z" fill="${CREAM}" fill-opacity="0.12"/>
    <circle cx="100" cy="12" r="6" fill="${CREAM}" stroke="none"/>
    <circle cx="15" cy="245" r="5" fill="${CREAM}" stroke="none"/>
    <circle cx="195" cy="200" r="5" fill="${CREAM}" stroke="none"/>
  </g>

  <!-- ИВА курсивом -->
  <text x="600" y="380" fill="${CREAM}"
        font-family="'Cormorant Garamond', 'Times New Roman', serif"
        font-style="italic" font-weight="500" font-size="180"
        text-anchor="middle" letter-spacing="4">ИВА</text>

  <!-- Подпись -->
  <text x="600" y="440" fill="${CREAM}" opacity="0.75"
        font-family="'Manrope', 'Helvetica', sans-serif"
        font-size="26" font-weight="400"
        text-anchor="middle" letter-spacing="10">ЦВЕТОЧНАЯ СТУДИЯ</text>

  <!-- Разделитель -->
  <line x1="500" y1="490" x2="700" y2="490" stroke="${PINK}" stroke-width="1.5" opacity="0.6"/>

  <!-- Подпись города -->
  <text x="600" y="540" fill="${CREAM}" opacity="0.6"
        font-family="'Manrope', 'Helvetica', sans-serif"
        font-size="20" font-weight="400"
        text-anchor="middle" letter-spacing="6">БЕЛГОРОД · с 2019</text>
</svg>`;

await sharp(Buffer.from(svg))
  .png()
  .toFile(OUT);

console.log('OG written:', OUT);
