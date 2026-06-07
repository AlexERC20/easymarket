const FEE_RATE = 0.02;
const AMOUNTS = [5, 10, 50, 100];

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
  selectedAmount: 5,
  activityLoaded: false,
  seenActivityIds: new Set(),
  pendingBuy: false,
  pendingSellSide: null,
  chart: null,
  priceSeries: null,
  openPriceSeries: null,
};

const $ = (id) => document.getElementById(id);

const formatFire = (value) => Math.floor(Number(value || 0)).toLocaleString("ru-RU");
const formatFireDecimal = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 1,
});
const formatPrice = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});
const formatPercent = (value) => `${Math.round(Number(value || 0))}%`;
const formatCents = (value) => `${Math.round(Number(value || 0) * 100)}¢`;
const sideLabel = (side) => (side === "YES" ? "UP" : "DOWN");
const sideClass = (side) => (side === "YES" ? "yes" : "no");
const actionLabel = (action) => (action === "SELL" ? "продал" : "купил");

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

function initMarketChart() {
  if (state.chart || !window.LightweightCharts) {
    return;
  }

  const container = $("marketChart");
  state.chart = window.LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    autoSize: true,
    layout: {
      background: { color: "#080d16" },
      textColor: "#8d98aa",
      fontFamily: "Inter, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.035)" },
      horzLines: { color: "rgba(255,255,255,0.055)" },
    },
    crosshair: {
      mode: window.LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "rgba(255,255,255,0.18)" },
      horzLine: { color: "rgba(255,255,255,0.18)" },
    },
    rightPriceScale: {
      borderColor: "rgba(255,255,255,0.08)",
      scaleMargins: {
        top: 0.18,
        bottom: 0.18,
      },
    },
    timeScale: {
      borderColor: "rgba(255,255,255,0.08)",
      timeVisible: true,
      secondsVisible: true,
      rightOffset: 4,
      barSpacing: 7,
      fixLeftEdge: false,
      fixRightEdge: false,
    },
    handleScale: {
      axisPressedMouseMove: false,
      mouseWheel: false,
      pinch: true,
    },
    handleScroll: {
      horzTouchDrag: true,
      vertTouchDrag: false,
      mouseWheel: false,
      pressedMouseMove: true,
    },
  });

  state.priceSeries = state.chart.addLineSeries({
    color: "#19c37d",
    lineWidth: 3,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });

  state.openPriceSeries = state.chart.addLineSeries({
    color: "rgba(255,255,255,0.34)",
    lineWidth: 1,
    lineStyle: window.LightweightCharts.LineStyle.Dashed,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
}

function renderMarketChart() {
  initMarketChart();
  if (!state.chart || !state.priceSeries || !state.openPriceSeries || !state.market) {
    return;
  }

  const points = state.chartPoints
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at))
    .map((point) => ({
      time: Math.floor(point.at / 1000),
      value: point.price,
    }));

  const deduped = [];
  for (const point of points) {
    if (deduped.length && deduped[deduped.length - 1].time >= point.time) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }

  if (deduped.length < 2) {
    state.priceSeries.setData([]);
    state.openPriceSeries.setData([]);
    return;
  }

  const openPrice = Number(state.market.open_price || deduped[0].value);
  const latest = deduped[deduped.length - 1];
  const lineColor = latest.value >= openPrice ? "#19c37d" : "#ef466f";
  state.priceSeries.applyOptions({ color: lineColor });
  state.priceSeries.setData(deduped);
  state.openPriceSeries.setData([
    { time: deduped[0].time, value: openPrice },
    { time: latest.time, value: openPrice },
  ]);

  const leftPadding = Math.max(6, Math.ceil(deduped.length * 0.15));
  state.chart.timeScale().setVisibleLogicalRange({
    from: -leftPadding,
    to: deduped.length + 5,
  });
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

