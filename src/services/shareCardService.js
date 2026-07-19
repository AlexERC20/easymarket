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

// Тематика карточки по типу рынка. Тэглайн выбирает клиент (индекс в query),
// чтобы превью в приложении и сторис-картинка совпадали дословно.
export const STORY_THEMES = {
  btc: {
    subtitle: "BTC вверх или вниз за 5 минут",
    taglines: [
      "Выигрыш есть — можно поесть",
      "Это не лудка — это аналитика",
      "Пока ты думал, я забрал",
      "Минус? Не, не слышал",
    ],
  },
  football: {
    subtitle: "Спортивные исходы в EasyMarket",
    taglines: [
      "Счёт на табло",
      "Я знал ещё до свистка",
      "Даже VAR не поспорит",
      "Положил прогноз в девятку",
    ],
  },
  top: {
    subtitle: "Горячие рынки в EasyMarket",
    taglines: [
      "Увидел раньше, чем стало модно",
      "Инсайдов нет — есть чуйка",
      "Тренд отработал как надо",
    ],
  },
  kyivstoner: {
    subtitle: "Специальный рынок в EasyMarket",
    taglines: [
      "Сказал — сделал",
      "Чуйка не подвела",
      "Зашло? Ещё как зашло",
    ],
  },
};

function resolveStoryTheme(themeKey) {
  return STORY_THEMES[String(themeKey || "").toLowerCase()] || STORY_THEMES.btc;
}

function pickTagline(theme, taglineIndex, amountLabel) {
  const idx = Number(taglineIndex);
  if (Number.isInteger(idx) && idx >= 0 && idx < theme.taglines.length) {
    return theme.taglines[idx];
  }
  // Без индекса — детерминированно от суммы, чтобы кэш оставался стабильным.
  let hash = 0;
  for (const ch of normalizeAmount(amountLabel)) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  }
  return theme.taglines[hash % theme.taglines.length];
}

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

// Сумма — главный флекс карточки: настолько крупно, насколько влезает в
// билетную панель (~900px полезной ширины, DejaVu ~0.62em на символ).
function amountFontSize(label) {
  const len = Math.max(1, label.length);
  return Math.max(92, Math.min(205, Math.floor(900 / (len * 0.62))));
}

function pentagonPoints(cx, cy, r, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < 5; i += 1) {
    const a = rot + (i / 5) * Math.PI * 2;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(" ");
}

// Ручная частица в мировых координатах: гало + ядро + горячий центр.
function particleAt(px, py, ny, rand, coreScale = 1) {
  const [r, g, b] = gradientColor(ny);
  const coreR = ((4.5 + rand() * 3) * coreScale).toFixed(1);
  return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(coreR * 2.4).toFixed(1)}" fill="url(#${haloIdFor(ny)})"/>
  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${coreR}" fill="rgb(${r},${g},${b})" opacity="${(0.75 + rand() * 0.25).toFixed(2)}"/>
  <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(coreR * 0.36).toFixed(1)}" fill="#ffffff" opacity="0.85"/>`;
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

// Обобщённый сэмплер частиц: рисует светящиеся частицы внутри произвольной
// формы. Форма задаётся либо списком полигонов в локальной системе координат
// [0..unit]², либо предикатом test(x, y). Палитра — функция от (nx, ny).
function buildParticleShape(rand, opts) {
  const {
    cx,
    cy,
    size,
    unit = 64,
    step = 2,
    jitter = 1.5,
    coreScale = 1,
    polys = null,
    test = null,
    tint = null,
  } = opts;
  const scale = size / unit;
  const inside = (x, y) => (
    test ? test(x, y) : (polys || []).some((poly) => pointInPoly(x, y, poly))
  );
  const halos = [];
  const cores = [];
  for (let gy = 0; gy <= unit; gy += step) {
    for (let gx = 0; gx <= unit; gx += step) {
      const jx = gx + (rand() - 0.5) * jitter;
      const jy = gy + (rand() - 0.5) * jitter;
      if (!inside(jx, jy)) {
        continue;
      }
      const px = (cx + (jx - unit / 2) * scale).toFixed(1);
      const py = (cy + (jy - unit / 2) * scale).toFixed(1);
      const ny = jy / unit;
      const [r, g, b] = tint ? tint(jx / unit, ny, rand) : gradientColor(ny);
      const coreR = ((5.6 + rand() * 3.6) * coreScale).toFixed(1);
      halos.push(`<circle cx="${px}" cy="${py}" r="${(coreR * 2.5).toFixed(1)}" fill="url(#${haloIdFor(ny)})"/>`);
      cores.push(`<circle cx="${px}" cy="${py}" r="${coreR}" fill="rgb(${r},${g},${b})" opacity="${(0.78 + rand() * 0.22).toFixed(2)}"/>`);
      cores.push(`<circle cx="${px}" cy="${py}" r="${(coreR * 0.36).toFixed(1)}" fill="#ffffff" opacity="0.85"/>`);
    }
  }
  return halos.join("\n  ") + "\n  " + cores.join("\n  ");
}

