/* Готовит логотип из site/assets/logo.png:
   1. logo-transparent.png — вырезан бренд-фон (#455354), листья/буквы остаются
   2. logo-header.png — маленький ретина-вариант для шапки (h≈88px)
   3. og.png — 1200×630 бренд-превью с логотипом по центру
*/
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, '..', '..', 'site', 'assets');
const SITE = path.join(__dirname, '..', '..', 'site');
const SRC = path.join(ASSETS, 'logo.png');

const BG = [69, 83, 84];   // измеренный фон
const TOL = 22;             // терпимость по каналу

const src = sharp(SRC);
const { data, info } = await src.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
const px = new Uint8Array(data);
for (let i = 0; i < px.length; i += 4) {
  const dr = Math.abs(px[i] - BG[0]);
  const dg = Math.abs(px[i+1] - BG[1]);
  const db = Math.abs(px[i+2] - BG[2]);
  if (dr < TOL && dg < TOL && db < TOL) {
    px[i+3] = 0;
  }
}
const transparentBuf = await sharp(px, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png().toBuffer();
await fs.writeFile(path.join(ASSETS, 'logo-transparent.png'), transparentBuf);
console.log('logo-transparent.png:', transparentBuf.length);

const headerBuf = await sharp(transparentBuf).resize({ height: 176 }).png({ compressionLevel: 9 }).toBuffer();
await fs.writeFile(path.join(ASSETS, 'logo-header.png'), headerBuf);
console.log('logo-header.png:', headerBuf.length);

const BRAND = { r: 47, g: 74, b: 58 };
const bgBase = await sharp({
  create: { width: 1200, height: 630, channels: 4, background: BRAND }
}).png().toBuffer();

const ogLogo = await sharp(transparentBuf).resize({ height: 400, fit: 'inside' }).toBuffer();
const ogBuf = await sharp(bgBase)
  .composite([{ input: ogLogo, gravity: 'center' }])
  .png()
  .toBuffer();
await fs.writeFile(path.join(SITE, 'og.png'), ogBuf);
console.log('og.png:', ogBuf.length);
