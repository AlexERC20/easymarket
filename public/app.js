const FEE_RATE = 0.02;
const AMOUNTS = [50, 100, 500, 1000];
const MIN_OUTCOME_PRICE = 0.001;
const CHART_WINDOW_MS = 10_000;
const CHART_RENDER_INTERVAL_MS = 333;

const state = {
  user: null,
  market: null,
  balance: 0,
  positions: [],
  recentTrades: [],
  recentMarkets: [],
  activity: [],
  chartPoints: [],
  selectedSide: "YES",
  selectedAmount: 50,
  activityLoaded: false,
  seenActivityIds: new Set(),
  pendingBuy: false,
  pendingSellSide: null,
  pendingSellPositionId: null,
  publicConfig: {
    av_bot_url: "https://t.me/voit_help_bot?start=buy_fire",
    mini_app_url: "https://t.me/voit_help_bot?startapp=easymarket",
    referral_bonus_fire: 100,
  },
  chartRaf: null,
  smoothedPrice: null,
  chartYMin: null,
  chartYMax: null,
};

const $ = (id) => document.getElementById(id);

const formatFire = (value) => Math.floor(Number(value || 0)).toLocaleString("ru-RU");
const formatFireDecimal = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 1,
});
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
const sideClass = (side) => (side === "YES" ? "yes" : "no");
const actionLabel = (action) => (action === "SELL" ? "продал" : "купил");
const marketStatusLabel = (status) => {
  if (status === "open") {
    return "LIVE";
  }
  if (status === "resolved") {
    return "CLOSED";
  }
  return status || "нет рынка";
};

function triggerHaptic(type = "light") {
  const haptic = window.Telegram?.WebApp?.HapticFeedback;
  try {
    if (type === "selection") {
      haptic?.selectionChanged?.();
    } else if (type === "success" || type === "error" || type === "warning") {
      haptic?.notificationOccurred?.(type);
    } else {
      haptic?.impactOccurred?.(type);
    }
  } catch {
    // Haptic feedback is best-effort and must never block trading UI.
  }

  if (!haptic && "vibrate" in navigator) {
    const pattern = type === "success"
      ? [12, 28, 18]
      : type === "error"
        ? [35, 30, 35]
        : type === "selection"
          ? 8
          : 16;
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

function drawMarketChartFrame() {
  const canvas = $("marketChart");
  if (!(canvas instanceof HTMLCanvasElement) || !state.market) {
    state.chartRaf = null;
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    state.chartRaf = null;
    return;
  }

  const { width, height } = resizeCanvas(canvas);
  const openPrice = Number(state.market.open_price || 0);
  const currentPrice = Number(state.market.current_price || openPrice || 0);
  if (!state.smoothedPrice || Math.abs(state.smoothedPrice - currentPrice) > Math.max(250, currentPrice * 0.015)) {
    state.smoothedPrice = currentPrice;
  } else {
    state.smoothedPrice += (currentPrice - state.smoothedPrice) * 0.045;
  }

  const endTime = new Date(state.market.end_time).getTime();
  const nowMs = Date.now();
  const windowEnd = Math.min(endTime, nowMs);
  const windowStart = Math.max(new Date(state.market.start_time).getTime(), windowEnd - CHART_WINDOW_MS);
  const duration = Math.max(1, windowEnd - windowStart);
  const rawPoints = state.chartPoints
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at))
    .filter((point) => point.at >= windowStart - 1_500 && point.at <= windowEnd + 1_500)
    .map((point) => ({ ...point }));

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
  const padding = Math.max(4, (maxPrice - minPrice) * 0.42);
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
  ctx.fillStyle = "#080d16";
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
  const targetLabel = `TARGET ${targetAbove ? "↑" : "↓"}`;
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

    const currentLabel = `$${formatPrice(state.smoothedPrice || currentPrice)}`;
    ctx.font = `${Math.max(12, width * 0.034)}px Inter, system-ui, sans-serif`;
    const currentTextWidth = ctx.measureText(currentLabel).width + 18;
    const labelX = Math.min(width - currentTextWidth - 8, latest.x + 12);
    const labelY = Math.max(top + 4, Math.min(bottom - 28, latest.y - 14));
    ctx.fillStyle = isUp ? "rgba(25,195,125,0.16)" : "rgba(239,70,111,0.16)";
    ctx.strokeStyle = isUp ? "rgba(25,195,125,0.52)" : "rgba(239,70,111,0.52)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    roundedRectPath(ctx, labelX, labelY, currentTextWidth, 28, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isUp ? "#19c37d" : "#ef466f";
    ctx.textBaseline = "middle";
    ctx.fillText(currentLabel, labelX + 9, labelY + 14);
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

  const startedAt = performance.now();
  const delta = numericValue - previousValue;

  function step(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = previousValue + delta * eased;
    element.textContent = formatter(current);
    if (progress < 1) {
      requestAnimationFrame(step);
      return;
    }

    element.dataset.value = String(numericValue);
    element.textContent = formatter(numericValue);
  }

  requestAnimationFrame(step);
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
  } catch {
    // The UI can still work with local fallback config.
  }
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

