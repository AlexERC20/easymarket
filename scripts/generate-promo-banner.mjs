// Генерация баннера промо-гонки для карточки в телеграм-боте.
// Запуск: node scripts/generate-promo-banner.mjs
// Результат: public/assets/promo-race-banner.png (1280x640)
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIDTH = 1280;
const HEIGHT = 640;

// Молния велком-заставки (viewBox 64x64) — тот же силуэт, что в приложении.
const BOLT_POINTS = "36.8,3 13.6,35.6 29.6,35.6 24.8,61 50.4,25.2 34.2,25.2";

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7a8"/>
      <stop offset="0.45" stop-color="#b7ff4d"/>
      <stop offset="1" stop-color="#35f6ff"/>
    </linearGradient>
    <radialGradient id="glowCyan" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#35f6ff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#35f6ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowLime" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#b7ff4d" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#b7ff4d" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0a0f14"/>
  <circle cx="1030" cy="300" r="330" fill="url(#glowCyan)"/>
  <circle cx="220" cy="120" r="300" fill="url(#glowLime)"/>

  <g transform="translate(880,70) rotate(10) scale(8.2)">
    <polygon points="${BOLT_POINTS}" fill="url(#bolt)" filter="url(#blur)" opacity="0.55"/>
    <polygon points="${BOLT_POINTS}" fill="url(#bolt)"/>
  </g>

  <text x="82" y="128" font-family="DejaVu Sans, sans-serif" font-size="32" font-weight="700"
        fill="#b7ff4d" letter-spacing="10">EASYMARKET</text>
  <text x="76" y="232" font-family="DejaVu Sans, sans-serif" font-size="92" font-weight="800"
        fill="#ffffff">ПРОМО-ГОНКА</text>
  <text x="82" y="292" font-family="DejaVu Sans, sans-serif" font-size="30"
        fill="#9fb0c0">Месячная гонка за призовой фонд</text>
  <text x="82" y="368" font-family="DejaVu Sans, sans-serif" font-size="58" font-weight="800"
        fill="#b7ff4d">33 500$</text>

  <g font-family="DejaVu Sans, sans-serif">
    <rect x="80" y="412" width="230" height="96" rx="18" fill="#b7ff4d" fill-opacity="0.10"
          stroke="#b7ff4d" stroke-opacity="0.35"/>
    <text x="104" y="450" font-size="22" fill="#9fb0c0" letter-spacing="2">1 МЕСТО</text>
    <text x="104" y="492" font-size="40" font-weight="800" fill="#ffffff">5 000$</text>

    <rect x="330" y="412" width="230" height="96" rx="18" fill="#b7ff4d" fill-opacity="0.07"
          stroke="#b7ff4d" stroke-opacity="0.25"/>
    <text x="354" y="450" font-size="22" fill="#9fb0c0" letter-spacing="2">2 МЕСТО</text>
    <text x="354" y="492" font-size="40" font-weight="800" fill="#ffffff">3 000$</text>

    <rect x="580" y="412" width="230" height="96" rx="18" fill="#b7ff4d" fill-opacity="0.05"
          stroke="#b7ff4d" stroke-opacity="0.18"/>
    <text x="604" y="450" font-size="22" fill="#9fb0c0" letter-spacing="2">3 МЕСТО</text>
    <text x="604" y="492" font-size="40" font-weight="800" fill="#ffffff">1 700$</text>
  </g>

  <text x="82" y="572" font-family="DejaVu Sans, sans-serif" font-size="26"
        fill="#6b7a8a">100 призовых мест · задания в боте · итоги в конце сезона</text>
</svg>
`;

const outputPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/assets/promo-race-banner.png",
);

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outputPath);
console.log(`promo banner written to ${outputPath}`);
