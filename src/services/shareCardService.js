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

// Keep the profit label short and safe. Non-breaking spaces from ru-RU
// formatting are normalised to plain spaces so the glyph always exists.
function normalizeAmount(raw) {
  const cleaned = String(raw ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  return cleaned || "Выигрыш";
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

export function buildStoryCardSvg(amountLabel) {
  const amount = escapeXml(normalizeAmount(amountLabel));
  const amountSize = amountFontSize(normalizeAmount(amountLabel));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1220"/>
      <stop offset="0.58" stop-color="#080b13"/>
      <stop offset="1" stop-color="#06090f"/>
    </linearGradient>
    <radialGradient id="glowBlue" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#3587ed" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#3587ed" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowGold" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffd166" stop-opacity="0.30"/>
      <stop offset="1" stop-color="#ffd166" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe6a3"/>
      <stop offset="1" stop-color="#f5b400"/>
    </linearGradient>
    <linearGradient id="spark" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#45d98a"/>
      <stop offset="1" stop-color="#8ef0c2"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <ellipse cx="540" cy="470" rx="720" ry="470" fill="url(#glowBlue)"/>
  <ellipse cx="540" cy="430" rx="440" ry="300" fill="url(#glowGold)"/>
  <ellipse cx="540" cy="1560" rx="640" ry="420" fill="url(#glowBlue)"/>

  <polyline points="70,1200 300,1130 470,1210 690,1000 860,1055 1010,880"
    fill="none" stroke="url(#spark)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>

  <text x="540" y="250" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="46" letter-spacing="16" fill="#ffffff" fill-opacity="0.93">EASYMARKET</text>
  <rect x="470" y="286" width="140" height="7" rx="4" fill="url(#gold)"/>

  <polygon points="558,360 470,600 540,600 505,760 636,520 566,520 628,360" fill="url(#gold)"/>

  <text x="540" y="838" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="42" letter-spacing="6" fill="#c9d4e5" fill-opacity="0.85">ТВОЙ ВЫИГРЫШ</text>
  <text x="540" y="${amountSize > 120 ? 968 : 958}" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="${amountSize}" fill="#b7ff4d">${amount}</text>

  <text x="540" y="1150" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="58" fill="#ffd166">Выигрыш есть — можно поесть</text>
  <text x="540" y="1240" text-anchor="middle" font-family="DejaVu Sans"
    font-size="46" fill="#c9d4e5" fill-opacity="0.86">BTC вверх или вниз за 5 минут</text>

  <rect x="290" y="1560" width="500" height="118" rx="59" fill="url(#gold)"/>
  <text x="540" y="1636" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold"
    font-size="50" fill="#0a0e16">Играй и ты  →</text>
  <text x="540" y="1798" text-anchor="middle" font-family="DejaVu Sans"
    font-size="36" fill="#8b97a8" fill-opacity="0.85">жми ссылку ниже</text>
</svg>`;
}

export async function renderStoryCardPng(amountLabel) {
  const svg = buildStoryCardSvg(amountLabel);
  return sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
}