// Штрих-код победного «билета»: случайные (но детерминированные) полосы.
function buildBarcode(rand, x, y, width, height) {
  const bars = [];
  let cursor = x;
  while (cursor < x + width) {
    const w = 3 + Math.round(rand() * 9);
    if (rand() > 0.35) {
      bars.push(`<rect x="${cursor}" y="${y}" width="${w}" height="${height}" fill="#cfe0f2" fill-opacity="${(0.5 + rand() * 0.4).toFixed(2)}"/>`);
    }
    cursor += w + 3 + Math.round(rand() * 5);
  }
  return bars.join("\n  ");
}

// Номер «билета» из сида — маленькая деталь, которую любят разглядывать.
function ticketNumber(seed) {
  return String(100000 + (seed % 900000)).slice(0, 6);
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

// ===== Тематические hero-сцены (зона y=340..1000, центр x=540) =====

// BTC: «год-свеча до луны» — лесенка свечей, гигантская лаймовая свеча,
// луна и золотая монета. Считывается за полсекунды: «BTC улетел».
function buildBtcHero(rand) {
  const parts = [];
  for (const y of [460, 610, 760, 910]) {
    parts.push(`<line x1="100" y1="${y}" x2="980" y2="${y}" stroke="#35f6ff" stroke-opacity="0.07" stroke-width="2"/>`);
  }
  const xs = [190, 300, 410, 520, 630];
  xs.forEach((cx, i) => {
    const h = 90 + Math.round(rand() * 90) + i * 14;
    const up = i % 2 === 0 || rand() > 0.4;
    const bodyTop = 930 - h;
    const wick = 30 + rand() * 30;
    parts.push(`<line x1="${cx}" y1="${(bodyTop - wick).toFixed(0)}" x2="${cx}" y2="948" stroke="${up ? "#b7ff4d" : "#35f6ff"}" stroke-opacity="0.45" stroke-width="4"/>`);
    parts.push(up
      ? `<rect x="${cx - 29}" y="${bodyTop}" width="58" height="${h}" rx="6" fill="#b7ff4d" fill-opacity="0.82"/>`
      : `<rect x="${cx - 29}" y="${bodyTop}" width="58" height="${h}" rx="6" fill="#123a44" stroke="#35f6ff" stroke-width="2"/>`);
  });
  parts.push(`<ellipse cx="795" cy="560" rx="220" ry="340" fill="url(#haloLime)"/>`);
  parts.push(`<line x1="795" y1="360" x2="795" y2="430" stroke="#fff7a8" stroke-width="6" stroke-opacity="0.9"/>`);
  parts.push(`<rect x="760" y="420" width="70" height="510" rx="10" fill="url(#godCandle)"/>`);
  parts.push(`<circle cx="880" cy="430" r="70" fill="#f4f7ff" fill-opacity="0.12"/>`);
  parts.push(`<circle cx="880" cy="430" r="58" fill="#f4f7ff" fill-opacity="0.10"/>`);
  parts.push(`<circle cx="858" cy="410" r="14" fill="#f4f7ff" fill-opacity="0.08"/>`);
  parts.push(`<circle cx="902" cy="452" r="9" fill="#f4f7ff" fill-opacity="0.08"/>`);
  parts.push(`<g transform="rotate(-12 250 430)">
    <circle cx="250" cy="430" r="95" fill="#241c08" stroke="#ffd36b" stroke-width="8"/>
    <text x="250" y="468" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="110" fill="#ffd36b">B</text>
    <rect x="256" y="348" width="10" height="24" fill="#ffd36b"/>
    <rect x="256" y="490" width="10" height="24" fill="#ffd36b"/>
  </g>`);
  for (let i = 0; i < 46; i += 1) {
    const px = 766 + rand() * 58;
    const py = 436 + rand() * 480;
    parts.push(particleAt(px, py, (py - 420) / 560, rand, 0.8));
  }
  return parts.join("\n  ");
}

// Футбол: мяч со шлейфом влетает в девятку, сетка вздувается.
function buildFootballHero(rand) {
  const parts = [];
  const ball = { x: 820, y: 560, r: 105 };
  // штанги
  parts.push(`<line x1="120" y1="430" x2="960" y2="430" stroke="#eaf4ff" stroke-width="16" stroke-linecap="round"/>`);
  parts.push(`<line x1="960" y1="430" x2="960" y2="1000" stroke="#eaf4ff" stroke-width="16" stroke-linecap="round"/>`);
  // сетка с выгибом возле мяча
  const bulge = (x, y) => {
    const dx = x - ball.x;
    const dy = y - ball.y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, 1 - d / 260) * 26;
    return [x + (dx / d) * k, y + (dy / d) * k];
  };
  for (let gx = 350; gx <= 950; gx += 52) {
    const pts = [];
    for (let gy = 430; gy <= 990; gy += 28) {
      const [bx, by] = bulge(gx, gy);
      pts.push(`${bx.toFixed(1)},${by.toFixed(1)}`);
    }
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#9fdcff" stroke-opacity="0.16" stroke-width="2"/>`);
  }
  for (let gy = 482; gy <= 990; gy += 52) {
    const pts = [];
    for (let gx = 350; gx <= 950; gx += 28) {
      const [bx, by] = bulge(gx, gy);
      pts.push(`${bx.toFixed(1)},${by.toFixed(1)}`);
    }
    parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#9fdcff" stroke-opacity="0.16" stroke-width="2"/>`);
  }
  // дуги поля
  parts.push(`<ellipse cx="540" cy="1060" rx="520" ry="90" fill="none" stroke="#b7ff4d" stroke-opacity="0.12" stroke-width="3"/>`);
  parts.push(`<ellipse cx="540" cy="1060" rx="430" ry="70" fill="none" stroke="#b7ff4d" stroke-opacity="0.12" stroke-width="3"/>`);
  // шлейф мяча
  const q = (t) => ({
    x: (1 - t) ** 2 * 150 + 2 * (1 - t) * t * 430 + t * t * 780,
    y: (1 - t) ** 2 * 950 + 2 * (1 - t) * t * 900 + t * t * 600,
  });
  for (let i = 0; i < 26; i += 1) {
    const t = i / 25;
    const p = q(t);
    const [r, g, b] = gradientColor(0.35 + t * 0.6);
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(3 + t * 6).toFixed(1)}" fill="rgb(${r},${g},${b})" opacity="${(0.15 + t * 0.55).toFixed(2)}"/>`);
  }
  for (let i = 0; i < 3; i += 1) {
    const t0 = 0.55 + i * 0.12;
    const a = q(t0);
    const b2 = q(Math.min(1, t0 + 0.18));
    parts.push(`<line x1="${a.x.toFixed(0)}" y1="${(a.y + 40 + i * 26).toFixed(0)}" x2="${b2.x.toFixed(0)}" y2="${(b2.y + 40 + i * 26).toFixed(0)}" stroke="#35f6ff" stroke-opacity="${(0.3 - i * 0.07).toFixed(2)}" stroke-width="5" stroke-linecap="round"/>`);
  }
  // мяч
  parts.push(`<ellipse cx="${ball.x}" cy="${ball.y}" rx="210" ry="190" fill="url(#haloCyan)"/>`);
  parts.push(`<circle cx="${ball.x}" cy="${ball.y}" r="${ball.r}" fill="#f2f7ff"/>`);
  parts.push(`<polygon points="${pentagonPoints(ball.x, ball.y, 38)}" fill="#0a101c"/>`);
  for (let i = 0; i < 5; i += 1) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const px = ball.x + Math.cos(a) * 68;
    const py = ball.y + Math.sin(a) * 68;
    parts.push(`<polygon points="${pentagonPoints(px, py, 30, a)}" fill="#0a101c"/>`);
  }
  parts.push(`<circle cx="${ball.x}" cy="${ball.y}" r="${ball.r}" fill="none" stroke="#0a101c" stroke-opacity="0.4" stroke-width="4"/>`);
  return parts.join("\n  ");
}

