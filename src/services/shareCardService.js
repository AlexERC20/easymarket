import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1920;

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Keep labels short and safe. Non-breaking spaces from ru-RU formatting are
// normalised to plain spaces so the glyph always exists in the SVG renderer.
function normalizeAmount(raw) {
  const cleaned = String(raw ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  return cleaned || "Выигрыш";
}

function normalizeLine(raw, fallback = "") {
  return String(raw ?? fallback)
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34) || fallback;
}

// Build the profit label server-side from clean numeric params, so nothing
// with URL-sensitive characters ($, +, non-breaking spaces) is ever passed
// through the query string (Telegram re-encodes the media URL, which would
// otherwise surface raw %-codes on the card).
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
  if (len > 14) return 82;
  if (len > 11) return 100;
  if (len > 8) return 118;
  return 132;
}

export function buildStoryCardSvg(amountLabel, options = {}) {
  const rawAmount = normalizeAmount(amountLabel);
  const amount = escapeXml(rawAmount);
  const amountSize = amountFontSize(rawAmount);
  const ticker = escapeXml(normalizeLine(options.ticker, "BTC · 5 мин"));
  const user = escapeXml(normalizeLine(options.user, "EasyMarket player"));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101827"/>
      <stop offset="0.46" stop-color="#080d17"/>
      <stop offset="1" stop-color="#06090f"/>
    </linearGradient>
    <radialGradient id="cyanGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#35f6ff" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#35f6ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="limeGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#b7ff4d" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#b7ff4d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="purpleGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#9d6cff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#9d6cff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#182234"/>
      <stop offset="0.54" stop-color="#0d1422"/>
      <stop offset="1" stop-color="#090d15"/>
    </linearGradient>
    <linearGradient id="electric" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#b7ff4d"/>
      <stop offset="0.52" stop-color="#35f6ff"/>
      <stop offset="1" stop-color="#ffe86b"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0a8"/>
      <stop offset="0.54" stop-color="#ffd166"/>
      <stop offset="1" stop-color="#f3a81d"/>
    </linearGradient>
    <filter id="softShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="#000000" flood-opacity="0.52"/>
    </filter>
    <filter id="neon" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <clipPath id="panelClip">
      <rect x="92" y="430" width="896" height="960" rx="78"/>
    </clipPath>
    <pattern id="grid" width="54" height="54" patternUnits="userSpaceOnUse">
      <path d="M54 0H0V54" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-width="2"/>
    </pattern>
    <pattern id="dots" width="72" height="72" patternUnits="userSpaceOnUse">
      <circle cx="8" cy="8" r="2.4" fill="#ffffff" opacity="0.12"/>
    </pattern>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)" opacity="0.46"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#dots)" opacity="0.38"/>

  <ellipse cx="170" cy="220" rx="470" ry="360" fill="url(#cyanGlow)"/>
  <ellipse cx="1000" cy="520" rx="480" ry="410" fill="url(#purpleGlow)"/>
  <ellipse cx="530" cy="1510" rx="650" ry="420" fill="url(#limeGlow)"/>

  <path d="M28 1304C220 1206 310 1278 450 1192C610 1094 690 924 1044 814"
    fill="none" stroke="#35f6ff" stroke-width="10" stroke-linecap="round" stroke-opacity="0.18"/>
  <path d="M48 1320C238 1218 316 1302 462 1204C626 1094 716 926 1038 842"
    fill="none" stroke="url(#electric)" stroke-width="7" stroke-linecap="round" filter="url(#neon)" opacity="0.84"/>

  <text x="540" y="174" text-anchor="middle" font-family="DejaVu Sans" font-weight="900"
    font-size="58" fill="#f7fbff">EasyMarket</text>
  <text x="540" y="236" text-anchor="middle" font-family="DejaVu Sans" font-weight="700"
    font-size="32" fill="#94a3b8">premium win card</text>

  <g filter="url(#softShadow)">
    <rect x="92" y="430" width="896" height="960" rx="78" fill="url(#panel)"/>
    <rect x="110" y="448" width="860" height="924" rx="64" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
    <rect x="112" y="450" width="856" height="920" rx="62" fill="none" stroke="#b7ff4d" stroke-opacity="0.10" stroke-width="4"/>
  </g>

  <g clip-path="url(#panelClip)">
    <ellipse cx="540" cy="638" rx="360" ry="230" fill="url(#cyanGlow)"/>
    <ellipse cx="540" cy="676" rx="260" ry="190" fill="url(#limeGlow)"/>
    <path d="M92 1010C248 930 352 1000 494 910C640 818 734 704 988 662V1390H92Z"
      fill="url(#electric)" opacity="0.06"/>
  </g>

  <g transform="translate(540 624)">
    <circle cx="0" cy="0" r="146" fill="#ffffff" opacity="0.035"/>
    <circle cx="0" cy="0" r="116" fill="none" stroke="#35f6ff" stroke-opacity="0.34" stroke-width="4"/>
    <circle cx="0" cy="0" r="84" fill="url(#gold)" filter="url(#neon)"/>
    <path d="M20 -78-50 16h52l-18 76 88-118H19l1-52Z" fill="#071017"/>
  </g>

  <rect x="174" y="478" width="300" height="66" rx="33" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.10"/>
  <text x="324" y="522" text-anchor="middle" font-family="DejaVu Sans" font-weight="800"
    font-size="31" fill="#dce7f7">${ticker}</text>
  <rect x="622" y="478" width="284" height="66" rx="33" fill="#b7ff4d" fill-opacity="0.14" stroke="#b7ff4d" stroke-opacity="0.28"/>
  <text x="764" y="522" text-anchor="middle" font-family="DejaVu Sans" font-weight="900"
    font-size="31" fill="#b7ff4d">WIN</text>

  <text x="540" y="842" text-anchor="middle" font-family="DejaVu Sans" font-weight="900"
    font-size="38" fill="#9fb1c8">ТВОЙ ПРОФИТ</text>
  <text x="540" y="${amountSize > 120 ? 990 : 980}" text-anchor="middle" font-family="DejaVu Sans" font-weight="900"
    font-size="${amountSize}" fill="#efffe4" filter="url(#neon)">${amount}</text>

  <g transform="translate(190 1050)">
    <rect x="0" y="0" width="700" height="166" rx="46" fill="#030712" fill-opacity="0.28" stroke="#ffffff" stroke-opacity="0.08"/>
    <path d="M54 108C150 104 164 62 236 72C294 80 316 126 378 96C448 62 478 22 646 42"
      fill="none" stroke="#35f6ff" stroke-opacity="0.32" stroke-width="10" stroke-linecap="round"/>
    <path d="M54 108C150 104 164 62 236 72C294 80 316 126 378 96C448 62 478 22 646 42"
      fill="none" stroke="url(#electric)" stroke-width="6" stroke-linecap="round" filter="url(#neon)"/>
    <circle cx="646" cy="42" r="14" fill="#b7ff4d" filter="url(#neon)"/>
  </g>

  <text x="540" y="1298" text-anchor="middle" font-family="DejaVu Sans" font-weight="900"
    font-size="54" fill="#ffd166">Забрал рынок красиво</text>
  <text x="540" y="1364" text-anchor="middle" font-family="DejaVu Sans"
    font-size="34" fill="#c8d2e2" opacity="0.88">${user}</text>

  <g filter="url(#softShadow)">
    <rect x="196" y="1540" width="688" height="128" rx="64" fill="url(#electric)"/>
    <text x="540" y="1622" text-anchor="middle" font-family="DejaVu Sans" font-weight="900"
      font-size="50" fill="#071017">Играть в EasyMarket</text>
  </g>
  <text x="540" y="1754" text-anchor="middle" font-family="DejaVu Sans"
    font-size="34" fill="#8fa0b7">жми кнопку ниже и забирай бонус</text>
</svg>`;
}

export async function renderStoryCardPng(amountLabel, options = {}) {
  const svg = buildStoryCardSvg(amountLabel, options);
  return sharp(Buffer.from(svg)).png({ quality: 92 }).toBuffer();
}
