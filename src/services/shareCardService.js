import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1920;

// Молния велком-заставки (viewBox 64x64) как полигон для сэмплинга частиц.
const BOLT_POLY = [
  [36.8, 3],
  [13.6, 35.6],
  [29.6, 35.6],
  [24.8, 61],
  [50.4, 25.2],
  [34.2, 25.2],
];

// Градиент велкома: тёплый верх -> лайм -> циан.
const GRADIENT_STOPS = [
  { at: 0, rgb: [255, 247, 168] },
  { at: 0.45, rgb: [183, 255, 77] },
  { at: 1, rgb: [53, 246, 255] },
];

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Keep the profit label short and safe. Non-breaking spaces from ru-RU
// formatting are normalised to plain spaces so the glyph always exists.
function normalizeAmount(raw) {
  const cleaned = String(raw ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  return cleaned || "Выигрыш";
}

// Build the profit label server-side from clean numeric params, so nothing with
// URL-sensitive characters ($, +, non-breaking spaces) is ever passed through
// the query string (Telegram re-encodes the media URL, which would otherwise
// surface raw %-codes on the card).
export function formatStoryAmount(value, currency) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "";
  }
  const isUsdt = String(currency || "").toUpperCase() === "USDT";
  const rounded = isUsdt ? Math.round(numeric * 100) / 100 : Math.round(numeric);
  const grouped = rounded
    .toLocaleString("en-US", { maximumFractionDigits: isUsdt ? 2 : 0 })
    .replace(/,/g, " ");
  return isUsdt ? `+$${grouped}` : `+${grouped} ★`;
}

function amountFontSize(label) {
  const len = label.length;
  if (len > 14) return 92;
  if (len > 11) return 112;
  if (len > 8) return 126;
  return 144;
}

// Детерминированный PRNG: карточка при одинаковой сумме рендерится одинаково.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function gradientColor(t) {
  const at = Math.min(1, Math.max(0, t));
  let lower = GRADIENT_STOPS[0];
  let upper = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i += 1) {
    if (at >= GRADIENT_STOPS[i].at && at <= GRADIENT_STOPS[i + 1].at) {
      lower = GRADIENT_STOPS[i];
      upper = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const span = upper.at - lower.at || 1;
  const k = (at - lower.at) / span;
  return [
    Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * k),
    Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * k),
    Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * k),
  ];
}

function haloIdFor(ny) {
  if (ny < 0.3) return "haloWarm";
  if (ny < 0.62) return "haloLime";
  return "haloCyan";
}

// Молния, собранная из светящихся частиц (как в велком-заставке).
// Каждая частица: мягкое гало + цветное ядро + горячий белый центр.
function buildParticleBolt(rand, cx, cy, boltHeight) {
  const scale = boltHeight / 64;
  const halos = [];
  const cores = [];
  for (let gy = 3; gy <= 61; gy += 2.0) {
    for (let gx = 13; gx <= 51; gx += 2.0) {
      const jx = gx + (rand() - 0.5) * 1.5;
      const jy = gy + (rand() - 0.5) * 1.5;
      if (!pointInPoly(jx, jy, BOLT_POLY)) {
        continue;
      }
      const px = (cx + (jx - 32) * scale).toFixed(1);
      const py = (cy + (jy - 32) * scale).toFixed(1);
      const ny = (jy - 3) / 58;
      const [r, g, b] = gradientColor(ny);
      const coreR = (5.6 + rand() * 3.6).toFixed(1);
      halos.push(`<circle cx="${px}" cy="${py}" r="${(coreR * 2.5).toFixed(1)}" fill="url(#${haloIdFor(ny)})"/>`);
      cores.push(`<circle cx="${px}" cy="${py}" r="${coreR}" fill="rgb(${r},${g},${b})" opacity="${(0.78 + rand() * 0.22).toFixed(2)}"/>`);
      cores.push(`<circle cx="${px}" cy="${py}" r="${(coreR * 0.36).toFixed(1)}" fill="#ffffff" opacity="0.85"/>`);
    }
  }
  return halos.join("\n  ") + "\n  " + cores.join("\n  ");
}

// Кометы, летящие к молнии: карточка ловит момент сборки логотипа из частиц.
function buildComets(rand, cx, cy) {
  const defs = [];
  const shapes = [];
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.5;
    const dist = 430 + rand() * 260;
    const hx = cx + Math.cos(angle) * dist;
    const hy = cy + Math.sin(angle) * dist * 0.86;
    if (hy < 330 || hy > 1010) {
      continue; // не заезжаем на текстовые зоны
    }
    const len = 70 + rand() * 110;
    const tx = hx + Math.cos(angle) * len;
    const ty = hy + Math.sin(angle) * len;
    const [r, g, b] = gradientColor(rand());
    const id = `comet${i}`;
    defs.push(`<linearGradient id="${id}" x1="${tx.toFixed(0)}" y1="${ty.toFixed(0)}" x2="${hx.toFixed(0)}" y2="${hy.toFixed(0)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
      <stop offset="1" stop-color="rgb(${r},${g},${b})" stop-opacity="0.66"/>
    </linearGradient>`);
    shapes.push(`<line x1="${tx.toFixed(0)}" y1="${ty.toFixed(0)}" x2="${hx.toFixed(0)}" y2="${hy.toFixed(0)}" stroke="url(#${id})" stroke-width="${(4.5 + rand() * 3).toFixed(1)}" stroke-linecap="round"/>
  <circle cx="${hx.toFixed(0)}" cy="${hy.toFixed(0)}" r="${(4 + rand() * 3).toFixed(1)}" fill="rgb(${r},${g},${b})" opacity="0.9"/>`);
  }
  return { defs: defs.join("\n    "), shapes: shapes.join("\n  ") };
}