// Топ: пьедестал №1 с золотой короной и взлетающими искрами.
function buildTopHero(rand) {
  const parts = [];
  parts.push(`<ellipse cx="540" cy="450" rx="260" ry="180" fill="url(#haloWarm)"/>`);
  parts.push(`<rect x="150" y="730" width="220" height="270" rx="14" fill="#10202e" stroke="#35f6ff" stroke-width="2"/>`);
  parts.push(`<rect x="710" y="790" width="220" height="210" rx="14" fill="#10202e" stroke="#35f6ff" stroke-width="2"/>`);
  parts.push(`<text x="260" y="880" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="90" fill="#35f6ff" fill-opacity="0.6">2</text>`);
  parts.push(`<text x="820" y="920" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="90" fill="#35f6ff" fill-opacity="0.6">3</text>`);
  parts.push(`<rect x="390" y="560" width="300" height="440" rx="18" fill="url(#podium)"/>`);
  parts.push(`<text x="540" y="800" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="170" fill="#06130d">1</text>`);
  // лучи и корона
  parts.push(`<polygon points="540,430 500,340 520,340" fill="#ffd36b" fill-opacity="0.15"/>`);
  parts.push(`<polygon points="540,430 560,335 580,340" fill="#ffd36b" fill-opacity="0.12"/>`);
  parts.push(`<polygon points="540,430 610,355 625,370" fill="#ffd36b" fill-opacity="0.1"/>`);
  parts.push(`<polygon points="420,530 450,395 510,470 540,360 570,470 630,395 660,530" fill="#ffd36b" stroke="#fff2c0" stroke-width="3"/>`);
  parts.push(`<rect x="420" y="530" width="240" height="30" rx="8" fill="#d9a63f"/>`);
  for (const cx of [450, 540, 630]) {
    parts.push(`<circle cx="${cx}" cy="545" r="10" fill="#35f6ff"/>`);
  }
  for (let i = 0; i < 34; i += 1) {
    const px = 170 + rand() * 740;
    const py = 380 + rand() * 180;
    parts.push(particleAt(px, py, 0.2 + rand() * 0.3, rand, 0.5));
  }
  return parts.join("\n  ");
}

