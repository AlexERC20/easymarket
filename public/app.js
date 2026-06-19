const PROFIT_FEE_RATE = 0.05;
const MARKET_MAKER_SPREAD_RATE = 0.03;
const SELL_IMPACT_MULTIPLIER = 1.1;
const STAR_AMOUNTS = [50, 100, 500, 1000];
const USDT_AMOUNTS = [5, 10, 25, 100];
const MIN_OUTCOME_PRICE = 0.001;
const BTC_MIN_OUTCOME_PRICE = 0.04;
const CHART_WINDOW_MS = 10_000;
const CHART_RENDER_INTERVAL_MS = 100;
const ACTIVE_MARKET_POLL_MS = 1_500;
const MARKET_LIST_POLL_MS = 10_000;
const COMMENTS_POLL_MS = 10_000;
const COLLAPSE_LIMIT = 3;
const MARKET_BUY_CLOSE_BUFFER_MS = 400;

const state = {
  user: null,
  market: null,
  currency: "STAR",
  balance: 0,
  usdtBalance: 0,
  usdtCashBalance: 0,
  usdtBonusBalance: 0,
  positions: [],
  recentTrades: [],
  marketStats: [],
  recentMarkets: [],
  leaderboard: [],
  leaderboardCache: {
    STAR: null,
    USDT: null,
  },
  leaderboardLoading: false,
  leaderboardRequestId: 0,
  activity: [],
  chartPoints: [],
  btcMarkets: [],
  selectedBtcMarketId: null,
  btcCharts: new Map(),
  btcMarketsListRenderedOrder: "",
  worldCupMarkets: [],
  worldCupListRenderedOrder: "",
  selectedWorldCupMarketId: null,
  worldCupCharts: new Map(),
  comments: [],
  commentsMarketId: null,
  commentPending: false,
  betSheet: {
    market: null,
    side: "YES",
    amount: 0,
  },
  topup: {
    amount: 0,
    reason: "",
    pending: false,
    mode: "topup",
    currency: "STAR",
    network: "BSC",
    intent: null,
    pollTimer: null,
  },
  leaderboardCurrency: "STAR",
  taskTab: "tasks",
  expanded: {
    positions: false,
    activity: false,
    recent: false,
  },
  selectedSide: "YES",
  selectedAmount: 50,
  activityLoaded: false,
  settlementsLoaded: false,
  seenActivityIds: new Set(),
  seenSettledPositionIds: new Set(),
  pendingBuy: false,
  pendingBuyKey: null,
  buyQueue: [],
  inFlight: new Set(),
  refreshTimer: null,
  lastCommentsLoadAt: 0,
  expiryRefreshMarketId: null,
  lastClosedMarketToastAt: 0,
  pendingSellSide: null,
  pendingSellPositionId: null,
  publicConfig: {
    av_bot_url: "https://t.me/voit_help_bot?start=buy_stars",
    mini_app_url: "https://t.me/voit_help_bot?startapp=easymarket",
    referral_bonus_fire: 500,
    referral_signup_bonus_usdt: 5,
    referral_bet_bonus_usdt: 30,
    task_share_fire: 100,
    task_subscribe_fire: 500,
    task_private_chat_fire: 15000,
    task_daily_presence_fire: 50,
    task_daily_bet_fire: 50,
    task_daily_cap_fire: 10000,
    av_channel_url: "https://t.me/erc20coin",
    av_chat_url: "https://t.me/thedaomaker",
    private_chat_url: "https://t.me/tribute/app?startapp=stKL",
    usdt_evm_address: "0x51592e92e48b94f3714c24c7597fb8a4ecfb36cd",
    usdt_ton_address: "UQAFrUUrG0-cFLbZDkYA_RuGKSjuaULQPp7B7xxsmbzoaBdh",
    usdt_deposit_scan_enabled: false,
    usdt_deposit_networks: [],
    stars_invoice_enabled: false,
  },
  presence: {
    startedAt: null,
    claimed: false,
    pending: false,
  },
  chartRaf: null,
  smoothedPrice: null,
  chartYMin: null,
  chartYMax: null,
};

const textAnimations = new WeakMap();
const $ = (id) => document.getElementById(id);

const formatFire = (value) => Math.floor(Number(value || 0)).toLocaleString("ru-RU");
const formatFireDecimal = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 1,
});
const normalizeCurrency = (value) => (String(value || "STAR").toUpperCase() === "USDT" ? "USDT" : "STAR");
const getAmountsForCurrency = (currency = state.currency) => (normalizeCurrency(currency) === "USDT" ? USDT_AMOUNTS : STAR_AMOUNTS);
const formatCurrencyAmount = (value, currency = state.currency) => {
  const safeCurrency = normalizeCurrency(currency);
  const formatted = Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: safeCurrency === "USDT" ? 0 : 0,
    maximumFractionDigits: safeCurrency === "USDT" ? 2 : 0,
  });
  return safeCurrency === "USDT" ? `$${formatted}` : formatted;
};
const formatHeaderCurrencyAmount = (value, currency = state.currency) => {
  const safeCurrency = normalizeCurrency(currency);
  const formatted = Number(value || 0).toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  });
  return safeCurrency === "USDT" ? `$${formatted}` : formatted;
};
const normalizeTopupAmount = (value, currency = state.topup.currency) => {
  const safeCurrency = normalizeCurrency(currency);
  const numeric = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(numeric)) {
    return safeCurrency === "USDT" ? 15 : 1;
  }
  const capped = Math.min(100_000, Math.max(safeCurrency === "USDT" ? 15 : 1, numeric));
  return safeCurrency === "USDT"
    ? Math.round(capped * 100) / 100
    : Math.round(capped);
};
const getActiveBalance = () => (state.currency === "USDT" ? state.usdtBalance : state.balance);
const formatSignedCurrencyAmount = (value, currency = state.currency) => {
  const numeric = Number(value || 0);
  return `${numeric > 0 ? "+" : ""}${formatCurrencyAmount(numeric, currency)}`;
};
function applyCurrencyBalance(currency, balance) {
  const normalized = normalizeCurrency(currency);
  if (normalized === "USDT") {
    state.usdtBalance = Number(balance || 0);
    return;
  }
  state.balance = Number(balance || 0);
}