// Редкая светящаяся пыль по всей карточке — глубина сцены.
function buildDust(rand) {
  const dots = [];
  for (let i = 0; i < 30; i += 1) {
    const x = Math.round(40 + rand() * (WIDTH - 80));
    const y = Math.round(150 + rand() * (HEIGHT - 340));
    const [r, g, b] = gradientColor(rand());
    dots.push(`<circle cx="${x}" cy="${y}" r="${(1.6 + rand() * 2.6).toFixed(1)}" fill="rgb(${r},${g},${b})" opacity="${(0.08 + rand() * 0.16).toFixed(2)}"/>`);
  }
  return dots.join("\n  ");
}

// Вертикальная Story-карточка в стиле велком-заставки: молния EasyMarket,
// собранная из частиц, кометы сборки, вордмарк и выигрыш. Сознательно БЕЗ
// SVG-фильтров (feGaussianBlur/feDropShadow) — librsvg через sharp рендерит их
// ненадёжно; всё свечение сделано слоями полупрозрачных градиентных фигур.
export function buildStoryCardSvg(amountLabel) {
  const raw = normalizeAmount(amountLabel);
  const amount = escapeXml(raw);
  const amountSize = amountFontSize(raw);
  // Сид зависит от суммы: у одной суммы стабильная картинка, у разных — свой
  // рисунок частиц.
  let seed = 0x9e3779b9;
  for (const ch of raw) {
    seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const rand = mulberry32(seed);

  const boltCx = 540;
  const boltCy = 640;
  const comets = buildComets(rand, boltCx, boltCy);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a101c"/>
      <stop offset="0.5" stop-color="#070a10"/>
      <stop offset="1" stop-color="#04060b"/>
    </linearGradient>
    <radialGradient id="glowLime" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#b7ff4d" stop-opacity="0.17"/>
      <stop offset="1" stop-color="#b7ff4d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowCyan" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#35f6ff" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#35f6ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowAmount" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#b7ff4d" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#b7ff4d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haloWarm" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff7a8" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#fff7a8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haloLime" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#b7ff4d" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#b7ff4d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haloCyan" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#35f6ff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#35f6ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.72" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#02040a" stop-opacity="0.78"/>
    </radialGradient>
    <linearGradient id="scan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b7ff4d" stop-opacity="0"/>
      <stop offset="0.35" stop-color="#b7ff4d"/>
      <stop offset="0.65" stop-color="#35f6ff"/>
      <stop offset="1" stop-color="#35f6ff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cta" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#b7ff4d"/>
      <stop offset="1" stop-color="#35f6ff"/>
    </linearGradient>
    ${comets.defs}
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <ellipse cx="${boltCx}" cy="${boltCy}" rx="470" ry="400" fill="url(#glowLime)"/>
  <ellipse cx="${boltCx}" cy="1160" rx="520" ry="360" fill="url(#glowCyan)"/>

  ${buildDust(rand)}

  ${comets.shapes}

  ${buildParticleBolt(rand, boltCx, boltCy, 580)}

  <text x="540" y="228" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="54" letter-spacing="18" fill="#f7fbff" fill-opacity="0.97">EASYMARKET</text>
  <text x="540" y="288" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="26" letter-spacing="12" fill="#b7ff4d" fill-opacity="0.66">ПРОГНОЗИРУЙ · ВЫИГРЫВАЙ</text>
  <rect x="410" y="316" width="260" height="5" rx="2.5" fill="url(#scan)"/>

  <ellipse cx="540" cy="1170" rx="430" ry="150" fill="url(#glowAmount)"/>
  <text x="540" y="1076" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="38" letter-spacing="10" fill="#c9d4e5" fill-opacity="0.82">ТВОЙ ВЫИГРЫШ</text>
  <text x="540" y="1218" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="${amountSize}" fill="#b7ff4d">${amount}</text>

  <text x="540" y="1364" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="56" fill="#ffe66d">Выигрыш есть — можно поесть</text>
  <text x="540" y="1448" text-anchor="middle" font-family="DejaVu Sans"
    font-size="44" fill="#c9d4e5" fill-opacity="0.85">BTC вверх или вниз за 5 минут</text>

  <ellipse cx="540" cy="1624" rx="330" ry="110" fill="url(#glowLime)"/>
  <rect x="280" y="1560" width="520" height="120" rx="60" fill="url(#cta)"/>
  <text x="540" y="1638" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="50" fill="#06130d">Играй и ты  →</text>
  <text x="540" y="1800" text-anchor="middle" font-family="DejaVu Sans"
    font-size="36" fill="#8b97a8" fill-opacity="0.85">жми ссылку ниже</text>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>
</svg>`;
}

export async function renderStoryCardPng(amountLabel) {
  const svg = buildStoryCardSvg(amountLabel);
  return sharp(Buffer.from(svg)).png({ quality: 92 }).toBuffer();
}