function setConnection(status, type = "") {
  const element = $("connectionStatus");
  element.textContent = status;
  element.classList.remove("online", "error");
  if (type) {
    element.classList.add(type);
  }
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
  if (tg) {
    tg.ready();
    tg.expand();
    const user = tg.initDataUnsafe?.user || parseTelegramInitDataUser(tg.initData);
    const normalizedUser = normalizeTelegramUser(user, "telegram");
    if (normalizedUser) {
      return normalizedUser;
    }
  }

  const params = new URLSearchParams(window.location.search);
  const telegramId = params.get("telegram_id");
  if (telegramId) {
    return {
      telegram_id: telegramId,
      username: params.get("username"),
      first_name: params.get("first_name"),
      auth_source: "dev",
    };
  }

  return null;
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
    throw new Error(data.message || data.status || "request_failed");
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
  const safePrice = Math.max(0.05, price || 0.5);
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
  const movePct = openPrice > 0 ? ((currentPrice - openPrice) / openPrice) * 100 : 0;
  const yes = Number(market?.yes_price || 0.5);
  const no = Number(market?.no_price || 0.5);
  const yesVolume = Number(market?.yes_volume || 0);
  const noVolume = Number(market?.no_volume || 0);
  const volumeTotal = Math.max(1, yesVolume + noVolume);
  const yesDepth = Math.max(6, Math.min(94, (yesVolume / volumeTotal) * 100));

  $("marketStatus").textContent = market?.status || "нет рынка";
  $("marketQuestion").textContent = hasMarket ? "BTC закроется выше цены открытия?" : "Рынок пока не создан.";
  animateText($("openPrice"), openPrice, (value) => `$${formatPrice(value)}`);
  animateText($("currentPrice"), currentPrice, (value) => `$${formatPrice(value)}`);

  const moveElement = $("priceMove");
  moveElement.classList.toggle("positive", movePct >= 0);
  moveElement.classList.toggle("negative", movePct < 0);
  animateText(moveElement, movePct, (value) => `${value >= 0 ? "+" : ""}${value.toFixed(3)}%`);

  animateText($("yesProbability"), yes * 100, formatPercent);
  animateText($("noProbability"), no * 100, formatPercent);
  $("yesPrice").textContent = formatCents(yes);
  $("noPrice").textContent = formatCents(no);
  animateText($("yesVolume"), yesVolume, formatFire);
  animateText($("noVolume"), noVolume, formatFire);
  $("depthYesBar").parentElement.style.setProperty("--yes-depth", `${yesDepth}%`);

  updateTimer();
  document.querySelectorAll(".outcome-button, .amount-button, #placeBetBtn").forEach((button) => {
    button.disabled = !hasMarket || !state.user || state.pendingBuy;
  });
}

function updateTimer() {
  const market = state.market;
  if (!market?.end_time) {
    $("timeLeft").textContent = "--:--";
    return;
  }

  const remainingMs = new Date(market.end_time).getTime() - Date.now();
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  $("timeLeft").textContent = `${minutesPart}:${secondsPart}`;
}