function applyCurrencyBalancePayload(currency, payload = {}) {
  const normalized = normalizeCurrency(currency);
  const total = payload.currency_balance ?? payload.balance;
  if (normalized === "USDT") {
    state.usdtBalance = Number(total || 0);
    if (payload.currency_cash_balance !== undefined) {
      state.usdtCashBalance = Number(payload.currency_cash_balance || 0);
    }
    if (payload.currency_bonus_balance !== undefined) {
      state.usdtBonusBalance = Number(payload.currency_bonus_balance || 0);
    }
    return;
  }

  state.balance = Number(total || 0);
}
const formatPrice = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});
const formatCents = (value) => {
  const cents = Number(value || 0) * 100;
  if (cents > 0 && cents < 1) {
    return `${cents.toFixed(1)}¢`;
  }
  if (cents > 99) {
    return `${cents.toFixed(1)}¢`;
  }
  return `${Math.round(cents)}¢`;
};
const sideLabel = (side) => (side === "YES" ? "UP" : "DOWN");
const marketSideLabel = (market, side) => (
  market?.market_type === "WORLD_CUP_WINNER"
    ? (side === "YES" ? "Yes" : "No")
    : sideLabel(side)
);
const sideClass = (side) => (side === "YES" ? "yes" : "no");
const actionLabel = (action) => (action === "SELL" ? "продал" : "купил");
const marketStatusLabel = (status) => {
  if (status === "open") {
    return "LIVE";
  }
  if (status === "resolved") {
    return "CLOSED";
  }
  if (status === "closed") {
    return "ENDED";
  }
  return status || "нет рынка";
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isImageUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function teamIconMarkup(icon, alt = "team") {
  if (isImageUrl(icon)) {
    return `<img src="${escapeHtml(icon)}" alt="${escapeHtml(alt)}" loading="eager" decoding="async" />`;
  }
  return `<span>${escapeHtml(icon || "🏆")}</span>`;
}

function setTeamIconElement(element, icon, alt = "team") {
  if (!element) {
    return;
  }
  const normalizedIcon = String(icon || "");
  if (element.dataset.icon === normalizedIcon && element.dataset.alt === String(alt || "")) {
    return;
  }
  element.dataset.icon = normalizedIcon;
  element.dataset.alt = String(alt || "");
  element.innerHTML = teamIconMarkup(icon, alt);
}

function triggerHaptic(type = "light") {
  const haptic = window.Telegram?.WebApp?.HapticFeedback;
  const telegramPulse = (pulseType) => {
    if (pulseType === "selection") {
      haptic?.selectionChanged?.();
    } else if (pulseType === "success" || pulseType === "error" || pulseType === "warning") {
      haptic?.notificationOccurred?.(pulseType);
    } else {
      haptic?.impactOccurred?.(pulseType);
    }
  };

  try {
    if (haptic) {
      const sequences = {
        selection: ["selection", "light"],
        light: ["light"],
        medium: ["medium", "light"],
        success: ["success", "light"],
        win: [
          { pulse: "success", delay: 0 },
          { pulse: "light", delay: 130 },
          { pulse: "medium", delay: 310 },
          { pulse: "light", delay: 500 },
          { pulse: "medium", delay: 760 },
          { pulse: "heavy", delay: 1080 },
          { pulse: "light", delay: 1390 },
          { pulse: "medium", delay: 1700 },
          { pulse: "success", delay: 2050 },
          { pulse: "light", delay: 2380 },
          { pulse: "medium", delay: 2700 },
          { pulse: "success", delay: 3100 },
        ],
        warning: ["warning", "medium"],
        error: ["error", "heavy", "medium"],
      };
      (sequences[type] || sequences.light).forEach((pulse, index) => {
        const item = typeof pulse === "string"
          ? { pulse, delay: index * 48 }
          : pulse;
        window.setTimeout(() => telegramPulse(item.pulse), item.delay);
      });
    }
  } catch {
    // Haptic feedback is best-effort and must never block trading UI.
  }

  if (!haptic && "vibrate" in navigator) {
    const pattern = type === "success"
      ? [18, 32, 24]
      : type === "win"
        ? [70, 55, 105, 70, 55, 55, 135, 90, 180, 110, 75, 70, 160, 95, 240, 130, 85, 75, 330]
      : type === "error"
        ? [55, 35, 42]
        : type === "warning"
          ? [32, 28, 44]
          : type === "medium"
            ? [28, 24, 18]
        : type === "selection"
          ? [14, 18, 10]
          : 24;
    navigator.vibrate(pattern);
  }
}

function resizeCanvas(canvas) {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { dpr, width, height };
}

function drawSmoothPath(ctx, points) {
  if (points.length < 2) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }

  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function getDisplayMarket() {
  if (state.selectedBtcMarketId) {
    return state.btcMarkets.find((market) => market.id === state.selectedBtcMarketId) || state.market;
  }

  if (state.selectedWorldCupMarketId) {
    return state.worldCupMarkets.find((market) => market.id === state.selectedWorldCupMarketId) || state.market;
  }

  return state.market;
}

function isWorldCupMarket(market = getDisplayMarket()) {
  return market?.market_type === "WORLD_CUP_WINNER";
}

function isBtcMarket(market = getDisplayMarket()) {
  return market?.market_type === "BTC_UPDOWN" || String(market?.symbol || "").startsWith("BTCUSDT");
}

function isMarketOpenForBuy(market, bufferMs = MARKET_BUY_CLOSE_BUFFER_MS) {
  if (!market || market.status !== "open" || !market.end_time) {
    return false;
  }
  return new Date(market.end_time).getTime() > Date.now() + bufferMs;
}

function getMarketMinOutcomePrice(market = getDisplayMarket()) {
  return isBtcMarket(market) ? BTC_MIN_OUTCOME_PRICE : MIN_OUTCOME_PRICE;
}

function upsertMarketListItem(listName, market) {
  if (!market?.id) {
    return;
  }
  const index = state[listName].findIndex((item) => item.id === market.id);
  if (index >= 0) {
    state[listName][index] = {
      ...state[listName][index],
      ...market,
    };
    return;
  }
  state[listName].push(market);
}

function upsertLocalMarket(market) {
  if (!market?.id) {
    return;
  }
  if (market.id === state.market?.id) {
    state.market = {
      ...state.market,
      ...market,
    };
  }
  if (market.market_type === "BTC_UPDOWN") {
    upsertMarketListItem("btcMarkets", market);
  }
  if (market.market_type === "WORLD_CUP_WINNER") {
    upsertMarketListItem("worldCupMarkets", market);
  }
}

function getDisplayChartPoints(market) {
  if (isBtcMarket(market) && market?.id !== state.market?.id) {
    const points = state.btcCharts.get(market.id) || [];
    if (points.length) {
      return points;
    }
  }

  if (!isWorldCupMarket(market)) {
    const btcPoints = isBtcMarket(market) && market?.id !== state.market?.id
      ? state.btcCharts.get(market.id) || []
      : state.chartPoints;
    if (btcPoints.length > 1) {
      return btcPoints;
    }
    const now = Date.now();
    const start = Number(market?.open_price || market?.current_price || 0);
    const current = Number(market?.current_price || start || 0);
    if (!start || !current) {
      return btcPoints;
    }
    const wiggle = Math.max(1, current * 0.00005);
    return Array.from({ length: 18 }, (_, index) => {
      const progress = index / 17;
      return {
        price: start + (current - start) * progress + Math.sin(index / 2.2) * wiggle,
        at: now - (17 - index) * 850,
      };
    });
  }

  const points = state.worldCupCharts.get(market.id) || [];
  if (points.length) {
    return points;
  }

  const now = Date.now();
  const base = Number(market.yes_price || 0.5) * 100;
  return Array.from({ length: 12 }, (_, index) => ({
    price: Math.max(0.1, Math.min(99.9, base + Math.sin(index / 2.3) * 0.35)),
    at: now - (11 - index) * 850,
  }));
}

function normalizeChartPrice(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric <= 1.5 ? numeric * 100 : numeric;
}

function drawMarketChartFrame() {
  const canvas = $("marketChart");
  const market = getDisplayMarket();
  if (!(canvas instanceof HTMLCanvasElement) || !market) {
    state.chartRaf = null;
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    state.chartRaf = null;
    return;
  }

  const { width, height } = resizeCanvas(canvas);
  const appBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#080d16";
  const worldCup = isWorldCupMarket(market);
  const openPrice = worldCup
    ? Math.max(0.1, Math.min(99.9, Number(market.yes_price || 0.5) * 100))
    : Number(market.open_price || 0);
  const currentPrice = worldCup
    ? Math.max(0.1, Math.min(99.9, Number(market.yes_price || 0.5) * 100))
    : Number(market.current_price || openPrice || 0);
  if (!state.smoothedPrice || Math.abs(state.smoothedPrice - currentPrice) > Math.max(250, currentPrice * 0.015)) {
    state.smoothedPrice = currentPrice;
  } else {
    state.smoothedPrice += (currentPrice - state.smoothedPrice) * 0.045;
  }

  const sourcePoints = getDisplayChartPoints(market)
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at))
    .map((point) => ({ ...point }))
    .sort((a, b) => a.at - b.at);
  const endTime = new Date(market.end_time).getTime();
  const nowMs = Date.now();
  const historyStart = sourcePoints[0]?.at;
  const historyEnd = sourcePoints[sourcePoints.length - 1]?.at;
  const btc = isBtcMarket(market);
  const windowEnd = (worldCup || btc) && sourcePoints.length > 1
    ? Math.max(nowMs, historyEnd || nowMs)
    : Math.min(endTime, nowMs);
  const startTime = (worldCup || btc) && sourcePoints.length > 1
    ? historyStart
    : (worldCup ? windowEnd - CHART_WINDOW_MS : new Date(market.start_time).getTime());
  const windowStart = (worldCup || btc) && sourcePoints.length > 1
    ? startTime
    : Math.max(startTime, windowEnd - CHART_WINDOW_MS);
  const duration = Math.max(1, windowEnd - windowStart);
  const rawPoints = sourcePoints
    .filter((point) => worldCup || btc || (point.at >= windowStart - 1_500 && point.at <= windowEnd + 1_500));

  if (rawPoints.length === 0 && currentPrice > 0) {
    rawPoints.push({ price: currentPrice, at: Date.now() });
  }
  if (rawPoints.length > 0) {
    rawPoints[rawPoints.length - 1] = {
      ...rawPoints[rawPoints.length - 1],
      price: state.smoothedPrice,
      at: windowEnd,
    };
  }

  const prices = [...rawPoints.map((point) => point.price), openPrice].filter(Number.isFinite);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = worldCup ? Math.max(1.8, (maxPrice - minPrice) * 0.56) : Math.max(4, (maxPrice - minPrice) * 0.42);
  const targetMin = minPrice - padding;
  const targetMax = maxPrice + padding;
  state.chartYMin = state.chartYMin === null ? targetMin : state.chartYMin + (targetMin - state.chartYMin) * 0.08;
  state.chartYMax = state.chartYMax === null ? targetMax : state.chartYMax + (targetMax - state.chartYMax) * 0.08;

  const left = width * 0.04;
  const currentX = width * 0.70;
  const right = width * 0.98;
  const top = height * 0.12;
  const bottom = height * 0.82;
  const plotWidth = Math.max(1, currentX - left);
  const plotHeight = Math.max(1, bottom - top);
  const scaleY = (price) => bottom - ((price - state.chartYMin) / Math.max(1, state.chartYMax - state.chartYMin)) * plotHeight;
  const scaleX = (at) => left + ((Math.min(windowEnd, Math.max(windowStart, at)) - windowStart) / duration) * plotWidth;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = appBg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = top + (plotHeight / 3) * i;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }

  const openY = scaleY(openPrice);
  ctx.setLineDash([8, 9]);
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(left, openY);
  ctx.lineTo(right, openY);
  ctx.stroke();
  ctx.setLineDash([]);

  const targetAbove = openY < scaleY(state.smoothedPrice || currentPrice);
  const targetLabel = worldCup
    ? `${formatCents((state.smoothedPrice || currentPrice) / 100)} YES`
    : `TARGET ${targetAbove ? "↑" : "↓"}`;
  ctx.font = `${Math.max(10, width * 0.026)}px Inter, system-ui, sans-serif`;
  const targetTextWidth = ctx.measureText(targetLabel).width + 20;
  const targetX = Math.min(right - targetTextWidth, Math.max(left, currentX + width * 0.08));
  const targetY = Math.max(top + 4, Math.min(bottom - 22, openY - 14));
  ctx.fillStyle = "rgba(101, 113, 132, 0.88)";
  ctx.beginPath();
  roundedRectPath(ctx, targetX, targetY, targetTextWidth, 24, 10);
  ctx.fill();
  ctx.fillStyle = "#f3f6fb";
  ctx.textBaseline = "middle";
  ctx.fillText(targetLabel, targetX + 10, targetY + 12);

  const pathPoints = rawPoints.map((point) => ({
    x: scaleX(point.at),
    y: scaleY(point.price),
  }));
  const isUp = state.smoothedPrice >= openPrice;
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, isUp ? "rgba(25,195,125,0.24)" : "rgba(239,70,111,0.22)");
  gradient.addColorStop(1, "rgba(8,13,22,0)");

  if (pathPoints.length > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pathPoints[0].x, bottom);
    for (const point of pathPoints) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.lineTo(pathPoints[pathPoints.length - 1].x, bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = isUp ? "#19c37d" : "#ef466f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawSmoothPath(ctx, pathPoints);
  }

  const latest = pathPoints[pathPoints.length - 1];
  if (latest) {
    ctx.fillStyle = isUp ? "#19c37d" : "#ef466f";
    ctx.shadowColor = isUp ? "rgba(25,195,125,0.55)" : "rgba(239,70,111,0.52)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(latest.x, latest.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    const currentLabel = worldCup
      ? `${(state.smoothedPrice || currentPrice).toFixed(1)}%`
      : `$${formatPrice(state.smoothedPrice || currentPrice)}`;
    ctx.font = `${Math.max(12, width * 0.034)}px Inter, system-ui, sans-serif`;
    const currentTextWidth = ctx.measureText(currentLabel).width + 18;
    const labelX = Math.min(width - currentTextWidth - 8, latest.x + 12);
    const labelY = Math.max(top + 4, Math.min(bottom - 28, latest.y - 14));
    ctx.fillStyle = isUp ? "#19c37d" : "#ef466f";
    ctx.shadowColor = "rgba(0,0,0,0.42)";
    ctx.shadowBlur = 9;
    ctx.textBaseline = "middle";
    ctx.fillText(currentLabel, labelX + 9, labelY + 14);
    ctx.shadowBlur = 0;
  }

  if (Math.abs((state.smoothedPrice || 0) - currentPrice) > 0.04) {
    state.chartRaf = requestAnimationFrame(drawMarketChartFrame);
    return;
  }

  state.chartRaf = null;
}

function renderMarketChart() {
  if (state.chartRaf) {
    return;
  }
  state.chartRaf = requestAnimationFrame(drawMarketChartFrame);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

function setConnection(status, type = "") {
  const element = $("connectionStatus");
  if (!element) {
    return;
  }
  element.textContent = status;
  element.classList.remove("online", "error");
  if (type) {
    element.classList.add(type);
  }
}

function formatMarketWindow(market) {
  if (!market?.start_time || !market?.end_time) {
    return "--";
  }

  const start = new Date(market.start_time);
  const end = new Date(market.end_time);
  const day = start.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
  const startTime = start.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${day}, ${startTime}-${endTime}`;
}

function animateText(element, nextValue, formatter, duration = 360) {
  if (!element) {
    return;
  }

  const numericValue = Number(nextValue || 0);
  const previousValue = Number(element.dataset.value);
  if (!Number.isFinite(previousValue)) {
    element.dataset.value = String(numericValue);
    element.textContent = formatter(numericValue);
    return;
  }

  if (Math.abs(previousValue - numericValue) < 0.001) {
    element.textContent = formatter(numericValue);
    return;
  }

  const previousAnimation = textAnimations.get(element);
  if (previousAnimation) {
    cancelAnimationFrame(previousAnimation);
    textAnimations.delete(element);
  }

  const startedAt = performance.now();
  const delta = numericValue - previousValue;

  function step(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = previousValue + delta * eased;
    element.dataset.value = String(current);
    element.textContent = formatter(current);
    if (progress < 1) {
      textAnimations.set(element, requestAnimationFrame(step));
      return;
    }

    textAnimations.delete(element);
    element.dataset.value = String(numericValue);
    element.textContent = formatter(numericValue);
  }

  textAnimations.set(element, requestAnimationFrame(step));
}

function normalizeTelegramUser(user, authSource) {
  if (!user?.id) {
    return null;
  }

  return {
    telegram_id: String(user.id),
    username: user.username || null,
    first_name: user.first_name || null,
    auth_source: authSource,
  };
}

function parseTelegramInitDataUser(initData) {
  if (!initData) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);
    const rawUser = params.get("user");
    return rawUser ? JSON.parse(rawUser) : null;
  } catch {
    return null;
  }
}

function parseTelegramStartParam(initData) {
  if (!initData) {
    return null;
  }

  try {
    return new URLSearchParams(initData).get("start_param");
  } catch {
    return null;
  }
}

function getTelegramDebugInfo() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    return "Telegram.WebApp: нет · initData: нет · user: нет";
  }

  const unsafeUser = tg.initDataUnsafe?.user;
  const parsedUser = parseTelegramInitDataUser(tg.initData);
  return [
    "Telegram.WebApp: да",
    `initData: ${tg.initData ? "да" : "нет"}`,
    `unsafe user: ${unsafeUser?.id ? "да" : "нет"}`,
    `parsed user: ${parsedUser?.id ? "да" : "нет"}`,
  ].join(" · ");
}

function getTelegramUser() {
  const tg = window.Telegram?.WebApp;
  const params = new URLSearchParams(window.location.search);
  const refParam = params.get("ref")
    || params.get("startapp")
    || params.get("start_param")
    || params.get("tgWebAppStartParam");
  const normalizeRef = (value) => {
    const normalized = String(value || "").trim().replace(/^ref_/, "");
    return /^\d+$/.test(normalized) ? normalized : null;
  };

  if (tg) {
    const applyTelegramViewport = () => {
      const height = Number(tg.viewportStableHeight || tg.viewportHeight || 0);
      if (height > 0) {
        document.documentElement.style.setProperty("--tg-app-height", `${height}px`);
      }
    };
    try {
      document.body.classList.add("telegram-shell");
      tg.ready();
      tg.expand();
      tg.requestFullscreen?.();
      tg.disableVerticalSwipes?.();
      applyTelegramViewport();
      tg.onEvent?.("viewportChanged", applyTelegramViewport);
    } catch {
      // Older Telegram clients may not support every Mini App display method.
    }
    const user = tg.initDataUnsafe?.user || parseTelegramInitDataUser(tg.initData);
    const telegramRef = tg.initDataUnsafe?.start_param || parseTelegramStartParam(tg.initData);
    const normalizedUser = normalizeTelegramUser(user, "telegram");
    if (normalizedUser) {
      return {
        ...normalizedUser,
        referred_by_telegram_id: normalizeRef(telegramRef) || normalizeRef(refParam),
      };
    }
  }

  const telegramId = params.get("telegram_id");
  if (telegramId) {
    return {
      telegram_id: telegramId,
      username: params.get("username"),
      first_name: params.get("first_name"),
      auth_source: "dev",
      referred_by_telegram_id: normalizeRef(refParam),
    };
  }

  return null;
}

async function loadPublicConfig() {
  try {
    const data = await api("/api/public/config");
    state.publicConfig = {
      ...state.publicConfig,
      ...data,
    };
    if (Array.isArray(state.publicConfig.usdt_deposit_networks) && state.publicConfig.usdt_deposit_networks.length > 0) {
      state.topup.network = state.publicConfig.usdt_deposit_networks[0].key || state.topup.network;
    }
    renderTaskRewards();
    renderTopupSheet();
  } catch {
    // The UI can still work with local fallback config.
  }
}

function renderTaskRewards() {
  const share = Math.round(Number(state.publicConfig.task_share_fire || 100));
  const sub = Math.round(Number(state.publicConfig.task_subscribe_fire || 500));
  const privateChat = Math.round(Number(state.publicConfig.task_private_chat_fire || 15000));
  const ref = Math.round(Number(state.publicConfig.referral_bonus_fire || 500));
  const refUsdt = Math.round(Number(state.publicConfig.referral_bet_bonus_usdt || 30));
  const dailyPresence = Math.round(Number(state.publicConfig.task_daily_presence_fire || 50));
  const dailyBet = Math.round(Number(state.publicConfig.task_daily_bet_fire || 50));
  if ($("shareTaskReward")) $("shareTaskReward").textContent = formatFire(share);
  if ($("channelTaskReward")) $("channelTaskReward").textContent = formatFire(sub);
  if ($("chatTaskReward")) $("chatTaskReward").textContent = formatFire(sub);
  if ($("privateChatTaskReward")) $("privateChatTaskReward").textContent = formatFire(privateChat);
  if ($("refTaskReward")) $("refTaskReward").textContent = formatFire(ref);
  if ($("refTaskUsdtReward")) $("refTaskUsdtReward").textContent = formatFire(refUsdt);
  if ($("dailyPresenceTaskReward")) $("dailyPresenceTaskReward").textContent = formatFire(dailyPresence);
  if ($("dailyBetTaskReward")) $("dailyBetTaskReward").textContent = formatFire(dailyBet);
}

function getMarketStatTitle(stat) {
  if (stat?.team) {
    return stat.team;
  }
  if (stat?.title) {
    return stat.label ? `${stat.title}` : stat.title;
  }
  if (stat?.symbol?.startsWith("BTCUSDT")) {
    const label = stat.label || stat.symbol.replace("BTCUSDT_", "").replace("BTCUSDT", "5m").toLowerCase();
    return `BTC ${label}`;
  }
  return stat?.question || stat?.symbol || `Маркет #${stat?.market_id || ""}`;
}

function renderTaskTabs() {
  const isStats = state.taskTab === "stats";
  $("tasksTabTasks")?.classList.toggle("active", !isStats);
  $("tasksTabStats")?.classList.toggle("active", isStats);
  document.querySelector(".task-list")?.classList.toggle("hidden", isStats);
  $("taskStatsPanel")?.classList.toggle("hidden", !isStats);
}

function renderTaskStats() {
  const list = $("taskStatsList");
  if (!list) return;

  const stats = state.marketStats || [];
  if (!stats.length) {
    list.innerHTML = `
      <div class="task-stat-empty">
        Пока нет рассчитанных рынков. Сделай ставку и дождись закрытия маркета.
      </div>
    `;
    return;
  }

  list.innerHTML = stats.slice(0, 30).map((stat) => {
    const currency = normalizeCurrency(stat.currency);
    const pnl = Number(stat.pnl || 0);
    const status = stat.open_positions_count > 0 ? "LIVE" : (stat.status === "resolved" ? "CLOSED" : String(stat.status || "").toUpperCase());
    return `
      <div class="task-stat-row">
        <div class="task-stat-main">
          <strong>${escapeHtml(getMarketStatTitle(stat))}</strong>
          <small>${escapeHtml(status)} · ${stat.positions_count || 0} поз. · ${escapeHtml(currency)}</small>
        </div>
        <div class="task-stat-numbers">
          <strong class="${pnl >= 0 ? "profit" : "loss"}">${formatSignedCurrencyAmount(pnl, currency)}</strong>
          <small>${formatCurrencyAmount(stat.spent || 0, currency)} → ${formatCurrencyAmount(stat.payout || 0, currency)}</small>
        </div>
      </div>
    `;
  }).join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || data.status || "request_failed");
    error.detail = data.detail || "";
    throw error;
  }
  return data;
}

