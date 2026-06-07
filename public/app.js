const state = {
  user: null,
  market: null,
  balance: 0,
  positions: [],
  recentMarkets: [],
  chartPoints: [],
};

const $ = (id) => document.getElementById(id);

const formatFire = (value) => Math.floor(Number(value || 0)).toLocaleString("ru-RU");
const formatPrice = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 2,
});
const formatOdds = (value) => `${Math.round(Number(value || 0) * 100)}%`;

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

async function loadMarket() {
  const data = await api("/api/market/active");
  state.market = data.market;
  if (state.market?.current_price) {
    state.chartPoints.push({
      price: Number(state.market.current_price),
      yes: Number(state.market.yes_price),
      at: Date.now(),
    });
    state.chartPoints = state.chartPoints.slice(-90);
  }
  renderMarket();
  drawChart();
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

function renderMarket() {
  const market = state.market;
  const hasMarket = Boolean(market);
  $("marketStatus").textContent = market?.status || "нет рынка";
  $("marketQuestion").textContent = market?.question || "Рынок пока не создан.";
  $("openPrice").textContent = hasMarket ? `$${formatPrice(market.open_price)}` : "-";
  $("currentPrice").textContent = hasMarket ? `$${formatPrice(market.current_price || market.open_price)}` : "-";
  $("yesProbability").textContent = hasMarket ? formatOdds(market.yes_price) : "50%";
  $("noProbability").textContent = hasMarket ? formatOdds(market.no_price) : "50%";
  $("yesPrice").textContent = hasMarket ? Number(market.yes_price).toFixed(2) : "0.50";
  $("noPrice").textContent = hasMarket ? Number(market.no_price).toFixed(2) : "0.50";
  $("yesVolume").textContent = hasMarket ? formatFire(market.yes_volume) : "0";
  $("noVolume").textContent = hasMarket ? formatFire(market.no_volume) : "0";

  updateTimer();
  document.querySelectorAll(".buy-button").forEach((button) => {
    button.disabled = !hasMarket || !state.user;
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
  $("fireBalance").textContent = formatFire(state.balance);

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
    const pnl = payout - Number(position.spent || 0);
    return `
      <div class="mini-row">
        <div>
          <strong class="side-${position.side}">${position.side} shares: ${payout.toFixed(2)}</strong>
          <br />
          <small>Avg: ${Number(position.avg_price).toFixed(3)} · Spent: ${formatFire(position.spent)} FIRE</small>
        </div>
        <div>
          <strong>${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</strong>
          <br />
          <small>если ${position.side}</small>
        </div>
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

  container.innerHTML = state.recentMarkets.slice(0, 5).map((market) => `
    <div class="mini-row">
      <div>
        <strong>${market.winner || market.status}</strong>
        <br />
        <small>Open $${formatPrice(market.open_price)} → Close $${formatPrice(market.close_price)}</small>
      </div>
      <small>${new Date(market.resolved_at || market.end_time).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })}</small>
    </div>
  `).join("");
}

function drawChart() {
  const canvas = $("marketChart");
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);

  context.fillStyle = "#080d18";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(148, 163, 184, 0.12)";
  context.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    const y = (height / 4) * i;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  const points = state.chartPoints;
  if (points.length < 2) {
    return;
  }

  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(1, max - min);

  context.strokeStyle = "#60a5fa";
  context.lineWidth = 3;
  context.beginPath();
  points.forEach((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.price - min) / range) * (height - 24) - 12;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();

  context.strokeStyle = "#20d47b";
  context.lineWidth = 2;
  context.beginPath();
  points.forEach((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - point.yes * (height - 24) - 12;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
}

async function buy(side, amount) {
  if (!state.user || !state.market) {
    showToast("Сначала нужен пользователь и активный рынок.");
    return;
  }

  try {
    await api(`/api/market/${state.market.id}/buy`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        side,
        amount,
      }),
    });
    showToast(`Куплено ${side} на ${amount} FIRE`);
    await Promise.all([loadMarket(), loadMe()]);
  } catch (error) {
    showToast(error.message === "insufficient_fire" ? "Не хватает FIRE." : "Покупка не прошла.");
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

document.querySelectorAll(".buy-button").forEach((button) => {
  button.addEventListener("click", () => {
    void buy(button.dataset.side, Number(button.dataset.amount));
  });
});

$("refreshBtn").addEventListener("click", () => {
  void refreshAll();
});

setInterval(updateTimer, 500);
setInterval(() => void loadMarket().catch(() => setConnection("Ошибка", "error")), 1_000);
setInterval(() => void loadMe().catch(() => undefined), 5_000);
setInterval(() => void loadRecentMarkets().catch(() => undefined), 10_000);

upsertMe()
  .then(refreshAll)
  .catch((error) => {
    setConnection("Ошибка входа", "error");
    $("authCard").classList.remove("hidden");
    showToast(error.message || "Не удалось создать пользователя.");
  });