async function upsertMe() {
  const user = getTelegramUser();
  if (!user) {
    $("authCard").classList.remove("hidden");
    $("authDebug").textContent = getTelegramDebugInfo();
    setConnection("Нет пользователя", "error");
    return;
  }

  const data = await api("/api/me/upsert", {
    method: "POST",
    body: JSON.stringify(user),
  });
  state.user = data.user;
  state.balance = data.balance || 0;
  state.positions = data.positions || [];
  $("authCard").classList.add("hidden");
  setConnection("Online", "online");
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

async function loadMarket() {
  const data = await api("/api/market/active");
  state.market = data.market;
  state.chartPoints = mergeChartPoints(data.chart, data.market);
  handleActivity(data.activity || []);
  renderMarket();
  renderTradeTicket();
  renderActivity();
  renderMarketChart();
}

async function loadMe() {
  if (!state.user?.telegram_id) {
    return;
  }

  const data = await api(`/api/me?telegram_id=${encodeURIComponent(state.user.telegram_id)}`);
  state.balance = data.balance || 0;
  state.positions = data.positions || [];
  state.recentTrades = data.recent_trades || [];
  renderMe();
}

async function loadRecentMarkets() {
  const data = await api("/api/markets/recent");
  state.recentMarkets = data.markets || [];
  renderRecentMarkets();
}

function getSelectedPrice() {
  if (!state.market) {
    return 0.5;
  }

  return Number(state.selectedSide === "YES" ? state.market.yes_price : state.market.no_price) || 0.5;
}

function getPreview(amount = state.selectedAmount, side = state.selectedSide) {
  const price = state.market
    ? Number(side === "YES" ? state.market.yes_price : state.market.no_price)
    : 0.5;
  const safePrice = Math.max(MIN_OUTCOME_PRICE, price || 0.5);
  const net = Number(amount || 0) * (1 - FEE_RATE);
  const shares = net / safePrice;
  const profit = shares - Number(amount || 0);

  return {
    shares,
    profit,
    price: safePrice,
  };
}

function renderMarket() {
  const market = state.market;
  const hasMarket = Boolean(market);
  const currentPrice = Number(market?.current_price || market?.open_price || 0);
  const openPrice = Number(market?.open_price || 0);
  const priceMove = currentPrice - openPrice;
  const yes = Number(market?.yes_price || 0.5);
  const no = Number(market?.no_price || 0.5);
  const yesVolume = Number(market?.yes_volume || 0);
  const noVolume = Number(market?.no_volume || 0);
  const volumeTotal = Math.max(1, yesVolume + noVolume);
  const yesDepth = Math.max(6, Math.min(94, (yesVolume / volumeTotal) * 100));

  const marketStatus = $("marketStatus");
  marketStatus.textContent = marketStatusLabel(market?.status);
  marketStatus.classList.toggle("live", market?.status === "open");
  const marketQuestion = $("marketQuestion");
  if (marketQuestion) {
    marketQuestion.textContent = hasMarket ? "" : "Рынок пока не создан.";
  }
  $("marketWindow").textContent = hasMarket ? formatMarketWindow(market) : "--";
  animateText($("openPrice"), openPrice, (value) => `$${formatPrice(value)}`);
  animateText($("currentPrice"), currentPrice, (value) => `$${formatPrice(value)}`);

  const moveElement = $("priceMove");
  moveElement.classList.toggle("positive", priceMove >= 0);
  moveElement.classList.toggle("negative", priceMove < 0);
  animateText(moveElement, priceMove, (value) => `${value >= 0 ? "▲" : "▼"} $${formatPrice(Math.abs(value))}`);

  $("yesOptionText").textContent = `Up ${formatCents(yes)}`;
  $("noOptionText").textContent = `Down ${formatCents(no)}`;
  animateText($("yesVolume"), yesVolume, formatFire);
  animateText($("noVolume"), noVolume, formatFire);
  $("depthYesBar").parentElement.style.setProperty("--yes-depth", `${yesDepth}%`);

  updateTimer();
  document.querySelectorAll(".outcome-button, .amount-button").forEach((button) => {
    button.disabled = !hasMarket || !state.user || state.pendingBuy;
  });
}

function updateTimer() {
  const market = state.market;
  if (!market?.end_time) {
    $("timeLeftMinutes").textContent = "--";
    $("timeLeftSeconds").textContent = "--";
    return;
  }

  const remainingMs = new Date(market.end_time).getTime() - Date.now();
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  $("timeLeftMinutes").textContent = minutesPart;
  $("timeLeftSeconds").textContent = secondsPart;
}

function renderMe() {
  animateText($("fireBalance"), state.balance, formatFire);

  const positions = state.positions.filter((position) => position.status === "open");

  const container = $("positionList");
  if (!positions.length) {
    container.innerHTML = '<p class="muted">Позиции пока нет.</p>';
    return;
  }

  container.innerHTML = positions.map((position) => {
    const payout = Number(position.shares || 0);
    const spent = Number(position.spent || 0);
    const isActiveMarket = position.market_id === state.market?.id;
    const positionMarketPrice = Number(position.side === "YES" ? position.yes_price : position.no_price);
    const liveMarketPrice = Number(position.side === "YES" ? state.market?.yes_price : state.market?.no_price);
    const marketPrice = (isActiveMarket ? liveMarketPrice : positionMarketPrice) || 0;
    const exitValue = payout * marketPrice * (1 - FEE_RATE);
    const pnl = exitValue - spent;
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
    return `
      <div class="mini-row">
        <div>
          <strong class="side-${position.side}">${sideLabel(position.side)} ${payout.toFixed(2)} shares</strong>
          <br />
          <small>Avg ${formatCents(position.avg_price)} · Sell ${formatCents(marketPrice)} · Spent ${formatFire(spent)}${marketBadge}</small>
        </div>
        <div class="position-actions">
          <strong class="${pnl >= 0 ? "positive" : "negative"}">${pnl >= 0 ? "+" : ""}${formatFireDecimal(pnl)}</strong>
          <button
            class="sell-button ${sideClass(position.side)}"
            data-side="${position.side}"
            data-position-id="${position.id}"
            data-market-id="${position.market_id}"
            data-sell-locked="${canSell ? "0" : "1"}"
            data-lock-message="${sellLockMessage}"
            type="button"
            ${isSelling || !canSell ? "disabled" : ""}
          >
            ${isSelling ? "Продаю..." : canSell ? `Продать ${formatFireDecimal(exitValue)}` : "Ждём итог"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function renderTradeTicket() {
  const side = state.selectedSide;
  const price = getSelectedPrice();

  document.querySelectorAll(".outcome-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.side === side);
  });
  document.querySelectorAll(".amount-button").forEach((button) => {
    const amount = Number(button.dataset.amount);
    const amountPreview = getPreview(amount, side);
    button.classList.toggle("active", amount === state.selectedAmount);
    button.disabled = !state.market || !state.user || state.pendingBuy;
    button.innerHTML = `
      <strong>${formatFire(amount)}</strong>
      <small>win <b>${formatFireDecimal(amountPreview.shares)}</b></small>
    `;
  });

  $("ticketTitle").textContent = state.pendingBuy
    ? "Ставка отправляется..."
    : `Нажми сумму для ${sideLabel(side)}`;
  $("ticketPrice").textContent = `${sideLabel(side)} ${formatCents(price)}`;
}

function renderActivity() {
  const container = $("activityTape");
  if (!state.activity.length) {
    container.innerHTML = '<p class="muted">Пока нет ставок.</p>';
    return;
  }

  container.innerHTML = state.activity.slice(0, 8).map((trade) => {
    const name = trade.username || trade.first_name || `user ${trade.telegram_id}`;
    const action = trade.action || "BUY";
    return `
      <div class="activity-row">
        <div>
          <strong class="side-${trade.side}">${name} ${actionLabel(action)} ${sideLabel(trade.side)}</strong>
          <br />
          <small>${formatCents(trade.price)} · ${trade.shares.toFixed(2)} shares</small>
        </div>
        <strong>${formatFire(trade.amount)} FIRE</strong>
      </div>
    `;
  }).join("");
}

function renderRecentMarkets() {
  const container = $("recentMarkets");
  if (!state.recentMarkets.length) {
    container.innerHTML = '<p class="muted">Пока нет закрытых рынков.</p>';
    return;
  }

  container.innerHTML = state.recentMarkets.slice(0, 5).map((market) => {
    const winner = market.winner ? sideLabel(market.winner) : market.status;
    const move = Number(market.close_price || 0) - Number(market.open_price || 0);
    return `
      <div class="mini-row">
        <div>
          <strong class="side-${market.winner || "YES"}">${winner}</strong>
          <br />
          <small>$${formatPrice(market.open_price)} -> $${formatPrice(market.close_price)}</small>
        </div>
        <small class="${move >= 0 ? "positive" : "negative"}">${move >= 0 ? "+" : ""}${formatPrice(move)}</small>
      </div>
    `;
  }).join("");
}

function showTradeBubble(trade) {
  const container = $("tradeBubbles");
  const bubble = document.createElement("div");
  const name = trade.username || trade.first_name || "user";
  const action = trade.action || "BUY";
  bubble.className = `trade-bubble ${sideClass(trade.side)}`;
  bubble.textContent = `${name} ${actionLabel(action)} ${sideLabel(trade.side)} ${formatFire(trade.amount)}`;
  bubble.style.left = `${24 + Math.random() * 52}%`;
  container.appendChild(bubble);
  setTimeout(() => bubble.remove(), 2600);
}

async function buy(amount = state.selectedAmount) {
  if (!state.user || !state.market || state.pendingBuy) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь и активный рынок.");
    return;
  }

  state.selectedAmount = Number(amount || state.selectedAmount);
  triggerHaptic("medium");
  state.pendingBuy = true;
  renderTradeTicket();
  try {
    const result = await api(`/api/market/${state.market.id}/buy`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        side: state.selectedSide,
        amount: state.selectedAmount,
      }),
    });
    state.balance = result.balance ?? state.balance;
    state.market = result.market ?? state.market;
    triggerHaptic("success");
    await Promise.all([loadMarket(), loadMe()]);
  } catch (error) {
    triggerHaptic("error");
    showToast(error.message === "insufficient_fire" ? "Не хватает FIRE." : "Покупка не прошла.");
  } finally {
    state.pendingBuy = false;
    renderMarket();
    renderTradeTicket();
  }
}

async function sellPosition({ side, positionId, marketId }) {
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
      }),
    });
    state.balance = result.balance ?? state.balance;
    state.market = result.market ?? state.market;
    triggerHaptic("success");
    const pnl = Number(result.sale?.pnl || 0);
    showToast(`Продано ${sideLabel(side)}: ${pnl >= 0 ? "+" : ""}${formatFireDecimal(pnl)} FIRE`);
    await Promise.all([loadMarket(), loadMe()]);
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
    await Promise.all([
      loadMarket().catch(() => undefined),
      loadMe().catch(() => undefined),
    ]);
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
    await loadMe();
    await loadRecentMarkets();
    setConnection("Online", "online");
  } catch (error) {
    setConnection("Ошибка", "error");
    showToast(error.message || "Ошибка обновления.");
  }
}

document.querySelectorAll(".outcome-button").forEach((button) => {
  button.addEventListener("click", () => {
    triggerHaptic("selection");
    state.selectedSide = button.dataset.side;
    renderTradeTicket();
  });
});

document.querySelectorAll(".amount-button").forEach((button) => {
  button.addEventListener("click", () => {
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
  const url = state.publicConfig.av_bot_url || "https://t.me/voit_help_bot?start=buy_fire";
  openBotTopup(url);
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

$("inviteBtn").addEventListener("click", async () => {
  triggerHaptic("selection");
  if (!state.user?.telegram_id) {
    showToast("Сначала нужен пользователь.");
    return;
  }

  const bonus = Math.round(Number(state.publicConfig.referral_bonus_fire || 100));
  const inviteUrl = buildInviteUrl(state.user.telegram_id);
  const text = `Залетай в EasyMarket. После первой ставки мне дадут ${bonus} FIRE.`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    showToast(`+${bonus} FIRE за друга после его первой ставки. 1 раз в день.`);
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "EasyMarket",
        text,
        url: inviteUrl,
      });
      return;
    }
  } catch {
    // Fall through to Telegram share link.
  }

  window.open(shareUrl, "_blank", "noopener,noreferrer");
  showToast(`+${bonus} FIRE за друга после его первой ставки. 1 раз в день.`);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest(".sell-button");
  if (!button) {
    return;
  }

  event.preventDefault();
  if (button.dataset.sellLocked === "1") {
    triggerHaptic("warning");
    showToast(button.dataset.lockMessage || "Эта позиция уже не продаётся.");
    void Promise.all([
      loadMarket().catch(() => undefined),
      loadMe().catch(() => undefined),
    ]);
    return;
  }

  void sellPosition({
    side: button.dataset.side,
    positionId: Number(button.dataset.positionId),
    marketId: Number(button.dataset.marketId),
  });
});

setInterval(updateTimer, 250);
setInterval(renderMarketChart, CHART_RENDER_INTERVAL_MS);
setInterval(() => void loadMarket().catch(() => setConnection("Ошибка", "error")), 1_000);
setInterval(() => void loadMe().catch(() => undefined), 3_000);
setInterval(() => void loadRecentMarkets().catch(() => undefined), 10_000);

window.addEventListener("resize", () => {
  state.chartYMin = null;
  state.chartYMax = null;
  renderMarketChart();
});

AMOUNTS.forEach((amount, index) => {
  const button = document.querySelector(`.amount-button[data-amount="${amount}"]`);
  if (button && index === 0) {
    button.classList.add("active");
  }
});

loadPublicConfig()
  .then(upsertMe)
  .then(refreshAll)
  .catch((error) => {
    setConnection("Ошибка входа", "error");
    $("authCard").classList.remove("hidden");
    showToast(error.message || "Не удалось создать пользователя.");
  });