async function runSingleFlight(key, task) {
  if (state.inFlight.has(key)) {
    return null;
  }

  state.inFlight.add(key);
  try {
    return await task();
  } finally {
    state.inFlight.delete(key);
  }
}

function maybeLoadComments(force = false) {
  const now = Date.now();
  if (!force && now - state.lastCommentsLoadAt < COMMENTS_POLL_MS) {
    return;
  }

  state.lastCommentsLoadAt = now;
  void runSingleFlight("comments", loadComments).catch(() => undefined);
}

function scheduleCoreRefresh({ delay = 120, includeLists = true, includeComments = false } = {}) {
  if (state.refreshTimer) {
    clearTimeout(state.refreshTimer);
  }

  state.refreshTimer = window.setTimeout(() => {
    state.refreshTimer = null;
    const jobs = [
      runSingleFlight("market", loadMarket).catch(() => undefined),
      runSingleFlight("me", loadMe).catch(() => undefined),
    ];

    if (includeLists) {
      jobs.push(runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined));
      jobs.push(runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined));
    }

    void Promise.all(jobs);
    if (includeComments) {
      maybeLoadComments(true);
    }
  }, delay);
}

async function upsertMe() {
  const user = getTelegramUser();
  if (!user) {
    document.body.classList.add("auth-only");
    $("authCard").classList.remove("hidden");
    $("authDebug").textContent = getTelegramDebugInfo();
    setConnection("Нет пользователя", "error");
    if (!/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
      window.setTimeout(() => {
        if (!state.user && state.publicConfig.mini_app_url) {
          window.location.href = state.publicConfig.mini_app_url;
        }
      }, 900);
    }
    return false;
  }

  const data = await api("/api/me/upsert", {
    method: "POST",
    body: JSON.stringify(user),
  });
  state.user = data.user;
  state.balance = data.balance || 0;
  state.usdtBalance = data.usdt_balance || 0;
  state.usdtCashBalance = data.usdt_cash_balance || 0;
  state.usdtBonusBalance = data.usdt_bonus_balance || 0;
  state.positions = data.positions || [];
  state.marketStats = data.market_stats || [];
  state.presence.startedAt = Date.now();
  document.body.classList.remove("auth-only");
  $("authCard").classList.add("hidden");
  setConnection("LIVE", "online");
  return true;
}