// Киевстонер: золотые очки, цепь с кулоном EM и дым из частиц.
function buildKyivstonerHero(rand) {
  const parts = [];
  // дым (без горячих ядер)
  const streams = [
    [[300, 980], [360, 700], [300, 470]],
    [[560, 990], [620, 760], [570, 480]],
  ];
  for (const [a, b2, c] of streams) {
    for (let i = 0; i < 22; i += 1) {
      const t = i / 21;
      const x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b2[0] + t * t * c[0] + Math.sin(t * 9 + rand()) * 40 * t;
      const y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b2[1] + t * t * c[1];
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(14 + t * 20).toFixed(1)}" fill="url(#haloSmoke)"/>`);
    }
  }
  for (const [cx, cy, r, w, o] of [[700, 470, 36, 14, 0.25], [715, 415, 58, 12, 0.18], [735, 370, 84, 10, 0.12]]) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#cfe8c0" stroke-width="${w}" stroke-opacity="${o}"/>`);
  }
  // очки
  for (const [x0] of [[245], [585]]) {
    parts.push(`<rect x="${x0}" y="520" width="250" height="150" rx="70" fill="url(#lens)" stroke="#ffd36b" stroke-width="10"/>`);
    parts.push(`<polygon points="${x0 + 40},670 ${x0 + 100},520 ${x0 + 150},520 ${x0 + 90},670" fill="#ffffff" fill-opacity="0.18"/>`);
  }
  parts.push(`<path d="M 495 560 Q 540 525 585 560" fill="none" stroke="#ffd36b" stroke-width="10"/>`);
  parts.push(`<line x1="245" y1="560" x2="150" y2="520" stroke="#ffd36b" stroke-width="10" stroke-linecap="round"/>`);
  parts.push(`<line x1="835" y1="560" x2="930" y2="520" stroke="#ffd36b" stroke-width="10" stroke-linecap="round"/>`);
  parts.push(`<polyline points="620,635 655,600 685,615 720,575 755,590" fill="none" stroke="#b7ff4d" stroke-opacity="0.5" stroke-width="6" stroke-linecap="round"/>`);
  // цепь
  for (let i = 0; i < 13; i += 1) {
    const t = i / 12;
    const x = 330 + 420 * t;
    const y = 760 + 480 * t * (1 - t);
    const rot = i % 2 ? 35 : -35;
    parts.push(`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="17" ry="11" fill="none" stroke="#ffd36b" stroke-width="7" transform="rotate(${rot} ${x.toFixed(0)} ${y.toFixed(0)})"/>`);
  }
  parts.push(`<circle cx="540" cy="905" r="52" fill="#ffd36b" stroke="#fff2c0" stroke-width="4"/>`);
  parts.push(`<text x="540" y="922" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="40" fill="#241c08">EM</text>`);
  return parts.join("\n  ");
}