function renderMe() {
  animateText($("fireBalance"), state.balance, formatFire);

  const activeMarketId = state.market?.id;
  const positions = state.positions.filter((position) => (
    position.market_id === activeMarketId && position.status === "open"
  ));

  const container = $("positionList");
  if (!positions.length) {
    container.innerHTML = '<p class="muted">Позиции пока нет.</p>';
    return;
  }

  container.innerHTML = positions.map((position) => {
    const payout = Number(position.shares || 0);
    const spent = Number(position.spent || 0);
    const marketPrice = Number(position.side === "YES" ? state.market?.yes_price : state.market?.no_price) || 0;
    const exitValue = payout * marketPrice * (1 - FEE_RATE);
    const pnl = exitValue - spent;
    const isSelling = state.pendingSellSide === position.side;
    return `
      <div class="mini-row">
        <div>
          <strong class="side-${position.side}">${sideLabel(position.side)} ${payout.toFixed(2)} shares</strong>
          <br />
          <small>Avg ${formatCents(position.avg_price)} · Sell ${formatCents(marketPrice)} · Spent ${formatFire(spent)}</small>
        </div>
        <div class="position-actions">
          <strong class="${pnl >= 0 ? "positive" : "negative"}">${pnl >= 0 ? "+" : ""}${formatFireDecimal(pnl)}</strong>
          <button
            class="sell-button ${sideClass(position.side)}"
            data-side="${position.side}"
            type="button"
            ${isSelling ? "disabled" : ""}
          >
            ${isSelling ? "Продаю..." : `Продать ${formatFireDecimal(exitValue)}`}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function renderTradeTicket() {
  const side = state.selectedSide;
  const price = getSelectedPrice();
  const preview = getPreview();
  const isYes = side === "YES";

  document.querySelectorAll(".outcome-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.side === side);
  });
  document.querySelectorAll(".amount-button").forEach((button) => {
    const amount = Number(button.dataset.amount);
    const amountPreview = getPreview(amount, side);
    button.classList.toggle("active", amount === state.selectedAmount);
    button.innerHTML = `
      <strong>${amount} FIRE</strong>
      <small>+${formatFireDecimal(amountPreview.profit)}</small>
    `;
  });

  $("ticketTitle").textContent = `Купить ${sideLabel(side)}`;
  $("ticketPrice").textContent = formatCents(price);
  $("sharesPreview").textContent = `${preview.shares.toFixed(2)} shares`;
  $("profitPreview").textContent = `${preview.profit >= 0 ? "+" : ""}${formatFireDecimal(preview.profit)} FIRE`;
  $("profitPreview").classList.toggle("positive", preview.profit >= 0);
  $("profitPreview").classList.toggle("negative", preview.profit < 0);

  const placeButton = $("placeBetBtn");
  placeButton.textContent = `Купить ${sideLabel(side)} на ${state.selectedAmount} FIRE`;
  placeButton.classList.toggle("yes", isYes);
  placeButton.classList.toggle("no", !isYes);
  placeButton.disabled = !state.market || !state.user || state.pendingBuy;
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

async function buy() {
  if (!state.user || !state.market || state.pendingBuy) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь и активный рынок.");
    return;
  }

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
    showToast(`Куплено ${sideLabel(state.selectedSide)} на ${state.selectedAmount} FIRE`);
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

async function sellPosition(side) {
  if (!state.user || !state.market || state.pendingSellSide) {
    triggerHaptic("warning");
    showToast("Нет активной позиции для продажи.");
    return;
  }

  triggerHaptic("medium");
  state.pendingSellSide = side;
  renderMe();
  try {
    const result = await api(`/api/market/${state.market.id}/sell`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
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
    showToast(error.message === "position_not_open" ? "Открытой позиции нет." : "Продажа не прошла.");
  } finally {
    state.pendingSellSide = null;
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
    triggerHaptic("selection");
    state.selectedAmount = Number(button.dataset.amount);
    renderTradeTicket();
  });
});

$("placeBetBtn").addEventListener("click", () => {
  void buy();
});

$("refreshBtn").addEventListener("click", () => {
  triggerHaptic("light");
  void refreshAll();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest(".sell-button");
  if (!button) {
    return;
  }

  void sellPosition(button.dataset.side);
});

setInterval(updateTimer, 250);
setInterval(() => void loadMarket().catch(() => setConnection("Ошибка", "error")), 1_000);
setInterval(() => void loadMe().catch(() => undefined), 3_000);
setInterval(() => void loadRecentMarkets().catch(() => undefined), 10_000);

window.addEventListener("resize", renderMarketChart);

AMOUNTS.forEach((amount, index) => {
  const button = document.querySelector(`.amount-button[data-amount="${amount}"]`);
  if (button && index === 0) {
    button.classList.add("active");
  }
});

upsertMe()
  .then(refreshAll)
  .catch((error) => {
    setConnection("Ошибка входа", "error");
    $("authCard").classList.remove("hidden");
    showToast(error.message || "Не удалось создать пользователя.");
  });