function mergeChartPoints(points, market) {
  const mapped = (points || []).map((point) => ({
    price: Number(point.price),
    at: new Date(point.created_at).getTime(),
  })).filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at));

  if (market?.current_price) {
    mapped.push({
      price: Number(market.current_price),
      at: Date.now(),
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const point of mapped) {
    const key = `${Math.round(point.at / 1000)}:${point.price}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(point);
    }
  }

  deduped.sort((a, b) => a.at - b.at);
  return deduped.slice(-260);
}

function handleActivity(activity) {
  const nextActivity = activity || [];
  if (state.activityLoaded) {
    nextActivity
      .filter((trade) => !state.seenActivityIds.has(trade.id))
      .slice()
      .reverse()
      .forEach(showTradeBubble);
  }

  nextActivity.forEach((trade) => state.seenActivityIds.add(trade.id));
  state.activityLoaded = true;
  state.activity = nextActivity;
}

function handleSettlements(positions) {
  const settled = (positions || [])
    .filter((position) => position.status !== "open")
    .filter((position) => Number(position.payout || 0) > 0 || Number(position.pnl || 0) > 0);

  if (state.settlementsLoaded) {
    const newWins = settled.filter((position) => !state.seenSettledPositionIds.has(position.id));
    if (newWins.length) {
      triggerHaptic("win");
      const winsByCurrency = newWins.reduce((map, item) => {
        const currency = normalizeCurrency(item.currency);
        map.set(currency, (map.get(currency) || 0) + Number(item.pnl || item.payout || 0));
        return map;
      }, new Map());
      const label = Array.from(winsByCurrency.entries())
        .map(([currency, value]) => formatSignedCurrencyAmount(value, currency))
        .join(" · ");
      showToast(`Есть выигрыш: ${label}`);
    }
  }

  settled.forEach((position) => state.seenSettledPositionIds.add(position.id));
  state.settlementsLoaded = true;
}

async function loadMarket() {
  const data = await api("/api/market/active");
  state.market = data.market;
  state.chartPoints = mergeChartPoints(data.chart, data.market);
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  if (!state.commentsMarketId || state.commentsMarketId === getDisplayMarket()?.id) {
    maybeLoadComments();
  }
}

async function loadActivity() {
  const data = await api("/api/activity/recent?limit=40");
  handleActivity(data.activity || []);
  renderActivity();
}

async function loadMe() {
  if (!state.user?.telegram_id) {
    return;
  }

  const data = await api(`/api/me?telegram_id=${encodeURIComponent(state.user.telegram_id)}`);
  state.balance = data.balance || 0;
  state.usdtBalance = data.usdt_balance || 0;
  state.usdtCashBalance = data.usdt_cash_balance || 0;
  state.usdtBonusBalance = data.usdt_bonus_balance || 0;
  state.positions = data.positions || [];
  state.recentTrades = data.recent_trades || [];
  state.marketStats = data.market_stats || [];
  handleSettlements(state.positions);
  renderMe();
  renderTaskStats();
}

async function loadRecentMarkets() {
  const data = await api("/api/markets/recent");
  state.recentMarkets = data.markets || [];
  renderRecentMarkets();
}

async function loadLeaderboard(currency = state.leaderboardCurrency, options = {}) {
  const normalizedCurrency = normalizeCurrency(currency);
  const requestId = state.leaderboardRequestId + 1;
  state.leaderboardRequestId = requestId;
  state.leaderboardLoading = true;

  if (!options.background) {
    if (state.leaderboardCache[normalizedCurrency]) {
      state.leaderboard = state.leaderboardCache[normalizedCurrency];
    }
    renderLeaderboard();
  }

  try {
    const data = await api(`/api/leaderboard?limit=30&currency=${encodeURIComponent(normalizedCurrency)}`);
    const players = data.players || [];
    state.leaderboardCache[normalizedCurrency] = players;

    if (state.leaderboardCurrency === normalizedCurrency && state.leaderboardRequestId === requestId) {
      state.leaderboard = players;
      state.leaderboardLoading = false;
      renderLeaderboard();
      return;
    }

    if (state.leaderboardRequestId === requestId) {
      state.leaderboardLoading = false;
    }
  } catch (error) {
    if (state.leaderboardRequestId === requestId) {
      state.leaderboardLoading = false;
      renderLeaderboard();
    }
    throw error;
  }
}

function formatRelativeTime(value) {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

async function loadComments() {
  const market = getDisplayMarket();
  if (!market?.id) {
    state.comments = [];
    state.commentsMarketId = null;
    renderComments();
    return;
  }

  const data = await api(`/api/market/${market.id}/comments?limit=30`);
  state.comments = data.comments || [];
  state.commentsMarketId = market.id;
  renderComments();
}

function renderComments() {
  const container = $("marketChatList");
  if (!container) {
    return;
  }

  const market = getDisplayMarket();
  if (!market?.id) {
    container.innerHTML = '<p class="muted">Сначала выбери рынок.</p>';
    return;
  }

  if (state.commentsMarketId !== market.id || !state.comments.length) {
    container.innerHTML = '<p class="muted">Комментариев пока нет.</p>';
    return;
  }

  container.innerHTML = state.comments.slice(0, 8).map((comment) => {
    const name = comment.username || comment.first_name || `user ${comment.telegram_id}`;
    const latestBet = comment.latest_bet;
    const betBadge = latestBet
      ? `<span class="chat-bet side-${latestBet.side}">${actionLabel(latestBet.action)} ${marketSideLabel(market, latestBet.side)} ${formatCurrencyAmount(latestBet.amount, latestBet.currency)}</span>`
      : '<span class="chat-bet muted">без ставки</span>';
    return `
      <div class="chat-row">
        <div class="chat-meta">
          <strong>${escapeHtml(name)}</strong>
          <span>${formatRelativeTime(comment.created_at)}</span>
          ${betBadge}
        </div>
        <p>${escapeHtml(comment.message)}</p>
      </div>
    `;
  }).join("");
}

function mergeWorldCupChartPoint(market) {
  if (!market?.id) {
    return;
  }

  const existing = state.worldCupCharts.get(market.id) || [];
  const history = (market.chart || [])
    .map((point) => ({
      price: normalizeChartPrice(point.price),
      at: new Date(point.created_at).getTime(),
    }))
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at));
  const points = existing.length ? existing : history;
  const nextPoint = {
    price: Math.max(0.1, Math.min(99.9, Number(market.yes_price || 0.5) * 100)),
    at: Date.now(),
  };
  const lastPoint = points[points.length - 1];
  if (!lastPoint || nextPoint.at - lastPoint.at > 700 || Math.abs(nextPoint.price - lastPoint.price) > 0.02) {
    points.push(nextPoint);
  }
  state.worldCupCharts.set(market.id, points.slice(-260));
}

function mergeBtcChartPoint(market) {
  if (!market?.id) {
    return;
  }

  const existing = state.btcCharts.get(market.id) || [];
  const history = (market.chart || [])
    .map((point) => ({
      price: normalizeChartPrice(point.price),
      at: new Date(point.created_at).getTime(),
    }))
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at));
  const points = existing.length ? existing : history;
  if (market.current_price) {
    const nextPoint = {
      price: Number(market.current_price),
      at: Date.now(),
    };
    const lastPoint = points[points.length - 1];
    if (!lastPoint || nextPoint.at - lastPoint.at > 700 || Math.abs(nextPoint.price - lastPoint.price) > 0.01) {
      points.push(nextPoint);
    }
  }
  state.btcCharts.set(market.id, points.slice(-260));
}

async function loadBtcMarkets() {
  const data = await api("/api/btc/markets");
  const incomingMarkets = data.markets || [];
  state.btcMarkets = incomingMarkets;
  state.btcMarkets.forEach(mergeBtcChartPoint);
  if (
    state.selectedBtcMarketId
    && !state.btcMarkets.some((market) => market.id === state.selectedBtcMarketId)
  ) {
    state.selectedBtcMarketId = null;
  }
  renderBtcMarketsList();
  if (state.selectedBtcMarketId) {
    renderMarket();
    renderTradeTicket();
    renderMarketChart();
  }
}

async function loadWorldCupMarkets() {
  const data = await api("/api/world-cup/markets");
  const incomingMarkets = data.markets || [];
  state.worldCupMarkets = incomingMarkets;
  state.worldCupMarkets.forEach(mergeWorldCupChartPoint);
  if (
    state.selectedWorldCupMarketId
    && !state.worldCupMarkets.some((market) => market.id === state.selectedWorldCupMarketId)
  ) {
    state.selectedWorldCupMarketId = null;
  }
  renderWorldCupList();
  if (state.selectedWorldCupMarketId) {
    renderMarket();
    renderTradeTicket();
    renderMarketChart();
  }
}

function getSelectedPrice() {
  const market = getDisplayMarket();
  if (!market) {
    return 0.5;
  }

  return Number(state.selectedSide === "YES" ? market.yes_price : market.no_price) || 0.5;
}

function getPreview(amount = state.selectedAmount, side = state.selectedSide) {
  const market = getDisplayMarket();
  const price = market
    ? Number(side === "YES" ? market.yes_price : market.no_price)
    : 0.5;
  const safePrice = Math.max(getMarketMinOutcomePrice(market), price || 0.5);
  const net = Number(amount || 0);
  const shares = net / safePrice;
  const profit = shares - Number(amount || 0);

  return {
    shares,
    profit,
    price: safePrice,
  };
}

function getBuyIntentKey(marketId, side, amount, currency = state.currency) {
  return `${marketId}:${side}:${Math.round(Number(amount || 0) * 100) / 100}:${normalizeCurrency(currency)}`;
}

function applyBuyIntentSelection(intent) {
  const marketId = Number(intent.marketId);
  const btcMarket = state.btcMarkets.find((market) => market.id === marketId);
  const worldMarket = state.worldCupMarkets.find((market) => market.id === marketId);
  if (btcMarket) {
    state.selectedBtcMarketId = btcMarket.id === state.market?.id ? null : btcMarket.id;
    state.selectedWorldCupMarketId = null;
  } else if (worldMarket) {
    state.selectedWorldCupMarketId = worldMarket.id;
    state.selectedBtcMarketId = null;
  }
  state.selectedSide = intent.side;
  state.selectedAmount = intent.amount;
  state.currency = normalizeCurrency(intent.currency || state.currency);
}

function renderMarket() {
  const market = getDisplayMarket();
  const hasMarket = Boolean(market);
  const worldCup = isWorldCupMarket(market);
  const currentPrice = worldCup
    ? Number(market?.yes_price || 0.5) * 100
    : Number(market?.current_price || market?.open_price || 0);
  const openPrice = worldCup
    ? Number(market?.yes_price || 0.5) * 100
    : Number(market?.open_price || 0);
  const priceMove = currentPrice - openPrice;
  const yes = Number(market?.yes_price || 0.5);
  const no = Number(market?.no_price || 0.5);
  const yesVolume = Number(market?.yes_volume || 0);
  const noVolume = Number(market?.no_volume || 0);
  const volumeTotal = Math.max(1, yesVolume + noVolume);
  const yesDepth = Math.max(6, Math.min(94, (yesVolume / volumeTotal) * 100));
  const canBuyMarket = isMarketOpenForBuy(market);

  const marketStatus = $("marketStatus");
  marketStatus.textContent = marketStatusLabel(canBuyMarket ? market?.status : (market ? "closed" : market?.status));
  marketStatus.classList.toggle("live", canBuyMarket);
  $("marketTitle").textContent = worldCup
    ? `${market.team} Winner`
    : (market?.title || "BTC Up or Down 5m");
  const coinBadge = document.querySelector(".coin-badge");
  if (coinBadge) {
    if (worldCup) {
      setTeamIconElement(coinBadge, market.icon, market.team);
    } else {
      coinBadge.dataset.icon = "";
      coinBadge.dataset.alt = "";
      coinBadge.textContent = "₿";
    }
    coinBadge.classList.toggle("team", worldCup);
  }
  const marketQuestion = $("marketQuestion");
  if (marketQuestion) {
    marketQuestion.textContent = hasMarket ? "" : "Рынок пока не создан.";
  }
  $("marketWindow").textContent = hasMarket ? formatMarketWindow(market) : "--";
  const priceLabels = document.querySelectorAll(".price-board .label");
  if (priceLabels[0]) priceLabels[0].textContent = worldCup ? "Volume" : "Target Price";
  if (priceLabels[1]) {
    priceLabels[1].childNodes[0].nodeValue = worldCup ? "Yes Chance " : "Current Price ";
  }
  animateText($("openPrice"), worldCup ? Number(market?.volume || 0) : openPrice, (value) => (
    worldCup ? formatFire(value) : `$${formatPrice(value)}`
  ));
  animateText($("currentPrice"), currentPrice, (value) => (
    worldCup ? `${value.toFixed(1)}%` : `$${formatPrice(value)}`
  ));

  const moveElement = $("priceMove");
  moveElement.classList.toggle("positive", priceMove >= 0);
  moveElement.classList.toggle("negative", priceMove < 0);
  animateText(moveElement, priceMove, (value) => (
    worldCup ? `${formatCents(yes)} YES` : `${value >= 0 ? "▲" : "▼"} $${formatPrice(Math.abs(value))}`
  ));

  $("yesOptionText").textContent = `${marketSideLabel(market, "YES")} ${formatCents(yes)}`;
  $("noOptionText").textContent = `${marketSideLabel(market, "NO")} ${formatCents(no)}`;
  animateText($("yesVolume"), yesVolume, formatFire);
  animateText($("noVolume"), noVolume, formatFire);
  $("depthYesBar").parentElement.style.setProperty("--yes-depth", `${yesDepth}%`);
  document.querySelector(".market-depth")?.classList.toggle("hidden", !worldCup);

  updateTimer();
  document.querySelectorAll(".outcome-button, .amount-button").forEach((button) => {
    button.disabled = !hasMarket || !state.user || !canBuyMarket;
  });
}

function updateTimer() {
  const market = getDisplayMarket();
  const minuteLabel = $("timeLeftMinutes")?.nextElementSibling;
  const secondLabel = $("timeLeftSeconds")?.nextElementSibling;
  if (!market?.end_time) {
    $("timeLeftMinutes").textContent = "--";
    $("timeLeftSeconds").textContent = "--";
    if (minuteLabel) minuteLabel.textContent = "MINS";
    if (secondLabel) secondLabel.textContent = "SECS";
    return;
  }

  const remainingMs = new Date(market.end_time).getTime() - Date.now();
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (remainingMs <= 0 && market.status === "open" && state.expiryRefreshMarketId !== market.id) {
    state.expiryRefreshMarketId = market.id;
    state.buyQueue = [];
    if ($("marketStatus")) {
      $("marketStatus").textContent = marketStatusLabel("closed");
      $("marketStatus").classList.remove("live");
    }
    document.querySelectorAll(".outcome-button, .amount-button").forEach((button) => {
      button.disabled = true;
    });
    renderTradeTicket();
    scheduleCoreRefresh({ delay: 80 });
  }
  if ((isWorldCupMarket(market) || isBtcMarket(market)) && seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    $("timeLeftMinutes").textContent = String(days);
    $("timeLeftSeconds").textContent = String(hours).padStart(2, "0");
    if (minuteLabel) minuteLabel.textContent = "DAYS";
    if (secondLabel) secondLabel.textContent = "HRS";
    return;
  }
  if (isBtcMarket(market) && seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    $("timeLeftMinutes").textContent = String(hours).padStart(2, "0");
    $("timeLeftSeconds").textContent = String(minutes).padStart(2, "0");
    if (minuteLabel) minuteLabel.textContent = "HRS";
    if (secondLabel) secondLabel.textContent = "MINS";
    return;
  }
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  $("timeLeftMinutes").textContent = minutesPart;
  $("timeLeftSeconds").textContent = secondsPart;
  if (minuteLabel) minuteLabel.textContent = "MINS";
  if (secondLabel) secondLabel.textContent = "SECS";
}

function setSectionToggle(id, total, key) {
  const button = $(id);
  if (!button) {
    return;
  }

  if (total <= COLLAPSE_LIMIT) {
    button.classList.add("hidden");
    return;
  }

  button.classList.remove("hidden");
  button.textContent = state.expanded[key] ? "Скрыть" : `Все ${total}`;
}

function getPositionMarket(position) {
  return state.worldCupMarkets.find((market) => market.id === position.market_id)
    || state.btcMarkets.find((market) => market.id === position.market_id)
    || (position.market_id === state.market?.id ? state.market : null);
}

function getPositionMarketLabel(position, market = getPositionMarket(position)) {
  if (market?.team || position.team) {
    return market?.team || position.team;
  }
  if (market?.market_type === "BTC_UPDOWN") {
    return market.title || `BTC ${market.label || ""}`;
  }
  const symbol = market?.symbol || position.market_symbol;
  if (String(symbol || "").startsWith("BTCUSDT")) {
    const suffix = String(symbol).replace("BTCUSDT", "").replace(/^_/, "").toLowerCase();
    return `BTC ${suffix || "5m"}`;
  }
  return `#${position.market_id}`;
}

function getActivityMarketLabel(trade) {
  if (trade.team) {
    return trade.team;
  }
  if (String(trade.market_symbol || "").startsWith("BTCUSDT")) {
    const suffix = String(trade.market_symbol).replace("BTCUSDT", "").replace(/^_/, "").toLowerCase();
    return `BTC ${suffix || "5m"}`;
  }
  return trade.market_symbol || `#${trade.market_id}`;
}

function getActivitySideLabel(trade) {
  return trade.team ? (trade.side === "YES" ? "Yes" : "No") : sideLabel(trade.side);
}

function getRecentMarketLabel(market) {
  const winner = market.winner ? sideLabel(market.winner) : marketStatusLabel(market.status);
  if (String(market.symbol || "").startsWith("BTCUSDT")) {
    const suffix = String(market.symbol).replace("BTCUSDT", "").replace(/^_/, "").toLowerCase();
    return `#${market.id} · ${winner} BTC ${suffix || "5m"}`;
  }
  return `#${market.id} · ${winner} ${market.symbol}`;
}

function estimateSellQuote({ position, market, outcomePrice }) {
  const shares = Number(position.shares || 0);
  const minPrice = getMarketMinOutcomePrice(market);
  const price = Math.max(minPrice, Number(outcomePrice || 0));
  const liquidity = Math.max(100, Number(market?.liquidity || state.market?.liquidity || 10_000));
  const estimatedGross = shares * price;
  const impact = (estimatedGross / liquidity) * SELL_IMPACT_MULTIPLIER;
  const nextPrice = Math.max(minPrice, price - impact);
  const extraExitPenalty = isWorldCupMarket(market) ? 0.02 : 0;
  const bidPrice = Math.max(minPrice, Math.min(price, nextPrice) * (1 - MARKET_MAKER_SPREAD_RATE - extraExitPenalty));
  const grossExitValue = shares * bidPrice;
  const spent = Number(position.spent || 0);
  const exitProfit = grossExitValue - spent;
  const exitValue = Math.max(0, grossExitValue - Math.max(0, exitProfit) * PROFIT_FEE_RATE);

  return {
    bidPrice,
    exitValue,
    pnl: exitValue - spent,
  };
}

function renderMe() {
  const balanceElement = $("fireBalance");
  const activeBalance = getActiveBalance();
  const balanceDigits = String(Math.floor(Number(activeBalance || 0))).length;
  balanceElement?.classList.toggle("compact", balanceDigits >= 6);
  balanceElement?.classList.toggle("tiny", balanceDigits >= 8);
  document.querySelectorAll("[data-currency-toggle]").forEach((button) => {
    button.classList.toggle("active", normalizeCurrency(button.dataset.currencyToggle) === state.currency);
  });
  animateText(balanceElement, activeBalance, (value) => formatHeaderCurrencyAmount(value, state.currency));

  const positions = state.positions.filter((position) => (
    position.status === "open" && normalizeCurrency(position.currency) === state.currency
  ));
  setSectionToggle("positionToggle", positions.length, "positions");

  const container = $("positionList");
  if (!positions.length) {
    container.innerHTML = '<p class="muted">Позиции пока нет.</p>';
    return;
  }

  const visiblePositions = state.expanded.positions ? positions : positions.slice(0, COLLAPSE_LIMIT);
  container.innerHTML = visiblePositions.map((position) => {
    const payout = Number(position.shares || 0);
    const spent = Number(position.spent || 0);
    const currency = normalizeCurrency(position.currency);
    const displayMarket = getDisplayMarket();
    const selectedWorldCupMarket = getPositionMarket(position);
    const activeMarket = selectedWorldCupMarket || (position.market_id === state.market?.id ? state.market : null);
    const isActiveMarket = Boolean(activeMarket) || position.market_id === displayMarket?.id;
    const positionMarketPrice = Number(position.side === "YES" ? position.yes_price : position.no_price);
    const liveMarketPrice = Number(position.side === "YES" ? activeMarket?.yes_price : activeMarket?.no_price);
    const marketPrice = (isActiveMarket ? liveMarketPrice : positionMarketPrice) || 0;
    const exitQuote = estimateSellQuote({ position, market: activeMarket, outcomePrice: marketPrice });
    const exitValue = exitQuote.exitValue;
    const pnl = exitQuote.pnl;
    const isSelling = state.pendingSellPositionId === position.id;
    const expiresAt = position.market_end_time ? new Date(position.market_end_time).getTime() : 0;
    const secondsLeft = expiresAt > 0 ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000)) : null;
    const marketIsLive = position.market_status === "open";
    const canSell = marketIsLive && secondsLeft !== null && secondsLeft > 0;
    const sellLockMessage = !marketIsLive
      ? "Рынок уже рассчитан."
      : secondsLeft === 0
        ? "Рынок уже закрылся, ждём расчёт."
        : "";
    const marketBadge = secondsLeft === null
      ? ""
      : secondsLeft > 0
        ? ` · ${secondsLeft}с`
        : " · закрывается";
    const marketLabel = getPositionMarketLabel(position, activeMarket);
    return `
      <div class="mini-row">
        <div>
          <strong class="side-${position.side}">${escapeHtml(marketLabel)} · ${marketSideLabel(activeMarket, position.side)}</strong>
          <br />
          <small>${payout.toFixed(2)} shares · Avg ${formatCents(position.avg_price)} · Sell ${formatCents(exitQuote.bidPrice)} · Spent ${formatCurrencyAmount(spent, currency)}${marketBadge}</small>
        </div>
        <div class="position-actions">
          <strong class="${pnl >= 0 ? "positive" : "negative"}">${formatSignedCurrencyAmount(pnl, currency)}</strong>
          <button
            class="sell-button ${sideClass(position.side)}"
            data-side="${position.side}"
            data-position-id="${position.id}"
            data-market-id="${position.market_id}"
            data-shares="${payout}"
            data-sell-locked="${canSell ? "0" : "1"}"
            data-lock-message="${sellLockMessage}"
            type="button"
            ${isSelling || !canSell ? "disabled" : ""}
          >
            ${isSelling ? "Продаю..." : canSell ? `Продать ${formatCurrencyAmount(exitValue, currency)}` : "Ждём итог"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function renderTradeTicket() {
  const side = state.selectedSide;
  const price = getSelectedPrice();
  const market = getDisplayMarket();
  const canBuyMarket = isMarketOpenForBuy(market);
  const amounts = getAmountsForCurrency(state.currency);
  if (!amounts.includes(Number(state.selectedAmount))) {
    state.selectedAmount = amounts[0];
  }

  document.querySelectorAll(".outcome-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.side === side);
  });
  document.querySelectorAll(".amount-button").forEach((button, index) => {
    const amount = amounts[index] || amounts[0];
    button.dataset.amount = String(amount);
    const amountPreview = getPreview(amount, side);
    const pendingKey = market ? getBuyIntentKey(market.id, side, amount, state.currency) : null;
    const nextLabel = formatCurrencyAmount(amount, state.currency);
    const nextWin = formatCurrencyAmount(amountPreview.shares, state.currency);
    button.classList.toggle("active", amount === state.selectedAmount);
    button.classList.toggle("loading", Boolean(state.pendingBuyKey && state.pendingBuyKey === pendingKey));
    button.disabled = !market || !state.user || !canBuyMarket;
    if (button.dataset.label !== nextLabel || button.dataset.win !== nextWin) {
      button.dataset.label = nextLabel;
      button.dataset.win = nextWin;
      button.innerHTML = `
        <strong>${nextLabel}</strong>
        <small>win <b>${nextWin}</b></small>
      `;
    }
  });

  $("ticketTitle").textContent = canBuyMarket
    ? `Нажми сумму для ${marketSideLabel(market, side)}`
    : "Рынок завершён, обновляю...";
  $("ticketPrice").textContent = `${marketSideLabel(market, side)} ${formatCents(price)}`;
}

function renderActivity() {
  const container = $("activityTape");
  setSectionToggle("activityToggle", state.activity.length, "activity");
  if (!state.activity.length) {
    container.innerHTML = '<p class="muted">Пока нет ставок.</p>';
    return;
  }

  const visibleActivity = state.expanded.activity ? state.activity.slice(0, 16) : state.activity.slice(0, COLLAPSE_LIMIT);
  container.innerHTML = visibleActivity.map((trade) => {
    const name = trade.username || trade.first_name || `user ${trade.telegram_id}`;
    const action = trade.action || "BUY";
    const marketLabel = getActivityMarketLabel(trade);
    return `
      <div class="activity-row">
        <div>
          <strong class="side-${trade.side}">${escapeHtml(name)} ${actionLabel(action)} ${getActivitySideLabel(trade)}</strong>
          <br />
          <small>${escapeHtml(marketLabel)} · ${formatCents(trade.price)} · ${trade.shares.toFixed(2)} shares</small>
        </div>
        <strong>${formatCurrencyAmount(trade.amount, trade.currency)}</strong>
      </div>
    `;
  }).join("");
}

function renderRecentMarkets() {
  const container = $("recentMarkets");
  setSectionToggle("recentToggle", state.recentMarkets.length, "recent");
  if (!state.recentMarkets.length) {
    container.innerHTML = '<p class="muted">Пока нет закрытых рынков.</p>';
    return;
  }

  const visibleMarkets = state.expanded.recent ? state.recentMarkets.slice(0, 12) : state.recentMarkets.slice(0, COLLAPSE_LIMIT);
  container.innerHTML = visibleMarkets.map((market) => {
    const move = Number(market.close_price || 0) - Number(market.open_price || 0);
    return `
      <div class="mini-row">
        <div>
          <strong class="side-${market.winner || "YES"}">${escapeHtml(getRecentMarketLabel(market))}</strong>
          <br />
          <small>$${formatPrice(market.open_price)} -> $${formatPrice(market.close_price)}</small>
        </div>
        <small class="${move >= 0 ? "positive" : "negative"}">${move >= 0 ? "+" : ""}${formatPrice(move)}</small>
      </div>
    `;
  }).join("");
}

function renderLeaderboard() {
  const container = $("leaderboardList");
  if (!container) {
    return;
  }
  document.querySelectorAll("[data-leaderboard-currency]").forEach((button) => {
    button.classList.toggle("active", normalizeCurrency(button.dataset.leaderboardCurrency) === state.leaderboardCurrency);
  });

  container.classList.toggle("loading", Boolean(state.leaderboardLoading));

  if (!state.leaderboard.length) {
    container.innerHTML = state.leaderboardLoading
      ? '<p class="muted">Загружаю рейтинг...</p>'
      : '<p class="muted">Пока нет игроков в рейтинге.</p>';
    return;
  }

  const rows = state.leaderboard.map((player, index) => {
    const name = player.username
      ? `@${player.username}`
      : player.first_name || `user ${player.telegram_id}`;
    const winRate = Number(player.win_rate_pct || 0);
    return `
      <div class="leaderboard-row">
        <span class="leaderboard-rank">${index + 1}</span>
        <div class="leaderboard-player">
          <strong>${escapeHtml(name)}</strong>
          <small>${formatFire(player.bet_count)} ставок · WR ${winRate.toFixed(0)}%</small>
        </div>
        <strong class="leaderboard-balance">${formatCurrencyAmount(player.balance, player.currency || state.leaderboardCurrency)}</strong>
      </div>
    `;
  }).join("");
  const loadingPill = state.leaderboardLoading
    ? '<div class="leaderboard-refresh-pill">Обновляю...</div>'
    : "";
  container.innerHTML = `${loadingPill}${rows}`;
}

function formatVolume(value) {
  const num = Number(value || 0);
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}K`;
  }
  return formatFire(num);
}

function renderWorldCupList() {
  const container = $("worldCupList");
  if (!container) {
    return;
  }

  if (!state.worldCupMarkets.length) {
    container.innerHTML = '<p class="muted">World Cup markets пока загружаются.</p>';
    return;
  }

  const orderKey = state.worldCupMarkets.map((market) => market.id).join(",");
  if (state.worldCupListRenderedOrder === orderKey) {
    for (const market of state.worldCupMarkets) {
      const row = container.querySelector(`[data-market-id="${market.id}"]`);
      if (!row) continue;
      const volume = row.querySelector("[data-world-cup-volume]");
      const chance = row.querySelector("[data-world-cup-chance]");
      const yesButton = row.querySelector("[data-side='YES']");
      const noButton = row.querySelector("[data-side='NO']");
      if (volume) volume.textContent = `${formatVolume(market.volume)} Vol.`;
      if (chance) {
        chance.textContent = `${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
      }
      if (yesButton) yesButton.textContent = `Buy Yes ${formatCents(market.yes_price)}`;
      if (noButton) noButton.textContent = `Buy No ${formatCents(market.no_price)}`;
    }
    return;
  }

  state.worldCupListRenderedOrder = orderKey;
  container.innerHTML = state.worldCupMarkets.map((market) => `
    <article class="world-cup-row" data-market-id="${market.id}">
      <button class="world-cup-main" data-world-cup-open="${market.id}" type="button">
        <span class="team-flag">${teamIconMarkup(market.icon, market.team)}</span>
        <span>
          <strong>${escapeHtml(market.team)}</strong>
          <small data-world-cup-volume>${formatVolume(market.volume)} Vol.</small>
        </span>
        <b data-world-cup-chance>${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</b>
      </button>
      <div class="world-cup-actions">
        <button class="wc-yes" data-world-cup-buy="${market.id}" data-side="YES" type="button">Buy Yes ${formatCents(market.yes_price)}</button>
        <button class="wc-no" data-world-cup-buy="${market.id}" data-side="NO" type="button">Buy No ${formatCents(market.no_price)}</button>
      </div>
    </article>
  `).join("");
}

function renderBtcMarketsList() {
  const container = $("btcMarketsList");
  if (!container) {
    return;
  }

  if (!state.btcMarkets.length) {
    container.innerHTML = '<p class="muted">BTC markets пока загружаются.</p>';
    return;
  }

  const orderKey = state.btcMarkets.map((market) => market.id).join(",");
  if (state.btcMarketsListRenderedOrder === orderKey) {
    for (const market of state.btcMarkets) {
      const row = container.querySelector(`[data-market-id="${market.id}"]`);
      if (!row) continue;
      const chance = row.querySelector("[data-btc-chance]");
      const price = row.querySelector("[data-btc-price]");
      const yesButton = row.querySelector("[data-side='YES']");
      const noButton = row.querySelector("[data-side='NO']");
      if (chance) chance.textContent = `${Math.round(Number(market.yes_price || 0.5) * 100)}%`;
      if (price) price.textContent = `$${formatPrice(market.current_price || market.open_price)}`;
      if (yesButton) yesButton.textContent = `Buy Up ${formatCents(market.yes_price)}`;
      if (noButton) noButton.textContent = `Buy Down ${formatCents(market.no_price)}`;
    }
    return;
  }

  state.btcMarketsListRenderedOrder = orderKey;
  container.innerHTML = state.btcMarkets.map((market) => `
    <article class="world-cup-row btc-market-row" data-market-id="${market.id}">
      <button class="world-cup-main" data-btc-open="${market.id}" type="button">
        <span class="team-flag btc-mini-icon">₿</span>
        <span>
          <strong>${escapeHtml(market.title || `BTC ${market.label || ""}`)}</strong>
          <small data-btc-price>$${formatPrice(market.current_price || market.open_price)}</small>
        </span>
        <b data-btc-chance>${Math.round(Number(market.yes_price || 0.5) * 100)}%</b>
      </button>
      <div class="world-cup-actions">
        <button class="wc-yes" data-btc-buy="${market.id}" data-side="YES" type="button">Buy Up ${formatCents(market.yes_price)}</button>
        <button class="wc-no" data-btc-buy="${market.id}" data-side="NO" type="button">Buy Down ${formatCents(market.no_price)}</button>
      </div>
    </article>
  `).join("");
}

function setBtcMarketsSheetOpen(open) {
  const sheet = $("btcMarketsSheet");
  if (!sheet) return;
  sheet.classList.toggle("hidden", !open);
}

function selectBtcMarket(marketId) {
  const id = Number(marketId);
  const market = state.btcMarkets.find((item) => item.id === id);
  if (!market) {
    return;
  }
  state.selectedBtcMarketId = id === state.market?.id ? null : id;
  state.selectedWorldCupMarketId = null;
  state.smoothedPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  setBtcMarketsSheetOpen(false);
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}

function setWorldCupSheetOpen(open) {
  const sheet = $("worldCupSheet");
  if (!sheet) return;
  sheet.classList.toggle("hidden", !open);
}

function selectWorldCupMarket(marketId) {
  const id = Number(marketId);
  const market = state.worldCupMarkets.find((item) => item.id === id);
  if (!market) {
    return;
  }
  state.selectedWorldCupMarketId = id;
  state.selectedBtcMarketId = null;
  state.smoothedPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  setWorldCupSheetOpen(false);
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}

function renderBetSheet() {
  const { market, side, amount } = state.betSheet;
  if (!market) {
    return;
  }

  const isBtc = isBtcMarket(market);
  const price = Math.max(getMarketMinOutcomePrice(market), Number(side === "YES" ? market.yes_price : market.no_price) || 0.5);
  const shares = Number(amount || 0) / price;
  setTeamIconElement($("betTeamIcon"), isBtc ? "₿" : market.icon, isBtc ? "BTC" : market.team);
  if ($("betMarketTitle")) $("betMarketTitle").textContent = market.title || (isBtc ? "BTC Market" : "World Cup Winner");
  if ($("betTeamName")) $("betTeamName").textContent = isBtc ? (market.title || "BTC Up or Down") : (market.team || "Team");
  if ($("betSideName")) {
    $("betSideName").textContent = marketSideLabel(market, side);
    $("betSideName").className = side === "YES" ? "positive" : "negative";
  }
  if ($("betAmountValue")) $("betAmountValue").textContent = formatCurrencyAmount(amount, state.currency);
  if ($("betWinValue")) $("betWinValue").textContent = formatCurrencyAmount(shares, state.currency);
  if ($("betPriceValue")) $("betPriceValue").textContent = formatCents(price);
  $("betSideYesBtn")?.classList.toggle("active", side === "YES");
  $("betSideNoBtn")?.classList.toggle("active", side === "NO");
  if ($("betSideYesBtn")) $("betSideYesBtn").textContent = marketSideLabel(market, "YES");
  if ($("betSideNoBtn")) $("betSideNoBtn").textContent = marketSideLabel(market, "NO");
  const amounts = getAmountsForCurrency(state.currency);
  document.querySelectorAll("[data-bet-add]").forEach((button, index) => {
    const addAmount = amounts[index] || amounts[0];
    button.dataset.betAdd = String(addAmount);
    button.textContent = `+${formatCurrencyAmount(addAmount, state.currency)}`;
  });
  if ($("betConfirmBtn")) {
    $("betConfirmBtn").disabled = !amount || !state.user;
    $("betConfirmBtn").textContent = amount ? `Trade ${formatCurrencyAmount(amount, state.currency)}` : "Trade";
  }
}

function openBetSheet(market, side = "YES") {
  state.betSheet = {
    market,
    side,
    amount: 0,
    currency: state.currency,
  };
  renderBetSheet();
  $("betSheet")?.classList.remove("hidden");
}

function closeBetSheet() {
  $("betSheet")?.classList.add("hidden");
}

function renderTopupSheet() {
  const isTopupMode = state.topup.mode !== "withdraw";
  const currency = normalizeCurrency(state.topup.currency);
  const isUsdt = currency === "USDT";
  const intent = state.topup.intent;
  const hasPendingIntent = isUsdt && intent?.status === "pending";
  const amount = normalizeTopupAmount(state.topup.amount || 1, currency);
  state.topup.amount = amount;
  const networks = Array.isArray(state.publicConfig.usdt_deposit_networks)
    ? state.publicConfig.usdt_deposit_networks
    : [];
  const activeNetwork = networks.find((network) => network.key === state.topup.network) || networks[0];
  if (activeNetwork && state.topup.network !== activeNetwork.key) {
    state.topup.network = activeNetwork.key;
  }
  $("topupModePanel")?.classList.toggle("hidden", !isTopupMode);
  $("withdrawModePanel")?.classList.toggle("hidden", isTopupMode);
  $("walletModeTopupBtn")?.classList.toggle("active", isTopupMode);
  $("walletModeWithdrawBtn")?.classList.toggle("active", !isTopupMode);
  document.querySelectorAll("[data-wallet-currency]").forEach((button) => {
    button.classList.toggle("active", normalizeCurrency(button.dataset.walletCurrency) === currency);
  });
  $("usdtDepositPanel")?.classList.toggle("hidden", !isUsdt || !isTopupMode);
  document.querySelector(".topup-packages")?.classList.toggle("hidden", isUsdt);
  document.querySelectorAll("[data-usdt-network]").forEach((button) => {
    const network = networks.find((item) => item.key === button.dataset.usdtNetwork);
    button.disabled = !network || Boolean(intent);
    button.classList.toggle("active", Boolean(network) && network.key === state.topup.network);
  });
  $("usdtDepositIntentBox")?.classList.toggle("hidden", !isUsdt || !intent);
  if ($("usdtDepositExactAmount")) {
    $("usdtDepositExactAmount").textContent = intent
      ? `${Number(intent.deposit_amount || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
      : "";
  }
  if ($("usdtDepositStatus")) {
    const statusText = intent?.status === "credited"
      ? "Зачислено на баланс"
      : intent?.status === "expired"
        ? "Заявка истекла, создай новую"
        : intent
          ? "Ждем перевод и подтверждения сети"
          : "";
    $("usdtDepositStatus").textContent = statusText;
  }
  if ($("usdtCancelIntentBtn")) {
    $("usdtCancelIntentBtn").classList.toggle("hidden", !hasPendingIntent);
    $("usdtCancelIntentBtn").disabled = state.topup.pending;
  }
  document.querySelectorAll("[data-usdt-address-card]").forEach((card) => {
    card.classList.toggle("hidden", !hasPendingIntent);
  });
  if ($("usdtEvmAddressLabel")) {
    $("usdtEvmAddressLabel").textContent = intent?.network_label
      ? `${intent.network_label} USDT адрес`
      : "ERC20 / BEP20";
  }
  if ($("usdtEvmAddress")) $("usdtEvmAddress").textContent = state.publicConfig.usdt_evm_address;
  if ($("usdtTonAddress")) $("usdtTonAddress").textContent = state.publicConfig.usdt_ton_address;
  if ($("walletSheetTitle")) {
    $("walletSheetTitle").textContent = isTopupMode
      ? `Пополнить ${isUsdt ? "USDT" : "звезды"}`
      : `Вывести ${isUsdt ? "USDT" : "звезды"}`;
  }
  if ($("walletSheetEyebrow")) {
    $("walletSheetEyebrow").textContent = isUsdt ? "Virtual USDT" : "Telegram Stars";
  }
  if ($("walletFullBalance")) {
    const walletBalance = isUsdt ? state.usdtCashBalance : state.balance;
    $("walletFullBalance").textContent = formatCurrencyAmount(walletBalance, currency);
  }
  if ($("walletBonusBalance")) {
    const hasBonus = isUsdt && Number(state.usdtBonusBalance || 0) > 0;
    $("walletBonusBalance").classList.toggle("hidden", !hasBonus);
    $("walletBonusBalance").textContent = hasBonus
      ? `Бонус: ${formatCurrencyAmount(state.usdtBonusBalance, "USDT")}`
      : "";
  }
  if ($("topupAmountValue")) $("topupAmountValue").textContent = formatCurrencyAmount(amount, currency);
  if ($("topupCustomAmount") && document.activeElement !== $("topupCustomAmount")) {
    $("topupCustomAmount").value = currency === "USDT"
      ? String(amount)
      : String(Math.round(amount));
  }
  if ($("topupCustomAmount")) {
    $("topupCustomAmount").step = currency === "USDT" ? "0.01" : "1";
    $("topupCustomAmount").min = currency === "USDT" ? "15" : "1";
    $("topupCustomAmount").disabled = hasPendingIntent;
  }
  if ($("topupReason")) {
    if (state.topup.reason) {
      $("topupReason").textContent = state.topup.reason;
    } else if (isUsdt && intent) {
      $("topupReason").textContent = `Отправь ровно ${Number(intent.deposit_amount || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT на адрес ${intent.network_label || intent.network}. Баланс обновится автоматически.`;
    } else if (isUsdt) {
      $("topupReason").textContent = "Создай заявку, потом отправь точную сумму USDT на общий кошелек.";
    } else {
      $("topupReason").textContent = "Звезды зачислятся в баланс после оплаты.";
    }
  }
  if ($("topupBuyBtn")) {
    $("topupBuyBtn").disabled = !isTopupMode || state.topup.pending || !state.user;
    $("topupBuyBtn").textContent = isUsdt
      ? (hasPendingIntent ? "Скопировать адрес" : "Создать заявку")
      : (state.topup.pending ? "Открываю оплату..." : `Купить ${formatCurrencyAmount(amount, currency)}`);
  }
  document.querySelectorAll("[data-topup-package]").forEach((button) => {
    button.disabled = hasPendingIntent;
    button.classList.toggle("active", Number(button.dataset.topupPackage) === amount);
  });
}

function openTopupSheet(amount, reason = "", mode = "topup") {
  state.topup.amount = normalizeTopupAmount(amount || 1, state.currency);
  state.topup.reason = reason;
  state.topup.mode = mode === "withdraw" ? "withdraw" : "topup";
  state.topup.currency = state.currency;
  renderTopupSheet();
  $("topupSheet")?.classList.remove("hidden");
}

function closeTopupSheet() {
  $("topupSheet")?.classList.add("hidden");
}

function stopDepositPolling() {
  if (state.topup.pollTimer) {
    clearInterval(state.topup.pollTimer);
    state.topup.pollTimer = null;
  }
}

async function refreshBalanceAfterInvoice() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 2 ? 900 : 1500));
    await loadMe().catch(() => undefined);
  }
}

async function refreshDepositIntent() {
  const intent = state.topup.intent;
  if (!intent?.id || !state.user?.telegram_id) {
    stopDepositPolling();
    return;
  }

  try {
    const data = await api(`/api/usdt/deposits/intents/${intent.id}?telegram_id=${encodeURIComponent(state.user.telegram_id)}`);
    state.topup.intent = data.intent;
    renderTopupSheet();
    if (data.intent?.status === "credited") {
      stopDepositPolling();
      triggerHaptic("success");
      showToast("USDT зачислены на баланс.");
      await loadMe();
      return;
    }
    if (data.intent?.status === "expired") {
      stopDepositPolling();
      triggerHaptic("warning");
      showToast("Заявка истекла. Создай новую.");
    }
  } catch {
    // Keep polling. Short RPC/API hiccups should not break the visible intent.
  }
}

function startDepositPolling() {
  stopDepositPolling();
  state.topup.pollTimer = setInterval(() => {
    void refreshDepositIntent();
  }, 5000);
  void refreshDepositIntent();
}

async function copyToClipboard(value) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

async function createUsdtDepositIntent() {
  if (!state.user?.telegram_id) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь.");
    return;
  }

  const amount = normalizeTopupAmount(state.topup.amount || 1, "USDT");
  state.topup.pending = true;
  renderTopupSheet();
  try {
    const result = await api("/api/usdt/deposits/intents", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        amount,
        network: state.topup.network,
      }),
    });
    state.topup.intent = result.intent;
    triggerHaptic("success");
    showToast("Заявка создана. Отправь точную сумму.");
    startDepositPolling();
  } catch (error) {
    triggerHaptic("error");
    const message = error.message === "invalid_deposit_network"
      ? "Эта сеть сейчас недоступна."
      : "Не получилось создать заявку.";
    showToast(message);
  } finally {
    state.topup.pending = false;
    renderTopupSheet();
  }
}