const HERO_BUILDERS = {
  btc: buildBtcHero,
  football: buildFootballHero,
  top: buildTopHero,
  kyivstoner: buildKyivstonerHero,
};

const THEME_CHIPS = {
  btc: "BTC · 5 МИН",
  football: "ФУТБОЛ",
  top: "ТОП РЫНКИ",
  kyivstoner: "KYIVSTONER",
};

// Вертикальная Story-карточка «победный билет»: тематическая hero-сцена,
// билетная панель с перфорацией, штрих-код и голо-полоса. Сознательно БЕЗ
// SVG-фильтров (feGaussianBlur/feDropShadow) — librsvg через sharp рендерит их
// ненадёжно; всё свечение сделано слоями полупрозрачных градиентных фигур.
export function buildStoryCardSvg(amountLabel, themeKey = "btc", taglineIndex = null) {
  const raw = normalizeAmount(amountLabel);
  const amount = escapeXml(raw);
  const amountSize = amountFontSize(raw);
  const themeSlug = STORY_THEMES[String(themeKey || "").toLowerCase()] ? String(themeKey).toLowerCase() : "btc";
  const theme = resolveStoryTheme(themeSlug);
  const tagline = escapeXml(pickTagline(theme, taglineIndex, amountLabel));
  const subtitle = escapeXml(theme.subtitle);
  const chip = THEME_CHIPS[themeSlug];
  // Сид зависит от суммы и темы: одна пара — навсегда одна картинка.
  let seed = 0x9e3779b9;
  for (const ch of `${themeSlug}:${raw}`) {
    seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const rand = mulberry32(seed);

  const hero = HERO_BUILDERS[themeSlug](rand);
  const serial = `EM-${(seed % 0xffff).toString(16).toUpperCase().padStart(4, "0")}-${ticketNumber(seed).slice(0, 4)}`;
  const chipWidth = chip.length * 22 + 76;

  // Перфорация линии отрыва билета
  const perforation = [];
  for (let x = 76; x <= 1004; x += 34) {
    perforation.push(`<circle cx="${x}" cy="1500" r="9" fill="#04060b"/>`);
  }

  // Дифракционные штрихи голо-полосы
  const holoLines = [];
  for (let x = -140; x <= 1240; x += 12) {
    holoLines.push(`<line x1="${x}" y1="1525" x2="${x}" y2="1595" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>`);
  }

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
    <radialGradient id="haloSmoke" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#cfe8c0" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#cfe8c0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.72" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#02040a" stop-opacity="0.78"/>
    </radialGradient>
    <linearGradient id="godCandle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7a8"/>
      <stop offset="0.4" stop-color="#b7ff4d"/>
      <stop offset="1" stop-color="#6cbf2a"/>
    </linearGradient>
    <linearGradient id="podium" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b7ff4d"/>
      <stop offset="1" stop-color="#4a7a1e"/>
    </linearGradient>
    <linearGradient id="lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1a1206"/>
      <stop offset="1" stop-color="#3a2a08"/>
    </linearGradient>
    <linearGradient id="holo" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffd36b"/>
      <stop offset="0.25" stop-color="#b7ff4d"/>
      <stop offset="0.5" stop-color="#35f6ff"/>
      <stop offset="0.75" stop-color="#8a7bff"/>
      <stop offset="1" stop-color="#ffd36b"/>
    </linearGradient>
    <pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse">
      <circle cx="22" cy="22" r="1.5" fill="#35f6ff" fill-opacity="0.05"/>
    </pattern>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${WIDTH}" height="320" fill="url(#dots)"/>
  <rect x="0" y="1510" width="${WIDTH}" height="410" fill="url(#dots)"/>
  <ellipse cx="540" cy="640" rx="470" ry="400" fill="url(#${themeSlug === "football" ? "glowCyan" : "glowLime"})"/>
  <ellipse cx="540" cy="1240" rx="520" ry="320" fill="url(#glowCyan)"/>

  ${buildDust(rand)}

  <text x="90" y="140" text-anchor="start" font-family="DejaVu Sans" font-weight="bold"
    font-size="42" letter-spacing="8" fill="#f7fbff" fill-opacity="0.97">EASYMARKET</text>
  <rect x="${990 - chipWidth}" y="98" width="${chipWidth}" height="58" rx="29" fill="#b7ff4d" fill-opacity="0.08" stroke="#b7ff4d" stroke-width="2"/>
  <text x="960" y="139" text-anchor="end" font-family="DejaVu Sans" font-weight="bold"
    font-size="30" letter-spacing="4" fill="#b7ff4d">${chip}</text>

  ${hero}

  <rect x="60" y="1030" width="960" height="470" rx="36" fill="#0c1322" stroke="#223146" stroke-width="2"/>
  <ellipse cx="540" cy="1270" rx="430" ry="150" fill="url(#glowAmount)"/>
  <text x="540" y="1108" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="34" letter-spacing="12" fill="#c9d4e5" fill-opacity="0.82">ТВОЙ ВЫИГРЫШ</text>
  <text x="534" y="1290" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="${amountSize}" fill="#35f6ff" fill-opacity="0.9">${amount}</text>
  <text x="546" y="1290" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="${amountSize}" fill="#ffd36b" fill-opacity="0.9">${amount}</text>
  <text x="540" y="1290" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="${amountSize}" fill="#eaffd0">${amount}</text>
  <text x="540" y="1390" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="50" fill="#ffd36b">${tagline}</text>
  <text x="540" y="1456" text-anchor="middle" font-family="DejaVu Sans"
    font-size="36" fill="#c9d4e5" fill-opacity="0.8">${subtitle}</text>

  ${perforation.join("\n  ")}
  <line x1="76" y1="1500" x2="1004" y2="1500" stroke="#33415a" stroke-width="2" stroke-dasharray="2 10"/>
  <circle cx="60" cy="1500" r="26" fill="#04060b"/>
  <circle cx="1020" cy="1500" r="26" fill="#04060b"/>

  <g transform="rotate(-8 540 1560)">
    <rect x="-160" y="1525" width="1400" height="70" fill="url(#holo)" fill-opacity="0.3"/>
    ${holoLines.join("\n    ")}
    <text x="540" y="1572" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
      font-size="22" letter-spacing="14" fill="#ffffff" fill-opacity="0.5">VERIFIED WIN</text>
  </g>

  <rect x="310" y="1636" width="460" height="104" rx="52" fill="none" stroke="#b7ff4d" stroke-width="3"/>
  <text x="540" y="1704" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="46" fill="#b7ff4d">Играй и ты  →</text>

  ${buildBarcode(rand, 120, 1782, 380, 72)}
  <text x="120" y="1888" text-anchor="start" font-family="DejaVu Sans"
    font-size="24" letter-spacing="6" fill="#8b97a8">№ ${serial}</text>
  <text x="960" y="1888" text-anchor="end" font-family="DejaVu Sans"
    font-size="26" fill="#8b97a8" fill-opacity="0.85">жми ссылку ниже</text>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>
</svg>`;
}

// JPEG вместо PNG: карточка из градиентов и свечений сжимается в ~150-300 КБ
// против 2-4 МБ полноцветного PNG (у sharp png.quality без палитры вообще
// игнорируется) — Telegram скачивает картинку в разы быстрее. Готовые буферы
// кэшируются по подписи суммы: сид рисунка детерминирован от неё же, так что
// одна сумма — навсегда одна и та же картинка.
const storyCardCache = new Map();
const STORY_CARD_CACHE_MAX = 60;

export async function renderStoryCardJpeg(amountLabel, themeKey = "btc", taglineIndex = null) {
  const key = `${String(themeKey || "btc")}:${taglineIndex ?? "-"}:${normalizeAmount(amountLabel)}`;
  const cached = storyCardCache.get(key);
  if (cached) {
    return cached;
  }
  const svg = buildStoryCardSvg(amountLabel, themeKey, taglineIndex);
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  if (storyCardCache.size >= STORY_CARD_CACHE_MAX) {
    storyCardCache.delete(storyCardCache.keys().next().value);
  }
  storyCardCache.set(key, buffer);
  return buffer;
}