async function cancelUsdtDepositIntent() {
  const intent = state.topup.intent;
  if (!intent?.id || !state.user?.telegram_id || intent.status !== "pending") {
    state.topup.intent = null;
    stopDepositPolling();
    renderTopupSheet();
    return;
  }

  state.topup.pending = true;
  renderTopupSheet();
  try {
    await api(`/api/usdt/deposits/intents/${intent.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
      }),
    });
    state.topup.intent = null;
    stopDepositPolling();
    triggerHaptic("success");
    showToast("Заявка отменена.");
  } catch {
    triggerHaptic("error");
    showToast("Не получилось отменить заявку.");
  } finally {
    state.topup.pending = false;
    renderTopupSheet();
  }
}

async function startStarsTopup() {
  if (!state.user?.telegram_id) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь.");
    return;
  }

  const amount = normalizeTopupAmount(state.topup.amount || 1, state.topup.currency);
  if (state.topup.currency === "USDT") {
    if (!state.topup.intent || state.topup.intent.status === "expired" || state.topup.intent.status === "credited") {
      await createUsdtDepositIntent();
      return;
    }
    const copied = await copyToClipboard(state.topup.intent.to_address || state.publicConfig.usdt_evm_address);
    triggerHaptic(copied ? "success" : "warning");
    showToast(copied ? "Адрес скопирован." : "Скопируй адрес вручную.");
    return;
  }

  state.topup.pending = true;
  renderTopupSheet();
  try {
    const result = await api("/api/stars/invoice", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        amount,
      }),
    });
    const invoiceUrl = result.invoice_url;
    const tg = window.Telegram?.WebApp;
    if (tg?.openInvoice) {
      tg.openInvoice(invoiceUrl, (status) => {
        if (status === "paid") {
          triggerHaptic("success");
          showToast("Оплата прошла. Обновляю баланс...");
          closeTopupSheet();
          void refreshBalanceAfterInvoice();
          return;
        }
        if (status === "cancelled") {
          showToast("Оплата отменена.");
        }
      });
    } else {
      window.open(invoiceUrl, "_blank", "noopener,noreferrer");
      showToast("После оплаты баланс обновится автоматически.");
      void refreshBalanceAfterInvoice();
    }
  } catch (error) {
    triggerHaptic("error");
    const message = error.message === "invoice_not_configured"
      ? "Покупка внутри Mini App ещё не настроена на сервере."
      : "Не получилось открыть оплату.";
    showToast(message);
  } finally {
    state.topup.pending = false;
    renderTopupSheet();
  }
}

function showTradeBubble(trade) {
  const container = $("tradeBubbles");
  const bubble = document.createElement("div");
  const name = trade.username || trade.first_name || "user";
  const action = trade.action || "BUY";
  bubble.className = `trade-bubble ${sideClass(trade.side)}`;
  bubble.textContent = `${name} ${actionLabel(action)} ${sideLabel(trade.side)} ${formatCurrencyAmount(trade.amount, trade.currency)}`;
  bubble.style.left = `${24 + Math.random() * 52}%`;
  container.appendChild(bubble);
  setTimeout(() => bubble.remove(), 2600);
}

function upsertLocalPosition(position) {
  if (!position?.id) return;
  const index = state.positions.findIndex((item) => item.id === position.id);
  if (index >= 0) {
    state.positions[index] = {
      ...state.positions[index],
      ...position,
    };
    return;
  }

  state.positions.unshift(position);
}

function addLocalActivity(trade) {
  if (!trade) return;
  const enriched = {
    ...trade,
    telegram_id: state.user?.telegram_id,
    username: state.user?.username,
    first_name: state.user?.first_name,
  };
  state.activity = [enriched, ...state.activity].slice(0, 24);
  state.seenActivityIds.add(enriched.id);
  showTradeBubble(enriched);
}

async function buy(amount = state.selectedAmount) {
  const market = getDisplayMarket();
  if (!state.user || !market) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь и активный рынок.");
    return;
  }

  const marketId = market.id;
  const side = state.selectedSide;
  const buyAmount = Number(amount || state.selectedAmount);
  const currency = state.currency;
  state.selectedAmount = buyAmount;
  if (!isMarketOpenForBuy(market)) {
    state.buyQueue = [];
    const now = Date.now();
    if (now - state.lastClosedMarketToastAt > 1_500) {
      state.lastClosedMarketToastAt = now;
      showToast("Этот рынок уже завершился. Обновляю...");
    }
    triggerHaptic("warning");
    renderTradeTicket();
    scheduleCoreRefresh({ delay: 80 });
    return;
  }
  const intentKey = getBuyIntentKey(marketId, side, buyAmount, currency);
  if (state.pendingBuy) {
    triggerHaptic(state.pendingBuyKey === intentKey ? "light" : "selection");
    state.pendingBuyKey = state.pendingBuyKey || intentKey;
    if (state.buyQueue.length < 12) {
      state.buyQueue.push({ marketId, side, amount: buyAmount, currency });
    }
    renderTradeTicket();
    return;
  }
  const activeBalance = getActiveBalance();
  if (buyAmount > Number(activeBalance || 0)) {
    state.buyQueue = [];
    const missing = Math.max(1, Math.ceil(buyAmount - Number(activeBalance || 0)));
    triggerHaptic("warning");
    openTopupSheet(missing, `Для ставки ${formatCurrencyAmount(buyAmount, currency)} не хватает ${formatCurrencyAmount(missing, currency)}.`);
    return;
  }
  triggerHaptic("medium");
  state.pendingBuy = true;
  state.pendingBuyKey = intentKey;
  renderTradeTicket();
  try {
    const result = await api(`/api/market/${marketId}/buy`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        side,
        amount: buyAmount,
        currency,
      }),
    });
    applyCurrencyBalancePayload(result.currency || currency, result);
    upsertLocalMarket(result.market);
    upsertLocalPosition(result.position);
    addLocalActivity(result.trade);
    triggerHaptic("success");
    if (Number(result.daily_bet_bonus?.awarded || 0) > 0) {
      showToast(`+${formatFire(result.daily_bet_bonus.awarded)} за первую ставку дня.`);
    }
    renderMarket();
    renderMe();
    renderActivity();
    renderTradeTicket();
    scheduleCoreRefresh({ delay: 160, includeComments: true });
  } catch (error) {
    triggerHaptic("error");
    if (error.message === "insufficient_fire" || error.message === "insufficient_usdt") {
      state.buyQueue = [];
      const latestBalance = getActiveBalance();
      const missing = Math.max(1, Math.ceil(buyAmount - Number(latestBalance || 0)));
      openTopupSheet(missing, `Для ставки ${formatCurrencyAmount(buyAmount, currency)} не хватает ${formatCurrencyAmount(missing, currency)}.`);
    } else if (error.message === "market_closed" || error.message === "market_not_open") {
      state.buyQueue = [];
      showToast("Этот рынок уже завершился. Обновляю...");
      scheduleCoreRefresh({ delay: 80 });
    } else {
      showToast("Покупка не прошла.");
    }
  } finally {
    state.pendingBuy = false;
    state.pendingBuyKey = null;
    renderMarket();
    renderTradeTicket();
    const nextIntent = state.buyQueue.shift();
    if (nextIntent) {
      applyBuyIntentSelection(nextIntent);
      window.setTimeout(() => {
        void buy(nextIntent.amount);
      }, 70);
    }
  }
}

async function sellPosition({ side, positionId, marketId, shares }) {
  if (!state.user || !marketId || !positionId || state.pendingSellPositionId) {
    triggerHaptic("warning");
    showToast("Нет активной позиции для продажи.");
    return;
  }

  triggerHaptic("medium");
  state.pendingSellSide = side;
  state.pendingSellPositionId = positionId;
  renderMe();
  try {
    const result = await api(`/api/market/${marketId}/sell`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        position_id: positionId,
        side,
        shares,
        currency: state.currency,
      }),
    });
    applyCurrencyBalancePayload(result.currency || state.currency, result);
    upsertLocalMarket(result.market);
    upsertLocalPosition(result.position);
    addLocalActivity(result.trade);
    triggerHaptic("success");
    const pnl = Number(result.sale?.pnl || 0);
    showToast(`Продано ${sideLabel(side)}: ${formatSignedCurrencyAmount(pnl, result.currency || state.currency)}`);
    renderMarket();
    renderMe();
    renderActivity();
    renderTradeTicket();
    scheduleCoreRefresh({ delay: 120, includeComments: true });
  } catch (error) {
    triggerHaptic("error");
    const messages = {
      position_not_open: "Позиция уже закрыта или рассчитана.",
      market_closed: "Рынок уже закрылся, ждём расчёт.",
      market_not_open: "Рынок сейчас не открыт.",
      invalid_market_price: "Цена рынка обновляется. Попробуй ещё раз.",
      insufficient_shares: "Не хватает shares для продажи.",
      user_not_found: "Пользователь не найден.",
      sell_failed: "Продажа не прошла. Попробуй ещё раз.",
    };
    const detail = error.detail ? ` (${error.detail})` : "";
    showToast(messages[error.message] ? `${messages[error.message]}${detail}` : `Продажа не прошла: ${error.message || "ошибка"}${detail}`);
    scheduleCoreRefresh({ delay: 80, includeLists: false });
  } finally {
    state.pendingSellSide = null;
    state.pendingSellPositionId = null;
    renderMe();
    renderTradeTicket();
  }
}

async function refreshAll() {
  try {
    await loadMarket();
    await loadBtcMarkets().catch(() => undefined);
    await loadActivity();
    await loadMe();
    await loadRecentMarkets();
    await loadComments().catch(() => undefined);
    setConnection("LIVE", "online");
  } catch (error) {
    setConnection("Ошибка", "error");
    showToast(error.message || "Ошибка обновления.");
  }
}

document.querySelectorAll(".outcome-button").forEach((button) => {
  button.addEventListener("click", () => {
    button.blur();
    triggerHaptic("selection");
    state.selectedSide = button.dataset.side;
    renderTradeTicket();
  });
});

document.querySelectorAll(".amount-button").forEach((button) => {
  button.addEventListener("click", () => {
    button.blur();
    state.selectedAmount = Number(button.dataset.amount);
    renderTradeTicket();
    void buy(state.selectedAmount);
  });
});

const placeBetButton = $("placeBetBtn");
if (placeBetButton) {
  placeBetButton.addEventListener("click", () => {
    void buy();
  });
}

const refreshButton = $("refreshBtn");
if (refreshButton) {
  refreshButton.addEventListener("click", () => {
    triggerHaptic("light");
    void refreshAll();
  });
}

$("walletBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  openTopupSheet(100, "", "topup");
});

$("leaderboardBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setLeaderboardSheetOpen(true);
  void loadLeaderboard().catch(() => showToast("Рейтинг пока не загрузился."));
});

$("leaderboardCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setLeaderboardSheetOpen(false);
});

$("leaderboardSheet")?.addEventListener("click", (event) => {
  if (event.target === $("leaderboardSheet")) {
    setLeaderboardSheetOpen(false);
  }
});

$("topupCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopupSheet();
});

$("topupSheet")?.addEventListener("click", (event) => {
  if (event.target === $("topupSheet")) {
    closeTopupSheet();
  }
});

$("topupBuyBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  void startStarsTopup();
});

$("topupCustomAmount")?.addEventListener("input", () => {
  if (state.topup.intent?.status === "pending") {
    return;
  }
  state.topup.amount = normalizeTopupAmount($("topupCustomAmount").value, state.topup.currency);
  state.topup.reason = "";
  renderTopupSheet();
});

$("usdtCancelIntentBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  void cancelUsdtDepositIntent();
});

$("walletModeTopupBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.topup.mode = "topup";
  renderTopupSheet();
});

$("walletModeWithdrawBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.topup.mode = "withdraw";
  renderTopupSheet();
});

[
  ["positionToggle", "positions", renderMe],
  ["activityToggle", "activity", renderActivity],
  ["recentToggle", "recent", renderRecentMarkets],
].forEach(([id, key, render]) => {
  $(id)?.addEventListener("click", () => {
    triggerHaptic("selection");
    state.expanded[key] = !state.expanded[key];
    render();
  });
});

document.querySelectorAll("[data-topup-package]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) {
      return;
    }
    triggerHaptic("selection");
    state.topup.mode = "topup";
    state.topup.amount = normalizeTopupAmount(button.dataset.topupPackage, state.topup.currency);
    state.topup.reason = "";
    renderTopupSheet();
  });
});

document.querySelectorAll("[data-currency-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextCurrency = normalizeCurrency(button.dataset.currencyToggle);
    if (state.currency === nextCurrency) {
      return;
    }
    triggerHaptic("selection");
    state.currency = nextCurrency;
    state.topup.currency = nextCurrency;
    state.selectedAmount = getAmountsForCurrency(nextCurrency)[0];
    if (state.betSheet.market) {
      state.betSheet.amount = 0;
      state.betSheet.currency = nextCurrency;
    }
    state.buyQueue = [];
    renderMe();
    renderTradeTicket();
    renderBetSheet();
  });
});

document.querySelectorAll("[data-wallet-currency]").forEach((button) => {
  button.addEventListener("click", () => {
    triggerHaptic("selection");
    const nextCurrency = normalizeCurrency(button.dataset.walletCurrency);
    if (state.topup.currency !== nextCurrency) {
      state.topup.intent = null;
      stopDepositPolling();
    }
    state.topup.currency = nextCurrency;
    renderTopupSheet();
  });
});

document.querySelectorAll("[data-usdt-network]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.disabled) {
      return;
    }
    triggerHaptic("selection");
    state.topup.network = button.dataset.usdtNetwork || "BSC";
    state.topup.intent = null;
    stopDepositPolling();
    renderTopupSheet();
  });
});

document.querySelectorAll("[data-leaderboard-currency]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextCurrency = normalizeCurrency(button.dataset.leaderboardCurrency);
    if (state.leaderboardCurrency === nextCurrency) {
      return;
    }
    triggerHaptic("selection");
    state.leaderboardCurrency = nextCurrency;
    if (state.leaderboardCache[nextCurrency]) {
      state.leaderboard = state.leaderboardCache[nextCurrency];
    }
    state.leaderboardLoading = true;
    renderLeaderboard();
    void loadLeaderboard(nextCurrency).catch(() => {
      state.leaderboardLoading = false;
      renderLeaderboard();
      showToast("Рейтинг пока не загрузился.");
    });
  });
});

document.querySelectorAll("[data-copy-address]").forEach((button) => {
  button.addEventListener("click", async () => {
    const type = button.dataset.copyAddress;
    const address = type === "ton"
      ? state.publicConfig.usdt_ton_address
      : state.publicConfig.usdt_evm_address;
    const copied = await copyToClipboard(address);
    triggerHaptic(copied ? "success" : "warning");
    showToast(copied ? "Адрес скопирован." : "Скопируй адрес вручную.");
  });
});

function buildInviteUrl(inviterTelegramId) {
  const refValue = `ref_${inviterTelegramId}`;
  const baseUrl = state.publicConfig.mini_app_url || "https://t.me/voit_help_bot?startapp=easymarket";
  try {
    const url = new URL(baseUrl, window.location.origin);
    if (/^(www\.)?t\.me$/i.test(url.hostname) || /^(www\.)?telegram\.me$/i.test(url.hostname)) {
      url.searchParams.set("startapp", refValue);
      return url.toString();
    }

    url.searchParams.set("ref", String(inviterTelegramId));
    return url.toString();
  } catch {
    return `${window.location.origin}/?ref=${encodeURIComponent(String(inviterTelegramId))}`;
  }
}

function openTelegramUrl(url) {
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink && /^https:\/\/t\.me\//i.test(url)) {
    tg.openTelegramLink(url);
    return true;
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return false;
}

function openBotTopup(url) {
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink && /^https:\/\/t\.me\//i.test(url)) {
    tg.openTelegramLink(url);
    window.setTimeout(() => {
      try {
        tg.close?.();
      } catch {
        // Closing the Mini App is a convenience only.
      }
    }, 350);
    return;
  }

  window.location.href = url;
}

async function claimShareTask() {
  if (!state.user?.telegram_id) {
    return;
  }

  try {
    const result = await api("/api/tasks/share", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
      }),
    });
    state.balance = result.balance ?? state.balance;
    renderMe();
    if (result.already_claimed) {
      showToast("Share-бонус сегодня уже забран.");
      return;
    }
    if (Number(result.awarded || 0) > 0) {
      showToast(`+${formatFire(result.awarded)} за share.`);
      return;
    }
    showToast("Дневной лимит бонусов уже достигнут.");
  } catch {
    showToast("Share отправлен. Бонус начислим после обновления.");
  }
}

async function claimDailyPresenceTask() {
  if (!state.user?.telegram_id || state.presence.pending) {
    return;
  }
  const elapsed = Date.now() - Number(state.presence.startedAt || Date.now());
  if (elapsed < 5 * 60_000) {
    const left = Math.ceil((5 * 60_000 - elapsed) / 1000);
    showToast(`Осталось ${Math.ceil(left / 60)} мин.`);
    return;
  }

  state.presence.pending = true;
  try {
    const result = await api("/api/tasks/daily", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        task_key: "daily_presence",
      }),
    });
    state.balance = result.balance ?? state.balance;
    state.presence.claimed = true;
    renderMe();
    if (result.already_claimed) {
      showToast("Ежедневный вход уже забран.");
    } else if (Number(result.awarded || 0) > 0) {
      showToast(`+${formatFire(result.awarded)} за 5 минут в EasyMarket.`);
    } else {
      showToast("Дневной лимит бонусов уже достигнут.");
    }
  } catch {
    showToast("Не получилось забрать daily.");
  } finally {
    state.presence.pending = false;
  }
}

function updatePresenceTaskButton() {
  const button = $("taskDailyPresenceBtn");
  if (!button || !state.presence.startedAt || state.presence.claimed) {
    return;
  }
  const elapsed = Date.now() - state.presence.startedAt;
  const remainingMs = Math.max(0, 5 * 60_000 - elapsed);
  if (remainingMs <= 0) {
    button.textContent = "Забрать";
    return;
  }
  const seconds = Math.ceil(remainingMs / 1000);
  button.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function shareInvite({ awardShareTask = false } = {}) {
  triggerHaptic("selection");
  if (!state.user?.telegram_id) {
    showToast("Сначала нужен пользователь.");
    return;
  }

  const bonus = Math.round(Number(state.publicConfig.referral_bonus_fire || 500));
  const inviteUrl = buildInviteUrl(state.user.telegram_id);
  const text = `Залетай в EasyMarket. После первой ставки мне дадут ${formatFire(bonus)}.`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    if (awardShareTask) {
      await claimShareTask();
    } else {
      showToast(`+${formatFire(bonus)} после первой ставки друга.`);
    }
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "EasyMarket",
        text,
        url: inviteUrl,
      });
      if (awardShareTask) {
        await claimShareTask();
      }
      return;
    }
  } catch {
    // Fall through to Telegram share link.
  }

  window.open(shareUrl, "_blank", "noopener,noreferrer");
  if (awardShareTask) {
    await claimShareTask();
  } else {
    showToast(`+${formatFire(bonus)} после первой ставки друга.`);
  }
}

async function submitMarketComment() {
  const market = getDisplayMarket();
  const input = $("marketChatInput");
  const message = String(input?.value || "").trim();
  if (!state.user?.telegram_id || !market?.id || !message || state.commentPending) {
    triggerHaptic("warning");
    return;
  }

  state.commentPending = true;
  const submitButton = $("marketChatForm")?.querySelector("button");
  if (submitButton) {
    submitButton.disabled = true;
  }
  try {
    const result = await api(`/api/market/${market.id}/comments`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        message,
      }),
    });
    input.value = "";
    state.comments = [result.comment, ...state.comments].slice(0, 30);
    state.commentsMarketId = market.id;
    triggerHaptic("success");
    renderComments();
  } catch (error) {
    triggerHaptic("error");
    showToast(error.message === "comment_required" ? "Напиши текст." : "Комментарий не отправился.");
  } finally {
    state.commentPending = false;
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

function setTasksSheetOpen(open) {
  const sheet = $("tasksSheet");
  if (!sheet) return;
  if (open) {
    renderTaskRewards();
    renderTaskTabs();
    renderTaskStats();
  }
  sheet.classList.toggle("hidden", !open);
}

function setLeaderboardSheetOpen(open) {
  const sheet = $("leaderboardSheet");
  if (!sheet) return;
  sheet.classList.toggle("hidden", !open);
}

$("tasksBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  renderTaskRewards();
  renderTaskStats();
  setTasksSheetOpen(true);
});

document.querySelectorAll("[data-task-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    triggerHaptic("selection");
    state.taskTab = button.dataset.taskTab === "stats" ? "stats" : "tasks";
    renderTaskTabs();
    renderTaskStats();
  });
});

$("tasksCloseBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  setTasksSheetOpen(false);
});

$("tasksSheet").addEventListener("click", (event) => {
  if (event.target === $("tasksSheet")) {
    setTasksSheetOpen(false);
  }
});

$("taskChannelBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  openTelegramUrl(state.publicConfig.av_channel_url || "https://t.me/erc20coin");
  showToast("После подписки AV-бот проверит канал и начислит звезды.");
});

$("taskChatBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  openTelegramUrl(state.publicConfig.av_chat_url || "https://t.me/thedaomaker");
  showToast("После вступления AV-бот проверит чат и начислит звезды.");
});

$("taskPrivateChatBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  openTelegramUrl(state.publicConfig.private_chat_url || state.publicConfig.av_bot_url);
  showToast(`После подписки на приватку AV-бот начислит аванс ${formatFire(Number(state.publicConfig.task_private_chat_fire || 15000))}.`);
});

$("taskShareBtn").addEventListener("click", () => {
  void shareInvite({ awardShareTask: true });
});

$("taskDailyPresenceBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  void claimDailyPresenceTask();
});

$("openTelegramAppBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  window.location.href = state.publicConfig.mini_app_url || "https://t.me/voit_help_bot?startapp=easymarket";
});

$("marketChatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitMarketComment();
});

$("btcMarketsBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setBtcMarketsSheetOpen(true);
  void loadBtcMarkets().catch(() => showToast("BTC markets пока не загрузились."));
});

$("btcMarketsCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setBtcMarketsSheetOpen(false);
});

$("btcMarketsSheet")?.addEventListener("click", (event) => {
  if (event.target === $("btcMarketsSheet")) {
    setBtcMarketsSheetOpen(false);
  }
});

$("btcMarketsList")?.addEventListener("click", (event) => {
  const buyButton = event.target.closest("[data-btc-buy]");
  if (buyButton) {
    event.preventDefault();
    event.stopPropagation();
    const market = state.btcMarkets.find((item) => item.id === Number(buyButton.dataset.btcBuy));
    if (market) {
      triggerHaptic("selection");
      openBetSheet(market, buyButton.dataset.side || "YES");
    }
    return;
  }

  const openButton = event.target.closest("[data-btc-open]");
  if (openButton) {
    triggerHaptic("selection");
    selectBtcMarket(openButton.dataset.btcOpen);
  }
});

$("worldCupBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setWorldCupSheetOpen(true);
  void loadWorldCupMarkets().catch(() => showToast("World Cup markets пока не загрузились."));
});

$("worldCupCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setWorldCupSheetOpen(false);
});

$("worldCupSheet")?.addEventListener("click", (event) => {
  if (event.target === $("worldCupSheet")) {
    setWorldCupSheetOpen(false);
  }
});

$("worldCupList")?.addEventListener("click", (event) => {
  const buyButton = event.target.closest("[data-world-cup-buy]");
  if (buyButton) {
    event.preventDefault();
    event.stopPropagation();
    const market = state.worldCupMarkets.find((item) => item.id === Number(buyButton.dataset.worldCupBuy));
    if (market) {
      triggerHaptic("selection");
      openBetSheet(market, buyButton.dataset.side || "YES");
    }
    return;
  }

  const openButton = event.target.closest("[data-world-cup-open]");
  if (openButton) {
    triggerHaptic("selection");
    selectWorldCupMarket(openButton.dataset.worldCupOpen);
  }
});

$("betCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeBetSheet();
});

$("betSheet")?.addEventListener("click", (event) => {
  if (event.target === $("betSheet")) {
    closeBetSheet();
  }
});

$("betSideYesBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.betSheet.side = "YES";
  renderBetSheet();
});

$("betSideNoBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.betSheet.side = "NO";
  renderBetSheet();
});

document.querySelectorAll("[data-bet-add]").forEach((button) => {
  button.addEventListener("click", () => {
    button.blur();
    triggerHaptic("selection");
    const addAmount = Number(button.dataset.betAdd || 0);
    const nextAmount = state.betSheet.amount + addAmount;
    const activeBalance = getActiveBalance();
    if (nextAmount > Number(activeBalance || 0)) {
      const missing = Math.max(1, Math.ceil(nextAmount - Number(activeBalance || 0)));
      triggerHaptic("warning");
      openTopupSheet(missing, `Для ставки ${formatCurrencyAmount(nextAmount, state.currency)} не хватает ${formatCurrencyAmount(missing, state.currency)}.`);
      return;
    }
    state.betSheet.amount = nextAmount;
    renderBetSheet();
  });
});

$("betConfirmBtn")?.addEventListener("click", async () => {
  $("betConfirmBtn")?.blur();
  const { market, side, amount } = state.betSheet;
  if (!market || !amount) {
    triggerHaptic("warning");
    return;
  }
  if (isBtcMarket(market)) {
    state.selectedBtcMarketId = market.id === state.market?.id ? null : market.id;
    state.selectedWorldCupMarketId = null;
  } else {
    state.selectedWorldCupMarketId = market.id;
    state.selectedBtcMarketId = null;
  }
  state.selectedSide = side;
  state.selectedAmount = amount;
  closeBetSheet();
  await buy(amount);
  scheduleCoreRefresh({ delay: 120, includeComments: true });
});

let touchStartX = null;
let touchStartY = null;
document.querySelector(".market-card")?.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  touchStartX = touch?.clientX ?? null;
  touchStartY = touch?.clientY ?? null;
}, { passive: true });

document.querySelector(".market-card")?.addEventListener("touchend", (event) => {
  if (touchStartX === null || touchStartY === null || (!state.worldCupMarkets.length && !state.btcMarkets.length)) {
    return;
  }
  const touch = event.changedTouches[0];
  const dx = (touch?.clientX ?? touchStartX) - touchStartX;
  const dy = (touch?.clientY ?? touchStartY) - touchStartY;
  touchStartX = null;
  touchStartY = null;
  if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.3) {
    return;
  }

  const markets = [
    { type: "home", id: null },
    ...state.btcMarkets
      .filter((market) => market.id !== state.market?.id)
      .map((market) => ({ type: "btc", id: market.id })),
    ...state.worldCupMarkets.map((market) => ({ type: "world", id: market.id })),
  ];
  const currentKey = state.selectedWorldCupMarketId
    ? `world:${state.selectedWorldCupMarketId}`
    : state.selectedBtcMarketId
      ? `btc:${state.selectedBtcMarketId}`
      : "home:null";
  const currentIndex = Math.max(0, markets.findIndex((market) => `${market.type}:${market.id}` === currentKey));
  const nextIndex = dx < 0
    ? Math.min(markets.length - 1, currentIndex + 1)
    : Math.max(0, currentIndex - 1);
  const nextMarket = markets[nextIndex];
  state.selectedWorldCupMarketId = nextMarket.type === "world" ? nextMarket.id : null;
  state.selectedBtcMarketId = nextMarket.type === "btc" ? nextMarket.id : null;
  state.smoothedPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  triggerHaptic("selection");
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}, { passive: true });

document.addEventListener("click", (event) => {
  const button = event.target.closest(".sell-button");
  if (!button) {
    return;
  }

  event.preventDefault();
  if (button.dataset.sellLocked === "1") {
    triggerHaptic("warning");
    showToast(button.dataset.lockMessage || "Эта позиция уже не продаётся.");
    scheduleCoreRefresh({ delay: 80, includeLists: false });
    return;
  }

  void sellPosition({
    side: button.dataset.side,
    positionId: Number(button.dataset.positionId),
    marketId: Number(button.dataset.marketId),
    shares: Number(button.dataset.shares),
  });
});

setInterval(updateTimer, 250);
setInterval(updatePresenceTaskButton, 1_000);
setInterval(renderMarketChart, CHART_RENDER_INTERVAL_MS);
setInterval(() => {
  void runSingleFlight("market", loadMarket).catch(() => setConnection("Ошибка", "error"));
}, ACTIVE_MARKET_POLL_MS);
setInterval(() => {
  void runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined);
}, MARKET_LIST_POLL_MS);
setInterval(() => {
  void runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined);
}, MARKET_LIST_POLL_MS);
setInterval(() => maybeLoadComments(true), COMMENTS_POLL_MS);
setInterval(() => {
  void runSingleFlight("activity", loadActivity).catch(() => undefined);
}, 4_000);
setInterval(() => {
  void runSingleFlight("me", loadMe).catch(() => undefined);
}, 3_500);
setInterval(() => {
  void runSingleFlight("recentMarkets", loadRecentMarkets).catch(() => undefined);
}, 12_000);

window.addEventListener("resize", () => {
  state.chartYMin = null;
  state.chartYMax = null;
  renderMarketChart();
});

getAmountsForCurrency().forEach((amount, index) => {
  const button = document.querySelector(`.amount-button[data-amount="${amount}"]`);
  if (button && index === 0) {
    button.classList.add("active");
  }
});

loadPublicConfig()
  .then(upsertMe)
  .then((authorized) => {
    if (!authorized) {
      return null;
    }
    return loadBtcMarkets()
      .catch(() => undefined)
      .then(() => loadWorldCupMarkets().catch(() => undefined))
      .then(refreshAll);
  })
  .catch((error) => {
    setConnection("Ошибка входа", "error");
    $("authCard").classList.remove("hidden");
    showToast(error.message || "Не удалось создать пользователя.");
  });
