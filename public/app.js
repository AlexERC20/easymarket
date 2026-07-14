import {
  hideLightningLoader,
  initLightningMotion,
  isMotionSoundEnabled,
  playMotionSound,
  setMotionSoundEnabled,
  showDirectionalSurge,
  showRewardPop,
  showRoundSweep,
  showSuccessLightningBurst,
  showWalletFlowBurst,
  showWinCelebration,
  triggerBalancePulse,
  triggerButtonLightning,
} from "./lightning-motion.js?v=20260707-01";
import {
  initAquarium,
  isAquariumEnabled,
  primeAquarium,
  setAquariumEnabled,
  setAquariumGoldenFish,
  setAquariumPremiumFish,
  setAquariumRuntimeAllowed,
  setAquariumShakeFeeder,
} from "./aquarium.js?v=20260712-01";
import { getActiveSceneKey, setActiveScene, setShakeSceneListener } from "./shake-scenes.js?v=20260712-01";
import "./basketball-scene.js?v=20260712-03"; // регистрирует сцену «Легенда 24»
import { playKyivstonerMotion, preloadKyivstonerMotion } from "./kyivstoner-motion.js?v=20260714-01";

const PROFIT_FEE_RATE = 0.05;
const MARKET_MAKER_SPREAD_RATE = 0.03;
const BUY_IMPACT_MULTIPLIER = 1.08;
const SELL_IMPACT_MULTIPLIER = 1.42;
const MARKET_MAKER_DENSITY_MULTIPLIER = 1.4;
const SPORTS_MARKET_MAKER_DENSITY_MULTIPLIER = 1.8;
const SPECIAL_MARKET_SPREAD_RATE = 0.01;
const SPECIAL_MARKET_MAX_SHIFT = 0.2;
const MAX_SINGLE_TRADE_SHIFT = 0.46;
const MIN_TAIL_DEPTH_FACTOR = 0.004;
const SPORTS_MIN_TAIL_DEPTH_FACTOR = 0.2;
const SPORTS_TAIL_DEPTH_EXPONENT = 1.45;
const STAR_AMOUNTS = [50, 100, 500, 1000];
const USDT_AMOUNTS = [5, 10, 25, 100];
const MIN_OUTCOME_PRICE = 0.001;
const BTC_MIN_OUTCOME_PRICE = 0.001;
const CHART_WINDOW_MS = 10_000;
const BTC_5M_CHART_HISTORY_RATIO = 0.5;
const CHART_AVATAR_RADIUS_CSS = 3.8;
const CHART_INTRO_MS = 720; // crossfade window when the chart switches markets
const CHART_FRAME_MS = 33; // ~30fps cap for the chart loop (was uncapped 60fps)
let lastChartDrawTs = 0;
let chartSnapshotCanvas = null; // offscreen copy of the previous market's frame
let chartBetLabelCache = null; // cached measureText widths for the "your bet" pill
let chartTickerLabelCache = null; // cached measureText widths for the live ticker pill
const ACTIVE_MARKET_POLL_MS = 1_500;
const MARKET_LIST_POLL_MS = 10_000;
const SPECIAL_MARKET_POLL_MS = 3_000;
const COMMENTS_POLL_MS = 10_000;
const LEADERBOARD_CACHE_MS = 90_000;
const LEADERBOARD_MODES = ["BEST_24H", "WINS_24H", "BALANCE", "CLANS"];
const LEADERBOARD_CURRENCIES = ["USDT", "STAR"];
const SHEET_CLOSE_MS = 360;
const SHEET_HEIGHT_MORPH_MS = 360;
const COLLAPSE_LIMIT = 3;
const MARKET_BUY_CLOSE_BUFFER_MS = 400;
const MARKET_SELL_FREEZE_SECONDS = 7;
const chartAvatarImages = new Map();
const QUICK_BET_MODE_KEY = "easymarket_quick_bet_mode";

function loadQuickBetMode() {
  try {
    return window.localStorage?.getItem(QUICK_BET_MODE_KEY) === "confirm" ? "confirm" : "one_click";
  } catch {
    return "one_click";
  }
}

function saveQuickBetMode(mode) {
  try {
    window.localStorage?.setItem(QUICK_BET_MODE_KEY, mode);
  } catch {
    // Ignore storage failures inside restricted webviews.
  }
}

const state = {
  user: null,
  market: null,
  currency: "USDT",
  balance: 0,
  usdtBalance: 0,
  usdtCashBalance: 0,
  usdtBonusBalance: 0,
  positions: [],
  recentTrades: [],
  marketStats: [],
  referralStats: null,
  recentMarkets: [],
  leaderboard: [],
  leaderboardClans: [],
  leaderboardMode: "BEST_24H",
  leaderboardCache: {},
  leaderboardCacheAt: {},
  leaderboardLoading: false,
  leaderboardPreloadPromise: null,
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
  topMarkets: [],
  topMarketsListRenderedOrder: "",
  selectedTopMarketId: null,
  topMarketCharts: new Map(),
  sportsMarkets: [],
  sportsMarketsListRenderedOrder: "",
  selectedSportsMarketId: null,
  specialMarkets: [],
  selectedSpecialMarketId: null,
  specialMarketCharts: new Map(),
  specialNoMarketCharts: new Map(),
  comments: [],
  commentsMarketId: null,
  commentsOnlineCount: 0,
  appTotalBets: 0,
  commentsLoaded: false,
  seenCommentIds: new Set(),
  freshCommentIds: new Set(),
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
    currency: "USDT",
    intent: null,
    pollTimer: null,
    historyOpen: false,
    checking: false,
    afterAction: null,
  },
  withdrawal: {
    amount: "",
    address: "",
    network: "BSC",
    pending: false,
    reason: "",
  },
  walletHistory: {
    loading: false,
    items: [],
  },
  leaderboardCurrency: "USDT",
  clans: [],
  userClan: null,
  clanWar: null,
  clanWarBankShown: null,
  clansLoading: false,
  clansPollTimer: null,
  clanCreating: false,
  selectedClanIconKey: "bull",
  handledClanLaunch: false,
  selectedClanId: null,
  clanView: "leaderboard",
  marketPanel: "chat",
  feedPanel: "positions",
  orderbookSide: "YES",
  orderbook: {
    marketId: null,
    currency: "USDT",
    loading: false,
    levels: [],
    myOrders: [],
    loadedAt: 0,
    formPrice: "",
    formAmount: "",
    orderSide: "BUY",
    pending: false,
    cancelPendingId: null,
    myOrdersOpen: false,
  },
  lossRefundOffers: [],
  lossRefundRenderedKey: null,
  referralNudgeShown: false,
  taskTab: "tasks",
  taskSettingsOpen: false,
  dailyTasks: {},
  expanded: {
    positions: false,
    activity: false,
    recent: false,
  },
  selectedSide: "YES",
  selectedAmount: 50,
  quickBetMode: loadQuickBetMode(),
  activityLoaded: false,
  settlementsLoaded: false,
  seenActivityIds: new Set(),
  bubbledActivityIds: new Set(),
  chartTradesByMarket: new Map(),
  aquariumSnapshot: null,
  aquariumSnapAt: 0,
  aquariumRuntimeAllowed: false,
  aquariumPremiumFishUnlocked: false,
  legendScene: null,
  depositBonus: null,
  shakeFeed: null,
  luckyAnnouncedFor: 0,
  freshActivityIds: new Set(),
  playedActivityAnimIds: new Set(), // въезд/глинт уже проигран — не повторять на пере-рендерах
  lastPositionPnl: {},
  seenSettledPositionIds: new Set(),
  winStreak: 0,
  renderedPositionIds: new Set(),
  positionsWarmedUp: false,
  pendingBuy: false,
  pendingBuyKey: null,
  buyQueue: [],
  inFlight: new Set(),
  refreshTimer: null,
  lastCommentsLoadAt: 0,
  expiryRefreshMarketId: null,
  lastRoundTransitionMarketId: null,
  lastClosedMarketToastAt: 0,
  lastFinalTickKey: null,
  pendingSellSide: null,
  pendingSellPositionId: null,
  sideSelectedMarketId: null,
  winOverlayTimer: null,
  lastWin: null,
  publicConfig: {
    av_bot_url: "https://t.me/voit_help_bot?start=buy_stars",
    mini_app_url: "https://t.me/voit_help_bot?startapp=easymarket",
    referral_bonus_fire: 500,
    referral_signup_bonus_usdt: 5,
    referral_bet_bonus_usdt: 30,
    task_share_fire: 50,
    task_subscribe_fire: 300,
    task_private_chat_fire: 7500,
    task_daily_presence_fire: 13,
    task_daily_bet_fire: 25,
    task_daily_cap_fire: 5000,
    av_channel_url: "https://t.me/erc20coin",
    av_chat_url: "https://t.me/thedaomaker",
    private_chat_url: "https://t.me/tribute/app?startapp=stKL",
    usdt_evm_address: "",
    usdt_deposit_scan_enabled: false,
    usdt_deposit_networks: [],
    stars_invoice_enabled: false,
  },
  presence: {
    activeMs: 0,
    lastInteractionAt: Date.now(),
    claimed: {},
    pending: false,
  },
  engagement: null, // ротация дейликов + лестница + разовые (GET /api/tasks/state)
  streak: null, // «Заряд молнии» (POST /api/streak/checkin)
  chartRaf: null,
  smoothedPrice: null,
  smoothedNoPrice: null,
  chartYMin: null,
  chartYMax: null,
  chartLastMarketId: null,
  chartIntroStart: 0,
  lastFlashedPrice: null,
};

const textAnimations = new WeakMap();
const sheetCloseTimers = new WeakMap();
const sheetHeightTimers = new WeakMap();
const $ = (id) => document.getElementById(id);

function markTelegramShellEarly() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    return;
  }
  const platform = String(tg.platform || "").toLowerCase();
  const mobileByPlatform = platform === "ios" || platform === "android";
  const mobileByViewport = window.matchMedia?.("(pointer: coarse)")?.matches
    && Math.min(window.innerWidth || 0, window.screen?.width || 0) <= 820;
  document.body.classList.add("telegram-shell");
  document.body.classList.toggle("telegram-ios-shell", platform === "ios" || /iPhone|iPad|iPod/i.test(navigator.userAgent || ""));
  document.body.classList.toggle("telegram-desktop-shell", !(mobileByPlatform || mobileByViewport));
}

markTelegramShellEarly();
initLightningMotion();
void preloadKyivstonerMotion();
initAquarium();
// «Шейк, шейк!»: каждая встряска-кормление засчитывается в задание.
setShakeSceneListener(onShakeFeedShake);
// Let a phone shake feed the fish on demand, mid-round, from the current chart.
setAquariumShakeFeeder(() => {
  const market = getDisplayMarket();
  if (!market || !shouldRunAquariumForMarket(market)) {
    return [];
  }
  postTaskEvent("feed_fish"); // дейлик «Покорми рыбок»
  return buildAquariumFoodForMarket(market);
});

const formatFire = (value) => Math.floor(Number(value || 0)).toLocaleString("ru-RU");
const formatFireDecimal = (value) => Number(value || 0).toLocaleString("ru-RU", {
  maximumFractionDigits: 1,
});
const normalizeCurrency = (value) => (String(value || "STAR").toUpperCase() === "USDT" ? "USDT" : "STAR");
const normalizeLeaderboardMode = (value) => {
  const mode = String(value || "BEST_24H").toUpperCase();
  return ["BEST_24H", "WINS_24H", "BALANCE", "CLANS"].includes(mode) ? mode : "BEST_24H";
};
const getLeaderboardCacheKey = (mode = state.leaderboardMode, currency = state.leaderboardCurrency) => `${normalizeLeaderboardMode(mode)}:${normalizeCurrency(currency)}`;
const getAmountsForCurrency = (currency = state.currency) => (normalizeCurrency(currency) === "USDT" ? USDT_AMOUNTS : STAR_AMOUNTS);
const getTierForAmount = (amount, currency = state.currency) => {
  const numeric = Math.abs(Number(amount || 0));
  const amounts = getAmountsForCurrency(currency);
  return amounts.reduce((tier, value, index) => (numeric >= Number(value) ? index + 1 : tier), 1);
};
const formatCurrencyAmount = (value, currency = state.currency) => {
  const safeCurrency = normalizeCurrency(currency);
  const formatted = Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: safeCurrency === "USDT" ? 0 : 0,
    maximumFractionDigits: safeCurrency === "USDT" ? 2 : 0,
  });
  return safeCurrency === "USDT" ? `$${formatted}` : formatted;
};
const formatWholeCurrencyAmount = (value, currency = state.currency) => {
  const safeCurrency = normalizeCurrency(currency);
  const formatted = Math.floor(Number(value || 0)).toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
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
const hasTopupAmountValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return false;
  }
  const numeric = Number(raw.replace(",", "."));
  return Number.isFinite(numeric) && numeric > 0;
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
const outcomePriceToCentsInput = (value) => {
  const cents = Number(value || 0) * 100;
  return Number(cents.toFixed(3)).toString();
};
const centsInputToOutcomePrice = (value) => Number(value) / 100;
const yesNoSideLabel = (side) => (side === "YES" ? "Yes" : "No");
const sideLabel = (side) => (side === "YES" ? "UP" : "DOWN");
const marketSideLabel = (market, side) => (
  market?.market_type === "SPECIAL_MARKET" || String(market?.symbol || market?.market_symbol || "").startsWith("SPECIAL:")
    ? (side === "YES" ? (market.yes_label || "Больше 8") : (market.no_label || "Меньше 8"))
    : market?.market_type === "SPORTS_MARKET" || String(market?.symbol || market?.market_symbol || "").startsWith("SPORT:")
    ? (side === "YES" ? (market.yes_label || "Yes") : (market.no_label || "No"))
    : market?.market_type === "WORLD_CUP_WINNER"
    || market?.market_type === "TOP_MARKET"
    || String(market?.symbol || "").startsWith("TOP:")
    || Boolean(market?.team)
    ? yesNoSideLabel(side)
    : sideLabel(side)
);

function renderOutcomeOptionLabel(element, label, price, stacked = false) {
  if (!element) {
    return;
  }

  const formattedPrice = formatCents(price);
  element.classList.toggle("stacked", stacked);
  if (!stacked) {
    const text = `${label} ${formattedPrice}`;
    if (element.textContent !== text) {
      element.textContent = text;
    }
    return;
  }

  let nameElement = element.querySelector(".outcome-option-name");
  let priceElement = element.querySelector(".outcome-option-price");
  if (!nameElement || !priceElement) {
    nameElement = document.createElement("span");
    nameElement.className = "outcome-option-name";
    priceElement = document.createElement("span");
    priceElement.className = "outcome-option-price";
    element.replaceChildren(nameElement, priceElement);
  }
  if (nameElement.textContent !== label) {
    nameElement.textContent = label;
  }
  if (priceElement.textContent !== formattedPrice) {
    priceElement.textContent = formattedPrice;
  }
}

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

function setInnerHtmlIfChanged(element, html) {
  if (!element || element.innerHTML === html) {
    return;
  }

  element.innerHTML = html;
}

function isImageUrl(value) {
  return /^(?:https?:\/\/|\/assets\/)/i.test(String(value || ""));
}

function teamIconMarkup(icon, alt = "team") {
  if (isImageUrl(icon)) {
    return `<img src="${escapeHtml(icon)}" alt="${escapeHtml(alt)}" loading="eager" decoding="async" />`;
  }
  return `<span>${escapeHtml(icon || "🏆")}</span>`;
}

const CLAN_ICON_THEMES = [
  {
    key: "bull",
    label: "Bull",
    className: "bull",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 14c-3.8-.8-6.7-3-8.3-6.4 6 .1 10.2 2.2 12.4 6.2 2.1-.9 4.4-1.3 6.9-1.3s4.8.4 6.9 1.3c2.2-4 6.4-6.1 12.4-6.2-1.6 3.4-4.5 5.6-8.3 6.4 1.9 2.1 2.8 4.9 2.8 8.2 0 8.2-5.7 15.1-13.8 15.1S10.2 30.4 10.2 22.2c0-3.3.9-6.1 2.8-8.2Zm5.2 17.6 3.6 3.4h4.4l3.6-3.4-4.4-3.1h-2.8l-4.4 3.1Zm-2.3-10.7 4.7 2.1.9-3.7-4.8-.8-.8 2.4Zm16.2 0-.8-2.4-4.8.8.9 3.7 4.7-2.1Z"/></svg>',
  },
  {
    key: "bear",
    label: "Bear",
    className: "bear",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14.3 12.6a7 7 0 0 1 6.4-6.1c1.1 1.2 2.2 2 3.3 2s2.2-.8 3.3-2a7 7 0 0 1 6.4 6.1 15.2 15.2 0 0 1 5.2 11.6c0 9.1-6.1 16.3-14.9 16.3S9.1 33.3 9.1 24.2c0-4.7 1.9-8.8 5.2-11.6Zm4.5 19.6 3.1 3h4.2l3.1-3-3.9-2.3h-2.6l-3.9 2.3Zm-2.6-10.9 4 2.2 1.2-3.5-4.1-1-1.1 2.3Zm15.6 0-1.1-2.3-4.1 1 1.2 3.5 4-2.2Z"/></svg>',
  },
  {
    key: "fox",
    label: "Fox",
    className: "fox",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 8.5 20.2 13c1.2-.4 2.5-.6 3.8-.6s2.6.2 3.8.6L39 8.5l-3 15.3c.2 1 .3 2 .3 3.1 0 7.9-5 13.4-12.3 13.4S11.7 34.8 11.7 26.9c0-1.1.1-2.1.3-3.1L9 8.5Zm8.7 21.8 4.1 4.4h4.4l4.1-4.4L25.8 27h-3.6l-4.5 3.3Zm-.5-9 4.1 2.3.9-3.8-4.2-1.4-.8 2.9Zm13.6 0-.8-2.9-4.2 1.4.9 3.8 4.1-2.3Z"/></svg>',
  },
  {
    key: "wolf",
    label: "Wolf",
    className: "wolf",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7.3 7.8 19.6 15c1.4-.5 2.9-.8 4.4-.8s3 .3 4.4.8L40.7 7.8l-3.9 19.4c-1 8-5.7 13.3-12.8 13.3S12.2 35.2 11.2 27.2L7.3 7.8Zm10.4 22.7 4.2 4.1h4.2l4.2-4.1-4.7-2.2h-3.2l-4.7 2.2Zm-1-9.6 4.5 2.4.8-4.1-4.5-1.5-.8 3.2Zm14.6 0-.8-3.2-4.5 1.5.8 4.1 4.5-2.4Z"/></svg>',
  },
  {
    key: "eagle",
    label: "Eagle",
    className: "eagle",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4.6 15.5c8.5-2.7 14-1.7 16.7 2.8.7-.2 1.6-.3 2.7-.3s2 .1 2.7.3c2.7-4.5 8.2-5.5 16.7-2.8-5.5 3.7-9.1 7-10.7 9.9l3.1 9.2-8.7-3.3L24 40.5l-3.1-9.2-8.7 3.3 3.1-9.2c-1.6-2.9-5.2-6.2-10.7-9.9Zm15.9 8.4 3.5 2.4 3.5-2.4-3.5-2-3.5 2Z"/></svg>',
  },
  {
    key: "tiger",
    label: "Tiger",
    className: "tiger",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13.5 13.6C16 10.8 19.5 9.4 24 9.4s8 1.4 10.5 4.2l6.1-3.1-2.5 11.7c.2 1 .3 2.1.3 3.2 0 8.9-5.8 15.2-14.4 15.2S9.6 34.3 9.6 25.4c0-1.1.1-2.2.3-3.2L7.4 10.5l6.1 3.1Zm2.7 7.5 4.1 2 .9-3.7-4.3-1.1-.7 2.8Zm15.6 0-.7-2.8-4.3 1.1.9 3.7 4.1-2Zm-13.4-7.6 3.4 2.4-.4-4.2-3 1.8Zm11.2 0-3-1.8-.4 4.2 3.4-2.4Zm-11 17.4 3.3 3.6h4.2l3.3-3.6-4.2-2.2h-2.4l-4.2 2.2Z"/></svg>',
  },
  {
    key: "lion",
    label: "Lion",
    className: "lion",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5.7 29.2 10l6.7-.4 2 6.4 5.1 4.4-2.7 6.2.7 6.7-6 3.1-3.4 5.9-6.6-1.3-6.6 1.3-3.4-5.9-6-3.1.7-6.7L7 20.4l5.1-4.4 2-6.4 6.7.4L24 5.7Zm-6.2 24.8 4 4.2h4.4l4-4.2-4.6-2.4h-3.2l-4.6 2.4Zm-1.2-9.9 4.2 2.4 1-3.9-4.4-1.2-.8 2.7Zm14.8 0-.8-2.7-4.4 1.2 1 3.9 4.2-2.4Z"/></svg>',
  },
  {
    key: "shark",
    label: "Shark",
    className: "shark",
    svg: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4.7 25.8c10.7-9.6 22.2-12.3 34.6-8.1l4-5.8 1 13-1 13-4-5.8C26.9 36.3 15.4 33.6 4.7 24Zm13.8-.4 5.5 3.3 5.5-3.3-5.5-2.5-5.5 2.5Zm15.7-4.2 3.7 1.7.9-2.7-3.8-.7-.8 1.7Z"/></svg>',
  },
];

function hashString(value) {
  return String(value || "").split("").reduce((hash, char) => (
    ((hash << 5) - hash + char.charCodeAt(0)) | 0
  ), 0);
}

function getClanIconTheme(clan = {}) {
  const iconKey = String(clan.icon_key || clan.iconKey || "").toLowerCase();
  const exactTheme = CLAN_ICON_THEMES.find((theme) => theme.key === iconKey);
  if (exactTheme) {
    return exactTheme;
  }
  const slug = String(clan.slug || "").toLowerCase();
  if (slug === "btc-bulls") {
    return CLAN_ICON_THEMES[0];
  }
  if (slug === "btc-bears") {
    return CLAN_ICON_THEMES[1];
  }
  const index = Math.abs(hashString(`${slug}:${clan.name || ""}`)) % (CLAN_ICON_THEMES.length - 2);
  return CLAN_ICON_THEMES[index + 2];
}

function clanIconMarkup(clan, className = "clan-avatar") {
  const theme = getClanIconTheme(clan);
  const avatarUrl = String(clan?.channel_avatar_url || "").trim();
  if (avatarUrl) {
    return `
      <div class="${className} channel-photo ${theme.className}" aria-hidden="true">
        <img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.opacity='1';" />
        <span class="clan-avatar-fallback">${theme.svg}</span>
      </div>
    `;
  }
  return `<div class="${className} ${theme.className}" aria-hidden="true">${theme.svg}</div>`;
}

function clanMemberAvatarMarkup(member, name) {
  const avatarUrl = String(member?.avatar_url || "").trim();
  const initial = escapeHtml((String(name || "").replace(/^@/, "")[0] || "?").toUpperCase());
  if (avatarUrl) {
    return `
      <div class="clan-member-avatar member-photo" aria-hidden="true">
        <img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.opacity='1';" />
        <span>${initial}</span>
      </div>
    `;
  }
  return `<div class="clan-member-avatar" aria-hidden="true">${initial}</div>`;
}

function normalizeChannelUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^@[\w\d_]+$/i.test(raw)) {
    return `https://t.me/${raw.replace(/^@/, "")}`;
  }
  if (/^t\.me\//i.test(raw)) {
    return `https://${raw}`;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return raw;
}

function formatChannelLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(normalizeChannelUrl(raw));
    if (/^(www\.)?t\.me$/i.test(url.hostname)) {
      const name = url.pathname.replace(/^\/+/, "").split("/")[0];
      return name ? `@${name}` : "Канал";
    }
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^t\.me\//i, "@");
  }
}

function buildClanInviteUrl(clan) {
  return buildTelegramMiniAppLaunchUrl(`clan_${clan?.id || ""}`);
}

function getLaunchClanId() {
  const raw = String(getLaunchRefValue() || "").trim();
  const match = raw.match(/^clan[_:-](\d+)$/i);
  return match ? Number(match[1]) : null;
}

function renderClanIconPicker() {
  const picker = $("clanIconPicker");
  if (!picker) {
    return;
  }
  const html = CLAN_ICON_THEMES.map((theme) => `
    <button
      class="clan-icon-option ${state.selectedClanIconKey === theme.key ? "active" : ""} ${theme.className}"
      type="button"
      data-clan-icon="${theme.key}"
      aria-label="${escapeHtml(theme.label)}"
    >
      ${theme.svg}
    </button>
  `).join("");
  setInnerHtmlIfChanged(picker, html);
  updateClanCreatePreview();
}

// Live preview of the clan-to-be (icon + name) in the create form.
function updateClanCreatePreview() {
  const nameEl = $("clanPreviewName");
  const iconEl = $("clanPreviewIcon");
  if (!nameEl && !iconEl) {
    return;
  }
  if (nameEl) {
    const value = ($("clanNameInput")?.value || "").trim();
    nameEl.textContent = value || "Название клана";
    nameEl.classList.toggle("placeholder", !value);
  }
  if (iconEl) {
    const theme = CLAN_ICON_THEMES.find((item) => item.key === state.selectedClanIconKey)
      || CLAN_ICON_THEMES[0];
    iconEl.className = `clan-create-preview-icon ${theme.className}`;
    iconEl.innerHTML = theme.svg;
  }
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
        round: [
          { pulse: "light", delay: 0 },
          { pulse: "medium", delay: 110 },
          { pulse: "light", delay: 260 },
          { pulse: "warning", delay: 460 },
        ],
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
      : type === "round"
        ? [24, 35, 46, 65, 22]
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

  if (type === "win") {
    playMotionSound("win");
  } else if (type === "round") {
    playMotionSound("warning");
  } else if (type === "success" || type === "warning" || type === "error") {
    playMotionSound(type);
  } else {
    playMotionSound("tap");
  }
}

function resizeCanvas(canvas) {
  // dpr-кэп 2: на dpr-3 телефонах канвас ворочал в 2.25 раза больше пикселей,
  // а на линии графика разница неразличима. Меньше растра — холоднее телефон.
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
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

function getTelegramUserAvatarUrl(username) {
  const cleanUsername = String(username || "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{4,}$/.test(cleanUsername)
    ? `https://t.me/i/userpic/320/${encodeURIComponent(cleanUsername)}.jpg`
    : "";
}

function getTradeAvatarUrl(trade) {
  return String(trade?.avatar_url || getTelegramUserAvatarUrl(trade?.username) || "").trim();
}

function getTradeAvatarInitial(trade) {
  const raw = String(trade?.username || trade?.first_name || trade?.telegram_id || "?").trim().replace(/^@/, "");
  return (raw[0] || "?").toUpperCase();
}

function getTradeAvatarColor(trade) {
  const seed = String(trade?.telegram_id || trade?.username || trade?.id || "user");
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  return `hsl(${hash} 78% 58%)`;
}

function formatUserDisplayName(entity, { preferAt = true } = {}) {
  const username = String(entity?.username || "").trim().replace(/^@/, "");
  if (username && !/^user$/i.test(username)) {
    return preferAt ? `@${username}` : username;
  }
  const firstName = String(entity?.first_name || entity?.firstName || "").trim();
  if (firstName && !/^user$/i.test(firstName)) {
    return firstName;
  }
  const telegramId = String(entity?.telegram_id || entity?.telegramId || "").trim();
  if (telegramId) {
    return `User ${telegramId.slice(-4)}`;
  }
  return "User";
}

function getCachedTradeAvatarImage(url) {
  if (!url) {
    return null;
  }

  const cached = chartAvatarImages.get(url);
  if (cached) {
    return cached.loaded && !cached.failed ? cached.image : null;
  }

  const image = new Image();
  const entry = { image, loaded: false, failed: false };
  chartAvatarImages.set(url, entry);
  image.decoding = "async";
  image.onload = () => {
    entry.loaded = true;
    renderMarketChart();
  };
  image.onerror = () => {
    entry.failed = true;
  };
  image.src = url;
  return null;
}

// Пре-рендер аватарки (тень + клип + кольцо) в offscreen-спрайт: в кадре
// остаётся один drawImage вместо самых дорогих операций 2D-канваса
// (shadowBlur + clip), которые раньше платились до 80 раз на каждый кадр.
const chartAvatarSpriteCache = new Map();

function getChartAvatarSprite(trade, radius) {
  const url = getTradeAvatarUrl(trade);
  const image = getCachedTradeAvatarImage(url);
  const r = Math.max(2, Math.round(radius * 2) / 2);
  const side = trade.side === "YES" ? "YES" : "NO";
  const face = image ? `u:${url}` : `i:${getTradeAvatarInitial(trade)}`;
  const key = `${face}|${side}|${r}`;
  const cached = chartAvatarSpriteCache.get(key);
  if (cached) {
    return cached;
  }

  const shadow = Math.max(3, r * 1.2);
  const pad = Math.ceil(shadow + Math.max(0.8, r * 0.26) + 2);
  const size = Math.ceil(r * 2 + pad * 2);
  const sprite = { canvas: document.createElement("canvas"), half: size / 2 };
  sprite.canvas.width = size;
  sprite.canvas.height = size;
  const sctx = sprite.canvas.getContext("2d");
  const c = size / 2;

  sctx.save();
  sctx.shadowColor = side === "YES" ? "rgba(25,195,125,0.34)" : "rgba(239,70,111,0.32)";
  sctx.shadowBlur = shadow;
  sctx.beginPath();
  sctx.arc(c, c, r, 0, Math.PI * 2);
  sctx.clip();

  if (image) {
    sctx.drawImage(image, c - r, c - r, r * 2, r * 2);
  } else {
    const gradient = sctx.createRadialGradient(c - r * 0.35, c - r * 0.4, 0, c, c, r * 1.4);
    gradient.addColorStop(0, "rgba(255,255,255,0.62)");
    gradient.addColorStop(0.38, "rgba(92,112,145,0.9)");
    gradient.addColorStop(1, "rgba(14,20,32,0.98)");
    sctx.fillStyle = gradient;
    sctx.fillRect(c - r, c - r, r * 2, r * 2);
    sctx.shadowBlur = 0;
    sctx.fillStyle = "rgba(255,255,255,0.92)";
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.font = `${Math.max(5, r * 1.15)}px Inter, system-ui, sans-serif`;
    sctx.fillText(getTradeAvatarInitial(trade), c, c + r * 0.04);
  }
  sctx.restore();

  sctx.lineWidth = Math.max(0.8, r * 0.26);
  sctx.strokeStyle = side === "YES" ? "rgba(25,195,125,0.86)" : "rgba(239,70,111,0.84)";
  sctx.beginPath();
  sctx.arc(c, c, r, 0, Math.PI * 2);
  sctx.stroke();

  // Кэш ограничен, чтобы за долгую сессию не копить составы старых раундов.
  if (chartAvatarSpriteCache.size > 240) {
    chartAvatarSpriteCache.delete(chartAvatarSpriteCache.keys().next().value);
  }
  chartAvatarSpriteCache.set(key, sprite);
  return sprite;
}

function drawChartTradeAvatar(ctx, trade, x, y, radius, bounds) {
  const safeRadius = Math.max(2, radius);
  const centerX = Math.max(bounds.left + safeRadius, Math.min(bounds.right - safeRadius, x));
  const centerY = Math.max(bounds.top + safeRadius, Math.min(bounds.bottom - safeRadius, y));
  const sprite = getChartAvatarSprite(trade, safeRadius);
  ctx.drawImage(sprite.canvas, centerX - sprite.half, centerY - sprite.half);
}

function getDisplayMarket() {
  if (state.selectedBtcMarketId) {
    return state.btcMarkets.find((market) => market.id === state.selectedBtcMarketId) || state.market;
  }

  if (state.selectedWorldCupMarketId) {
    return state.worldCupMarkets.find((market) => market.id === state.selectedWorldCupMarketId) || state.market;
  }

  if (state.selectedTopMarketId) {
    return state.topMarkets.find((market) => market.id === state.selectedTopMarketId) || state.market;
  }

  if (state.selectedSportsMarketId) {
    return state.sportsMarkets.find((market) => market.id === state.selectedSportsMarketId) || state.market;
  }

  if (state.selectedSpecialMarketId) {
    return state.specialMarkets.find((market) => market.id === state.selectedSpecialMarketId) || state.market;
  }

  return state.market;
}

function findMarketById(marketId) {
  const id = Number(marketId);
  return state.btcMarkets.find((market) => market.id === id)
    || state.worldCupMarkets.find((market) => market.id === id)
    || state.topMarkets.find((market) => market.id === id)
    || state.sportsMarkets.find((market) => market.id === id)
    || state.specialMarkets.find((market) => market.id === id)
    || (state.market?.id === id ? state.market : null);
}

function isWorldCupMarket(market = getDisplayMarket()) {
  return market?.market_type === "WORLD_CUP_WINNER";
}

function isTopMarket(market = getDisplayMarket()) {
  return market?.market_type === "TOP_MARKET";
}

function isSportsListMarket(market = getDisplayMarket()) {
  return market?.market_type === "SPORTS_MARKET"
    || String(market?.symbol || market?.market_symbol || "").startsWith("SPORT:");
}

function isSpecialMarket(market = getDisplayMarket()) {
  return market?.market_type === "SPECIAL_MARKET"
    || String(market?.symbol || market?.market_symbol || "").startsWith("SPECIAL:");
}

function isSportsEventLive(market = getDisplayMarket()) {
  if (!isSportsListMarket(market) || !(market?.is_live === true || market?.is_live === "true")) {
    return false;
  }
  const startsAt = new Date(market.starts_at || market.start_time || "").getTime();
  return !Number.isFinite(startsAt) || startsAt <= Date.now() + 2 * 60_000;
}

function abbreviateSportsOutcomeLabel(value) {
  const label = String(value || "").trim();
  if (!label || /^(yes|no|up|down)$/i.test(label)) {
    return label;
  }
  const words = label.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length > 1) {
    return words
      .map((word) => Array.from(word)[0] || "")
      .join("")
      .slice(0, 4)
      .toLocaleUpperCase("ru-RU");
  }
  const characters = Array.from(words[0] || label);
  return characters
    .slice(0, characters.length > 4 ? 3 : 4)
    .join("")
    .toLocaleUpperCase("ru-RU");
}

function marketButtonSideLabel(market, side) {
  const label = marketSideLabel(market, side);
  return isSportsListMarket(market) ? abbreviateSportsOutcomeLabel(label) : label;
}

function isNamedSportsOutcome(market, side) {
  return isSportsListMarket(market) && !/^(yes|no)$/i.test(marketSideLabel(market, side));
}

function sportsBetPrompt(market, side, action) {
  const outcome = marketButtonSideLabel(market, side);
  const subject = isNamedSportsOutcome(market, side)
    ? `Победа ${outcome}`
    : outcome;
  return `${subject} · ${action}`;
}

function compactSportsMarketLabel(market) {
  if (!isSportsListMarket(market)) {
    return "";
  }
  if (isNamedSportsOutcome(market, "YES") || isNamedSportsOutcome(market, "NO")) {
    return `${marketButtonSideLabel(market, "YES")}–${marketButtonSideLabel(market, "NO")}`;
  }
  const title = String(market?.title || market?.question || "SPORT").trim();
  return title.length > 34 ? `${title.slice(0, 33).trim()}…` : title;
}

function isPredictionListMarket(market = getDisplayMarket()) {
  return isWorldCupMarket(market) || isTopMarket(market) || isSportsListMarket(market) || isSpecialMarket(market);
}

function isBtcMarket(market = getDisplayMarket()) {
  return market?.market_type === "BTC_UPDOWN" || String(market?.symbol || "").startsWith("BTCUSDT");
}

function isBtcFiveMinuteMarket(market = getDisplayMarket()) {
  return isBtcMarket(market) && String(market?.symbol || "") === "BTCUSDT";
}

function shouldRunAquariumForMarket(market = getDisplayMarket()) {
  return isBtcFiveMinuteMarket(market);
}

function syncAquariumRuntimeForMarket(market = getDisplayMarket()) {
  const allowed = shouldRunAquariumForMarket(market);
  if (state.aquariumRuntimeAllowed !== allowed) {
    state.aquariumRuntimeAllowed = allowed;
    setAquariumRuntimeAllowed(allowed);
    if (!allowed) {
      state.aquariumSnapshot = null;
      state.aquariumSnapAt = 0;
    }
  }
  return allowed;
}

// Счастливое окно только что прокнуло — громко объявляем один раз за раунд:
// шанс поставить с x2 живёт всего ~15 секунд.
function maybeAnnounceLuckyWindow(market, luckyLeftSec) {
  if (!market || luckyLeftSec <= 0 || state.luckyAnnouncedFor === market.id) {
    return;
  }
  state.luckyAnnouncedFor = market.id;
  triggerHaptic("medium");
  playMotionSound("tap-strong");
  showToast(`⚡ x2 на ${luckyLeftSec} секунд — успей поставить!`);
}

function applyAquariumEntitlements(data) {
  const unlocked = Boolean(data?.aquarium_premium_fish_unlocked);
  state.aquariumPremiumFishUnlocked = unlocked;
  setAquariumPremiumFish(unlocked);
  applyLegendSceneEntitlements(data);
  state.depositBonus = data?.deposit_bonus || state.depositBonus;
  renderDepositBonusTask();
  state.shakeFeed = data?.shake_feed || state.shakeFeed;
  renderShakeFeedTask();
}

// «Шейк, шейк!»: встряски копятся локально и улетают на сервер пачками —
// не больше одного запроса раз в несколько секунд.
let pendingShakeFeeds = 0;
let shakeFeedFlushTimer = 0;

async function flushShakeFeeds() {
  shakeFeedFlushTimer = 0;
  const count = Math.min(6, pendingShakeFeeds);
  pendingShakeFeeds -= count; // излишек не теряем — уедет следующей пачкой
  if (!count || !state.user?.telegram_id) {
    return;
  }
  try {
    const result = await api("/api/shake-feed/ingest", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        count,
      }),
    });
    if (result?.shake_feed) {
      state.shakeFeed = result.shake_feed;
      renderShakeFeedTask();
    }
  } catch {
    pendingShakeFeeds += count; // не потеряли — доотправим со следующей встряской
  }
}

function onShakeFeedShake() {
  if (!state.user?.telegram_id) {
    return;
  }
  pendingShakeFeeds += 1;
  if (!shakeFeedFlushTimer) {
    shakeFeedFlushTimer = window.setTimeout(() => {
      void flushShakeFeeds();
    }, 4000);
  }
}

function renderShakeFeedTask() {
  const row = $("shakeFeedTask");
  if (!row) {
    return;
  }
  const levels = Array.isArray(state.shakeFeed?.levels) ? state.shakeFeed.levels : [];
  row.classList.toggle("hidden", levels.length === 0);
  if (!levels.length) {
    return;
  }
  const total = Math.max(0, Number(state.shakeFeed.total) || 0);
  const readySum = levels
    .filter((level) => level.ready)
    .reduce((sum, level) => sum + (Number(level.bonus) || 0), 0);
  const nextIdx = levels.findIndex((level) => !level.claimed && !level.ready);
  const next = nextIdx >= 0 ? levels[nextIdx] : null;
  const prevGoal = nextIdx > 0 ? Number(levels[nextIdx - 1].goal) || 0 : 0;
  const lastGoal = Number(levels[levels.length - 1].goal) || 1;

  const bar = $("shakeFeedBar");
  if (bar) {
    const fill = next
      ? (total - prevGoal) / Math.max(1, (Number(next.goal) || 1) - prevGoal)
      : 1;
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%`;
  }
  if ($("shakeFeedCur")) {
    $("shakeFeedCur").textContent = `${Math.floor(total)} из ${Math.floor(next ? next.goal : lastGoal)}`;
  }
  const nextLabel = $("shakeFeedNext");
  if (nextLabel) {
    const nextBonus = Number(next?.bonus) || 0;
    nextLabel.textContent = `+$${nextBonus}`;
    nextLabel.classList.toggle("hidden", nextBonus <= 0);
  }
  const button = $("shakeFeedBtn");
  if (button) {
    if (readySum > 0) {
      button.textContent = `Забрать $${readySum}`;
      button.disabled = false;
    } else if (next) {
      button.textContent = "Тряси!";
      button.disabled = true;
    } else {
      button.textContent = "Собрано";
      button.disabled = true;
    }
  }
}

async function claimShakeFeedLevels(sourceElement = null) {
  if (!state.user?.telegram_id) {
    return;
  }
  try {
    const result = await api("/api/shake-feed/claim", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
      }),
    });
    const credited = Number(result?.credited || 0);
    if (credited > 0) {
      playTaskRewardAnimation(sourceElement);
      showToast(`+$${credited} на бонусный счёт. Рыбки сыты!`);
      void runSingleFlight("me", loadMe).catch(() => undefined);
    } else {
      showToast("Пока нечего забирать — тряси ещё.");
    }
  } catch {
    showToast("Не получилось забрать бонус, попробуй ещё раз.");
  }
}

// Лесенка бонусов за суммарный депозит: прогресс-бар до следующего уровня,
// достигнутые уровни забираются одной кнопкой.
function renderDepositBonusTask() {
  const row = $("depositBonusTask");
  if (!row) {
    return;
  }
  const levels = Array.isArray(state.depositBonus?.levels) ? state.depositBonus.levels : [];
  row.classList.toggle("hidden", levels.length === 0);
  if (!levels.length) {
    return;
  }
  const total = Math.max(0, Number(state.depositBonus.total) || 0);
  const readySum = levels
    .filter((level) => level.ready)
    .reduce((sum, level) => sum + (Number(level.bonus) || 0), 0);
  const nextIdx = levels.findIndex((level) => !level.claimed && !level.ready);
  const next = nextIdx >= 0 ? levels[nextIdx] : null;
  const prevGoal = nextIdx > 0 ? Number(levels[nextIdx - 1].goal) || 0 : 0;
  const lastGoal = Number(levels[levels.length - 1].goal) || 1;

  const bar = $("depositBonusBar");
  if (bar) {
    const fill = next
      ? (total - prevGoal) / Math.max(1, (Number(next.goal) || 1) - prevGoal)
      : 1;
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%`;
  }
  if ($("depositBonusCur")) {
    const goalLabel = `$${Math.floor(next ? next.goal : lastGoal).toLocaleString("ru-RU")}`;
    $("depositBonusCur").textContent = `$${Math.floor(total).toLocaleString("ru-RU")} из ${goalLabel}`;
  }
  const nextLabel = $("depositBonusNext");
  if (nextLabel) {
    const nextBonus = Number(next?.bonus) || 0;
    nextLabel.textContent = `+$${Math.floor(nextBonus).toLocaleString("ru-RU")}`;
    nextLabel.classList.toggle("hidden", nextBonus <= 0);
  }
  const button = $("depositBonusBtn");
  if (button) {
    if (readySum > 0) {
      button.textContent = `Забрать $${Math.floor(readySum).toLocaleString("ru-RU")}`;
      button.disabled = false;
    } else if (next) {
      button.textContent = "Пополнить";
      button.disabled = false;
    } else {
      button.textContent = "Собрано";
      button.disabled = true;
    }
  }
}

async function claimDepositBonusLevels(sourceElement = null) {
  if (!state.user?.telegram_id) {
    return;
  }
  try {
    const result = await api("/api/deposit-bonus/claim", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
      }),
    });
    const credited = Number(result?.credited || 0);
    if (credited > 0) {
      playTaskRewardAnimation(sourceElement);
      showToast(`+$${credited} на бонусный счёт.`);
      void runSingleFlight("me", loadMe).catch(() => undefined);
    } else {
      showToast("Пока нечего забирать — пополни ещё.");
    }
  } catch {
    showToast("Не получилось забрать бонус, попробуй ещё раз.");
  }
}

// Сцена «Легенда 24»: сервер решает, кому открыто (депозит $1000 или админ).
// Владелец премиума сам выбирает в настройках: шоу или рыбки.
const LEGEND_SCENE_PREF_KEY = "em_legend_scene_on";

function legendScenePrefEnabled() {
  try {
    return window.localStorage?.getItem(LEGEND_SCENE_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

function setLegendScenePref(on) {
  try {
    window.localStorage?.setItem(LEGEND_SCENE_PREF_KEY, on ? "1" : "0");
  } catch {
    // storage может быть недоступен в hardened webview
  }
}

function isLegendSceneUnlocked() {
  return Boolean(state.legendScene?.available && state.legendScene?.unlocked);
}

function syncActiveShakeScene() {
  const wantPremium = isLegendSceneUnlocked() && legendScenePrefEnabled();
  const activeKey = getActiveSceneKey();
  if (wantPremium && activeKey === "aquarium") {
    setActiveScene("basketball");
  } else if (!wantPremium && activeKey === "basketball") {
    setActiveScene("aquarium");
  }
}

function applyLegendSceneEntitlements(data) {
  state.legendScene = data?.legend_scene || null;
  syncActiveShakeScene();
  renderLegendSceneTask();
  renderLegendSceneToggle();
}

function renderLegendSceneToggle() {
  const row = $("legendSceneSettingsRow");
  const button = $("legendSceneToggleBtn");
  if (!row || !button) {
    return;
  }
  const unlocked = isLegendSceneUnlocked();
  row.classList.toggle("hidden", !unlocked);
  const on = legendScenePrefEnabled();
  button.classList.toggle("active", on);
  button.setAttribute("aria-pressed", on ? "true" : "false");
}

function renderLegendSceneTask() {
  const row = $("legendSceneTask");
  const section = $("legendSceneTaskSection");
  if (!row) {
    return;
  }
  const info = state.legendScene;
  const available = Boolean(info?.available);
  row.classList.toggle("hidden", !available);
  section?.classList.toggle("hidden", !available);
  if (!available) {
    return;
  }
  const goal = Math.max(1, Number(info.deposit_goal) || 1000);
  const total = Math.min(Math.max(0, Number(info.deposit_total) || 0), goal);
  if ($("legendSceneTaskBar")) {
    $("legendSceneTaskBar").style.width = `${Math.round((total / goal) * 100)}%`;
  }
  if ($("legendSceneTaskCur")) {
    $("legendSceneTaskCur").textContent = `$${Math.floor(total).toLocaleString("ru-RU")}`;
  }
  if ($("legendSceneTaskGoal")) {
    $("legendSceneTaskGoal").textContent = `$${Math.floor(goal).toLocaleString("ru-RU")}`;
  }
  const button = $("legendSceneTaskBtn");
  if (button) {
    const done = Boolean(info.unlocked);
    button.textContent = done ? "Открыто" : "Пополнить";
    button.disabled = done;
  }
}

function isMarketOpenForBuy(market, bufferMs = MARKET_BUY_CLOSE_BUFFER_MS) {
  if (!market || market.status !== "open" || !market.end_time) {
    return false;
  }
  return new Date(market.end_time).getTime() > Date.now() + bufferMs;
}

function isMarketClosedForCarousel(market) {
  if (!market || market.status !== "open" || !market.end_time) {
    return true;
  }
  const endAt = new Date(market.end_time).getTime();
  return Number.isFinite(endAt) && endAt <= Date.now();
}

function openCarouselMarkets(markets) {
  return (markets || []).filter((market) => !isMarketClosedForCarousel(market));
}

function retainPendingExternalMarkets(markets) {
  return (markets || []).filter((market) => market?.status === "open");
}

function pruneClosedLocalMarkets({ renderLists = false } = {}) {
  const beforeBtc = state.btcMarkets.map((market) => market.id).join(",");
  const beforeWorld = state.worldCupMarkets.map((market) => market.id).join(",");
  const beforeTop = state.topMarkets.map((market) => market.id).join(",");
  const beforeSports = state.sportsMarkets.map((market) => market.id).join(",");
  const beforeSpecial = state.specialMarkets.map((market) => market.id).join(",");

  state.btcMarkets = openCarouselMarkets(state.btcMarkets);
  state.worldCupMarkets = retainPendingExternalMarkets(state.worldCupMarkets);
  state.topMarkets = retainPendingExternalMarkets(state.topMarkets);
  state.sportsMarkets = retainPendingExternalMarkets(state.sportsMarkets);
  state.specialMarkets = retainPendingExternalMarkets(state.specialMarkets);

  const afterBtc = state.btcMarkets.map((market) => market.id).join(",");
  const afterWorld = state.worldCupMarkets.map((market) => market.id).join(",");
  const afterTop = state.topMarkets.map((market) => market.id).join(",");
  const afterSports = state.sportsMarkets.map((market) => market.id).join(",");
  const afterSpecial = state.specialMarkets.map((market) => market.id).join(",");
  const btcChanged = beforeBtc !== afterBtc;
  const worldChanged = beforeWorld !== afterWorld;
  const topChanged = beforeTop !== afterTop;
  const sportsChanged = beforeSports !== afterSports;
  const specialChanged = beforeSpecial !== afterSpecial;
  let selectionChanged = false;

  if (
    state.selectedBtcMarketId
    && !state.btcMarkets.some((market) => market.id === state.selectedBtcMarketId)
  ) {
    state.selectedBtcMarketId = null;
    selectionChanged = true;
  }
  if (
    state.selectedWorldCupMarketId
    && !state.worldCupMarkets.some((market) => market.id === state.selectedWorldCupMarketId)
  ) {
    state.selectedWorldCupMarketId = null;
    selectionChanged = true;
  }
  if (
    state.selectedTopMarketId
    && !state.topMarkets.some((market) => market.id === state.selectedTopMarketId)
  ) {
    state.selectedTopMarketId = null;
    selectionChanged = true;
  }
  if (
    state.selectedSportsMarketId
    && !state.sportsMarkets.some((market) => market.id === state.selectedSportsMarketId)
  ) {
    state.selectedSportsMarketId = null;
    selectionChanged = true;
  }
  if (
    state.selectedSpecialMarketId
    && !state.specialMarkets.some((market) => market.id === state.selectedSpecialMarketId)
  ) {
    state.selectedSpecialMarketId = null;
    selectionChanged = true;
  }

  if (btcChanged) {
    state.btcMarketsListRenderedOrder = "";
  }
  if (worldChanged) {
    state.worldCupListRenderedOrder = "";
  }
  if (topChanged) {
    state.topMarketsListRenderedOrder = "";
  }
  if (sportsChanged) {
    state.sportsMarketsListRenderedOrder = "";
  }
  if (renderLists) {
    if (btcChanged) renderBtcMarketsList();
    if (worldChanged) renderWorldCupList();
    if (topChanged) renderTopMarketsList();
    if (sportsChanged) renderSportsMarketsList();
  }

  return { changed: btcChanged || worldChanged || topChanged || sportsChanged || specialChanged, selectionChanged };
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
  const marketPatch = Object.fromEntries(
    Object.entries(market).filter(([, value]) => value !== undefined),
  );
  if (marketPatch.id === state.market?.id) {
    state.market = {
      ...state.market,
      ...marketPatch,
    };
  }
  if (marketPatch.market_type === "BTC_UPDOWN") {
    upsertMarketListItem("btcMarkets", marketPatch);
  }
  if (marketPatch.market_type === "WORLD_CUP_WINNER") {
    upsertMarketListItem("worldCupMarkets", marketPatch);
  }
  if (marketPatch.market_type === "TOP_MARKET") {
    upsertMarketListItem("topMarkets", marketPatch);
  }
  if (marketPatch.market_type === "SPORTS_MARKET") {
    upsertMarketListItem("sportsMarkets", marketPatch);
  }
  if (marketPatch.market_type === "SPECIAL_MARKET") {
    upsertMarketListItem("specialMarkets", marketPatch);
    mergeSpecialMarketChartPoints(marketPatch);
  }
}

function getDisplayChartPoints(market) {
  if (isBtcMarket(market) && market?.id !== state.market?.id) {
    const points = state.btcCharts.get(market.id) || [];
    if (points.length) {
      return points;
    }
  }

  if (!isPredictionListMarket(market)) {
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

  const points = isSpecialMarket(market)
    ? state.specialMarketCharts.get(market.id) || []
    : (isTopMarket(market) || isSportsListMarket(market))
    ? state.topMarketCharts.get(market.id) || []
    : state.worldCupCharts.get(market.id) || [];
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

function getDisplaySecondaryChartPoints(market) {
  return isSpecialMarket(market)
    ? state.specialNoMarketCharts.get(market.id) || []
    : [];
}

function normalizeChartPrice(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric <= 1.5 ? numeric * 100 : numeric;
}

// Copy the current chart frame into an offscreen canvas so the next frame can
// dissolve it into the new market (used for the market-switch crossfade).
function captureChartSnapshot(canvas) {
  if (!canvas || canvas.width < 2 || canvas.height < 2) {
    chartSnapshotCanvas = null;
    return;
  }
  if (!chartSnapshotCanvas) {
    chartSnapshotCanvas = document.createElement("canvas");
  }
  if (chartSnapshotCanvas.width !== canvas.width || chartSnapshotCanvas.height !== canvas.height) {
    chartSnapshotCanvas.width = canvas.width;
    chartSnapshotCanvas.height = canvas.height;
  }
  const sctx = chartSnapshotCanvas.getContext("2d");
  if (!sctx) {
    chartSnapshotCanvas = null;
    return;
  }
  sctx.clearRect(0, 0, chartSnapshotCanvas.width, chartSnapshotCanvas.height);
  try {
    sctx.drawImage(canvas, 0, 0);
  } catch {
    chartSnapshotCanvas = null;
  }
}

// The user's own open bet on a market (largest by stake), for the chart label.
function getMyChartBet(market) {
  if (!market?.id || !state.user) {
    return null;
  }
  const mine = (state.positions || []).filter(
    (p) => p.market_id === market.id && p.status === "open" && Number(p.shares || 0) > 0,
  );
  if (!mine.length) {
    return null;
  }
  mine.sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0));
  const p = mine[0];
  return {
    side: p.side === "YES" ? "YES" : "NO",
    spent: Number(p.spent || 0),
    shares: Number(p.shares || 0),
    currency: normalizeCurrency(p.currency),
  };
}

// Искра пересечения таргет-линии: цена пробивает цель — главный драматический
// момент ставки, он должен ощущаться (вспышка + волна по линии + хаптика).
let chartCrossFx = null;
let chartCrossPrevSide = 0;
let chartCrossLastAt = 0;
let chartCrossMarketId = null;

function detectTargetCross(market, openPrice) {
  const crossSide = state.smoothedPrice >= openPrice ? 1 : -1;
  if (chartCrossMarketId !== market.id) {
    // Новый рынок: запоминаем сторону без эффекта, чтобы не мигать на переключении.
    chartCrossMarketId = market.id;
    chartCrossPrevSide = crossSide;
    return;
  }
  if (crossSide === chartCrossPrevSide) {
    return;
  }
  chartCrossPrevSide = crossSide;
  const now = performance.now();
  // Троттлинг: когда цена "едет по линии", не превращаем график в стробоскоп.
  if (market.status !== "open" || now - chartCrossLastAt < 1500) {
    return;
  }
  chartCrossLastAt = now;
  const sparks = [];
  for (let i = 0; i < 8; i += 1) {
    sparks.push({
      vx: (Math.random() - 0.5) * 90,
      vy: -crossSide * (18 + Math.random() * 70),
      size: 1.4 + Math.random() * 1.6,
    });
  }
  chartCrossFx = { start: now, dir: crossSide, sparks };
  triggerHaptic("light");
}

function drawTargetCrossFx(ctx, latest, openY, width) {
  if (!chartCrossFx || !latest) {
    return;
  }
  const k = (performance.now() - chartCrossFx.start) / 700;
  if (k >= 1) {
    chartCrossFx = null;
    return;
  }
  const rgb = chartCrossFx.dir > 0 ? "25,195,125" : "239,70,111";
  const cx = latest.x;
  const easeOut = 1 - (1 - k) ** 3;

  // Волна энергии, разбегающаяся по таргет-линии от точки пробоя.
  const spread = Math.max(12, easeOut * width * 0.55);
  const lineGrad = ctx.createLinearGradient(cx - spread, 0, cx + spread, 0);
  lineGrad.addColorStop(0, `rgba(${rgb},0)`);
  lineGrad.addColorStop(0.5, `rgba(${rgb},${(0.85 * (1 - k)).toFixed(3)})`);
  lineGrad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(cx - spread, openY);
  ctx.lineTo(cx + spread, openY);
  ctx.stroke();

  // Расходящееся кольцо в точке пробоя.
  const ringK = Math.min(1, k / 0.6);
  ctx.strokeStyle = `rgba(${rgb},${(0.65 * (1 - ringK)).toFixed(3)})`;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(cx, openY, 4 + (1 - (1 - ringK) ** 3) * 24, 0, Math.PI * 2);
  ctx.stroke();

  // Сноп искр в сторону пробоя.
  const t = k * 0.7; // сек с момента пробоя
  ctx.fillStyle = `rgba(${rgb},${(0.9 * (1 - k)).toFixed(3)})`;
  for (const spark of chartCrossFx.sparks) {
    const sx = cx + spark.vx * t;
    const sy = openY + spark.vy * t;
    ctx.fillRect(sx - spark.size / 2, sy - spark.size / 2, spark.size, spark.size);
  }

  // Вспышка на самой точке.
  ctx.fillStyle = `rgba(255,255,255,${(0.8 * (1 - k)).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(cx, openY, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawMarketChartFrame(ts) {
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

  // Pause the loop while a sheet covers the chart; it resumes on sheet close.
  if (isBlockingSheetOpen()) {
    state.chartRaf = null;
    return;
  }

  // ~30fps cap: the per-frame work (up to ~80 avatar draws with shadows/clips,
  // the path, gradients and labels) is the app's heaviest loop; halving its rate
  // roughly halves that cost with no visible difference on a price chart.
  const nowTs = typeof ts === "number" ? ts : performance.now();
  if (lastChartDrawTs && nowTs - lastChartDrawTs < CHART_FRAME_MS) {
    state.chartRaf = requestAnimationFrame(drawMarketChartFrame);
    return;
  }
  lastChartDrawTs = nowTs;

  const { dpr, width, height } = resizeCanvas(canvas);
  const appBg = getAppBgColor();
  const worldCup = isPredictionListMarket(market);
  const dualSportsChart = isSportsListMarket(market)
    && isNamedSportsOutcome(market, "YES")
    && isNamedSportsOutcome(market, "NO");
  const dualSpecialChart = isSpecialMarket(market);
  const dualOutcomeChart = dualSportsChart || dualSpecialChart;
  const aquariumAllowed = syncAquariumRuntimeForMarket(market);
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
  const currentNoPrice = dualSpecialChart
    ? Math.max(0.1, Math.min(99.9, Number(market.no_price || 0.5) * 100))
    : 100 - currentPrice;
  if (dualSpecialChart) {
    if (!state.smoothedNoPrice || Math.abs(state.smoothedNoPrice - currentNoPrice) > 25) {
      state.smoothedNoPrice = currentNoPrice;
    } else {
      state.smoothedNoPrice += (currentNoPrice - state.smoothedNoPrice) * 0.045;
    }
  }
  if (!worldCup && Number.isFinite(openPrice) && openPrice > 0) {
    detectTargetCross(market, openPrice);
  }

  const sourcePoints = getSortedChartPoints(market);
  const endTime = new Date(market.end_time).getTime();
  const nowMs = Date.now();
  const historyStart = sourcePoints[0]?.at;
  const historyEnd = sourcePoints[sourcePoints.length - 1]?.at;
  const btc = isBtcMarket(market);
  const btcFiveMinute = isBtcFiveMinuteMarket(market);
  const fullHistoryChart = (worldCup || (btc && !btcFiveMinute)) && sourcePoints.length > 1;
  const marketStartTime = new Date(market.start_time).getTime();
  const marketDurationMs = Math.max(CHART_WINDOW_MS, endTime - marketStartTime);
  const btcFiveMinuteWindowMs = Math.max(CHART_WINDOW_MS, marketDurationMs * BTC_5M_CHART_HISTORY_RATIO);
  const windowEnd = (worldCup || btc) && sourcePoints.length > 1
    ? Math.max(nowMs, historyEnd || nowMs)
    : Math.min(endTime, nowMs);
  const startTime = fullHistoryChart
    ? historyStart
    : (worldCup ? windowEnd - CHART_WINDOW_MS : marketStartTime);
  const windowStart = fullHistoryChart
    ? startTime
    : Math.max(startTime, windowEnd - (btcFiveMinute ? btcFiveMinuteWindowMs : CHART_WINDOW_MS));
  const duration = Math.max(1, windowEnd - windowStart);
  const rawPoints = sourcePoints
    .filter((point) => fullHistoryChart || (point.at >= windowStart - 1_500 && point.at <= windowEnd + 1_500));

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

  const secondaryRawPoints = dualSpecialChart
    ? getSortedSecondaryChartPoints(market)
      .filter((point) => fullHistoryChart || (point.at >= windowStart - 1_500 && point.at <= windowEnd + 1_500))
      .map((point) => ({ ...point }))
    : (dualSportsChart ? rawPoints.map((point) => ({ ...point, price: 100 - point.price })) : []);
  if (dualSpecialChart && secondaryRawPoints.length === 0) {
    secondaryRawPoints.push({ price: currentNoPrice, at: windowEnd });
  }
  if (dualSpecialChart && secondaryRawPoints.length > 0) {
    secondaryRawPoints[secondaryRawPoints.length - 1] = {
      ...secondaryRawPoints[secondaryRawPoints.length - 1],
      price: state.smoothedNoPrice,
      at: windowEnd,
    };
  }
  const prices = [
    ...rawPoints.map((point) => point.price),
    ...secondaryRawPoints.map((point) => point.price),
    openPrice,
  ].filter(Number.isFinite);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = dualOutcomeChart
    ? Math.max(2.5, (maxPrice - minPrice) * 0.08)
    : (worldCup ? Math.max(1.8, (maxPrice - minPrice) * 0.56) : Math.max(4, (maxPrice - minPrice) * 0.42));
  const targetMin = dualOutcomeChart ? Math.max(-2, minPrice - padding) : minPrice - padding;
  const targetMax = dualOutcomeChart ? Math.min(102, maxPrice + padding) : maxPrice + padding;
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

  // Market switched -> snapshot the previous frame (still on the canvas) so we can
  // dissolve it into the new chart below. Purely visual; data is untouched.
  if (state.chartLastMarketId !== null && state.chartLastMarketId !== market.id) {
    captureChartSnapshot(canvas);
    state.chartIntroStart = performance.now();
  }
  state.chartLastMarketId = market.id;

  // Интро переключения рынка: старый кадр растворяется, а новая линия
  // прорисовывается слева направо (wipe-клип ниже).
  const introElapsed = state.chartIntroStart ? performance.now() - state.chartIntroStart : CHART_INTRO_MS;
  const intro = Math.min(1, Math.max(0, introElapsed / CHART_INTRO_MS));
  const introEase = 1 - (1 - intro) ** 3;

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

  // Счастливое окно x2: молния + обратный отсчёт, пока окно живо. Легаси
  // is_lucky (флаг на весь раунд) дорисовывается без таймера.
  const luckyUntilTs = market.lucky_until ? Date.parse(market.lucky_until) : 0;
  const luckyLeftSec = Math.max(0, Math.ceil((luckyUntilTs - Date.now()) / 1000));
  maybeAnnounceLuckyWindow(market, luckyLeftSec);
  if ((market.is_lucky || luckyLeftSec > 0) && market.status === "open") {
    const flicker = 0.72 + 0.28 * Math.sin(nowTs * 0.018);
    const luckyX = left + 10 * dpr;
    const luckyY = top + 15 * dpr;
    ctx.save();
    ctx.globalAlpha = flicker;
    ctx.shadowColor = "rgba(183,255,77,0.9)";
    ctx.shadowBlur = 12 * dpr;
    ctx.fillStyle = "#b7ff4d";
    ctx.beginPath();
    ctx.moveTo(luckyX + 8 * dpr, luckyY - 13 * dpr);
    ctx.lineTo(luckyX - 1 * dpr, luckyY + 1 * dpr);
    ctx.lineTo(luckyX + 6 * dpr, luckyY + 1 * dpr);
    ctx.lineTo(luckyX + 2 * dpr, luckyY + 13 * dpr);
    ctx.lineTo(luckyX + 14 * dpr, luckyY - 3 * dpr);
    ctx.lineTo(luckyX + 7 * dpr, luckyY - 3 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 7 * dpr;
    ctx.font = `900 ${Math.max(10, width * 0.024)}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(luckyLeftSec > 0 ? `x2 · ${luckyLeftSec}с` : "x2", luckyX + 20 * dpr, luckyY + 1 * dpr);
    ctx.restore();
  }

  const openY = scaleY(openPrice);
  const referenceY = dualOutcomeChart ? scaleY(50) : openY;
  ctx.setLineDash([8, 9]);
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(left, referenceY);
  ctx.lineTo(right, referenceY);
  ctx.stroke();
  ctx.setLineDash([]);

  const targetAbove = openY < scaleY(state.smoothedPrice || currentPrice);
  const targetLabel = dualOutcomeChart
    ? "50%"
    : worldCup
      ? `${formatCents((state.smoothedPrice || currentPrice) / 100)} YES`
      : `TARGET ${targetAbove ? "↑" : "↓"}`;
  ctx.font = `${Math.max(10, width * 0.026)}px Inter, system-ui, sans-serif`;
  const targetTextWidth = ctx.measureText(targetLabel).width + 20;
  const targetX = Math.min(right - targetTextWidth, Math.max(left, currentX + width * 0.08));
  const targetY = Math.max(top + 4, Math.min(bottom - 22, referenceY - 14));
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
  const secondaryPathPoints = secondaryRawPoints.map((point) => ({
    x: scaleX(point.at),
    y: scaleY(point.price),
  }));
  const isUp = state.smoothedPrice >= openPrice;
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, dualOutcomeChart || isUp ? "rgba(25,195,125,0.20)" : "rgba(239,70,111,0.22)");
  gradient.addColorStop(1, "rgba(8,13,22,0)");

  const wipeActive = intro < 1 && pathPoints.length > 1;
  if (wipeActive) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, left + (right - left) * introEase, height);
    ctx.clip();
  }

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

    ctx.strokeStyle = dualOutcomeChart || isUp ? "#19c37d" : "#ef466f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawSmoothPath(ctx, pathPoints);

    if (secondaryPathPoints.length > 1) {
      ctx.save();
      ctx.strokeStyle = "#ef466f";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(239,70,111,0.24)";
      ctx.shadowBlur = 7;
      drawSmoothPath(ctx, secondaryPathPoints);
      ctx.restore();
    }

    const chartTrades = getChartTradesForMarket(market, windowStart, windowEnd);
    // Only snapshot avatars when the aquarium is on, and at most ~3x/sec, so the
    // chart's hot render loop is not allocating a fresh snapshot every frame.
    const captureAvatars = aquariumAllowed && isAquariumEnabled() && nowMs - (state.aquariumSnapAt || 0) > 300;
    const frameAvatars = captureAvatars ? [] : null;
    chartTrades.forEach((trade) => {
      const x = scaleX(trade.at);
      const tradePath = dualOutcomeChart && trade.side === "NO"
        ? secondaryPathPoints
        : pathPoints;
      const nearest = nearestPathPoint(tradePath, x);
      const own = String(trade.telegram_id || "") === String(state.user?.telegram_id || "");
      const lineDirection = dualOutcomeChart
        ? (trade.side === "NO" ? 1 : -1)
        : (own ? -1 : 1);
      const dotY = nearest.y + lineDirection * (own ? 8 : 7);
      const avatarRadius = Math.max(own ? 5.2 : 4.2, CHART_AVATAR_RADIUS_CSS * dpr);
      const avatarY = dotY;
      if (captureAvatars) {
        frameAvatars.push({
          xFrac: x / width,
          yFrac: avatarY / height,
          url: getTradeAvatarUrl(trade),
          color: getTradeAvatarColor(trade),
          initial: getTradeAvatarInitial(trade),
          side: trade.side === "YES" ? "YES" : "NO",
        });
      }
      drawChartTradeAvatar(ctx, trade, x, avatarY, avatarRadius, {
        left,
        right: currentX - 2 * dpr,
        top: top + 2 * dpr,
        bottom: bottom - 2 * dpr,
      });
    });
    if (captureAvatars) {
      state.aquariumSnapshot = { marketId: String(market.id || ""), avatars: frameAvatars };
      state.aquariumSnapAt = nowMs;
    }
  }

  const latest = pathPoints[pathPoints.length - 1];
  const secondaryLatest = secondaryPathPoints[secondaryPathPoints.length - 1];
  if (latest) {
    const headRgb = dualOutcomeChart || isUp ? "25,195,125" : "239,70,111";
    const pulse = 0.5 + 0.5 * Math.sin(nowTs * 0.005);

    // Хвост кометы: последние ~44px пути подсвечены градиентом к голове.
    let tailStart = pathPoints.length - 1;
    let tailLen = 0;
    while (tailStart > 0 && tailLen < 44) {
      tailLen += Math.hypot(
        pathPoints[tailStart].x - pathPoints[tailStart - 1].x,
        pathPoints[tailStart].y - pathPoints[tailStart - 1].y,
      );
      tailStart -= 1;
    }
    if (tailStart < pathPoints.length - 1) {
      const tailFrom = pathPoints[tailStart];
      const tailGrad = ctx.createLinearGradient(tailFrom.x, tailFrom.y, latest.x, latest.y);
      tailGrad.addColorStop(0, `rgba(${headRgb},0)`);
      tailGrad.addColorStop(1, `rgba(${headRgb},${(0.2 + pulse * 0.18).toFixed(3)})`);
      ctx.strokeStyle = tailGrad;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(tailFrom.x, tailFrom.y);
      for (let i = tailStart + 1; i < pathPoints.length; i += 1) {
        ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
      }
      ctx.stroke();
    }

    // Пульсирующее ядро с дышащим ореолом.
    ctx.fillStyle = dualOutcomeChart || isUp ? "#19c37d" : "#ef466f";
    ctx.shadowColor = dualOutcomeChart || isUp ? "rgba(25,195,125,0.55)" : "rgba(239,70,111,0.52)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(latest.x, latest.y, 5.5 + pulse * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${headRgb},${(0.34 - pulse * 0.22).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(latest.x, latest.y, 9 + pulse * 4.5, 0, Math.PI * 2);
    ctx.stroke();

    const currentLabel = dualOutcomeChart
      ? `${marketButtonSideLabel(market, "YES")} ${(state.smoothedPrice || currentPrice).toFixed(1)}%`
      : worldCup
        ? `${(state.smoothedPrice || currentPrice).toFixed(1)}%`
      : `$${formatPrice(state.smoothedPrice || currentPrice)}`;
    ctx.font = `${Math.max(12, width * 0.034)}px Inter, system-ui, sans-serif`;
    const currentTextWidth = ctx.measureText(currentLabel).width + 18;
    const labelX = Math.min(width - currentTextWidth - 8, latest.x + 12);
    let labelY = Math.max(top + 4, Math.min(bottom - 28, latest.y - 14));
    let secondaryLabelY = secondaryLatest
      ? Math.max(top + 4, Math.min(bottom - 28, secondaryLatest.y - 14))
      : 0;
    if (secondaryLatest && Math.abs(labelY - secondaryLabelY) < 24) {
      labelY = Math.max(top + 2, labelY - 13);
      secondaryLabelY = Math.min(bottom - 24, secondaryLabelY + 13);
    }
    ctx.fillStyle = dualOutcomeChart || isUp ? "#19c37d" : "#ef466f";
    ctx.shadowColor = "rgba(0,0,0,0.42)";
    ctx.shadowBlur = 9;
    ctx.textBaseline = "middle";
    ctx.fillText(currentLabel, labelX + 9, labelY + 14);
    ctx.shadowBlur = 0;

    if (dualOutcomeChart && secondaryLatest) {
      const secondaryPrice = dualSpecialChart
        ? (state.smoothedNoPrice || currentNoPrice)
        : 100 - (state.smoothedPrice || currentPrice);
      const secondaryLabel = `${marketButtonSideLabel(market, "NO")} ${secondaryPrice.toFixed(1)}%`;
      const secondaryTextWidth = ctx.measureText(secondaryLabel).width + 18;
      const secondaryLabelX = Math.min(width - secondaryTextWidth - 8, secondaryLatest.x + 12);
      const secondaryPulse = 0.5 + 0.5 * Math.sin(nowTs * 0.005 + Math.PI);
      ctx.fillStyle = "#ef466f";
      ctx.shadowColor = "rgba(239,70,111,0.48)";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(secondaryLatest.x, secondaryLatest.y, 4.8 + secondaryPulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = "rgba(0,0,0,0.42)";
      ctx.shadowBlur = 9;
      ctx.fillText(secondaryLabel, secondaryLabelX + 9, secondaryLabelY + 14);
      ctx.shadowBlur = 0;
    }
  }

  if (wipeActive) {
    ctx.restore(); // конец wipe-клипа прорисовки линии
  }

  drawTargetCrossFx(ctx, latest, openY, width);

  // "Your bet" pill in the bottom-left corner when the user holds a position.
  const myBet = getMyChartBet(market);
  if (myBet) {
    const sideColor = myBet.side === "YES" ? "#19c37d" : "#ef466f";
    const seg1 = "Твоя ставка: ";
    const seg2 = `${marketButtonSideLabel(market, myBet.side)} ${formatCurrencyAmount(myBet.spent, myBet.currency)}`;
    const seg3 = ` Win ${formatCurrencyAmount(myBet.shares, myBet.currency)}`;
    const fontPx = Math.max(11, width * 0.024);
    ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const padX = Math.max(8, width * 0.018);
    // Cache the text widths: measureText x3 per frame on a 30-60fps loop is
    // wasteful when the bet text doesn't change between frames.
    const labelKey = `${seg1}|${seg2}|${seg3}|${fontPx.toFixed(1)}`;
    if (!chartBetLabelCache || chartBetLabelCache.key !== labelKey) {
      chartBetLabelCache = {
        key: labelKey,
        w1: ctx.measureText(seg1).width,
        w2: ctx.measureText(seg2).width,
        w3: ctx.measureText(seg3).width,
      };
    }
    const { w1, w2, w3 } = chartBetLabelCache;
    const pillH = Math.max(22, height * 0.105);
    const pillW = w1 + w2 + w3 + padX * 2;
    const pillX = left;
    const pillY = height - pillH - Math.max(4, height * 0.02);
    // Без рамки-обводки, в пару к live-тикеру справа: форму держит чуть более
    // контрастная заливка + волна цвета своей стороны.
    ctx.fillStyle = "rgba(13, 19, 30, 0.88)";
    ctx.beginPath();
    roundedRectPath(ctx, pillX, pillY, pillW, pillH, Math.max(8, height * 0.05));
    ctx.fill();
    const myWash = ctx.createLinearGradient(pillX, 0, pillX + pillW * 0.64, 0);
    myWash.addColorStop(0, myBet.side === "YES" ? "rgba(25, 195, 125, 0.18)" : "rgba(239, 70, 111, 0.16)");
    myWash.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = myWash;
    ctx.fill();
    const cy = pillY + pillH / 2;
    let tx = pillX + padX;
    ctx.fillStyle = "rgba(141, 152, 170, 0.95)";
    ctx.fillText(seg1, tx, cy);
    tx += w1;
    ctx.fillStyle = sideColor;
    ctx.fillText(seg2, tx, cy);
    tx += w2;
    ctx.fillStyle = "rgba(243, 246, 251, 0.96)";
    ctx.fillText(seg3, tx, cy);
  }

  // Live-тикер в правом нижнем углу: та же высота и шрифт, что у плашки
  // "Твоя ставка" слева. Крутит последние сделки из ленты активности;
  // крупная ставка получает мерцающую молнию и золотую рамку. Дёшево:
  // одна плашка + два текста на кадр, замеры текста кэшируются, blur нет.
  // Только на открытом раунде: иначе последний статичный кадр застынет
  // с полупрозрачной плашкой посреди фейда.
  if (market.status === "open") {
    drawLiveTickerPill(ctx, {
      width,
      height,
      nowTs,
      myBetPillEnd: myBet && chartBetLabelCache
        ? left + chartBetLabelCache.w1 + chartBetLabelCache.w2 + chartBetLabelCache.w3 + Math.max(8, width * 0.018) * 2
        : left,
    });
  }

  // Dissolve the previous market's snapshot on top of the new chart so the switch
  // reads as a smooth crossfade instead of an abrupt cut + ragged redraw.
  if (intro < 1 && chartSnapshotCanvas) {
    ctx.save();
    ctx.globalAlpha = 1 - introEase;
    ctx.drawImage(chartSnapshotCanvas, 0, 0, width, height);
    ctx.restore();
  }

  if (
    (market.status === "open" && btc)
    || Math.abs((state.smoothedPrice || 0) - currentPrice) > 0.04
    || (dualSpecialChart && Math.abs((state.smoothedNoPrice || 0) - currentNoPrice) > 0.04)
    || intro < 1
    || chartCrossFx
  ) {
    state.chartRaf = requestAnimationFrame(drawMarketChartFrame);
    return;
  }

  state.chartRaf = null;
}

// --bg статичен, а getComputedStyle в кадре — это принудительный пересчёт
// стилей 30 раз в секунду. Читаем один раз и запоминаем.
let cachedAppBgColor = "";

function getAppBgColor() {
  if (!cachedAppBgColor) {
    cachedAppBgColor = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#080d16";
  }
  return cachedAppBgColor;
}

// Отсортированные точки графика кэшируются между обновлениями данных: раньше
// filter+map+sort пересобирали массив в каждом кадре и кормили GC. Данные
// приходят раз в ~1.5с, ключ (id, длина, крайние at) ловит каждое обновление.
let chartPointsCacheKey = "";
let chartPointsCacheList = [];
let secondaryChartPointsCacheKey = "";
let secondaryChartPointsCacheList = [];

function getSortedChartPoints(market) {
  const source = getDisplayChartPoints(market);
  const length = source.length;
  const key = `${market.id}:${length}:${length ? source[0].at : 0}:${length ? source[length - 1].at : 0}`;
  if (chartPointsCacheKey !== key) {
    chartPointsCacheKey = key;
    chartPointsCacheList = source
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at))
      .sort((a, b) => a.at - b.at);
  }
  return chartPointsCacheList;
}

function getSortedSecondaryChartPoints(market) {
  const source = getDisplaySecondaryChartPoints(market);
  const length = source.length;
  const key = `${market.id}:${length}:${length ? source[0].at : 0}:${length ? source[length - 1].at : 0}`;
  if (secondaryChartPointsCacheKey !== key) {
    secondaryChartPointsCacheKey = key;
    secondaryChartPointsCacheList = source
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at))
      .sort((a, b) => a.at - b.at);
  }
  return secondaryChartPointsCacheList;
}

// Live-тикер сделок в правом нижнем углу графика. Показывает по очереди
// последние ставки (~3.2с на запись) с плавным появлением/уходом; крупные
// выделяются молнией с альфа-мерцанием — без shadowBlur, чтобы кадр
// оставался дешёвым.
const CHART_TICKER_SLOT_MS = 3_200;
const CHART_TICKER_MAX_ENTRIES = 8;

// Уровни тикера = уровни кнопок ставок (getTierForAmount): минимальная —
// просто ник без молнии, дальше молния крупнее и ярче, максимальная ($100 /
// топ по звёздам) — золотая с мягким свечением. Вместо рамок-обводок уровень
// подсвечивает мягкая заливка-волна изнутри плашки (язык карточек приложения).
const CHART_TICKER_TIER_SPEC = {
  2: { bolt: 0.42, flick: 0.2, wash: "rgba(147, 217, 78, 0.14)", name: "rgba(141, 152, 170, 0.95)", boltColor: "#93d94e", glow: false },
  3: { bolt: 0.54, flick: 0.28, wash: "rgba(183, 255, 77, 0.2)", name: "rgba(221, 255, 229, 0.96)", boltColor: "#b7ff4d", glow: false },
  4: { bolt: 0.66, flick: 0.34, wash: "rgba(255, 214, 92, 0.26)", name: "rgba(255, 224, 130, 0.98)", boltColor: "#ffe66d", glow: true },
};

// Свечение топ-уровня — пререндеренный радиальный спрайт: один drawImage
// на кадр вместо дорогого shadowBlur.
let tickerGlowSprite = null;

function getTickerGlowSprite() {
  if (!tickerGlowSprite) {
    const size = 64;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const g = sprite.getContext("2d");
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(255, 230, 109, 0.55)");
    grad.addColorStop(0.6, "rgba(255, 214, 92, 0.16)");
    grad.addColorStop(1, "rgba(255, 214, 92, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    tickerGlowSprite = sprite;
  }
  return tickerGlowSprite;
}

function drawLiveTickerPill(ctx, { width, height, nowTs, myBetPillEnd }) {
  const feed = state.activity;
  if (!Array.isArray(feed) || !feed.length) {
    return;
  }

  const pool = Math.min(feed.length, CHART_TICKER_MAX_ENTRIES);
  const slot = Math.floor(nowTs / CHART_TICKER_SLOT_MS);
  const trade = feed[slot % pool];
  if (!trade) {
    return;
  }

  // Плавный вход/выход внутри слота.
  const phase = (nowTs % CHART_TICKER_SLOT_MS) / CHART_TICKER_SLOT_MS;
  const alpha = Math.min(1, phase / 0.09, (1 - phase) / 0.09);
  if (alpha <= 0.01) {
    return;
  }

  const tier = getTierForAmount(trade.amount, trade.currency);
  const spec = CHART_TICKER_TIER_SPEC[tier] || null;
  const rawName = formatUserDisplayName(trade, { preferAt: false });
  const name = rawName.length > 12 ? `${rawName.slice(0, 11)}…` : rawName;
  const seg1 = `${name} `;
  const verb = (trade.action || "BUY") === "SELL" ? "продал" : "ставит";
  const seg2 = `${verb} ${getActivitySideLabel(trade)} ${formatCurrencyAmount(trade.amount, trade.currency)}`;
  const fontPx = Math.max(11, width * 0.024);
  ctx.font = `${fontPx}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const labelKey = `${trade.id}|${seg1}|${seg2}|${fontPx.toFixed(1)}`;
  if (!chartTickerLabelCache || chartTickerLabelCache.key !== labelKey) {
    chartTickerLabelCache = {
      key: labelKey,
      w1: ctx.measureText(seg1).width,
      w2: ctx.measureText(seg2).width,
    };
  }
  const { w1, w2 } = chartTickerLabelCache;

  const padX = Math.max(8, width * 0.018);
  const pillH = Math.max(22, height * 0.105);
  const boltW = spec ? pillH * spec.bolt : 0;
  const pillW = boltW + w1 + w2 + padX * 2;
  // Отступ от правого края зеркален левой плашке (4% ширины): кромка графика
  // (2%) слишком близко — плашка липла к стенке.
  const pillX = width * 0.96 - pillW;
  const pillY = height - pillH - Math.max(4, height * 0.02);

  // Не наезжаем на плашку своей ставки слева: если тесно, тикер не рисуем.
  if (pillX < myBetPillEnd + Math.max(6, width * 0.012)) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(13, 19, 30, 0.88)";
  ctx.beginPath();
  roundedRectPath(ctx, pillX, pillY, pillW, pillH, Math.max(8, height * 0.05));
  ctx.fill();
  if (spec) {
    // Волна цвета уровня от молнии в сторону текста; путь плашки ещё активен.
    const washGradient = ctx.createLinearGradient(pillX, 0, pillX + pillW * 0.64, 0);
    washGradient.addColorStop(0, spec.wash);
    washGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = washGradient;
    ctx.fill();
  }

  const cy = pillY + pillH / 2;
  let tx = pillX + padX;

  if (spec) {
    // Молния мерцанием альфы (как у lucky-раунда), заливка без теней.
    // Чем выше уровень — тем крупнее молния и глубже мерцание.
    const flicker = (1 - spec.flick) + spec.flick * Math.sin(nowTs * 0.018);
    const bs = pillH * spec.bolt * 0.5;
    const bx = tx + boltW * 0.4;
    if (spec.glow) {
      const glowR = pillH * 0.62;
      ctx.save();
      ctx.globalAlpha = alpha * (0.45 + 0.55 * flicker);
      ctx.drawImage(getTickerGlowSprite(), bx - glowR, cy - glowR, glowR * 2, glowR * 2);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = alpha * flicker;
    ctx.fillStyle = spec.boltColor;
    ctx.beginPath();
    ctx.moveTo(bx + bs * 0.55, cy - bs);
    ctx.lineTo(bx - bs * 0.35, cy + bs * 0.1);
    ctx.lineTo(bx + bs * 0.15, cy + bs * 0.1);
    ctx.lineTo(bx - bs * 0.15, cy + bs);
    ctx.lineTo(bx + bs * 0.75, cy - bs * 0.2);
    ctx.lineTo(bx + bs * 0.25, cy - bs * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    tx += boltW;
  }

  ctx.fillStyle = spec ? spec.name : "rgba(141, 152, 170, 0.95)";
  ctx.fillText(seg1, tx, cy);
  tx += w1;
  ctx.fillStyle = trade.side === "YES" ? "#19c37d" : "#ef466f";
  ctx.fillText(seg2, tx, cy);
  ctx.restore();
}

// pathPoints отсортированы по x: ближайшую к аватарке точку линии ищем
// бинарным поиском вместо полного reduce-перебора на каждый трейд в кадре.
function nearestPathPoint(points, x) {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return Math.abs(points[lo].x - x) <= Math.abs(points[hi].x - x) ? points[lo] : points[hi];
}

// A full-screen sheet (tasks/wallet/clans/etc.) covers the chart, so there's no
// reason to keep repainting it behind them — doing so churns the compositor
// (visible jitter on the open sheet) and burns CPU/heat.
function isBlockingSheetOpen() {
  return Boolean(document.querySelector(".task-sheet.sheet-open"));
}

function renderMarketChart() {
  if (syncAquariumRuntimeForMarket()) {
    primeAquarium();
  }
  if (state.chartRaf || isBlockingSheetOpen()) {
    return;
  }
  state.chartRaf = requestAnimationFrame(drawMarketChartFrame);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.remove("toast-show");
  void toast.offsetWidth;
  toast.classList.add("toast-show");
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

function triggerLightningFlash(kind = "success", tier = 1, options = {}) {
  showSuccessLightningBurst(kind === "success" ? "Success" : "Energy", {
    tier,
    epic: options.epic,
  });
}

// Fly a small reward token from a source element toward the fire balance.
function flyRewardToBalance(fromEl, glyph = "⭐") {
  if (prefersReducedMotion()) {
    return;
  }
  const target = $("fireBalance") || $("balance");
  if (!fromEl?.getBoundingClientRect || !target) {
    return;
  }
  const from = fromEl.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) {
    return;
  }
  const startX = from.left + from.width / 2;
  const startY = from.top + from.height / 2;
  const coin = document.createElement("div");
  coin.className = "reward-coin";
  coin.textContent = glyph;
  coin.style.left = `${startX}px`;
  coin.style.top = `${startY}px`;
  coin.style.setProperty("--dx", `${to.left + to.width / 2 - startX}px`);
  coin.style.setProperty("--dy", `${to.top + to.height / 2 - startY}px`);
  document.body.appendChild(coin);
  window.setTimeout(() => coin.remove(), 760);
}

function captureAnimationOrigin(element) {
  const rect = element?.getBoundingClientRect?.();
  return rect && rect.width && rect.height
    ? { getBoundingClientRect: () => rect }
    : null;
}

function playTaskRewardAnimation(sourceElement = null, rowElement = null) {
  const origin = sourceElement?.getBoundingClientRect ? captureAnimationOrigin(sourceElement) : sourceElement;
  const claimedRow = rowElement || sourceElement?.closest?.(".task-item, .task-row");
  triggerHaptic("success");
  triggerLightningFlash("success");
  showRewardPop(origin);
  flyRewardToBalance(origin);
  if (claimedRow) {
    claimedRow.classList.remove("task-claimed");
    void claimedRow.offsetWidth;
    claimedRow.classList.add("task-claimed");
    window.setTimeout(() => claimedRow.classList.remove("task-claimed"), 900);
  }
}

function showRoundTransition(market) {
  if (!market?.id || state.lastRoundTransitionMarketId === market.id) {
    return;
  }
  state.lastRoundTransitionMarketId = market.id;
  triggerHaptic("round");
  showRoundSweep("NEXT ROUND");
  showToast("Раунд завершён. Готовлю следующий...");
  // No automatic food fall at round end (kept the phone hot) — the aquarium
  // now only spills food when the user shakes the device.
}

function showTopupSuccessAnimation(label = "TOP UP") {
  triggerHaptic("win");
  showWalletFlowBurst("in", label);
  showSuccessLightningBurst(label, { tier: 4, epic: true });
}

// Quiet, respectful closure on a losing round — a small muted "−$X" that sinks
// and fades over the chart. Not a punishment, just an ending.
function showLossClose(label) {
  if (prefersReducedMotion()) {
    return;
  }
  const host = document.querySelector(".chart-frame");
  if (!host) {
    return;
  }
  const el = document.createElement("div");
  el.className = "loss-close";
  el.textContent = label;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 1700);
  // Несколько частиц пепла оседают вслед за суммой — тихое завершение,
  // сознательно скромнее победного залпа.
  for (let i = 0; i < 8; i += 1) {
    const ash = document.createElement("i");
    ash.className = "loss-ash";
    ash.style.setProperty("--dx", `${((Math.random() - 0.5) * 120).toFixed(0)}px`);
    ash.style.setProperty("--fall", `${(40 + Math.random() * 70).toFixed(0)}px`);
    ash.style.setProperty("--delay", `${(Math.random() * 200).toFixed(0)}ms`);
    ash.style.setProperty("--sz", `${(2 + Math.random() * 2.5).toFixed(1)}px`);
    ash.style.left = `${(44 + Math.random() * 12).toFixed(1)}%`;
    ash.style.top = `${(40 + Math.random() * 12).toFixed(1)}%`;
    host.appendChild(ash);
    window.setTimeout(() => ash.remove(), 2100);
  }
}

// Escalating combo badge for consecutive winning rounds (item 5).
function showStreakCombo(streak) {
  if (prefersReducedMotion()) {
    return;
  }
  const host = document.querySelector(".chart-frame");
  if (!host) {
    return;
  }
  const tier = Math.min(5, Math.max(2, Number(streak) || 2));
  const el = document.createElement("div");
  el.className = `streak-combo tier-${tier}`;
  el.innerHTML = `<b>×${streak}</b><span>серия побед</span>`;
  host.appendChild(el);
  triggerHaptic("selection");
  window.setTimeout(() => el.remove(), 2000);
}

// A gold coin drips into the live clan bank number when it grows (item 6).
function dropClanBankCoin() {
  if (prefersReducedMotion()) {
    return;
  }
  const bank = $("clanWarBank");
  const hero = bank?.closest(".clan-war-hero");
  if (!hero) {
    return;
  }
  const coin = document.createElement("span");
  coin.className = "clan-bank-coin";
  hero.appendChild(coin);
  window.setTimeout(() => coin.remove(), 950);
}

function showWinOverlay(label, value = 0, tier = 1) {
  const overlay = $("winOverlay");
  const amount = $("winOverlayAmount");
  if (!overlay || !amount || !label) {
    return;
  }
  const safeTier = Math.max(1, Math.min(4, Number(tier || 1)));
  const epic = Math.abs(Number(value || 0)) >= 100 || safeTier >= 4;
  showWinCelebration({ tier: safeTier, epic });
  amount.textContent = label;
  overlay.classList.toggle("epic", epic);
  overlay.classList.remove("hidden");
  overlay.classList.remove("show");
  void overlay.offsetWidth;
  overlay.classList.add("show");
  if (state.winOverlayTimer) {
    clearTimeout(state.winOverlayTimer);
  }
  state.winOverlayTimer = window.setTimeout(() => {
    overlay.classList.remove("show");
    overlay.classList.add("hidden");
    state.winOverlayTimer = null;
  }, epic ? 6600 : 4400);
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
  if (isSportsListMarket(market) && market?.starts_at) {
    const startsAt = new Date(market.starts_at);
    const startsAtMs = startsAt.getTime();
    if (Number.isFinite(startsAtMs)) {
      if (isSportsEventLive(market)) {
        const details = [market.score, market.period].filter(Boolean).join(" · ");
        return details ? `Сейчас · ${details}` : "Событие идёт сейчас";
      }
      if (startsAtMs > Date.now()) {
        const day = startsAt.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
        const time = startsAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        return `Начало ${day}, ${time}`;
      }
      if (Date.now() - startsAtMs <= 36 * 60 * 60_000) {
        return "Событие завершилось · ждём итог";
      }
    }
  }
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

  element.classList.remove("balance-pop");
  void element.offsetWidth;
  element.classList.add("balance-pop");
  triggerBalancePulse(element);

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

function parseTelegramDataParams(initData) {
  try {
    return initData ? new URLSearchParams(initData) : new URLSearchParams();
  } catch {
    return new URLSearchParams();
  }
}

function getUrlHashParams() {
  try {
    return new URLSearchParams(window.location.hash.replace(/^#/, ""));
  } catch {
    return new URLSearchParams();
  }
}

function getTelegramLaunchDataParams() {
  const tg = window.Telegram?.WebApp;
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = getUrlHashParams();
  const candidates = [
    tg?.initData,
    searchParams.get("tgWebAppData"),
    hashParams.get("tgWebAppData"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const params = parseTelegramDataParams(candidate);
    if (params.get("user") || params.get("auth_date") || params.get("start_param")) {
      return params;
    }
  }

  if (hashParams.get("user") || hashParams.get("auth_date") || hashParams.get("start_param")) {
    return hashParams;
  }

  return new URLSearchParams();
}

function parseTelegramUserFromParams(params) {
  try {
    const rawUser = params.get("user");
    return rawUser ? JSON.parse(rawUser) : null;
  } catch {
    return null;
  }
}

function parseTelegramInitDataUser(initData) {
  return parseTelegramUserFromParams(parseTelegramDataParams(initData));
}

function parseTelegramStartParam(initData) {
  return parseTelegramDataParams(initData).get("start_param");
}

function getLaunchRefValue() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = getUrlHashParams();
  const telegramDataParams = getTelegramLaunchDataParams();
  return telegramDataParams.get("start_param")
    || hashParams.get("tgWebAppStartParam")
    || searchParams.get("tgWebAppStartParam")
    || searchParams.get("ref")
    || searchParams.get("startapp")
    || searchParams.get("start_param")
    || null;
}

function getTelegramDebugInfo() {
  const tg = window.Telegram?.WebApp;
  const launchDataParams = getTelegramLaunchDataParams();
  if (!tg) {
    const launchUser = parseTelegramUserFromParams(launchDataParams);
    return [
      "Telegram.WebApp: нет",
      `hash data: ${launchDataParams.toString() ? "да" : "нет"}`,
      `hash user: ${launchUser?.id ? "да" : "нет"}`,
      `start: ${getLaunchRefValue() ? "да" : "нет"}`,
    ].join(" · ");
  }

  const unsafeUser = tg.initDataUnsafe?.user;
  const parsedUser = parseTelegramInitDataUser(tg.initData);
  const launchUser = parseTelegramUserFromParams(launchDataParams);
  return [
    "Telegram.WebApp: да",
    `initData: ${tg.initData ? "да" : "нет"}`,
    `unsafe user: ${unsafeUser?.id ? "да" : "нет"}`,
    `parsed user: ${parsedUser?.id ? "да" : "нет"}`,
    `hash user: ${launchUser?.id ? "да" : "нет"}`,
    `start: ${getLaunchRefValue() ? "да" : "нет"}`,
  ].join(" · ");
}

function getTelegramUser() {
  const tg = window.Telegram?.WebApp;
  const params = new URLSearchParams(window.location.search);
  const launchDataParams = getTelegramLaunchDataParams();
  const refParam = getLaunchRefValue();
  const normalizeRef = (value) => {
    const normalized = String(value || "").trim().replace(/^ref_/, "");
    return /^\d+$/.test(normalized) ? normalized : null;
  };

  if (tg) {
    const platform = String(tg.platform || "").toLowerCase();
    const mobileByPlatform = platform === "ios" || platform === "android";
    const mobileByViewport = window.matchMedia?.("(pointer: coarse)")?.matches
      && Math.min(window.innerWidth || 0, window.screen?.width || 0) <= 820;
    const mobileShell = mobileByPlatform || mobileByViewport;
    const applyTelegramViewport = () => {
      if (!mobileShell) {
        return;
      }
      const height = Number(tg.viewportStableHeight || tg.viewportHeight || 0);
      if (height > 0) {
        document.documentElement.style.setProperty("--tg-app-height", `${height}px`);
      }
    };
    try {
      document.body.classList.add("telegram-shell");
      document.body.classList.toggle("telegram-ios-shell", platform === "ios" || /iPhone|iPad|iPod/i.test(navigator.userAgent || ""));
      document.body.classList.toggle("telegram-desktop-shell", !mobileShell);
      tg.ready();
      // expand() нужен на всех платформах: Telegram Desktop (Windows/Linux)
      // без него открывает мини-апп сжатой панелью, которую тянут вручную.
      tg.expand();
      if (mobileShell) {
        tg.requestFullscreen?.();
        tg.disableVerticalSwipes?.();
      } else {
        document.documentElement.style.removeProperty("--tg-app-height");
        tg.exitFullscreen?.();
      }
      applyTelegramViewport();
      tg.onEvent?.("viewportChanged", applyTelegramViewport);
    } catch {
      // Older Telegram clients may not support every Mini App display method.
    }
    const user = tg.initDataUnsafe?.user
      || parseTelegramInitDataUser(tg.initData)
      || parseTelegramUserFromParams(launchDataParams);
    const telegramRef = tg.initDataUnsafe?.start_param
      || parseTelegramStartParam(tg.initData)
      || launchDataParams.get("start_param");
    const normalizedUser = normalizeTelegramUser(user, "telegram");
    if (normalizedUser) {
      return {
        ...normalizedUser,
        referred_by_telegram_id: normalizeRef(telegramRef) || normalizeRef(refParam),
      };
    }
  }

  const launchUser = parseTelegramUserFromParams(launchDataParams);
  const normalizedLaunchUser = normalizeTelegramUser(launchUser, "telegram_hash");
  if (normalizedLaunchUser) {
    return {
      ...normalizedLaunchUser,
      referred_by_telegram_id: normalizeRef(launchDataParams.get("start_param")) || normalizeRef(refParam),
    };
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
    renderTaskRewards();
    renderTopupSheet();
  } catch {
    // The UI can still work with local fallback config.
  }
}

function renderTaskRewards() {
  const share = Math.round(Number(state.publicConfig.task_share_fire || 50));
  const sub = Math.round(Number(state.publicConfig.task_subscribe_fire || 300));
  const privateChat = Math.round(Number(state.publicConfig.task_private_chat_fire || 7500));
  const refUsdt = Math.round(Number(state.publicConfig.referral_bet_bonus_usdt || 30));
  const dailyPresence = Math.round(Number(state.publicConfig.task_daily_presence_fire || 13));
  if ($("shareTaskReward")) $("shareTaskReward").textContent = formatFire(share);
  if ($("channelTaskReward")) $("channelTaskReward").textContent = formatFire(sub);
  if ($("chatTaskReward")) $("chatTaskReward").textContent = formatFire(sub);
  if ($("privateChatTaskReward")) $("privateChatTaskReward").textContent = formatFire(privateChat);
  if ($("refTaskUsdtReward")) $("refTaskUsdtReward").textContent = formatFire(refUsdt);
  if ($("dailyPresenceTaskReward")) $("dailyPresenceTaskReward").textContent = formatFire(dailyPresence);
  renderSoundToggle();
  renderAquariumToggle();
  renderTaskSettings();
  renderTaskButtonStates();
  renderShareFriendTask();
}

function renderSoundToggle() {
  const button = $("motionSoundToggleBtn");
  if (!button) return;
  const enabled = isMotionSoundEnabled();
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function renderAquariumToggle() {
  const button = $("aquariumToggleBtn");
  if (!button) return;
  const enabled = isAquariumEnabled();
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
}

function renderTaskSettings() {
  const button = $("taskSettingsToggleBtn");
  const panel = $("taskSettingsPanel");
  const open = state.taskTab === "tasks" && Boolean(state.taskSettingsOpen);
  button?.classList.toggle("active", open);
  button?.classList.toggle("hidden", state.taskTab !== "tasks");
  button?.setAttribute("aria-expanded", open ? "true" : "false");
  panel?.classList.toggle("hidden", !open);
}

function getDailyTaskStatus(taskKey) {
  return state.dailyTasks?.[taskKey] || {
    ready: false,
    claimed: false,
  };
}

function setTaskButtonVisualState(button, status) {
  if (!button) return;
  const claimed = Boolean(status?.claimed);
  const claimable = Boolean(status?.ready) && !claimed;
  const isClaimChip = button.classList.contains("task-claim-chip");
  button.classList.toggle("claimable", claimable);
  button.classList.toggle("claimed", claimed);
  button.classList.toggle("not-ready", !claimable && !claimed);
  if (isClaimChip) {
    const amount = Number(button.dataset.taskAmount || 0);
    button.disabled = !claimable;
    // Забранный дейлик не светит суммой — только галочка, чтобы цифры
    // оставались лишь у невыполненных заданий.
    button.textContent = claimed ? "✓" : claimable ? "Забрать" : `+${formatFire(amount)}`;
    return;
  }
  button.classList.toggle("is-done", claimed);
  button.closest(".task-item")?.querySelector(".task-reward:not(.task-claim-chip)")?.classList.toggle("claimed", claimed);
  if (!claimed && button.dataset.dailyTask) {
    button.textContent = "Забрать";
  }
}

function markDailyTaskClaimed(taskKey) {
  if (!taskKey) return;
  state.dailyTasks = {
    ...state.dailyTasks,
    [taskKey]: {
      ...(state.dailyTasks?.[taskKey] || {}),
      ready: true,
      claimed: true,
    },
  };
  renderTaskButtonStates();
}

// Лестница присутствия: активные минуты за день -> три чекпоинта.
const PRESENCE_LADDER = [
  { key: "daily_presence", minutes: 5 },
  { key: "presence_15", minutes: 15 },
  { key: "presence_30", minutes: 30 },
];

function isTaskClaimedLocally(key) {
  return Boolean(state.presence.claimed[key] || getDailyTaskStatus(key).claimed);
}

function renderTaskButtonStates() {
  document.querySelectorAll("[data-daily-task]").forEach((button) => {
    setTaskButtonVisualState(button, getDailyTaskStatus(button.dataset.dailyTask));
  });
  updatePresenceLadder();
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
  morphSheetContent("tasksSheet", `tasks:${isStats ? "stats" : "rewards"}`, () => {
    $("tasksTabTasks")?.classList.toggle("active", !isStats);
    $("tasksTabStats")?.classList.toggle("active", isStats);
    document.querySelector(".task-list")?.classList.toggle("hidden", isStats);
    $("taskStatsPanel")?.classList.toggle("hidden", !isStats);
    if (isStats) {
      state.taskSettingsOpen = false;
    }
    renderTaskSettings();
  });
}

function renderTaskStats() {
  const list = $("taskStatsList");
  if (!list) return;
  const sheetOpen = isSheetOpen("tasksSheet");
  if (!sheetOpen || state.taskTab !== "stats") {
    return;
  }

  const stats = state.marketStats || [];
  const referralStats = state.referralStats || {};
  const referralTotal = Number(referralStats.total_referrals || 0);
  const referralStarTotal = Number(referralStats.star_total || 0);
  const referralUsdtTotal = Number(referralStats.usdt_total || 0);
  const referralStarProfit = Number(referralStats.star_profit_share || 0);
  const referralUsdtProfit = Number(referralStats.usdt_profit_share || 0);
  // Деньги в одну подпись: пустые валюты не показываем, чтобы не плодить нули.
  const referralMoney = (star, usdt) => {
    const parts = [];
    if (star > 0) parts.push(`★ ${formatCurrencyAmount(star, "STAR")}`);
    if (usdt > 0) parts.push(formatCurrencyAmount(usdt, "USDT"));
    return parts.length ? parts.join(" · ") : "0";
  };
  const friendsWord = (count) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "друг";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "друга";
    return "друзей";
  };
  const referralSummary = referralTotal === 0
    ? `
      <div class="task-referral-summary">
        <div class="task-referral-head">
          <strong>Рефералы</strong>
          <span>пока никого</span>
        </div>
        <small>Пригласи друга: тебе $30 после его первой ставки и 1% с каждой его победы.</small>
      </div>
    `
    : `
      <div class="task-referral-summary">
        <div class="task-referral-head">
          <strong>Рефералы</strong>
          <span>${formatFire(referralTotal)} ${friendsWord(referralTotal)}</span>
        </div>
        <div class="task-referral-rows">
          <div class="task-referral-row">
            <span>Бонусы за приглашения</span>
            <b>${referralMoney(referralStarTotal, referralUsdtTotal)}</b>
          </div>
          <div class="task-referral-row">
            <span>Прибыль за их победы</span>
            <b>${referralMoney(referralStarProfit, referralUsdtProfit)}</b>
          </div>
        </div>
      </div>
    `;
  if (!stats.length) {
    setInnerHtmlIfChanged(list, `
      ${referralSummary}
      <div class="task-stat-empty">
        Пока нет рассчитанных рынков. Сделай ставку и дождись закрытия маркета.
      </div>
    `);
    return;
  }

  // At-a-glance summary above the per-market rows.
  const closed = stats.filter((s) => s.status === "resolved" || Number(s.open_positions_count || 0) === 0);
  const wins = closed.filter((s) => Number(s.pnl || 0) > 0).length;
  const winRate = closed.length ? Math.round((wins / closed.length) * 100) : 0;
  const betsTotal = stats.reduce((sum, s) => sum + Number(s.positions_count || 0), 0);
  const best = stats.reduce((b, s) => (Number(s.pnl || 0) > Number(b ? b.pnl : -Infinity) ? s : b), null);
  const bestText = best && Number(best.pnl || 0) > 0
    ? formatSignedCurrencyAmount(Number(best.pnl), normalizeCurrency(best.currency))
    : "—";
  const summary = `
    <div class="task-stat-summary">
      <div><b>${winRate}%</b><span>винрейт</span></div>
      <div><b>${formatFire(betsTotal)}</b><span>ставок</span></div>
      <div><b class="profit">${escapeHtml(bestText)}</b><span>лучшее</span></div>
    </div>
  `;

  const visibleStats = [...stats].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at || "") || 0;
    const rightTime = Date.parse(right.updated_at || "") || 0;
    return rightTime - leftTime;
  });

  const rows = visibleStats.slice(0, 30).map((stat) => {
    const currency = normalizeCurrency(stat.currency);
    const pnl = Number(stat.pnl || 0);
    const status = stat.open_positions_count > 0 ? "LIVE" : (stat.status === "resolved" ? "CLOSED" : String(stat.status || "").toUpperCase());
    const limitCount = Number(stat.limit_orders_count || 0);
    const filledLimitCount = Number(stat.filled_limit_orders_count || 0);
    const limitText = limitCount > 0
      ? ` · limit ${filledLimitCount ? `${filledLimitCount}/${limitCount}` : limitCount}`
      : "";
    return `
      <div class="task-stat-row pnl-${pnl >= 0 ? "up" : "down"}">
        <div class="task-stat-main">
          <strong>${escapeHtml(getMarketStatTitle(stat))}</strong>
          <small>${escapeHtml(status)} · ${stat.positions_count || 0} поз.${escapeHtml(limitText)} · ${escapeHtml(currency)}</small>
        </div>
        <div class="task-stat-numbers">
          <strong class="${pnl >= 0 ? "profit" : "loss"}">${formatSignedCurrencyAmount(pnl, currency)}</strong>
          <small>ставка ${formatCurrencyAmount(stat.spent || 0, currency)} · выплата ${formatCurrencyAmount(stat.payout || 0, currency)}</small>
        </div>
      </div>
    `;
  }).join("");
  setInnerHtmlIfChanged(list, referralSummary + summary + rows);
}

async function api(path, options = {}) {
  // Таймаут обязателен: зависший fetch держал кнопку задания disabled и
  // runSingleFlight-ключ занятым навсегда — моргнула мобильная сеть, и
  // кнопка «залипала» без анимации и начисления до перезапуска.
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {}),
      },
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || data.status || "request_failed");
      error.detail = data.detail || "";
      throw error;
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
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

function isSheetOpen(id) {
  const element = $(id);
  return Boolean(element && !element.classList.contains("hidden"));
}

function isTelegramWebApp() {
  return Boolean(window.Telegram?.WebApp);
}

function prefersReducedMotion() {
  const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  return reduced && !isTelegramWebApp();
}

function syncSheetOverlayState() {
  const overlayActive = Boolean(document.querySelector(".task-sheet.sheet-open, .task-sheet.sheet-closing"));
  document.body.classList.toggle("sheet-overlay-active", overlayActive);
}

function openSheet(sheetOrId) {
  const sheet = typeof sheetOrId === "string" ? $(sheetOrId) : sheetOrId;
  if (!sheet) return;
  const pendingTimer = sheetCloseTimers.get(sheet);
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
    sheetCloseTimers.delete(sheet);
  }
  sheet.classList.remove("hidden", "sheet-open", "sheet-closing");
  void sheet.offsetWidth;
  sheet.classList.add("sheet-open", "is-revealing");
  syncSheetOverlayState();
  // One-shot content stagger on open; drop the flag so list polls don't replay it.
  window.setTimeout(() => sheet.classList.remove("is-revealing"), 950);
}

function closeSheet(sheetOrId, options = {}) {
  const sheet = typeof sheetOrId === "string" ? $(sheetOrId) : sheetOrId;
  if (!sheet || sheet.classList.contains("hidden")) return;
  const finish = () => {
    sheet.classList.add("hidden");
    sheet.classList.remove("sheet-open", "sheet-closing");
    sheetCloseTimers.delete(sheet);
    syncSheetOverlayState();
    // Resume the chart loop now that the sheet no longer covers it.
    renderMarketChart();
    options.afterClose?.();
  };
  const pendingTimer = sheetCloseTimers.get(sheet);
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
  }
  if (prefersReducedMotion() || options.instant) {
    finish();
    return;
  }
  sheet.classList.add("sheet-closing");
  sheet.classList.remove("sheet-open");
  syncSheetOverlayState();
  const timer = window.setTimeout(finish, options.duration || SHEET_CLOSE_MS);
  sheetCloseTimers.set(sheet, timer);
}

function getSheetPanel(sheetOrId) {
  const sheet = typeof sheetOrId === "string" ? $(sheetOrId) : sheetOrId;
  return sheet?.querySelector(".task-panel, .bet-panel") || null;
}

function beginSheetContentMorph(sheetOrId, viewKey) {
  const sheet = typeof sheetOrId === "string" ? $(sheetOrId) : sheetOrId;
  const panel = getSheetPanel(sheet);
  if (!panel || sheet?.classList.contains("hidden") || sheet?.classList.contains("sheet-closing") || prefersReducedMotion()) {
    if (panel) panel.dataset.motionView = viewKey || "";
    return { panel, viewKey, animate: false, morphHeight: false };
  }

  const previousView = panel.dataset.motionView || "";
  if (previousView === (viewKey || "")) {
    return { panel, viewKey, animate: false, morphHeight: false };
  }

  const pendingTimer = sheetHeightTimers.get(panel);
  if (pendingTimer) {
    window.clearTimeout(pendingTimer);
    sheetHeightTimers.delete(panel);
  }

  // Fixed-height panels keep a stable frame — only crossfade the view, never
  // animate the container height (that height jump is what feels janky).
  const morphHeight = !panel.classList.contains("sheet-stable-height");
  if (morphHeight) {
    const startHeight = panel.getBoundingClientRect().height;
    panel.style.height = `${startHeight}px`;
    panel.style.overflowY = "hidden";
    panel.classList.add("sheet-height-morphing");
  } else {
    // Real view change on a fixed-height panel — start the new view at the top.
    // (This branch only runs when the view actually changed, not on re-renders.)
    panel.scrollTop = 0;
  }
  panel.classList.add("sheet-view-animating");
  return { panel, viewKey, animate: true, morphHeight };
}

function finishSheetContentMorph(morph) {
  const panel = morph?.panel;
  if (!panel) return;
  panel.dataset.motionView = morph.viewKey || "";
  if (!morph.animate) return;

  if (!morph.morphHeight) {
    const timer = window.setTimeout(() => {
      panel.classList.remove("sheet-view-animating");
      sheetHeightTimers.delete(panel);
    }, SHEET_HEIGHT_MORPH_MS);
    sheetHeightTimers.set(panel, timer);
    return;
  }

  const endHeight = panel.scrollHeight;
  window.requestAnimationFrame(() => {
    panel.style.height = `${endHeight}px`;
  });
  const timer = window.setTimeout(() => {
    panel.style.height = "";
    panel.style.overflowY = "";
    panel.classList.remove("sheet-height-morphing", "sheet-view-animating");
    sheetHeightTimers.delete(panel);
  }, SHEET_HEIGHT_MORPH_MS);
  sheetHeightTimers.set(panel, timer);
}

function morphSheetContent(sheetOrId, viewKey, mutate) {
  const morph = beginSheetContentMorph(sheetOrId, viewKey);
  mutate();
  finishSheetContentMorph(morph);
}

function shouldRefreshBtcMarkets() {
  return Boolean(state.selectedBtcMarketId) || isSheetOpen("btcMarketsSheet");
}

function shouldRefreshWorldCupMarkets() {
  return Boolean(state.selectedWorldCupMarketId) || isSheetOpen("worldCupSheet");
}

function shouldRefreshTopMarkets() {
  return Boolean(state.selectedTopMarketId) || isSheetOpen("topMarketsSheet");
}

function shouldRefreshSportsMarkets() {
  return Boolean(state.selectedSportsMarketId) || isSheetOpen("sportsMarketsSheet");
}

function shouldRefreshSpecialMarket() {
  return Boolean(state.selectedSpecialMarketId);
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
      if (shouldRefreshBtcMarkets()) {
        jobs.push(runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined));
      }
      if (shouldRefreshWorldCupMarkets()) {
        jobs.push(runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined));
      }
      if (shouldRefreshTopMarkets()) {
        jobs.push(runSingleFlight("topMarkets", loadTopMarkets).catch(() => undefined));
      }
      if (shouldRefreshSportsMarkets()) {
        jobs.push(runSingleFlight("sportsMarkets", loadSportsMarkets).catch(() => undefined));
      }
      if (shouldRefreshSpecialMarket()) {
        jobs.push(runSingleFlight("specialMarket", loadSpecialMarket).catch(() => undefined));
      }
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
        if (!state.user) {
          window.location.href = buildTelegramMiniAppLaunchUrl(getLaunchRefValue() || "easymarket");
        }
      }, 1_800);
    }
    hideLightningLoader();
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
  state.referralStats = data.referral_stats || null;
  state.dailyTasks = data.daily_tasks || {};
  state.lossRefundOffers = data.loss_refund_offers || [];
  applyAquariumEntitlements(data);
  document.body.classList.remove("auth-only");
  $("authCard").classList.add("hidden");
  setConnection("LIVE", "online");
  renderTaskButtonStates();
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

function rememberChartTrades(trades) {
  const now = Date.now();
  (trades || []).forEach((trade) => {
    if (!trade?.id || !trade.market_id || trade.action === "SELL") {
      return;
    }
    const at = new Date(trade.created_at).getTime();
    if (!Number.isFinite(at)) {
      return;
    }
    const marketId = String(trade.market_id);
    const existing = state.chartTradesByMarket.get(marketId) || [];
    const nextTrade = { ...trade, at };
    const next = [nextTrade, ...existing.filter((item) => item.id !== trade.id)]
      .filter((item) => now - Number(item.at || 0) < 8 * 24 * 60 * 60 * 1000)
      .sort((a, b) => a.at - b.at)
      .slice(-260);
    state.chartTradesByMarket.set(marketId, next);
  });
}

function getChartTradesForMarket(market, windowStart, windowEnd) {
  const marketId = String(market?.id || "");
  if (!marketId) {
    return [];
  }
  const trades = state.chartTradesByMarket.get(marketId) || [];
  return trades
    .filter((trade) => Number.isFinite(trade.at) && trade.at >= windowStart && trade.at <= windowEnd)
    .slice(-80);
}

function stableTradeJitter(value) {
  const source = String(value || "");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 9973;
  }
  return hash / 9973;
}

function buildAquariumFoodForMarket(market) {
  const marketId = String(market?.id || "");
  if (!marketId) {
    return [];
  }
  // Prefer the real on-chart avatar positions (captured each frame) so crumbs
  // fall from where the bets actually sit, not from synthetic time-based spots
  // spread across the edges of the chart.
  if (state.aquariumSnapshot?.marketId === marketId && (state.aquariumSnapshot.avatars || []).length) {
    return state.aquariumSnapshot.avatars;
  }
  // Fallback when no fresh snapshot exists: approximate positions from trade times.
  const trades = (state.chartTradesByMarket.get(marketId) || [])
    .filter((trade) => trade?.action !== "SELL" && Number.isFinite(Number(trade.at)));
  if (!trades.length) {
    return [];
  }

  const marketStart = new Date(market.start_time || 0).getTime();
  const marketEnd = new Date(market.end_time || 0).getTime();
  const firstTradeAt = Math.min(...trades.map((trade) => Number(trade.at)));
  const lastTradeAt = Math.max(...trades.map((trade) => Number(trade.at)));
  const start = Number.isFinite(marketStart) && marketStart > 0 ? marketStart : firstTradeAt;
  const end = Number.isFinite(marketEnd) && marketEnd > start ? marketEnd : Math.max(start + 1, lastTradeAt);
  const duration = Math.max(1, end - start);

  return trades.slice(-80).map((trade, index) => {
    const jitter = stableTradeJitter(trade.id || `${trade.telegram_id}:${index}`);
    const rawX = (Number(trade.at) - start) / duration;
    const xFrac = Math.max(0.07, Math.min(0.93, 0.07 + rawX * 0.86 + (jitter - 0.5) * 0.05));
    const yFrac = Math.max(0.42, Math.min(0.69, 0.5 + jitter * 0.18));
    return {
      xFrac,
      yFrac,
      url: getTradeAvatarUrl(trade),
      color: getTradeAvatarColor(trade),
      initial: getTradeAvatarInitial(trade),
      side: trade.side === "YES" ? "YES" : "NO",
    };
  });
}

function handleActivity(activity) {
  const nextActivity = activity || [];
  rememberChartTrades(nextActivity);
  state.freshActivityIds = new Set();
  if (state.activityLoaded) {
    const freshTrades = nextActivity
      .filter((trade) => !state.seenActivityIds.has(trade.id))
      .slice();
    state.freshActivityIds = new Set(freshTrades.map((trade) => trade.id));
    freshTrades
      .reverse()
      .forEach(showTradeBubble);
    // Badge the Live tab when new trades land and you're not looking at it.
    if (freshTrades.length && state.feedPanel !== "activity") {
      $("feedActivityBtn")?.classList.add("has-new");
    }
  }

  nextActivity.forEach((trade) => state.seenActivityIds.add(trade.id));
  state.activityLoaded = true;
  state.activity = nextActivity;
}

function handleMarketActivity(activity) {
  const marketActivity = activity || [];
  rememberChartTrades(marketActivity);
  if (state.activityLoaded) {
    marketActivity
      .filter((trade) => !state.seenActivityIds.has(trade.id))
      .reverse()
      .forEach(showTradeBubble);
  }

  marketActivity.forEach((trade) => state.seenActivityIds.add(trade.id));
}

function handleSettlements(positions) {
  const allSettled = (positions || []).filter((position) => position.status !== "open");

  if (state.settlementsLoaded) {
    const newSettled = allSettled.filter((position) => !state.seenSettledPositionIds.has(position.id));
    const marketResolved = newSettled.filter((position) => position.status === "resolved");
    const newWins = marketResolved.filter((position) => Number(position.pnl || 0) > 0);
    const newLosses = marketResolved.filter((position) => Number(position.pnl || 0) < 0);

    if (newWins.length) {
      triggerHaptic("win");
      const winsByCurrency = newWins.reduce((map, item) => {
        const currency = normalizeCurrency(item.currency);
        map.set(currency, (map.get(currency) || 0) + Number(item.pnl || 0));
        return map;
      }, new Map());
      const largestWin = Math.max(...newWins.map((item) => Math.abs(Number(item.pnl || 0))));
      const winTier = newWins.reduce((tier, item) => {
        const currency = normalizeCurrency(item.currency);
        const value = Math.abs(Number(item.pnl || 0));
        return Math.max(tier, getTierForAmount(value, currency));
      }, 1);
      const label = Array.from(winsByCurrency.entries())
        .map(([currency, value]) => formatSignedCurrencyAmount(value, currency))
        .join(" · ");
      const primaryWin = Array.from(winsByCurrency.entries())
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
      const primaryPosition = newWins
        .slice()
        .sort((a, b) => Math.abs(Number(b.pnl || 0)) - Math.abs(Number(a.pnl || 0)))[0];
      const primaryMarket = primaryPosition ? getPositionMarket(primaryPosition) : null;
      state.lastWin = {
        amountLabel: primaryWin ? formatSignedCurrencyAmount(primaryWin[1], primaryWin[0]) : label,
        primaryValue: primaryWin ? Math.abs(Number(primaryWin[1])) : 0,
        primaryCurrency: primaryWin ? primaryWin[0] : "USDT",
        label,
        ticker: primaryPosition ? getPositionMarketLabel(primaryPosition, primaryMarket) : "BTC · 5 мин",
        side: primaryPosition?.side || "",
        tier: winTier,
        at: Date.now(),
      };
      showToast(`Есть выигрыш: ${label}`);
      showWinOverlay(label, largestWin, winTier);

      // Win streak (item 5): a clean winning round grows the combo; any loss breaks it.
      if (!newLosses.length) {
        state.winStreak += 1;
        if (state.winStreak >= 2) {
          showStreakCombo(state.winStreak);
        }
      }
    }

    if (newLosses.length) {
      state.winStreak = 0;
      const lossByCurrency = newLosses.reduce((map, item) => {
        const currency = normalizeCurrency(item.currency);
        const lost = Math.abs(Number(item.pnl || 0));
        map.set(currency, (map.get(currency) || 0) + lost);
        return map;
      }, new Map());
      const lossLabel = Array.from(lossByCurrency.entries())
        .filter(([, value]) => value > 0)
        .map(([currency, value]) => `−${formatCurrencyAmount(value, currency)}`)
        .join(" · ");
      if (lossLabel) {
        triggerHaptic("warning");
        showLossClose(lossLabel);
      }
    }
  }

  allSettled.forEach((position) => state.seenSettledPositionIds.add(position.id));
  state.settlementsLoaded = true;
}

async function loadMarket() {
  const data = await api("/api/market/active");
  const previousMarketId = state.market?.id || null;
  state.market = data.market;
  const activeMarketChanged = previousMarketId && data.market?.id && previousMarketId !== data.market.id;
  const pruned = pruneClosedLocalMarkets({ renderLists: true });
  state.chartPoints = mergeChartPoints(data.chart, data.market);
  handleMarketActivity(data.activity || []);
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  if (activeMarketChanged || pruned.changed) {
    const listLoader = isWorldCupMarket(data.market) ? loadWorldCupMarkets : loadBtcMarkets;
    void runSingleFlight(isWorldCupMarket(data.market) ? "worldCupMarkets" : "btcMarkets", listLoader)
      .catch(() => undefined);
  }
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
  state.referralStats = data.referral_stats || null;
  state.dailyTasks = data.daily_tasks || {};
  state.lossRefundOffers = data.loss_refund_offers || [];
  applyAquariumEntitlements(data);
  handleSettlements(state.positions);
  renderMe();
  renderTaskStats();
  if (isSheetOpen("tasksSheet")) {
    renderEngagement();
  }
  renderTaskButtonStates();
}

async function loadRecentMarkets() {
  const data = await api("/api/markets/recent");
  state.recentMarkets = data.markets || [];
  renderRecentMarkets();
}

function applyLeaderboardCache(mode = state.leaderboardMode, currency = state.leaderboardCurrency) {
  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedMode = normalizeLeaderboardMode(mode);
  const cached = state.leaderboardCache[getLeaderboardCacheKey(normalizedMode, normalizedCurrency)];
  state.leaderboard = cached?.players || [];
  state.leaderboardClans = cached?.clans || [];
  return Boolean(cached);
}

async function fetchLeaderboardSnapshot(mode, currency) {
  const normalizedCurrency = normalizeCurrency(currency);
  const normalizedMode = normalizeLeaderboardMode(mode);
  const data = await api(`/api/leaderboard?limit=30&currency=${encodeURIComponent(normalizedCurrency)}&mode=${encodeURIComponent(normalizedMode)}`);
  const cacheKey = getLeaderboardCacheKey(normalizedMode, normalizedCurrency);
  state.leaderboardCache[cacheKey] = {
    players: data.players || [],
    clans: data.clans || [],
  };
  state.leaderboardCacheAt[cacheKey] = Date.now();
  return state.leaderboardCache[cacheKey];
}

async function preloadLeaderboards({ force = false } = {}) {
  if (state.leaderboardPreloadPromise) {
    return state.leaderboardPreloadPromise;
  }

  const selectedCached = applyLeaderboardCache();
  state.leaderboardLoading = !selectedCached;
  renderLeaderboard();

  const jobs = [];
  for (const currency of LEADERBOARD_CURRENCIES) {
    for (const mode of LEADERBOARD_MODES) {
      const cacheKey = getLeaderboardCacheKey(mode, currency);
      const cachedAt = Number(state.leaderboardCacheAt[cacheKey] || 0);
      const cacheFresh = Boolean(state.leaderboardCache[cacheKey] && Date.now() - cachedAt < LEADERBOARD_CACHE_MS);
      if (!force && cacheFresh) {
        continue;
      }
      jobs.push(fetchLeaderboardSnapshot(mode, currency));
    }
  }

  state.leaderboardPreloadPromise = Promise.allSettled(jobs)
    .then((results) => {
      const failed = results.some((result) => result.status === "rejected");
      applyLeaderboardCache();
      state.leaderboardLoading = false;
      renderLeaderboard();
      if (failed) {
        throw new Error("leaderboard_preload_failed");
      }
    })
    .finally(() => {
      state.leaderboardPreloadPromise = null;
    });

  return state.leaderboardPreloadPromise;
}

async function loadClans() {
  if (!state.user?.telegram_id) {
    return;
  }
  state.clansLoading = true;
  renderClans();
  try {
    const data = await api(`/api/clans?telegram_id=${encodeURIComponent(state.user.telegram_id)}`);
    state.clans = data.clans || [];
    state.userClan = data.user_clan || null;
    state.clanWar = data.clan_war || state.clanWar;
    if (!state.clans.some((clan) => clan.id === state.selectedClanId)) {
      state.selectedClanId = state.userClan?.id || state.clans[0]?.id || null;
    }
  } finally {
    state.clansLoading = false;
    renderClans();
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

function formatDurationShort(secondsInput) {
  const seconds = Math.max(0, Math.floor(Number(secondsInput || 0)));
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    return `${days}d ${hours}h`;
  }
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return `${hours}h ${minutes}m`;
  }
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${seconds}s`;
}

function getCalendarMonthDayDiff(endTime, nowTime = Date.now()) {
  const start = new Date(nowTime);
  const end = new Date(endTime);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (!Number.isFinite(endDay.getTime()) || endDay <= startDay) {
    return { months: 0, days: 0 };
  }

  let months = (endDay.getFullYear() - startDay.getFullYear()) * 12
    + endDay.getMonth() - startDay.getMonth();
  const anchor = new Date(startDay);
  anchor.setMonth(anchor.getMonth() + months);
  if (anchor > endDay) {
    months -= 1;
    anchor.setMonth(anchor.getMonth() - 1);
  }

  const days = Math.max(0, Math.floor((endDay - anchor) / 86_400_000));
  return { months: Math.max(0, months), days };
}

async function loadComments() {
  const market = getDisplayMarket();
  if (!market?.id) {
    state.comments = [];
    state.commentsMarketId = null;
    state.commentsOnlineCount = 0;
    state.freshCommentIds = new Set();
    renderComments();
    return;
  }

  const data = await api(`/api/market/${market.id}/comments?limit=30`);
  const nextComments = data.comments || [];
  const sameMarket = state.commentsMarketId === market.id;
  state.freshCommentIds = new Set();
  if (sameMarket && state.commentsLoaded) {
    state.freshCommentIds = new Set(
      nextComments
        .filter((comment) => !state.seenCommentIds.has(`${market.id}:${comment.id}`))
        .map((comment) => `${market.id}:${comment.id}`),
    );
  }

  nextComments.forEach((comment) => state.seenCommentIds.add(`${market.id}:${comment.id}`));
  state.comments = nextComments;
  state.commentsOnlineCount = Number(data.online_count || 0);
  state.appTotalBets = Number(data.total_bets || state.appTotalBets || 0);
  state.commentsMarketId = market.id;
  state.commentsLoaded = true;
  renderComments();
}

function renderComments() {
  const container = $("marketChatList");
  if (!container) {
    return;
  }

  const market = getDisplayMarket();
  if ($("marketChatOnline")) {
    const online = Math.max(0, Math.round(Number(state.commentsOnlineCount || 0))).toLocaleString("ru-RU");
    const bets = Math.max(0, Math.round(Number(state.appTotalBets || 0))).toLocaleString("ru-RU");
    $("marketChatOnline").textContent = `${online} · Ставки: ${bets}`;
  }
  if (!market?.id) {
    setInnerHtmlIfChanged(container, '<p class="muted">Сначала выбери рынок.</p>');
    renderOrderbookPanel();
    return;
  }

  if (state.commentsMarketId !== market.id || !state.comments.length) {
    setInnerHtmlIfChanged(container, "");
    renderOrderbookPanel();
    return;
  }

  const html = state.comments.slice(0, 8).map((comment) => {
    const name = formatUserDisplayName(comment);
    const latestBet = comment.latest_bet;
    const summary = comment.bet_summary || {};
    const isFresh = state.freshCommentIds.has(`${market.id}:${comment.id}`);
    const summaryParts = [];
    if (Number(summary.yes_amount || 0) > 0) {
      summaryParts.push(`${marketSideLabel(market, "YES")} ${formatCurrencyAmount(summary.yes_amount, summary.currency)}`);
    }
    if (Number(summary.no_amount || 0) > 0) {
      summaryParts.push(`${marketSideLabel(market, "NO")} ${formatCurrencyAmount(summary.no_amount, summary.currency)}`);
    }
    const betBadge = summaryParts.length
      ? `<span class="chat-bet side-${latestBet?.side || "YES"}">${summaryParts.join(" · ")}</span>`
      : '<span class="chat-bet muted">без ставки</span>';
    return `
      <div class="chat-row ${isFresh ? "fresh" : ""}">
        <div class="chat-meta">
          <strong>${escapeHtml(name)}</strong>
          <span>${formatRelativeTime(comment.created_at)}</span>
          ${betBadge}
        </div>
        <p>${escapeHtml(comment.message)}</p>
      </div>
    `;
  }).join("");
  setInnerHtmlIfChanged(container, html);
  renderOrderbookPanel();
}

function getOutcomePrice(market, side) {
  const minPrice = getMarketMinOutcomePrice(market);
  const raw = side === "YES" ? Number(market?.yes_price || 0.5) : Number(market?.no_price || 0.5);
  return Math.min(1 - minPrice, Math.max(minPrice, raw));
}

function buildSyntheticOrderbook(market, side) {
  const price = getOutcomePrice(market, side);
  const volume = side === "YES" ? Number(market?.yes_volume || 0) : Number(market?.no_volume || 0);
  const liquidity = Math.max(50, Number(market?.liquidity || 10000));
  const depthBase = Math.max(12, Math.sqrt(liquidity + volume) * 0.7 * MARKET_MAKER_DENSITY_MULTIPLIER);
  const minPrice = getMarketMinOutcomePrice(market);

  if (isSpecialMarket(market)) {
    const weights = [0.22, 0.18, 0.1, 0.1, 0.18, 0.22];
    return weights.map((weight, index) => {
      const direction = index < 3 ? -1 : 1;
      const distance = index < 3 ? 3 - index : index - 2;
      return {
        price: Math.min(1 - minPrice, Math.max(minPrice, price + direction * distance * 0.01)),
        size: Math.round(liquidity * weight),
        type: direction < 0 ? "bid" : "ask",
      };
    }).sort((a, b) => b.price - a.price);
  }

  return Array.from({ length: 5 }, (_, index) => {
    const distance = index + 1;
    const direction = index < 2 ? -1 : 1;
    const step = (0.006 + Math.abs(price - 0.5) * 0.018) * distance;
    const levelPrice = Math.min(1 - minPrice, Math.max(minPrice, price + direction * step));
    const size = Math.max(1, Math.round(depthBase / Math.pow(distance, 0.62)));
    return {
      price: levelPrice,
      size,
      type: direction < 0 ? "bid" : "ask",
    };
  }).sort((a, b) => b.price - a.price);
}

function getLimitOrderDefaultPrice(market, side, orderSide = state.orderbook.orderSide || "BUY") {
  const minPrice = getMarketMinOutcomePrice(market);
  const currentPrice = getOutcomePrice(market, side);
  const offset = orderSide === "SELL" ? 0.01 : -0.01;
  return Math.max(minPrice, Math.min(1 - minPrice, currentPrice + offset));
}

function syncLimitOrderDefaults(market, side) {
  const marketId = Number(market?.id || 0);
  if (state.orderbook.marketId !== marketId || state.orderbook.currency !== state.currency) {
    state.orderbook.marketId = marketId || null;
    state.orderbook.currency = state.currency;
    state.orderbook.levels = [];
    state.orderbook.myOrders = [];
    state.orderbook.loadedAt = 0;
    state.orderbook.formPrice = "";
    state.orderbook.formAmount = "";
  }

  if (!state.orderbook.formPrice && market) {
    state.orderbook.formPrice = outcomePriceToCentsInput(getLimitOrderDefaultPrice(market, side));
  }
  if (!state.orderbook.formAmount) {
    state.orderbook.formAmount = String(state.selectedAmount || getAmountsForCurrency()[0] || 10);
  }
}

function getRealOrderbookRows(side) {
  return (state.orderbook.levels || [])
    .filter((row) => row.side === side && normalizeCurrency(row.currency) === state.currency)
    .map((row) => ({
      price: Number(row.price || 0),
      size: Math.max(1, Math.round(Number(row.amount || 0))),
      shares: Number(row.shares || 0),
      orders_count: Number(row.orders_count || 0),
      order_side: String(row.order_side || "BUY").toUpperCase(),
      type: String(row.order_side || "BUY").toUpperCase() === "SELL" ? "ask" : "bid",
      real: true,
    }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
}

function getSellableLimitPosition(market, side) {
  if (!market?.id) {
    return null;
  }
  return state.positions.find((position) => (
    Number(position.market_id) === Number(market.id)
    && position.side === side
    && position.status === "open"
    && normalizeCurrency(position.currency) === state.currency
    && Number(position.shares || 0) > 0
  )) || null;
}

function renderLimitOrderControls(market, side) {
  const priceInput = $("limitOrderPriceInput");
  const amountInput = $("limitOrderAmountInput");
  const submitButton = $("limitOrderSubmitBtn");
  const buyButton = $("limitOrderBuyBtn");
  const sellButton = $("limitOrderSellBtn");
  if (!priceInput || !amountInput || !submitButton) {
    return;
  }

  syncLimitOrderDefaults(market, side);
  const orderSide = state.orderbook.orderSide || "BUY";
  const minPrice = getMarketMinOutcomePrice(market);
  priceInput.min = outcomePriceToCentsInput(minPrice);
  priceInput.max = outcomePriceToCentsInput(1 - minPrice);
  priceInput.step = "0.1";
  buyButton?.classList.toggle("active", orderSide === "BUY");
  sellButton?.classList.toggle("active", orderSide === "SELL");
  // Drives the submit button colour (green Buy / red Sell).
  $("limitOrderForm")?.classList.toggle("is-sell", orderSide === "SELL");
  if (document.activeElement !== priceInput) {
    priceInput.value = state.orderbook.formPrice || "";
  }
  if (document.activeElement !== amountInput) {
    amountInput.value = state.orderbook.formAmount || "";
  }

  const price = centsInputToOutcomePrice(state.orderbook.formPrice);
  const amount = Number(state.orderbook.formAmount);
  const sellablePosition = getSellableLimitPosition(market, side);
  const sellableValue = Number(sellablePosition?.shares || 0) * price;
  const canSubmit = Boolean(
    market
    && state.user
    && isMarketOpenForBuy(market)
    && Number.isFinite(price)
    && price >= minPrice
    && price <= 1 - minPrice
    && Number.isFinite(amount)
    && amount > 0
    && (orderSide !== "SELL" || (sellablePosition && amount <= sellableValue + 0.00000001))
    && !state.orderbook.pending
  );
  submitButton.disabled = !canSubmit;
  submitButton.textContent = state.orderbook.pending
    ? "Placing..."
    : `${orderSide === "SELL" ? "Sell" : "Buy"} ${marketButtonSideLabel(market, side)}`;
  submitButton.title = marketSideLabel(market, side);
}

function renderMyLimitOrders() {
  const container = $("myLimitOrders");
  if (!container) {
    return;
  }

  const orders = (state.orderbook.myOrders || [])
    .filter((order) => normalizeCurrency(order.currency) === state.currency);
  if (!orders.length) {
    container.innerHTML = `
      <button class="limit-orders-toggle" type="button" data-toggle-limit-orders>
        <span>Мои лимитки</span>
        <b>0</b>
      </button>
    `;
    return;
  }

  container.innerHTML = `
    <button class="limit-orders-toggle ${state.orderbook.myOrdersOpen ? "open" : ""}" type="button" data-toggle-limit-orders>
      <span>Мои лимитки</span>
      <b>${orders.length}</b>
      <small>${state.orderbook.myOrdersOpen ? "Свернуть" : "Показать"}</small>
    </button>
    ${state.orderbook.myOrdersOpen ? orders.map((order) => `
        <div class="my-limit-order">
          <span class="lo-side ${order.order_side === "SELL" ? "sell" : "buy"}" title="${escapeHtml(marketSideLabel(getDisplayMarket(), order.side))}">${order.order_side === "SELL" ? "Sell" : "Buy"} ${escapeHtml(marketButtonSideLabel(getDisplayMarket(), order.side))}</span>
          <b>${formatCents(order.limit_price)}</b>
          <small>${formatCurrencyAmount(order.remaining_reserved, order.currency)}</small>
          <button type="button" data-cancel-limit-order="${order.id}" ${state.orderbook.cancelPendingId === order.id ? "disabled" : ""}>Cancel</button>
        </div>
      `).join("") : ""}
  `;
}

async function loadOrderbook({ force = false } = {}) {
  const market = getDisplayMarket();
  if (!market?.id || !state.user?.telegram_id || state.orderbook.loading) {
    return;
  }

  const now = Date.now();
  const sameBook = state.orderbook.marketId === Number(market.id) && state.orderbook.currency === state.currency;
  if (!force && sameBook && now - state.orderbook.loadedAt < 4_000) {
    return;
  }

  state.orderbook.loading = true;
  renderOrderbookPanel();
  try {
    const data = await api(`/api/market/${market.id}/orderbook?telegram_id=${encodeURIComponent(state.user.telegram_id)}&currency=${encodeURIComponent(state.currency)}`);
    state.orderbook.marketId = Number(market.id);
    state.orderbook.currency = normalizeCurrency(data.currency || state.currency);
    state.orderbook.levels = Array.isArray(data.levels) ? data.levels : [];
    state.orderbook.myOrders = Array.isArray(data.my_orders) ? data.my_orders : [];
    state.orderbook.loadedAt = Date.now();
  } catch {
    // Keep the synthetic book visible even if the network hiccups.
  } finally {
    state.orderbook.loading = false;
    renderOrderbookPanel();
  }
}

function renderOrderbookPanel() {
  const panel = $("marketOrderbookPanel");
  const chatList = $("marketChatList");
  const form = $("marketChatForm");
  const list = $("orderbookList");
  const market = getDisplayMarket();
  if (!panel || !chatList || !form || !list) {
    return;
  }

  const showBook = state.marketPanel === "book";
  panel.classList.toggle("hidden", !showBook);
  chatList.classList.toggle("hidden", showBook);
  form.classList.toggle("hidden", showBook);
  $("marketPanelChatBtn")?.classList.toggle("active", !showBook);
  $("marketPanelBookBtn")?.classList.toggle("active", showBook);
  const yesBookButton = $("orderbookYesBtn");
  const noBookButton = $("orderbookNoBtn");
  if (yesBookButton) {
    yesBookButton.textContent = marketButtonSideLabel(market, "YES");
    yesBookButton.title = marketSideLabel(market, "YES");
    yesBookButton.setAttribute("aria-label", marketSideLabel(market, "YES"));
    yesBookButton.classList.toggle("active", state.orderbookSide === "YES");
  }
  if (noBookButton) {
    noBookButton.textContent = marketButtonSideLabel(market, "NO");
    noBookButton.title = marketSideLabel(market, "NO");
    noBookButton.setAttribute("aria-label", marketSideLabel(market, "NO"));
    noBookButton.classList.toggle("active", state.orderbookSide === "NO");
  }

  if (!showBook || !market) {
    return;
  }

  const side = state.orderbookSide;
  syncLimitOrderDefaults(market, side);
  if (!state.orderbook.loading) {
    void loadOrderbook();
  }
  renderLimitOrderControls(market, side);

  const syntheticRows = buildSyntheticOrderbook(market, side);
  const realRows = getRealOrderbookRows(side);
  const rows = [...realRows, ...syntheticRows].sort((a, b) => b.price - a.price).slice(0, 8);
  const maxSize = Math.max(1, ...rows.map((row) => Number(row.size) || 0));
  const headPrice = formatCents(getOutcomePrice(market, side));
  // Depth as a 0..1 scaleX factor so the bar animates on the compositor (no reflow).
  const depthFor = (row) => Math.round(((Number(row.size) || 0) / maxSize) * 1000) / 1000;
  const existingRows = list.querySelectorAll(".orderbook-row");

  // Same side and row structure already present: update values in place so the
  // depth bars glide via their CSS transition instead of being recreated (which
  // would kill the animation and reset the scroll).
  const bookKey = `${market.id}:${side}:${state.currency}:${realRows.length}`;
  if (list.dataset.bookSide === bookKey && existingRows.length === rows.length) {
    const headEl = list.querySelector(".orderbook-head b");
    if (headEl) headEl.textContent = headPrice;
    const statusEl = list.querySelector(".orderbook-head small");
    if (statusEl) statusEl.textContent = state.orderbook.loading ? "loading" : `${realRows.length} limits`;
    rows.forEach((row, index) => {
      const rowEl = existingRows[index];
      rowEl.className = `orderbook-row ${row.type} ${row.real ? "real" : ""}`.trim();
      rowEl.style.setProperty("--depth", String(depthFor(row)));
      const priceEl = rowEl.querySelector("b");
      const sizeEl = rowEl.querySelector("small");
      const labelEl = rowEl.querySelector("span");
      if (priceEl) priceEl.textContent = formatCents(row.price);
      if (labelEl) labelEl.textContent = row.real
        ? (row.order_side === "SELL" ? "Limit Ask" : "Limit Bid")
        : (row.type === "bid" ? "Bid" : "Ask");
      if (sizeEl) sizeEl.textContent = row.real
        ? `${row.size.toLocaleString("ru-RU")} / ${row.orders_count}`
        : row.size.toLocaleString("ru-RU");
    });
    renderMyLimitOrders();
    return;
  }

  list.innerHTML = `
    <div class="orderbook-head">
      <span title="${escapeHtml(marketSideLabel(market, side))}">${escapeHtml(marketButtonSideLabel(market, side))} book</span>
      <b>${headPrice}</b>
      <small>${state.orderbook.loading ? "loading" : `${realRows.length} limits`}</small>
    </div>
    ${rows.map((row) => `
      <div class="orderbook-row ${row.type} ${row.real ? "real" : ""}" style="--depth:${depthFor(row)}">
        <span>${row.real ? (row.order_side === "SELL" ? "Limit Ask" : "Limit Bid") : (row.type === "bid" ? "Bid" : "Ask")}</span>
        <b>${formatCents(row.price)}</b>
        <small>${row.real ? `${row.size.toLocaleString("ru-RU")} / ${row.orders_count}` : row.size.toLocaleString("ru-RU")}</small>
      </div>
    `).join("")}
  `;
  list.dataset.bookSide = bookKey;
  renderMyLimitOrders();
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

function mergeTopMarketChartPoint(market) {
  if (!market?.id) {
    return;
  }

  const existing = state.topMarketCharts.get(market.id) || [];
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
  state.topMarketCharts.set(market.id, points.slice(-260));
}

function mergeSpecialMarketChartPoints(market) {
  if (!market?.id) {
    return;
  }

  const mergeSide = (map, source, currentPrice) => {
    const existing = map.get(market.id) || [];
    const history = (source || [])
      .map((point) => ({
        price: normalizeChartPrice(point.price),
        at: new Date(point.created_at).getTime(),
      }))
      .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.at));
    const points = existing.length ? existing : history;
    const nextPoint = {
      price: Math.max(0.1, Math.min(99.9, Number(currentPrice || 0.5) * 100)),
      at: Date.now(),
    };
    const lastPoint = points[points.length - 1];
    if (!lastPoint || nextPoint.at - lastPoint.at > 700 || Math.abs(nextPoint.price - lastPoint.price) > 0.02) {
      points.push(nextPoint);
    }
    map.set(market.id, points.slice(-260));
  };

  mergeSide(state.specialMarketCharts, market.chart, market.yes_price);
  mergeSide(state.specialNoMarketCharts, market.chart_no, market.no_price);
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
  const incomingMarkets = [];
  const seenSymbols = new Set();
  for (const market of data.markets || []) {
    if (isMarketClosedForCarousel(market)) continue;
    const symbol = String(market.symbol || market.id);
    if (seenSymbols.has(symbol)) continue;
    seenSymbols.add(symbol);
    incomingMarkets.push(market);
  }
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
  const incomingMarkets = retainPendingExternalMarkets(data.markets || []);
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

async function loadTopMarkets() {
  const data = await api("/api/top/markets");
  const incomingMarkets = retainPendingExternalMarkets(data.markets || []);
  state.topMarkets = incomingMarkets;
  state.topMarkets.forEach(mergeTopMarketChartPoint);
  if (
    state.selectedTopMarketId
    && !state.topMarkets.some((market) => market.id === state.selectedTopMarketId)
  ) {
    state.selectedTopMarketId = null;
  }
  renderTopMarketsList();
  if (state.selectedTopMarketId) {
    renderMarket();
    renderTradeTicket();
    renderMarketChart();
  }
}

async function loadSportsMarkets() {
  const data = await api("/api/sports/markets");
  const incomingMarkets = retainPendingExternalMarkets(data.markets || []);
  state.sportsMarkets = incomingMarkets;
  state.sportsMarkets.forEach(mergeTopMarketChartPoint);
  if (
    state.selectedSportsMarketId
    && !state.sportsMarkets.some((market) => market.id === state.selectedSportsMarketId)
  ) {
    state.selectedSportsMarketId = null;
  }
  renderSportsMarketsList();
  if (state.selectedSportsMarketId) {
    renderMarket();
    renderTradeTicket();
    renderMarketChart();
  }
}

async function loadSpecialMarket() {
  const data = await api("/api/special/kyivstoner");
  const market = data.market;
  state.specialMarkets = market?.status === "open" ? [market] : [];
  if (market) {
    mergeSpecialMarketChartPoints(market);
  }
  if (
    state.selectedSpecialMarketId
    && !state.specialMarkets.some((item) => item.id === state.selectedSpecialMarketId)
  ) {
    state.selectedSpecialMarketId = null;
  }
  if (state.selectedSpecialMarketId) {
    renderMarket();
    renderTradeTicket();
    renderMarketChart();
  }
  return market;
}

function getSelectedPrice() {
  const market = getDisplayMarket();
  if (!market) {
    return 0.5;
  }

  return Number(state.selectedSide === "YES" ? market.yes_price : market.no_price) || 0.5;
}

function getDefaultSideForMarket(market) {
  const yes = Number(market?.yes_price || 0.5);
  const no = Number(market?.no_price || 0.5);
  return yes <= no ? "YES" : "NO";
}

function ensureSelectedSideForMarket(market = getDisplayMarket()) {
  if (!market?.id || state.sideSelectedMarketId === market.id) {
    return;
  }
  state.selectedSide = getDefaultSideForMarket(market);
  state.sideSelectedMarketId = market.id;
}

function getPreview(amount = state.selectedAmount, side = state.selectedSide) {
  const market = getDisplayMarket();
  const quote = estimateBuyQuote({ market, side, amount });
  const safePrice = quote.executionPrice;
  const net = Number(amount || 0);
  const shares = net / safePrice;
  const profit = shares - Number(amount || 0);

  return {
    shares,
    profit,
    price: safePrice,
  };
}

function estimateMarketMakerLiquidity(market, outcomePrice) {
  const rawLiquidity = Math.max(1, Number(market?.liquidity || 10_000));
  const sportsEvent = isSportsListMarket(market);
  const baseLiquidity = sportsEvent
    ? Math.max(3_000, Math.min(45_000, Math.sqrt(rawLiquidity) * 3.2))
    : isPredictionListMarket(market)
      ? Math.max(1_500, Math.min(30_000, Math.sqrt(rawLiquidity) * 2.1))
      : Math.max(1_200, Math.min(24_000, rawLiquidity));
  const distanceFromCenter = Math.min(1, Math.abs(outcomePrice - 0.5) / 0.5);
  const minTailDepth = sportsEvent ? SPORTS_MIN_TAIL_DEPTH_FACTOR : MIN_TAIL_DEPTH_FACTOR;
  const tailExponent = sportsEvent ? SPORTS_TAIL_DEPTH_EXPONENT : 2.35;
  const depthFactor = minTailDepth
    + (1 - minTailDepth) * Math.pow(1 - distanceFromCenter, tailExponent);
  const densityMultiplier = sportsEvent
    ? SPORTS_MARKET_MAKER_DENSITY_MULTIPLIER
    : MARKET_MAKER_DENSITY_MULTIPLIER;
  return Math.max(35, baseLiquidity * densityMultiplier * depthFactor);
}

function estimateBuyQuote({ market, side, amount }) {
  const minPrice = getMarketMinOutcomePrice(market);
  const rawPrice = market
    ? Number(side === "YES" ? market.yes_price : market.no_price)
    : 0.5;
  const price = Math.max(minPrice, Math.min(1 - minPrice, rawPrice || 0.5));
  if (isSpecialMarket(market)) {
    const depth = Math.max(100, Number(market?.liquidity || 7_000));
    const impact = Math.min(SPECIAL_MARKET_MAX_SHIFT, Number(amount || 0) / depth);
    const nextPrice = Math.max(minPrice, Math.min(1 - minPrice, price + impact));
    return {
      executionPrice: Math.max(
        minPrice,
        Math.min(1 - minPrice, ((price + nextPrice) / 2) * (1 + SPECIAL_MARKET_SPREAD_RATE)),
      ),
      nextPrice,
    };
  }
  const liquidity = estimateMarketMakerLiquidity(market, price);
  const impact = Math.min(MAX_SINGLE_TRADE_SHIFT, (Number(amount || 0) / liquidity) * BUY_IMPACT_MULTIPLIER);
  const nextPrice = Math.max(minPrice, Math.min(1 - minPrice, price + impact));
  const executionPrice = Math.max(minPrice, Math.min(1 - minPrice, Math.max(price, nextPrice) * (1 + MARKET_MAKER_SPREAD_RATE)));
  return {
    executionPrice,
    nextPrice,
  };
}

function getBuyIntentKey(marketId, side, amount, currency = state.currency) {
  return `${marketId}:${side}:${Math.round(Number(amount || 0) * 100) / 100}:${normalizeCurrency(currency)}`;
}

function applyBuyIntentSelection(intent) {
  const marketId = Number(intent.marketId);
  const btcMarket = state.btcMarkets.find((market) => market.id === marketId);
  const worldMarket = state.worldCupMarkets.find((market) => market.id === marketId);
  const sportsMarket = state.sportsMarkets.find((market) => market.id === marketId);
  const specialMarket = state.specialMarkets.find((market) => market.id === marketId);
  if (btcMarket) {
    state.selectedBtcMarketId = btcMarket.id === state.market?.id ? null : btcMarket.id;
    state.selectedWorldCupMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSportsMarketId = null;
    state.selectedSpecialMarketId = null;
  } else if (worldMarket) {
    state.selectedWorldCupMarketId = worldMarket.id;
    state.selectedBtcMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSportsMarketId = null;
    state.selectedSpecialMarketId = null;
  } else if (sportsMarket) {
    state.selectedSportsMarketId = sportsMarket.id;
    state.selectedBtcMarketId = null;
    state.selectedWorldCupMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSpecialMarketId = null;
  } else if (specialMarket) {
    state.selectedSpecialMarketId = specialMarket.id;
    state.selectedBtcMarketId = null;
    state.selectedWorldCupMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSportsMarketId = null;
  } else {
    const topMarket = state.topMarkets.find((market) => market.id === marketId);
    if (topMarket) {
      state.selectedTopMarketId = topMarket.id;
      state.selectedBtcMarketId = null;
      state.selectedWorldCupMarketId = null;
      state.selectedSportsMarketId = null;
      state.selectedSpecialMarketId = null;
    }
  }
  state.selectedSide = intent.side;
  state.sideSelectedMarketId = marketId || null;
  state.selectedAmount = intent.amount;
  state.currency = normalizeCurrency(intent.currency || state.currency);
}

function renderMarket() {
  const market = getDisplayMarket();
  ensureSelectedSideForMarket(market);
  const hasMarket = Boolean(market);
  const worldCup = isPredictionListMarket(market);
  const topMarket = isTopMarket(market);
  const sportsMarket = isSportsListMarket(market);
  const specialMarket = isSpecialMarket(market);
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

  document.querySelector(".market-card")?.classList.toggle("top-market-card", topMarket || sportsMarket || specialMarket);
  document.querySelector(".market-card")?.classList.toggle("sports-market-card", sportsMarket);
  document.querySelector(".market-card")?.classList.toggle("special-market-card", specialMarket);

  const marketStatus = $("marketStatus");
  const sportsEventLive = sportsMarket && isSportsEventLive(market);
  marketStatus.textContent = canBuyMarket && sportsMarket
    ? (sportsEventLive ? "LIVE" : "OPEN")
    : marketStatusLabel(canBuyMarket ? market?.status : (market ? "closed" : market?.status));
  marketStatus.classList.toggle("live", canBuyMarket && (!sportsMarket || sportsEventLive));
  $("marketTitle").textContent = worldCup
    ? ((topMarket || sportsMarket || specialMarket) ? (market.title || market.question) : `${market.team} Winner`)
    : (market?.title || "BTC Up or Down 5m");
  const coinBadge = document.querySelector(".coin-badge");
  if (coinBadge) {
    if (worldCup) {
      setTeamIconElement(coinBadge, market.icon, market.team || market.title || market.question);
    } else {
      coinBadge.dataset.icon = "";
      coinBadge.dataset.alt = "";
      coinBadge.textContent = "₿";
    }
    coinBadge.classList.toggle("team", worldCup);
    coinBadge.classList.toggle("special", specialMarket);
  }
  const marketQuestion = $("marketQuestion");
  if (marketQuestion) {
    marketQuestion.textContent = hasMarket ? "" : "Рынок пока не создан.";
  }
  $("marketWindow").textContent = hasMarket ? formatMarketWindow(market) : "--";
  const priceLabels = document.querySelectorAll(".price-board .label");
  if (priceLabels[0]) priceLabels[0].textContent = worldCup ? "Volume" : "Target Price";
  if (priceLabels[1]) {
    priceLabels[1].childNodes[0].nodeValue = worldCup
      ? (sportsMarket ? `${marketButtonSideLabel(market, "YES")} Chance ` : `${marketSideLabel(market, "YES")} Chance `)
      : "Current Price ";
  }
  animateText($("openPrice"), worldCup ? Number(market?.volume || 0) : openPrice, (value) => (
    worldCup ? formatFire(value) : `$${formatPrice(value)}`
  ));
  // Цена тикает чаще (1.5s poll), чем успевает докрутиться барабан, поэтому
  // здесь плавный каунт-ап как у остальных цифр карточки; барабан — только на
  // балансе, где обновления редкие и дискретные.
  animateText($("currentPrice"), currentPrice, (value) => (
    worldCup ? `${value.toFixed(1)}%` : `$${formatPrice(value)}`
  ));
  // Brief green/red glow on the live price when it ticks up or down.
  const priceEl = $("currentPrice");
  const prevPrice = state.lastFlashedPrice;
  if (priceEl && Number.isFinite(prevPrice) && Math.abs(currentPrice - prevPrice) >= Math.max(0.01, Math.abs(prevPrice) * 0.00003)) {
    const dir = currentPrice > prevPrice ? "price-up" : "price-down";
    priceEl.classList.remove("price-up", "price-down");
    void priceEl.offsetWidth; // restart the one-shot animation
    priceEl.classList.add(dir);
  }
  state.lastFlashedPrice = currentPrice;

  const moveElement = $("priceMove");
  moveElement.classList.toggle("positive", priceMove >= 0);
  moveElement.classList.toggle("negative", priceMove < 0);
  animateText(moveElement, priceMove, (value) => (
    worldCup
      ? `${formatCents(yes)} · ${sportsMarket ? marketButtonSideLabel(market, "YES") : marketSideLabel(market, "YES")}`
      : `${value >= 0 ? "▲" : "▼"} $${formatPrice(Math.abs(value))}`
  ));

  renderOutcomeOptionLabel($("yesOptionText"), marketButtonSideLabel(market, "YES"), yes, specialMarket);
  renderOutcomeOptionLabel($("noOptionText"), marketButtonSideLabel(market, "NO"), no, specialMarket);
  $("yesOptionText").closest("button")?.setAttribute("aria-label", `${marketSideLabel(market, "YES")} ${formatCents(yes)}`);
  $("noOptionText").closest("button")?.setAttribute("aria-label", `${marketSideLabel(market, "NO")} ${formatCents(no)}`);
  animateText($("yesVolume"), yesVolume, formatFire);
  animateText($("noVolume"), noVolume, formatFire);
  $("depthYesBar").parentElement.style.setProperty("--yes-depth", `${yesDepth}%`);
  document.querySelector(".market-depth")?.classList.toggle("hidden", !worldCup);

  updateTimer();
  document.querySelectorAll(".outcome-button, .amount-button").forEach((button) => {
    button.disabled = !hasMarket || !state.user || !canBuyMarket;
  });
  renderOrderbookPanel();
}

// Пишем в DOM только при реальной смене значения: тик 250мс раньше делал
// 4 мутации текста в секунду на одно и то же, будя MutationObserver моушена.
function setCountdownText(el, value) {
  if (el && el.textContent !== value) {
    el.textContent = value;
  }
}

function renderCountdownDuration(seconds, targetAt) {
  if (seconds >= 30 * 86_400) {
    const { months, days } = getCalendarMonthDayDiff(targetAt);
    if (months > 0) {
      setCountdownText($("timeLeftMinutes"), String(months));
      setCountdownText($("timeLeftSeconds"), String(days).padStart(2, "0"));
      setCountdownText($("timeLeftMinutes")?.nextElementSibling, "MON");
      setCountdownText($("timeLeftSeconds")?.nextElementSibling, "DAYS");
      return;
    }
  }
  if (seconds >= 86_400) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    setCountdownText($("timeLeftMinutes"), String(days));
    setCountdownText($("timeLeftSeconds"), String(hours).padStart(2, "0"));
    setCountdownText($("timeLeftMinutes")?.nextElementSibling, "DAYS");
    setCountdownText($("timeLeftSeconds")?.nextElementSibling, "HRS");
    return;
  }
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    setCountdownText($("timeLeftMinutes"), String(hours).padStart(2, "0"));
    setCountdownText($("timeLeftSeconds"), String(minutes).padStart(2, "0"));
    setCountdownText($("timeLeftMinutes")?.nextElementSibling, "HRS");
    setCountdownText($("timeLeftSeconds")?.nextElementSibling, "MINS");
    return;
  }
  setCountdownText($("timeLeftMinutes"), String(Math.floor(seconds / 60)).padStart(2, "0"));
  setCountdownText($("timeLeftSeconds"), String(seconds % 60).padStart(2, "0"));
  setCountdownText($("timeLeftMinutes")?.nextElementSibling, "MINS");
  setCountdownText($("timeLeftSeconds")?.nextElementSibling, "SECS");
}

function renderSportsClock(seconds, caption) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  const secondsPart = value % 60;
  setCountdownText(
    $("timeLeftMinutes"),
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`,
  );
  setCountdownText($("timeLeftMinutes")?.nextElementSibling, caption);
  setCountdownText($("timeLeftSeconds"), "");
  setCountdownText($("timeLeftSeconds")?.nextElementSibling, "");
}

function setSportsTimerLabel(value = "") {
  const label = $("sportsTimerLabel");
  if (!label) return;
  setCountdownText(label, value);
  label.classList.toggle("hidden", !value);
}

function updateTimer() {
  const market = getDisplayMarket();
  const minuteLabel = $("timeLeftMinutes")?.nextElementSibling;
  const secondLabel = $("timeLeftSeconds")?.nextElementSibling;
  const countdownEl = document.querySelector(".countdown");
  const sportsMarket = isSportsListMarket(market);
  countdownEl?.classList.toggle("sports-mode", sportsMarket);

  if (sportsMarket) {
    countdownEl?.classList.remove("is-urgent", "is-final");
    document.querySelector(".chart-frame")?.classList.remove("round-final");
    const startsAt = new Date(market?.starts_at || "").getTime();
    if (isSportsEventLive(market)) {
      countdownEl?.classList.add("sports-live");
      countdownEl?.classList.remove("sports-wait");
      setSportsTimerLabel(`LIVE${market.period ? ` · ${String(market.period).slice(0, 8).toUpperCase()}` : ""}`);
      renderSportsClock(Number.isFinite(startsAt) ? (Date.now() - startsAt) / 1_000 : 0, "GAME TIME");
      return;
    }
    if (Number.isFinite(startsAt) && startsAt > Date.now()) {
      countdownEl?.classList.remove("sports-live", "sports-wait");
      setSportsTimerLabel("STARTS IN");
      renderSportsClock(Math.max(0, Math.ceil((startsAt - Date.now()) / 1_000)), "TO START");
      return;
    }
    if (Number.isFinite(startsAt) && Date.now() - startsAt <= 36 * 60 * 60_000) {
      countdownEl?.classList.remove("sports-live");
      countdownEl?.classList.add("sports-wait");
      setSportsTimerLabel("FINAL");
      setCountdownText($("timeLeftMinutes"), "WAIT");
      setCountdownText($("timeLeftSeconds"), "--");
      setCountdownText(minuteLabel, "RESULT");
      setCountdownText(secondLabel, "");
      return;
    }
  }

  countdownEl?.classList.remove("sports-mode", "sports-live", "sports-wait");
  setSportsTimerLabel("");

  if (!market?.end_time) {
    setCountdownText($("timeLeftMinutes"), "--");
    setCountdownText($("timeLeftSeconds"), "--");
    setCountdownText(minuteLabel, "MINS");
    setCountdownText(secondLabel, "SECS");
    return;
  }

  const endAt = new Date(market.end_time).getTime();
  const remainingMs = endAt - Date.now();
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  // Build tension in the final seconds of a round (pulse + red on the counter).
  const finalPhase = market.status === "open" && remainingMs > 0;
  countdownEl?.classList.toggle("is-urgent", finalPhase && seconds <= 10);
  countdownEl?.classList.toggle("is-final", finalPhase && seconds <= 3);
  // Красная виньетка по графику в самые последние секунды раунда.
  document.querySelector(".chart-frame")?.classList.toggle("round-final", finalPhase && seconds <= 5);
  // Хаптик-тики 3-2-1: рука чувствует финал, даже если глаза на графике.
  if (finalPhase && seconds <= 3 && state.lastFinalTickKey !== `${market.id}:${seconds}`) {
    state.lastFinalTickKey = `${market.id}:${seconds}`;
    triggerHaptic("selection");
  }
  if (remainingMs <= 0 && market.status === "open" && state.expiryRefreshMarketId !== market.id) {
    state.expiryRefreshMarketId = market.id;
    state.buyQueue = [];
    showRoundTransition(market);
    const pruned = pruneClosedLocalMarkets({ renderLists: true });
    if ($("marketStatus")) {
      $("marketStatus").textContent = marketStatusLabel("closed");
      $("marketStatus").classList.remove("live");
    }
    document.querySelectorAll(".outcome-button, .amount-button").forEach((button) => {
      button.disabled = true;
    });
    if (pruned.selectionChanged) {
      renderMarket();
      renderMarketChart();
    }
    renderTradeTicket();
    scheduleCoreRefresh({ delay: 80, includeLists: true });
  }
  renderCountdownDuration(seconds, endAt);
}

function setSectionToggle(id, total, key) {
  const button = $(id);
  if (!button) {
    return;
  }

  if (total <= COLLAPSE_LIMIT) {
    button.classList.add("hidden");
    button.closest(".section-title")?.classList.add("hidden");
    return;
  }

  button.closest(".section-title")?.classList.remove("hidden");
  button.classList.remove("hidden");
  button.textContent = state.expanded[key] ? "Скрыть" : `Все ${total}`;
}

function getPositionMarket(position) {
  return state.worldCupMarkets.find((market) => market.id === position.market_id)
    || state.topMarkets.find((market) => market.id === position.market_id)
    || state.sportsMarkets.find((market) => market.id === position.market_id)
    || state.specialMarkets.find((market) => market.id === position.market_id)
    || state.btcMarkets.find((market) => market.id === position.market_id)
    || (position.market_id === state.market?.id ? state.market : null);
}

function getPositionMarketLabel(position, market = getPositionMarket(position)) {
  if (isSportsListMarket(market || position)) {
    return compactSportsMarketLabel(market || position);
  }
  if (market?.team || position.team) {
    return market?.team || position.team;
  }
  if (market?.market_type === "TOP_MARKET" || market?.market_type === "SPORTS_MARKET") {
    return market.title || market.question || `TOP #${market.id}`;
  }
  if (market?.market_type === "SPECIAL_MARKET" || String(position.market_symbol || "").startsWith("SPECIAL:")) {
    return market?.title || position.question || "Киевстонер";
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
  if (String(trade.market_symbol || "").startsWith("TOP:")) {
    return trade.market_question || "TOP market";
  }
  if (String(trade.market_symbol || "").startsWith("SPORT:")) {
    return trade.market_question || "Спортивный рынок";
  }
  if (String(trade.market_symbol || "").startsWith("SPECIAL:")) {
    return trade.market_question || "Киевстонер";
  }
  if (String(trade.market_symbol || "").startsWith("BTCUSDT")) {
    const suffix = String(trade.market_symbol).replace("BTCUSDT", "").replace(/^_/, "").toLowerCase();
    return `BTC ${suffix || "5m"}`;
  }
  return trade.market_symbol || `#${trade.market_id}`;
}

function isPredictionTrade(trade) {
  const symbol = String(trade?.market_symbol || "");
  return Boolean(trade?.team)
    || trade?.market_type === "WORLD_CUP_WINNER"
    || trade?.market_type === "TOP_MARKET"
    || trade?.market_type === "SPORTS_MARKET"
    || trade?.market_type === "SPECIAL_MARKET"
    || symbol.startsWith("TOP:")
    || symbol.startsWith("SPORT:")
    || symbol.startsWith("SPECIAL:");
}

function getActivitySideLabel(trade) {
  return isPredictionTrade(trade) ? marketSideLabel(trade, trade.side) : sideLabel(trade.side);
}

function getRecentMarketLabel(market) {
  const winner = market.winner ? marketSideLabel(market, market.winner) : marketStatusLabel(market.status);
  if (String(market.symbol || "").startsWith("BTCUSDT")) {
    const suffix = String(market.symbol).replace("BTCUSDT", "").replace(/^_/, "").toLowerCase();
    return `#${market.id} · ${winner} BTC ${suffix || "5m"}`;
  }
  if (String(market.symbol || "").startsWith("TOP:")) {
    return `#${market.id} · ${winner} TOP`;
  }
  if (String(market.symbol || "").startsWith("SPORT:")) {
    return `#${market.id} · ${winner} SPORT`;
  }
  if (String(market.symbol || "").startsWith("SPECIAL:")) {
    return `#${market.id} · ${winner} КИЕВСТОНЕР`;
  }
  return `#${market.id} · ${winner} ${market.symbol}`;
}

function estimateSellQuote({ position, market, outcomePrice }) {
  const shares = Number(position.shares || 0);
  const minPrice = getMarketMinOutcomePrice(market);
  const price = Math.max(minPrice, Number(outcomePrice || 0));
  if (isSpecialMarket(market)) {
    const depth = Math.max(100, Number(market?.liquidity || 7_000));
    const estimatedGross = shares * price;
    const impact = Math.min(SPECIAL_MARKET_MAX_SHIFT, estimatedGross / depth);
    const nextPrice = Math.max(minPrice, price - impact);
    const bidPrice = Math.max(
      minPrice,
      Math.min(1 - minPrice, ((price + nextPrice) / 2) * (1 - SPECIAL_MARKET_SPREAD_RATE)),
    );
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
  const liquidity = estimateMarketMakerLiquidity(market, price);
  const estimatedGross = shares * price;
  const impact = Math.min(MAX_SINGLE_TRADE_SHIFT, (estimatedGross / liquidity) * SELL_IMPACT_MULTIPLIER);
  const nextPrice = Math.max(minPrice, price - impact);
  const extraExitPenalty = isPredictionListMarket(market) ? 0.03 : 0.015;
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
  // Смена валюты — мгновенная замена: твин между звёздами и долларами
  // бессмыслен и выглядит артефактом. Внутри одной валюты — плавный каунт-ап.
  if (balanceElement && balanceElement.dataset.currency !== state.currency) {
    balanceElement.dataset.currency = state.currency;
    delete balanceElement.dataset.value;
  }
  animateText(balanceElement, activeBalance, (value) => formatHeaderCurrencyAmount(value, state.currency));

  const positions = state.positions.filter((position) => (
    position.status === "open" && normalizeCurrency(position.currency) === state.currency
  ));
  // Drop P&L-flash memory for positions that are no longer open (avoid slow growth).
  const openPositionIds = new Set(positions.map((position) => String(position.id)));
  for (const id in state.lastPositionPnl) {
    if (!openPositionIds.has(id)) {
      delete state.lastPositionPnl[id];
    }
  }
  for (const id of state.renderedPositionIds) {
    if (!openPositionIds.has(String(id))) {
      state.renderedPositionIds.delete(id);
    }
  }
  setSectionToggle("positionToggle", positions.length, "positions");

  const container = $("positionList");
  renderLossRefundOffers();
  if (!positions.length) {
    setInnerHtmlIfChanged(container, '<p class="muted">Позиции пока нет.</p>');
    state.positionsWarmedUp = true;
    return;
  }

  const visiblePositions = state.expanded.positions ? positions : positions.slice(0, COLLAPSE_LIMIT);
  const html = visiblePositions.map((position, index) => {
    const payout = Number(position.shares || 0);
    const spent = Number(position.spent || 0);
    const currency = normalizeCurrency(position.currency);
    const displayMarket = getDisplayMarket();
    const selectedWorldCupMarket = getPositionMarket(position);
    const activeMarket = selectedWorldCupMarket || (position.market_id === state.market?.id ? state.market : null) || position;
    const isActiveMarket = Boolean(activeMarket) || position.market_id === displayMarket?.id;
    const positionMarketPrice = Number(position.side === "YES" ? position.yes_price : position.no_price);
    const liveMarketPrice = Number(position.side === "YES" ? activeMarket?.yes_price : activeMarket?.no_price);
    const marketPrice = (isActiveMarket ? liveMarketPrice : positionMarketPrice) || 0;
    const exitQuote = estimateSellQuote({ position, market: activeMarket, outcomePrice: marketPrice });
    const exitValue = exitQuote.exitValue;
    const pnl = exitQuote.pnl;
    // Flash the P&L green/red when it moves since the last render.
    const prevPnl = state.lastPositionPnl[position.id];
    const pnlFlash = Number.isFinite(prevPnl) && Math.abs(pnl - prevPnl) > 0.005
      ? (pnl > prevPnl ? " pnl-flash-up" : " pnl-flash-down")
      : "";
    state.lastPositionPnl[position.id] = pnl;
    const isSelling = state.pendingSellPositionId === position.id;
    const expiresAt = position.market_end_time ? new Date(position.market_end_time).getTime() : 0;
    const secondsLeft = expiresAt > 0 ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000)) : null;
    const marketIsLive = position.market_status === "open";
    const frozen = secondsLeft !== null && secondsLeft <= MARKET_SELL_FREEZE_SECONDS;
    const canSell = marketIsLive && secondsLeft !== null && secondsLeft > MARKET_SELL_FREEZE_SECONDS;
    const sellLockMessage = !marketIsLive
      ? "Рынок уже рассчитан."
      : secondsLeft === 0
        ? "Рынок уже закрылся, ждём расчёт."
        : frozen
          ? "В последние секунды продажа закрыта."
          : "";
    const marketBadge = secondsLeft === null
      ? ""
      : secondsLeft > 0
        ? ` · ${formatDurationShort(secondsLeft)}`
        : " · закрывается";
    const marketLabel = getPositionMarketLabel(position, activeMarket);
    const positionSideLabel = marketButtonSideLabel(activeMarket, position.side);
    const fullPositionLabel = `${activeMarket?.title || activeMarket?.question || marketLabel} · ${marketSideLabel(activeMarket, position.side)}`;
    // A freshly-opened position slides in with a glow so you see "my bet landed".
    const isNew = state.positionsWarmedUp && !prefersReducedMotion()
      && !state.renderedPositionIds.has(position.id);
    return `
      <div class="mini-row${isNew ? " pos-enter" : ""}"${isNew ? ` style="animation-delay:${Math.min(index, 5) * 55}ms"` : ""}>
        <div>
          <strong class="side-${position.side}" title="${escapeHtml(fullPositionLabel)}">${escapeHtml(marketLabel)} · ${escapeHtml(positionSideLabel)}</strong>
          <br />
          <small>${payout.toFixed(2)} shares · Avg ${formatCents(position.avg_price)} · Spent ${formatCurrencyAmount(spent, currency)}${marketBadge}</small>
        </div>
        <div class="position-actions">
          <strong class="${pnl >= 0 ? "positive" : "negative"}${pnlFlash}">${formatSignedCurrencyAmount(pnl, currency)}</strong>
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
  setInnerHtmlIfChanged(container, html);

  // Remember which positions we've shown so only genuinely new ones animate in;
  // the first render seeds silently (existing positions don't all fly in on open).
  positions.forEach((position) => state.renderedPositionIds.add(position.id));
  state.positionsWarmedUp = true;
}

function getLossRefundCost(offer) {
  if (offer?.offer_type === "stars_100") return 100;
  if (offer?.offer_type === "stars_500") return 500;
  return 0;
}

const LOSS_REFUND_DISMISS_KEY = "easymarket_loss_refund_dismissed_until";

function lossRefundDismissedUntil() {
  try {
    return Number(window.localStorage?.getItem(LOSS_REFUND_DISMISS_KEY) || 0);
  } catch {
    return 0;
  }
}

// Once the user closes/shares/claims the offer, hold it back for a day so it
// only re-surfaces ~once daily instead of nagging after every loss.
function dismissLossRefundForToday() {
  try {
    window.localStorage?.setItem(LOSS_REFUND_DISMISS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
  } catch {
    // storage can be unavailable in hardened webviews
  }
  state.lossRefundRenderedKey = null;
}

function renderLossRefundOffers() {
  const container = $("lossRefundList");
  if (!container) return;

  const dismissed = Date.now() < lossRefundDismissedUntil();
  const offer = dismissed
    ? null
    : (state.lossRefundOffers || []).find((item) => Number(item?.amount || 0) > 0) || null;

  if (!offer) {
    if (state.lossRefundRenderedKey !== null) {
      state.lossRefundRenderedKey = null;
      container.innerHTML = "";
    }
    container.classList.add("hidden");
    return;
  }

  // Only rebuild the DOM (and replay the entrance animation) when the offer
  // actually changes. renderMe runs on every poll, so rebuilding every time made
  // the card re-pop/flicker constantly.
  const key = `${offer.id}:${offer.offer_type}:${offer.amount}`;
  if (state.lossRefundRenderedKey === key && !container.classList.contains("hidden")) {
    return;
  }
  state.lossRefundRenderedKey = key;
  container.classList.remove("hidden");

  const amount = Number(offer.amount || 0);
  const cost = getLossRefundCost(offer);
  const isReferral = offer.offer_type === "referral";
  const title = isReferral ? "Вернуть проигрыш" : "Вернуть проигрыш за звезды";
  const text = isReferral
    ? "Позови друга. После его первой ставки вернем сумму на бонусный баланс."
    : `Нужно пополнить ${formatFire(cost)} новых звезд. Старые звезды не списываем.`;
  const action = isReferral
    ? `<button class="loss-refund-action" data-loss-refund-share="${offer.id}" type="button">Позвать друга</button>`
    : `<button class="loss-refund-action" data-loss-refund-stars="${offer.id}" data-loss-refund-cost="${cost}" type="button">Пополнить ${formatFire(cost)}</button>`;

  container.innerHTML = `
    <div class="loss-refund-card">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(text)}</small>
      </div>
      <div class="loss-refund-side">
        <b>${formatCurrencyAmount(amount, "USDT")}</b>
        ${action}
      </div>
      <button class="loss-refund-close" data-loss-refund-dismiss="1" type="button" aria-label="Закрыть">×</button>
    </div>
  `;
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
    button.dataset.stakeTier = String(index + 1);
    const amountPreview = getPreview(amount, side);
    const pendingKey = market ? getBuyIntentKey(market.id, side, amount, state.currency) : null;
    const nextLabel = formatWholeCurrencyAmount(amount, state.currency);
    const nextWin = formatWholeCurrencyAmount(amountPreview.shares, state.currency);
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

  const sportsTicket = isSportsListMarket(market);
  document.querySelector(".trade-card")?.classList.toggle("sports-trade-card", sportsTicket);
  $("ticketTitle").classList.toggle("sports-ticket-title", sportsTicket);
  $("ticketTitle").textContent = canBuyMarket
    ? (sportsTicket
      ? sportsBetPrompt(
        market,
        side,
        state.quickBetMode === "confirm" ? "выбери сумму" : "нажми сумму",
      )
      : (state.quickBetMode === "confirm"
        ? `Сумма для ${marketSideLabel(market, side)}`
        : `Нажми сумму для ${marketSideLabel(market, side)}`))
    : "Рынок завершён, обновляю...";
  $("ticketPrice").textContent = "";
  $("ticketPrice").classList.add("hidden");
  renderQuickBetToggle();
}

let quickBetToggleAnimTimer = 0;

function renderQuickBetToggle() {
  const button = $("quickBetToggle");
  if (!button) return;
  const confirmMode = state.quickBetMode === "confirm";
  const wasConfirm = button.classList.contains("confirm-mode");
  const wasRendered = button.dataset.qbtReady === "1";
  button.classList.toggle("confirm-mode", confirmMode);
  button.setAttribute("aria-pressed", confirmMode ? "false" : "true");
  button.setAttribute(
    "aria-label",
    confirmMode ? "Режим подтверждения ставки" : "Режим ставки в один клик",
  );
  button.dataset.qbtReady = "1";
  // Squash-and-stretch и вспышка иконки играют только на реальной смене
  // режима: рендер тикета дёргает эту функцию на каждом обновлении рынка.
  if (wasRendered && wasConfirm !== confirmMode) {
    button.classList.remove("qbt-anim");
    void button.offsetWidth;
    button.classList.add("qbt-anim");
    window.clearTimeout(quickBetToggleAnimTimer);
    quickBetToggleAnimTimer = window.setTimeout(() => {
      button.classList.remove("qbt-anim");
    }, 700);
  }
}

function setQuickBetMode(mode) {
  state.quickBetMode = mode === "confirm" ? "confirm" : "one_click";
  saveQuickBetMode(state.quickBetMode);
  renderTradeTicket();
}

function toggleQuickBetMode() {
  setQuickBetMode(state.quickBetMode === "confirm" ? "one_click" : "confirm");
  triggerHaptic("selection");
  showToast(state.quickBetMode === "confirm" ? "Ставка с подтверждением." : "Ставка в один клик.");
}

function renderActivity() {
  renderFeedPanel();
  const container = $("activityTape");
  setSectionToggle("activityToggle", state.activity.length, "activity");
  if (!state.activity.length) {
    setInnerHtmlIfChanged(container, '<p class="muted">Пока нет ставок.</p>');
    return;
  }

  const visibleActivity = state.expanded.activity ? state.activity.slice(0, 16) : state.activity.slice(0, COLLAPSE_LIMIT);
  const html = visibleActivity.map((trade) => {
    const name = formatUserDisplayName(trade);
    const action = trade.action || "BUY";
    const marketLabel = getActivityMarketLabel(trade);
    // Въезд и глинт играют один раз — на приходе сделки. Пере-рендеры от
    // свернуть/развернуть и поллинга не должны заново дёргать анимации.
    const isFresh = state.freshActivityIds.has(trade.id) && !state.playedActivityAnimIds.has(trade.id);
    // Крупная ставка получает золотую строку с глинтом — магнит для глаз в ленте.
    const isBig = Number(trade.amount || 0) >= (normalizeCurrency(trade.currency) === "STAR" ? 500 : 50);
    return `
      <div class="activity-row ${isFresh ? "fresh" : ""}${isBig ? " big-bet" : ""}">
        <div>
          <strong class="side-${trade.side}">${escapeHtml(name)} ${actionLabel(action)} ${getActivitySideLabel(trade)}</strong>
          <br />
          <small>${escapeHtml(marketLabel)} · ${formatCents(trade.price)} · ${trade.shares.toFixed(2)} shares</small>
        </div>
        <strong>${formatCurrencyAmount(trade.amount, trade.currency)}</strong>
      </div>
    `;
  }).join("");
  setInnerHtmlIfChanged(container, html);
  // Помечаем показанные "свежие" строки как отыгравшие анимацию.
  visibleActivity.forEach((trade) => {
    if (state.freshActivityIds.has(trade.id)) {
      state.playedActivityAnimIds.add(trade.id);
    }
  });
  if (state.playedActivityAnimIds.size > 400) {
    state.playedActivityAnimIds = new Set(Array.from(state.playedActivityAnimIds).slice(-200));
  }
}

function renderRecentMarkets() {
  renderFeedPanel();
  const container = $("recentMarkets");
  setSectionToggle("recentToggle", state.recentMarkets.length, "recent");
  if (!state.recentMarkets.length) {
    setInnerHtmlIfChanged(container, '<p class="muted">Пока нет закрытых рынков.</p>');
    return;
  }

  const visibleMarkets = state.expanded.recent ? state.recentMarkets.slice(0, 12) : state.recentMarkets.slice(0, COLLAPSE_LIMIT);
  const html = visibleMarkets.map((market) => {
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
  setInnerHtmlIfChanged(container, html);
}

function renderFeedPanel() {
  const panels = ["positions", "activity", "recent"];
  if (!panels.includes(state.feedPanel)) {
    state.feedPanel = "positions";
  }
  const currentPanel = state.feedPanel;
  // Clear the Live new-trade badge here so every switch path (tap AND swipe) covers it.
  if (currentPanel === "activity") {
    $("feedActivityBtn")?.classList.remove("has-new");
  }
  $("activitySection")?.classList.toggle("hidden", currentPanel !== "positions");
  $("activitySection")?.classList.toggle("active", currentPanel === "positions");
  $("recentSection")?.classList.toggle("hidden", currentPanel !== "activity");
  $("recentSection")?.classList.toggle("active", currentPanel === "activity");
  $("marketResultsSection")?.classList.toggle("hidden", currentPanel !== "recent");
  $("marketResultsSection")?.classList.toggle("active", currentPanel === "recent");
  document.querySelectorAll("[data-feed-panel]").forEach((button) => {
    button.classList.toggle("active", button.dataset.feedPanel === currentPanel);
  });
}

function renderLeaderboard() {
  const container = $("leaderboardList");
  if (!container) {
    return;
  }
  document.querySelectorAll("[data-leaderboard-currency]").forEach((button) => {
    button.classList.toggle("active", normalizeCurrency(button.dataset.leaderboardCurrency) === state.leaderboardCurrency);
  });
  document.querySelectorAll("[data-leaderboard-mode]").forEach((button) => {
    button.classList.toggle("active", normalizeLeaderboardMode(button.dataset.leaderboardMode) === state.leaderboardMode);
  });

  container.classList.toggle("loading", Boolean(state.leaderboardLoading));

  const mode = normalizeLeaderboardMode(state.leaderboardMode);
  if (mode === "CLANS") {
    if (!state.leaderboardClans.length) {
      container.innerHTML = state.leaderboardLoading
        ? '<p class="muted">Загружаю кланы...</p>'
        : '<p class="muted">Кланы пока не попали в рейтинг.</p>';
      return;
    }

    const rows = state.leaderboardClans.map((clan, index) => {
      const rank = Number(clan.rank || index + 1);
      const rankClass = rank <= 3 ? ` rank-${rank}` : "";
      const isMine = Boolean(clan.user_is_member || (state.userClan && Number(state.userClan.id) === Number(clan.id)));
      return `
        <div class="leaderboard-row clan-rating-row${rankClass}${isMine ? " is-me" : ""}">
          <span class="leaderboard-rank">${rank}</span>
          ${clanIconMarkup(clan, "leaderboard-clan-icon")}
          <div class="leaderboard-player">
            <strong>${escapeHtml(clan.name)}${isMine ? " · твой" : ""}</strong>
            <small>${formatFire(clan.members_count)} участников${Number(clan.rank) === 1 ? " · лидер месяца" : ""}</small>
          </div>
          <strong class="leaderboard-balance">${formatFire(clan.score)} pts</strong>
        </div>
      `;
    }).join("");
    container.innerHTML = rows;
    return;
  }

  if (!state.leaderboard.length) {
    container.innerHTML = state.leaderboardLoading
      ? '<p class="muted">Загружаю рейтинг...</p>'
      : '<p class="muted">За последние 24 часа пока нет победителей.</p>';
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  const rows = state.leaderboard.map((player, index) => {
    const name = formatUserDisplayName(player);
    const winRate = Number(player.win_rate_pct || 0);
    const rank = index + 1;
    const isMe = state.user && String(player.telegram_id) === String(state.user.telegram_id);
    const rankClass = rank <= 3 ? ` rank-${rank}` : "";
    const rankMark = rank <= 3 ? medals[rank - 1] : String(rank);
    const mainValue = mode === "BEST_24H"
      ? Number(player.best_pnl_24h || 0)
      : mode === "WINS_24H"
        ? Number(player.total_pnl_24h || 0)
        : Number(player.balance || 0);
    const meta = mode === "BEST_24H"
      ? `${escapeHtml(player.market_label || player.market_title || "market")} · ${escapeHtml(isPredictionTrade(player) ? yesNoSideLabel(player.side || "") : sideLabel(player.side || ""))} · всего +${formatCurrencyAmount(player.total_pnl_24h || player.best_pnl_24h || 0, player.currency || state.leaderboardCurrency)}`
      : mode === "WINS_24H"
        ? `${formatFire(player.wins_24h)} побед · лучший ${formatCurrencyAmount(player.best_pnl_24h || 0, player.currency || state.leaderboardCurrency)}`
        : `${formatFire(player.bet_count)} ставок · WR ${winRate.toFixed(0)}%`;
    const valueClass = mode === "BALANCE" ? "" : " profit";
    return `
      <div class="leaderboard-row${rankClass}${isMe ? " is-me" : ""}">
        <span class="leaderboard-rank">${rankMark}</span>
        <div class="leaderboard-player">
          <strong>${escapeHtml(name)}${isMe ? " · ты" : ""}</strong>
          <small>${meta}</small>
        </div>
        <strong class="leaderboard-balance${valueClass}">${mode === "BALANCE" ? formatCurrencyAmount(mainValue, player.currency || state.leaderboardCurrency) : formatSignedCurrencyAmount(mainValue, player.currency || state.leaderboardCurrency)}</strong>
      </div>
    `;
  }).join("");
  container.innerHTML = rows;
}

const CLAN_WAR_MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function formatClanWarMonth(monthKey) {
  const month = Number(String(monthKey || "").split("-")[1]);
  return CLAN_WAR_MONTHS[month - 1] || "";
}

function formatClanWarCountdown(iso) {
  const end = new Date(iso || 0).getTime();
  const ms = end - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) {
    return "скоро";
  }
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) {
    return `${days} дн ${hours} ч`;
  }
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours} ч ${mins} мин`;
}

function formatClanWarBank(value) {
  const num = Math.max(0, Number(value || 0));
  const rounded = num >= 100 ? Math.round(num) : Math.round(num * 10) / 10;
  return `${rounded.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} USDT`;
}

function renderClanWar() {
  const war = state.clanWar;
  const bankEl = $("clanWarBank");
  const monthEl = $("clanWarMonth");
  const endsEl = $("clanWarEnds");
  const podium = $("clanWarPodium");
  const bankValue = Number(war?.bank_usdt || 0);

  if (monthEl && war?.month_key) monthEl.textContent = formatClanWarMonth(war.month_key);
  if (endsEl) endsEl.textContent = war?.ends_at ? formatClanWarCountdown(war.ends_at) : "—";

  if (bankEl) {
    const isLeaderboard = (state.clanView || "leaderboard") === "leaderboard"
      && !$("clansLeaderboardView")?.classList.contains("hidden");
    const prevShown = state.clanWarBankShown;
    if (isLeaderboard && prevShown != null && !prefersReducedMotion()) {
      animateText(bankEl, bankValue, formatClanWarBank, 900);
      if (bankValue > prevShown + 0.001) {
        dropClanBankCoin();
      }
    } else {
      bankEl.dataset.value = String(bankValue);
      bankEl.textContent = formatClanWarBank(bankValue);
    }
    state.clanWarBankShown = bankValue;
  }

  if (podium) {
    const top3 = state.clans.slice(0, 3);
    if (top3.length < 3) {
      if (podium.dataset.sig) {
        podium.innerHTML = "";
        podium.dataset.sig = "";
      }
    } else {
      // Rebuild only when the lineup/avatar/name changes. A live score tick must
      // NOT recreate the <img> avatars — that reload is what flickers them.
      const sig = top3.map((c) => `${c.id}:${c.channel_avatar_url || ""}:${c.name}`).join("|");
      if (podium.dataset.sig !== sig) {
        podium.innerHTML = top3.map((clan) => `
          <span data-open-clan="${clan.id}">
            ${clanIconMarkup(clan, "clan-war-podium-ic")}
            <b>${escapeHtml(clan.name)}</b>
            <small>${formatFire(clan.score)} pts</small>
          </span>
        `).join("");
        podium.dataset.sig = sig;
      } else {
        const spans = podium.children;
        top3.forEach((clan, i) => {
          const small = spans[i]?.querySelector("small");
          if (small) small.textContent = `${formatFire(clan.score)} pts`;
        });
      }
    }
  }
}

function renderClans() {
  const list = $("clansList");
  const userCard = $("userClanCard");
  const detailCard = $("clanDetailCard");
  if (!list || !userCard || !detailCard) {
    return;
  }

  const view = state.clanView || "leaderboard";
  morphSheetContent("clansSheet", `clans:${view}`, () => {
    $("clansLeaderboardView")?.classList.toggle("hidden", view !== "leaderboard");
    $("clanDetailView")?.classList.toggle("hidden", view !== "detail");
    $("clanCreateView")?.classList.toggle("hidden", view !== "create");
    $("clanRulesView")?.classList.toggle("hidden", view !== "rules");
    $("clansBackBtn")?.classList.toggle("hidden", view === "leaderboard");
    $("clanInfoBtn")?.classList.toggle("hidden", view === "rules");
    $("clanCreateToggleBtn")?.classList.toggle("hidden", view === "create");

    const titles = {
      leaderboard: ["Лига", "Кланы"],
      detail: ["Клан", "Участники"],
      create: ["Создание", "Новый клан"],
      rules: ["Правила", "Очки клана"],
    };
    const [eyebrow, title] = titles[view] || titles.leaderboard;
    if ($("clansEyebrow")) $("clansEyebrow").textContent = eyebrow;
    if ($("clansTitle")) $("clansTitle").textContent = title;
    renderClanIconPicker();
  });

  if (state.userClan) {
    const uc = state.userClan;
    const clanInList = state.clans.find((clan) => clan.id === uc.id);
    const clanScore = Number(clanInList?.score) || 0;
    const contribution = Number(uc.user_contribution_score) || 0;
    const share = clanScore > 0 ? Math.max(0.03, Math.min(1, contribution / clanScore)) : 0;
    userCard.classList.remove("hidden");
    userCard.classList.add("is-clickable");
    userCard.dataset.openClan = String(uc.id);
    userCard.innerHTML = `
      ${clanIconMarkup(uc, "user-clan-icon")}
      <div class="user-clan-body">
        <strong>Твой клан: ${escapeHtml(uc.name)}</strong>
        <small>Вклад ${formatFire(contribution)} · место #${uc.rank || "-"}</small>
        ${share > 0 ? `<span class="user-clan-bar"><i style="transform:scaleX(${share.toFixed(3)})"></i></span>` : ""}
      </div>
      <span class="user-clan-go" aria-hidden="true">›</span>
    `;
  } else {
    userCard.classList.add("hidden");
    userCard.classList.remove("is-clickable");
    userCard.innerHTML = "";
  }

  renderClanWar();

  if (state.clansLoading && !state.clans.length) {
    setInnerHtmlIfChanged(list, '<p class="muted">Загружаю кланы...</p>');
    detailCard.innerHTML = "";
    return;
  }

  if (!state.clans.length) {
    setInnerHtmlIfChanged(list, '<p class="muted">Кланы пока не созданы.</p>');
    detailCard.innerHTML = "";
    return;
  }

  const selectedClan = state.clans.find((clan) => clan.id === state.selectedClanId)
    || state.userClan
    || state.clans[0];
  state.selectedClanId = selectedClan?.id || null;

  if (view === "detail" && selectedClan) {
    const members = (selectedClan.members || []).slice(0, 12);
    const channelUrl = normalizeChannelUrl(selectedClan.channel_url);
    const channelLabel = formatChannelLabel(selectedClan.channel_url);
    const rank = Number(selectedClan.rank) || 0;
    const isLeader = rank === 1;
    const bankLabel = formatClanWarBank(state.clanWar?.bank_usdt || 0);
    const goalLine = isLeader
      ? "Ваш клан №1 — сейчас забирает банк месяца"
      : rank > 1
        ? `Вы на ${rank} месте. Банк уходит клану №1 — обгоняйте лидера`
        : "Поднимайтесь в топ-1, чтобы забрать банк";
    const memberRows = members.length
      ? members.map((member) => {
        const name = formatUserDisplayName(member);
        return `
          <div class="clan-member-row ${String(member.telegram_id) === String(state.user?.telegram_id) ? "me" : ""}">
            <span>${member.rank || "-"}</span>
            ${clanMemberAvatarMarkup(member, name)}
            <div>
              <strong>${escapeHtml(name)}</strong>
              <small>${formatFire(member.contribution_score)} очков${member.role === "owner" ? " · owner" : ""}</small>
            </div>
          </div>
        `;
      }).join("")
      : '<p class="muted">В клане пока нет участников.</p>';

    detailCard.innerHTML = `
      <div class="clan-detail-hero">
        ${clanIconMarkup(selectedClan, "clan-detail-avatar")}
        <div>
          <strong>${escapeHtml(selectedClan.name)}${isLeader ? ' <em class="clan-leader-tag">лидер</em>' : ""}</strong>
          <small>${formatFire(selectedClan.members_count)} участников</small>
        </div>
      </div>
      <div class="clan-stat-grid">
        <div><b>${rank || "-"}</b><span>место</span></div>
        <div><b>${formatFire(selectedClan.score)}</b><span>очки</span></div>
        <div><b>${formatFire(selectedClan.members_count)}</b><span>состав</span></div>
      </div>
      <div class="clan-goal-card ${isLeader ? "is-leader" : ""}">
        <small>Банк месяца · ${bankLabel}</small>
        <strong>${goalLine}</strong>
        <span>В конце месяца весь банк уходит клану №1 и делится между топ-30 участниками пропорционально личным очкам вклада.</span>
      </div>
      <div class="clan-todo">
        <p class="clan-todo-title">Как поднять клан наверх</p>
        <div class="rules-score-list">
          <div class="rules-score-row"><span>USDT-прогноз — победа</span><b class="pts up">+3</b></div>
          <div class="rules-score-row"><span>Заходи каждый день</span><b class="pts up">+2</b></div>
          <div class="rules-score-row"><span>Первая ставка дня</span><b class="pts up">+3</b></div>
          <div class="rules-score-row"><span>Серия из 5 побед</span><b class="pts up">+12</b></div>
          <div class="rules-score-row"><span>Позвать друга в клан</span><b class="pts up">+5</b></div>
        </div>
      </div>
      <div class="clan-link-actions">
        ${channelUrl ? `<button class="clan-link-button secondary" data-open-channel="${escapeHtml(channelUrl)}" type="button">${escapeHtml(channelLabel || "Канал клана")}</button>` : ""}
        <button class="clan-link-button" data-share-clan="${selectedClan.id}" type="button">Позвать в клан</button>
      </div>
      ${selectedClan.user_is_member ? "" : `<button class="trade-confirm clan-join-main" data-join-clan="${selectedClan.id}" type="button">Вступить в клан</button>`}
      <div class="clan-members-list">${memberRows}</div>
    `;
  } else {
    detailCard.innerHTML = "";
  }

  // Top-3 live in the podium above; the list carries the chasing pack (rank 4+).
  // With fewer than 3 clans the podium stays empty, so list every clan instead
  // (otherwise a fresh 1-2 clan league would render nothing and be unjoinable).
  const rest = state.clans.length >= 3 ? state.clans.slice(3) : state.clans.slice();
  if (!rest.length) {
    setInnerHtmlIfChanged(list, '<p class="muted clans-list-empty">Все кланы уже в топ-3 — они борются за банк выше. Вступай и двигай свой клан наверх.</p>');
    return;
  }
  const html = rest.map((clan) => {
    const rank = Number(clan.rank) || 0;
    return `
    <div class="clan-row ${clan.user_is_member ? "active" : ""} ${clan.id === state.selectedClanId ? "selected" : ""}" data-open-clan="${clan.id}">
      <span class="clan-rank ${rank >= 1 && rank <= 3 ? `rank-${rank}` : ""}">${rank || "-"}</span>
      ${clanIconMarkup(clan)}
      <div class="clan-info">
        <strong>${escapeHtml(clan.name)}</strong>
        <small>${formatFire(clan.members_count)} участников · ${formatFire(clan.score)} очков</small>
      </div>
      <button class="task-button" data-join-clan="${clan.id}" type="button" ${clan.user_is_member ? "disabled" : ""}>
        ${clan.user_is_member ? "Твой" : "Войти"}
      </button>
    </div>
  `;
  }).join("");
  setInnerHtmlIfChanged(list, html);
}

async function joinClan(payload, button = null, successMessage = "Ты вступил в клан.") {
  if (!state.user?.telegram_id) {
    return;
  }
  if (button) {
    showButtonPressed(button);
    button.disabled = true;
  }
  triggerHaptic("selection");
  try {
    const result = await api("/api/clans/join", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        ...payload,
      }),
    });
    state.clans = result.clans || [];
    state.userClan = result.user_clan || null;
    state.selectedClanId = state.userClan?.id || Number(payload.clan_id || 0) || null;
    state.clanView = "detail";
    renderClans();
    triggerLightningFlash("success");
    showToast(successMessage);
  } catch {
    if (button) {
      button.disabled = false;
    }
    showToast("Не получилось вступить в клан.");
  }
}

async function joinClanFromButton(button) {
  if (!button) {
    return;
  }
  await joinClan({ clan_id: Number(button.dataset.joinClan) }, button);
}

async function handleClanLaunchLink() {
  if (state.handledClanLaunch || !state.user?.telegram_id) {
    return;
  }
  const clanId = getLaunchClanId();
  if (!clanId) {
    return;
  }
  state.handledClanLaunch = true;
  setClansSheetOpen(true);
  await joinClan({ clan_id: clanId }, null, "Ты вошёл в клан по ссылке.");
}

async function shareClan(clan) {
  if (!clan?.id) {
    return;
  }
  triggerHaptic("selection");
  const inviteUrl = buildClanInviteUrl(clan);
  const text = `Вступай в клан ${clan.name} в EasyMarket.`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    return;
  }
  try {
    if (navigator.share) {
      await navigator.share({
        title: clan.name,
        text,
        url: inviteUrl,
      });
      return;
    }
  } catch {
    // Fall through to clipboard.
  }
  const copied = await copyToClipboard(inviteUrl);
  showToast(copied ? "Ссылка на клан скопирована." : "Не получилось скопировать ссылку.");
}

function getShareWinUrl() {
  return state.user?.telegram_id
    ? buildInviteUrl(state.user.telegram_id)
    : buildTelegramMiniAppLaunchUrl("easymarket");
}

function getShareWinText() {
  const amount = state.lastWin?.amountLabel || state.lastWin?.label || "";
  const head = amount ? `${amount} на BTC за 5 минут. ` : "";
  return `Выигрыш есть — можно поесть. ${head}Играй и ты в EasyMarket →`;
}

function getStoryMediaUrl() {
  const value = Number(state.lastWin?.primaryValue || 0);
  const currency = state.lastWin?.primaryCurrency || "USDT";
  if (value > 0) {
    // ONLY digits/dot/letters — URL-safe even if Telegram re-encodes the media URL.
    // Never pass free-form text (Cyrillic ticker/username) here: it would double-
    // encode into raw %-codes on the card. All other text is baked server-side.
    return `${window.location.origin}/api/share/story?value=${encodeURIComponent(value)}&currency=${encodeURIComponent(currency)}`;
  }
  return `${window.location.origin}/share/story-win.png`;
}

function isShareWinsEnabled() {
  try {
    return window.localStorage?.getItem("easymarket_share_wins") !== "0";
  } catch {
    return true;
  }
}

function setShareWinsEnabled(enabled) {
  try {
    window.localStorage?.setItem("easymarket_share_wins", enabled ? "1" : "0");
  } catch {
    // Ignore storage errors (private mode etc).
  }
  return enabled;
}

function renderShareWinsToggle() {
  const button = $("shareWinsToggleBtn");
  if (!button) return;
  const enabled = isShareWinsEnabled();
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
}

// Молния из частиц для шэир-карточки — статичный кадр велком-заставки.
// Тот же силуэт и градиент (тёплый верх -> лайм -> циан), что и на сплеше.
function buildShareBoltParticlesSvg() {
  const poly = [[36.8, 3], [13.6, 35.6], [29.6, 35.6], [24.8, 61], [50.4, 25.2], [34.2, 25.2]];
  const inPoly = (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  const mix = (t) => {
    const stops = [[255, 247, 168], [183, 255, 77], [53, 246, 255]];
    const [a, b, k] = t < 0.45
      ? [stops[0], stops[1], t / 0.45]
      : [stops[1], stops[2], (t - 0.45) / 0.55];
    return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k));
  };
  const parts = [];
  for (let gy = 3; gy <= 61; gy += 2.5) {
    for (let gx = 13; gx <= 51; gx += 2.5) {
      const x = gx + (Math.random() - 0.5) * 1.8;
      const y = gy + (Math.random() - 0.5) * 1.8;
      if (!inPoly(x, y)) {
        continue;
      }
      const [r, g, b] = mix((y - 3) / 58);
      const size = 0.8 + Math.random() * 0.7;
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size * 2.2).toFixed(1)}" fill="rgb(${r},${g},${b})" opacity="0.13"/>`);
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="rgb(${r},${g},${b})" opacity="${(0.8 + Math.random() * 0.2).toFixed(2)}"/>`);
    }
  }
  return `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">${parts.join("")}</svg>`;
}

function openShareWinSheet() {
  const win = state.lastWin;
  const sheet = $("shareWinSheet");
  if (!win || !sheet) {
    return;
  }
  // Прогреваем серверный рендер сторис-карточки заранее: пока юзер смотрит
  // шит, картинка рендерится и оседает в серверном кэше — тап "В сторис"
  // получает её мгновенно, а не ждёт генерацию.
  fetch(getStoryMediaUrl()).catch(() => undefined);
  const bolt = $("shareCardBolt");
  if (bolt && bolt.dataset.particled !== "1") {
    bolt.dataset.particled = "1";
    bolt.innerHTML = buildShareBoltParticlesSvg();
  }
  const card = $("shareCard");
  if (card) {
    card.dataset.tier = String(Math.max(1, Math.min(4, Number(win.tier || 1))));
  }
  const amountEl = $("shareCardAmount");
  if (amountEl) amountEl.textContent = win.amountLabel || win.label || "+0";
  const tickerEl = $("shareCardTicker");
  if (tickerEl) tickerEl.textContent = win.ticker || "BTC · 5 мин";
  const userEl = $("shareCardUser");
  if (userEl) {
    userEl.textContent = state.user?.username
      ? `@${state.user.username}`
      : state.user?.first_name || "";
  }
  openSheet(sheet);
  triggerHaptic("win");
}

function shareWinToChat() {
  triggerHaptic("selection");
  const url = getShareWinUrl();
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(getShareWinText())}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    return;
  }
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareWinToStory() {
  triggerHaptic("selection");
  const tg = window.Telegram?.WebApp;
  const url = getShareWinUrl();
  const canStory = tg && typeof tg.shareToStory === "function"
    && (typeof tg.isVersionAtLeast !== "function" || tg.isVersionAtLeast("7.8"));
  if (canStory) {
    try {
      tg.shareToStory(getStoryMediaUrl(), {
        text: getShareWinText(),
        widget_link: { url, name: "Играть" },
      });
      postTaskEvent("share_story"); // дейлик «Сторис с выигрышем»
      return;
    } catch {
      // Fall through to chat share.
    }
  }
  shareWinToChat();
}

async function shareWinCopy() {
  triggerHaptic("selection");
  const copied = await copyToClipboard(getShareWinUrl());
  showToast(copied ? "Ссылка скопирована." : "Не удалось скопировать ссылку.");
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
    container.innerHTML = '<p class="muted">Маркеты пока загружаются.</p>';
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
      const canTrade = isMarketOpenForBuy(market);
      if (volume) volume.textContent = `${formatVolume(market.volume)} Vol.`;
      if (chance) {
        chance.textContent = `${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
      }
      if (yesButton) {
        yesButton.disabled = !canTrade;
        yesButton.textContent = canTrade ? `Buy Yes ${formatCents(market.yes_price)}` : "Ждём итог";
      }
      if (noButton) {
        noButton.disabled = !canTrade;
        noButton.textContent = canTrade ? `Buy No ${formatCents(market.no_price)}` : "Ждём итог";
      }
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

function renderTopMarketsList() {
  const container = $("topMarketsList");
  if (!container) {
    return;
  }

  if (!state.topMarkets.length) {
    container.innerHTML = '<p class="muted">ТОП маркеты пока загружаются.</p>';
    return;
  }

  const orderKey = state.topMarkets.map((market) => market.id).join(",");
  if (state.topMarketsListRenderedOrder === orderKey) {
    for (const market of state.topMarkets) {
      const row = container.querySelector(`[data-market-id="${market.id}"]`);
      if (!row) continue;
      const volume = row.querySelector("[data-top-volume]");
      const chance = row.querySelector("[data-top-chance]");
      const yesButton = row.querySelector("[data-side='YES']");
      const noButton = row.querySelector("[data-side='NO']");
      const canTrade = isMarketOpenForBuy(market);
      if (volume) volume.textContent = `Vol. ${formatVolume(market.volume)}`;
      if (chance) {
        chance.textContent = `${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
      }
      if (yesButton) {
        yesButton.disabled = !canTrade;
        yesButton.textContent = canTrade ? `Buy Yes ${formatCents(market.yes_price)}` : "Ждём итог";
      }
      if (noButton) {
        noButton.disabled = !canTrade;
        noButton.textContent = canTrade ? `Buy No ${formatCents(market.no_price)}` : "Ждём итог";
      }
    }
    return;
  }

  state.topMarketsListRenderedOrder = orderKey;
  container.innerHTML = state.topMarkets.map((market) => {
    const rankLabel = market.top_rank ? `#${market.top_rank}` : "active";
    const canTrade = isMarketOpenForBuy(market);
    return `
      <article class="world-cup-row top-market-row" data-market-id="${market.id}">
        <button class="world-cup-main" data-top-open="${market.id}" type="button">
          <span class="team-flag">${teamIconMarkup(market.icon, market.title || market.question)}</span>
          <span>
            <strong>${escapeHtml(market.title || market.question)}</strong>
            <small><i>${rankLabel}</i> · <span data-top-volume>Vol. ${formatVolume(market.volume)}</span></small>
          </span>
          <b data-top-chance>${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</b>
        </button>
        <div class="world-cup-actions">
          <button class="wc-yes" data-top-buy="${market.id}" data-side="YES" type="button" ${canTrade ? "" : "disabled"}>${canTrade ? `Buy Yes ${formatCents(market.yes_price)}` : "Ждём итог"}</button>
          <button class="wc-no" data-top-buy="${market.id}" data-side="NO" type="button" ${canTrade ? "" : "disabled"}>${canTrade ? `Buy No ${formatCents(market.no_price)}` : "Ждём итог"}</button>
        </div>
      </article>
    `;
  }).join("");
}

function formatSportsMarketMeta(market) {
  if (isSportsEventLive(market)) {
    const details = [market.score, market.period].filter(Boolean).join(" · ");
    return `<i class="sports-live-badge">LIVE</i>${details ? ` · ${escapeHtml(details)}` : ""}`;
  }
  const startsAt = new Date(market.starts_at || market.start_time || market.end_time).getTime();
  if (!Number.isFinite(startsAt)) return "Скоро";
  const date = new Date(startsAt);
  const now = new Date();
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Сегодня · ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Завтра · ${time}`;
  return `${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })} · ${time}`;
}

function renderSportsMarketsList() {
  const container = $("sportsMarketsList");
  if (!container) return;
  if (!state.sportsMarkets.length) {
    container.innerHTML = '<p class="muted">Спортивные рынки пока загружаются.</p>';
    return;
  }

  const orderKey = state.sportsMarkets.map((market) => market.id).join(",");
  if (state.sportsMarketsListRenderedOrder === orderKey) {
    for (const market of state.sportsMarkets) {
      const row = container.querySelector(`[data-market-id="${market.id}"]`);
      if (!row) continue;
      const meta = row.querySelector("[data-sports-meta]");
      const chance = row.querySelector("[data-sports-chance]");
      const yesButton = row.querySelector("[data-side='YES']");
      const noButton = row.querySelector("[data-side='NO']");
      const canTrade = isMarketOpenForBuy(market);
      row.classList.toggle("is-live", isSportsEventLive(market));
      if (meta) meta.innerHTML = formatSportsMarketMeta(market);
      if (chance) chance.textContent = `${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
      if (yesButton) {
        yesButton.disabled = !canTrade;
        yesButton.textContent = canTrade ? `${marketButtonSideLabel(market, "YES")} ${formatCents(market.yes_price)}` : "Ждём итог";
        yesButton.title = marketSideLabel(market, "YES");
      }
      if (noButton) {
        noButton.disabled = !canTrade;
        noButton.textContent = canTrade ? `${marketButtonSideLabel(market, "NO")} ${formatCents(market.no_price)}` : "Ждём итог";
        noButton.title = marketSideLabel(market, "NO");
      }
    }
    return;
  }

  state.sportsMarketsListRenderedOrder = orderKey;
  container.innerHTML = state.sportsMarkets.map((market) => {
    const canTrade = isMarketOpenForBuy(market);
    return `
    <article class="world-cup-row top-market-row sports-market-row${isSportsEventLive(market) ? " is-live" : ""}" data-market-id="${market.id}">
      <button class="world-cup-main" data-sports-open="${market.id}" type="button">
        <span class="team-flag">${teamIconMarkup(market.icon, market.event_title || market.title)}</span>
        <span>
          <strong>${escapeHtml(market.title || market.question)}</strong>
          <small data-sports-meta>${formatSportsMarketMeta(market)}</small>
        </span>
        <b data-sports-chance>${Number(market.chance_pct || market.yes_price * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</b>
      </button>
      <div class="world-cup-actions sports-market-actions">
        <button class="wc-yes" data-sports-buy="${market.id}" data-side="YES" type="button" title="${escapeHtml(marketSideLabel(market, "YES"))}" aria-label="${escapeHtml(marketSideLabel(market, "YES"))}" ${canTrade ? "" : "disabled"}>${canTrade ? `${escapeHtml(marketButtonSideLabel(market, "YES"))} ${formatCents(market.yes_price)}` : "Ждём итог"}</button>
        <button class="wc-no" data-sports-buy="${market.id}" data-side="NO" type="button" title="${escapeHtml(marketSideLabel(market, "NO"))}" aria-label="${escapeHtml(marketSideLabel(market, "NO"))}" ${canTrade ? "" : "disabled"}>${canTrade ? `${escapeHtml(marketButtonSideLabel(market, "NO"))} ${formatCents(market.no_price)}` : "Ждём итог"}</button>
      </div>
    </article>
  `;
  }).join("");
}

function renderBtcMarketsList() {
  const container = $("btcMarketsList");
  if (!container) {
    return;
  }

  if (!state.btcMarkets.length) {
    container.innerHTML = '<p class="muted">Маркеты пока загружаются.</p>';
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
  if (open) {
    openSheet("btcMarketsSheet");
  } else {
    closeSheet("btcMarketsSheet");
  }
}

function animateMarketSwitch() {
  const card = document.querySelector(".market-card");
  if (!card) return;
  card.classList.remove("market-switching");
  void card.offsetWidth;
  card.classList.add("market-switching");
}

function selectBtcMarket(marketId) {
  const id = Number(marketId);
  const market = state.btcMarkets.find((item) => item.id === id);
  if (!market) {
    return;
  }
  state.selectedBtcMarketId = id === state.market?.id ? null : id;
  state.selectedWorldCupMarketId = null;
  state.selectedTopMarketId = null;
  state.selectedSportsMarketId = null;
  state.selectedSpecialMarketId = null;
  state.smoothedPrice = null;
  state.smoothedNoPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  state.sideSelectedMarketId = null;
  setBtcMarketsSheetOpen(false);
  animateMarketSwitch();
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}

function setWorldCupSheetOpen(open) {
  if (open) {
    openSheet("worldCupSheet");
  } else {
    closeSheet("worldCupSheet");
  }
}

function selectWorldCupMarket(marketId) {
  const id = Number(marketId);
  const market = state.worldCupMarkets.find((item) => item.id === id);
  if (!market) {
    return;
  }
  state.selectedWorldCupMarketId = id;
  state.selectedBtcMarketId = null;
  state.selectedTopMarketId = null;
  state.selectedSportsMarketId = null;
  state.selectedSpecialMarketId = null;
  state.smoothedPrice = null;
  state.smoothedNoPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  state.sideSelectedMarketId = null;
  setWorldCupSheetOpen(false);
  animateMarketSwitch();
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}

function setTopMarketsSheetOpen(open) {
  if (open) {
    openSheet("topMarketsSheet");
  } else {
    closeSheet("topMarketsSheet");
  }
}

function selectTopMarket(marketId) {
  const id = Number(marketId);
  const market = state.topMarkets.find((item) => item.id === id);
  if (!market) {
    return;
  }
  state.selectedTopMarketId = id;
  state.selectedBtcMarketId = null;
  state.selectedWorldCupMarketId = null;
  state.selectedSportsMarketId = null;
  state.selectedSpecialMarketId = null;
  state.smoothedPrice = null;
  state.smoothedNoPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  state.sideSelectedMarketId = null;
  setTopMarketsSheetOpen(false);
  animateMarketSwitch();
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}

function setSportsMarketsSheetOpen(open) {
  if (open) {
    openSheet("sportsMarketsSheet");
  } else {
    closeSheet("sportsMarketsSheet");
  }
}

function selectSportsMarket(marketId) {
  const id = Number(marketId);
  const market = state.sportsMarkets.find((item) => item.id === id);
  if (!market) return;
  state.selectedSportsMarketId = id;
  state.selectedBtcMarketId = null;
  state.selectedWorldCupMarketId = null;
  state.selectedTopMarketId = null;
  state.selectedSpecialMarketId = null;
  state.smoothedPrice = null;
  state.smoothedNoPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  state.sideSelectedMarketId = null;
  setSportsMarketsSheetOpen(false);
  animateMarketSwitch();
  renderMarket();
  renderTradeTicket();
  renderMarketChart();
  maybeLoadComments(true);
}

function selectSpecialMarket(marketId) {
  const id = Number(marketId);
  const market = state.specialMarkets.find((item) => item.id === id);
  if (!market) return;
  state.selectedSpecialMarketId = id;
  state.selectedBtcMarketId = null;
  state.selectedWorldCupMarketId = null;
  state.selectedTopMarketId = null;
  state.selectedSportsMarketId = null;
  state.smoothedPrice = null;
  state.smoothedNoPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  state.sideSelectedMarketId = null;
  animateMarketSwitch();
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
  const quote = estimateBuyQuote({ market, side, amount });
  const price = quote.executionPrice;
  const shares = Number(amount || 0) / price;
  const sportsMarket = isSportsListMarket(market);
  setTeamIconElement($("betTeamIcon"), isBtc ? "₿" : market.icon, isBtc ? "BTC" : market.team);
  if ($("betMarketTitle")) $("betMarketTitle").textContent = market.title || (isBtc ? "Bitcoin Up / Down" : "World Cup Winner");
  if ($("betTeamName")) {
    $("betTeamName").textContent = sportsMarket
      ? (isNamedSportsOutcome(market, side) ? "Победа" : "Прогноз")
      : (isBtc ? (market.title || "BTC Up or Down") : (market.team || "Team"));
  }
  $("betTeamName")?.closest("h2")?.classList.toggle("sports-bet-title", sportsMarket);
  if ($("betSideSeparator")) $("betSideSeparator").textContent = sportsMarket ? " " : " · ";
  if ($("betSideName")) {
    $("betSideName").textContent = sportsMarket ? marketButtonSideLabel(market, side) : marketSideLabel(market, side);
    $("betSideName").title = marketSideLabel(market, side);
    $("betSideName").className = side === "YES" ? "positive" : "negative";
  }
  if ($("betAmountValue")) $("betAmountValue").textContent = formatCurrencyAmount(amount, state.currency);
  if ($("betWinValue")) $("betWinValue").textContent = formatCurrencyAmount(shares, state.currency);
  if ($("betPriceValue")) $("betPriceValue").textContent = formatCents(price);
  $("betSideYesBtn")?.classList.toggle("active", side === "YES");
  $("betSideNoBtn")?.classList.toggle("active", side === "NO");
  if ($("betSideYesBtn")) {
    $("betSideYesBtn").textContent = marketButtonSideLabel(market, "YES");
    $("betSideYesBtn").title = marketSideLabel(market, "YES");
    $("betSideYesBtn").setAttribute("aria-label", marketSideLabel(market, "YES"));
  }
  if ($("betSideNoBtn")) {
    $("betSideNoBtn").textContent = marketButtonSideLabel(market, "NO");
    $("betSideNoBtn").title = marketSideLabel(market, "NO");
    $("betSideNoBtn").setAttribute("aria-label", marketSideLabel(market, "NO"));
  }
  const amounts = getAmountsForCurrency(state.currency);
  document.querySelectorAll("[data-bet-add]").forEach((button, index) => {
    const addAmount = amounts[index] || amounts[0];
    button.dataset.betAdd = String(addAmount);
    button.dataset.stakeTier = String(index + 1);
    button.textContent = `+${formatCurrencyAmount(addAmount, state.currency)}`;
  });
  if ($("betConfirmBtn")) {
    $("betConfirmBtn").disabled = !amount || !state.user;
    $("betConfirmBtn").textContent = amount ? `Trade ${formatCurrencyAmount(amount, state.currency)}` : "Trade";
  }
}

function openBetSheet(market, side = "YES", initialAmount = 0) {
  state.betSheet = {
    market,
    side,
    amount: Number(initialAmount || 0),
    currency: state.currency,
  };
  renderBetSheet();
  openSheet("betSheet");
}

function closeBetSheet() {
  closeSheet("betSheet");
}

function requestMarketBuy(market, side = "YES", amount = state.selectedAmount) {
  if (!market) {
    triggerHaptic("warning");
    return;
  }
  const buyAmount = Number(amount || state.selectedAmount || getAmountsForCurrency(state.currency)[0]);
  if (state.quickBetMode === "confirm") {
    triggerHaptic("selection");
    openBetSheet(market, side, buyAmount);
    return;
  }
  void buy(buyAmount, {
    marketId: market.id,
    side,
    amount: buyAmount,
    currency: state.currency,
  });
}

function walletStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "credited") return "зачислено";
  if (normalized === "completed") return "выведено";
  if (normalized === "pending") return "в обработке";
  if (normalized === "expired") return "истекло";
  if (normalized === "cancelled" || normalized === "canceled") return "отменено";
  return normalized || "статус";
}

function walletTypeLabel(type) {
  return type === "withdrawal" ? "Вывод" : "Пополнение";
}

function renderWalletHistory() {
  const container = $("walletHistoryList");
  if (!container) {
    return;
  }

  if (state.walletHistory.loading) {
    container.innerHTML = '<p class="muted">Загружаю историю...</p>';
    return;
  }

  if (!state.walletHistory.items.length) {
    container.innerHTML = '<p class="muted">Истории пополнений и выводов пока нет.</p>';
    return;
  }

  container.innerHTML = state.walletHistory.items.slice(0, 30).map((item) => {
    const amount = formatCurrencyAmount(item.amount, "USDT");
    const network = item.network_label || item.network || "";
    const address = item.address
      ? `${String(item.address).slice(0, 7)}...${String(item.address).slice(-5)}`
      : "";
    const isPending = String(item.status || "").toLowerCase() === "pending";
    return `
      <div class="wallet-history-row ${item.type === "withdrawal" ? "withdrawal" : "deposit"}${isPending ? " is-pending" : ""}">
        <div>
          <strong>${walletTypeLabel(item.type)}</strong>
          <small>${escapeHtml(network)}${address ? ` · ${escapeHtml(address)}` : ""}</small>
        </div>
        <div>
          <b>${item.type === "withdrawal" ? "-" : "+"}${amount}</b>
          <span>${isPending ? '<span class="wallet-pending-dot"></span>' : ""}${walletStatusLabel(item.status)} · ${formatRelativeTime(item.created_at)}</span>
        </div>
      </div>
    `;
  }).join("");
}

async function loadWalletHistory() {
  if (!state.user?.telegram_id) {
    return;
  }
  state.walletHistory.loading = true;
  renderWalletHistory();
  try {
    const data = await api(`/api/wallet/history?telegram_id=${encodeURIComponent(state.user.telegram_id)}&limit=40`);
    state.walletHistory.items = data.history || [];
  } catch {
    showToast("История кошелька пока не загрузилась.");
  } finally {
    state.walletHistory.loading = false;
    renderWalletHistory();
  }
}

let lastWalletPane = null;

function renderTopupSheet() {
  const isTopupMode = state.topup.mode !== "withdraw";
  const currency = normalizeCurrency(state.topup.currency);
  const isUsdt = currency === "USDT";
  const isHistoryOpen = Boolean(state.topup.historyOpen);
  const intent = state.topup.intent;
  const hasPendingIntent = isUsdt && intent?.status === "pending";

  // Направленный слайд при переключении Пополнить <-> Вывести.
  const paneKey = isHistoryOpen ? "history" : isTopupMode ? "topup" : "withdraw";
  if (
    lastWalletPane && lastWalletPane !== paneKey
    && paneKey !== "history" && lastWalletPane !== "history"
    && !prefersReducedMotion()
  ) {
    const slidingPanel = isTopupMode ? $("topupModePanel") : $("withdrawModePanel");
    if (slidingPanel) {
      const slideClass = isTopupMode ? "wallet-slide-left" : "wallet-slide-right";
      slidingPanel.classList.remove("wallet-slide-left", "wallet-slide-right");
      void slidingPanel.offsetWidth;
      slidingPanel.classList.add(slideClass);
      window.setTimeout(() => slidingPanel.classList.remove(slideClass), 400);
    }
  }
  lastWalletPane = paneKey;
  const hasAmount = hasTopupAmountValue(state.topup.amount);
  const amount = hasAmount ? normalizeTopupAmount(state.topup.amount, currency) : "";
  state.topup.amount = amount;
  const networks = Array.isArray(state.publicConfig.usdt_deposit_networks)
    ? state.publicConfig.usdt_deposit_networks
    : [];
  const hasUsdtNetworks = networks.length > 0;
  const walletViewKey = isHistoryOpen
    ? "history"
    : isTopupMode
      ? `topup:${currency}:${hasPendingIntent ? "pending" : "entry"}`
      : `withdraw:${currency}`;
  const walletMorph = beginSheetContentMorph("topupSheet", `wallet:${walletViewKey}`);
  $("topupModePanel")?.classList.toggle("hidden", isHistoryOpen || !isTopupMode);
  $("withdrawModePanel")?.classList.toggle("hidden", isHistoryOpen || isTopupMode);
  $("walletHistoryPanel")?.classList.toggle("hidden", !isHistoryOpen);
  $("walletModeTopupBtn")?.classList.toggle("active", !isHistoryOpen && isTopupMode);
  $("walletModeWithdrawBtn")?.classList.toggle("active", !isHistoryOpen && !isTopupMode);
  $("walletHistoryBtn")?.classList.toggle("active", isHistoryOpen);
  // На шаге 2 тоггл Пополнить/Вывести не нужен — только детали заявки.
  document.querySelector(".wallet-mode-toggle")?.classList.toggle("hidden", isHistoryOpen || (hasPendingIntent && isTopupMode));
  document.querySelector(".wallet-currency-toggle")?.classList.toggle("hidden", isHistoryOpen || !isTopupMode || hasPendingIntent);
  document.querySelectorAll("[data-wallet-currency]").forEach((button) => {
    button.classList.toggle("active", normalizeCurrency(button.dataset.walletCurrency) === currency);
  });
  $("usdtDepositPanel")?.classList.toggle("hidden", !isUsdt || !isTopupMode || !hasPendingIntent);
  $("usdtDepositIntentBox")?.classList.toggle("hidden", !hasPendingIntent);
  $("usdtDepositIntentBox")?.classList.toggle("is-waiting", hasPendingIntent);

  // Степпер депозита: Заявка -> Перевод -> Зачисление.
  const stepper = $("usdtDepositStepper");
  if (stepper) {
    const showStepper = isUsdt && isTopupMode && !isHistoryOpen && Boolean(intent)
      && (intent.status === "pending" || intent.status === "credited");
    stepper.classList.toggle("hidden", !showStepper);
    if (showStepper) {
      const credited = intent.status === "credited";
      stepper.querySelectorAll(".usdt-step").forEach((step) => {
        const stepIndex = Number(step.dataset.step);
        step.classList.toggle("done", credited || stepIndex === 1);
        step.classList.toggle("active", !credited && stepIndex === 2);
      });
      stepper.querySelectorAll(".usdt-step-line").forEach((line) => {
        line.classList.toggle("done", credited || line.dataset.line === "1");
      });
    }
  }

  // Пресеты сумм: только на этапе ввода, пока нет активной заявки.
  const presetsBox = $("topupPresets");
  if (presetsBox) {
    const showPresets = isTopupMode && !isHistoryOpen && !hasPendingIntent;
    presetsBox.classList.toggle("hidden", !showPresets);
    if (showPresets) {
      const presets = WALLET_TOPUP_PRESETS[currency] || [];
      const currentAmount = Number(state.topup.amount || 0);
      setInnerHtmlIfChanged(presetsBox, presets.map((value) => `
        <button type="button" data-topup-preset="${value}"
          class="${currentAmount === value ? "active" : ""}"${state.topup.pending ? " disabled" : ""}>
          ${currency === "USDT" ? `$${value}` : `${value} ★`}
        </button>
      `).join(""));
    }
  }
  if ($("usdtDepositExactAmount")) {
    const exactAmountText = hasPendingIntent
      ? `${Number(intent.deposit_amount || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
      : "";
    $("usdtDepositExactAmount").textContent = exactAmountText;
    $("usdtDepositAmountCopy")?.setAttribute(
      "aria-label",
      exactAmountText ? `Скопировать точную сумму ${exactAmountText}` : "Скопировать сумму"
    );
  }
  if ($("usdtDepositNetworkHint")) {
    $("usdtDepositNetworkHint").textContent = hasPendingIntent
      ? "Сети: BEP20 · ERC20"
      : "";
  }
  if ($("usdtCancelIntentBtn")) {
    $("usdtCancelIntentBtn").classList.toggle("hidden", !hasPendingIntent);
    $("usdtCancelIntentBtn").disabled = state.topup.pending;
  }
  if ($("usdtCheckIntentBtn")) {
    $("usdtCheckIntentBtn").classList.toggle("hidden", !hasPendingIntent);
    $("usdtCheckIntentBtn").disabled = state.topup.pending || state.topup.checking;
    $("usdtCheckIntentBtn").textContent = state.topup.checking ? "Проверяю..." : "Проверить зачисление";
  }
  document.querySelectorAll("[data-usdt-address-card]").forEach((card) => {
    const cardType = card.dataset.usdtAddressCard;
    card.classList.toggle("hidden", !(hasPendingIntent && cardType === "evm" && intent?.to_address));
  });
  const depositAddress = hasPendingIntent ? (intent?.to_address || "") : "";
  if ($("usdtEvmAddress")) {
    // Показываем сокращённо — полный адрес уходит в буфер по тапу и в QR.
    $("usdtEvmAddress").textContent = depositAddress
      ? `${depositAddress.slice(0, 10)}…${depositAddress.slice(-8)}`
      : "";
    $("usdtEvmAddress").dataset.full = depositAddress;
  }
  $("usdtAddressCopy")?.setAttribute(
    "aria-label",
    depositAddress ? `Скопировать адрес для пополнения ${depositAddress}` : "Скопировать адрес"
  );
  // Шаг 2: баланс и переключатель валюты не нужны — остаётся платёжная карточка.
  document.querySelector(".wallet-balance-line")?.classList.toggle(
    "hidden",
    hasPendingIntent && isTopupMode && !isHistoryOpen,
  );

  // QR адреса: рисуем один раз на адрес; при любом сбое просто прячем бокс.
  const qrBox = $("usdtQrBox");
  if (qrBox) {
    let qrReady = false;
    if (hasPendingIntent && depositAddress) {
      if (qrBox.dataset.qrFor === depositAddress) {
        qrReady = true;
      } else if (drawWalletQr($("usdtQrCanvas"), depositAddress)) {
        qrBox.dataset.qrFor = depositAddress;
        qrReady = true;
      } else {
        qrBox.dataset.qrFor = "";
      }
    } else {
      qrBox.dataset.qrFor = "";
    }
    qrBox.classList.toggle("hidden", !qrReady);
  }
  if ($("walletSheetTitle")) {
    $("walletSheetTitle").textContent = isHistoryOpen
      ? "История кошелька"
      : isTopupMode
      ? `Пополнить ${isUsdt ? "USDT" : "звезды"}`
      : `Вывести ${isUsdt ? "USDT" : "звезды"}`;
  }
  if ($("walletSheetEyebrow")) {
    $("walletSheetEyebrow").textContent = isHistoryOpen
      ? "Transactions"
      : isUsdt ? "Virtual USDT" : "Telegram Stars";
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
  if ($("topupCustomAmount") && document.activeElement !== $("topupCustomAmount")) {
    $("topupCustomAmount").value = hasAmount
      ? (currency === "USDT" ? String(amount) : String(Math.round(amount)))
      : "";
  }
  if ($("topupCustomAmount")) {
    $("topupCustomAmount").step = currency === "USDT" ? "0.01" : "1";
    $("topupCustomAmount").min = currency === "USDT" ? "15" : "1";
    $("topupCustomAmount").disabled = hasPendingIntent;
    // Шаг 2: поле суммы убираем — точная сумма с центами живёт в заявке ниже.
    $("topupCustomAmount").closest("label")?.classList.toggle("hidden", hasPendingIntent);
  }
  if ($("topupReason")) {
    let topupReasonText = "";
    if (isUsdt && hasPendingIntent) {
      topupReasonText = "";
    } else if (state.topup.reason) {
      topupReasonText = state.topup.reason;
    } else if (!isUsdt) {
      topupReasonText = "Звезды зачислятся в баланс после оплаты.";
    }
    $("topupReason").textContent = topupReasonText;
    $("topupReason").classList.toggle("hidden", !topupReasonText);
  }
  if ($("topupBuyBtn")) {
    // На шаге 2 кнопка дублирует тап по карточке адреса — прячем, меньше шума.
    $("topupBuyBtn").classList.toggle("hidden", hasPendingIntent);
    $("topupBuyBtn").disabled = !isTopupMode || state.topup.pending || !state.user || (isUsdt && !hasUsdtNetworks);
    $("topupBuyBtn").textContent = isUsdt
      ? (hasPendingIntent ? "Скопировать адрес" : "Создать заявку")
      : (state.topup.pending
        ? "Открываю оплату..."
        : hasAmount
          ? `Купить ${formatCurrencyAmount(amount, currency)}`
          : "Купить");
  }
  if ($("withdrawAmountInput") && document.activeElement !== $("withdrawAmountInput")) {
    $("withdrawAmountInput").value = state.withdrawal.amount || "";
  }
  if ($("withdrawAddressInput") && document.activeElement !== $("withdrawAddressInput")) {
    $("withdrawAddressInput").value = state.withdrawal.address || "";
  }
  document.querySelectorAll("[data-withdraw-network]").forEach((button) => {
    button.classList.toggle("active", button.dataset.withdrawNetwork === state.withdrawal.network);
  });
  if ($("withdrawReason")) {
    $("withdrawReason").textContent = state.withdrawal.reason || "";
    $("withdrawReason").classList.toggle("hidden", !state.withdrawal.reason);
  }
  // Живая сводка вывода. Строка занимает место всегда (в режиме вывода),
  // чтобы её появление не дёргало высоту шита при наборе суммы.
  if ($("withdrawSummary")) {
    const withdrawAmountRaw = String(state.withdrawal.amount || "").replace(",", ".").trim();
    const withdrawAmount = Number(withdrawAmountRaw);
    const cashBalance = Number(state.usdtCashBalance || 0);
    const hasWithdrawAmount = withdrawAmountRaw !== "" && Number.isFinite(withdrawAmount) && withdrawAmount > 0;
    const overBalance = hasWithdrawAmount && withdrawAmount > cashBalance;
    const inWithdrawView = !isTopupMode && !isHistoryOpen;
    $("withdrawSummary").classList.toggle("hidden", !inWithdrawView);
    $("withdrawSummary").classList.toggle("over", overBalance);
    $("withdrawSummary").classList.toggle("idle", !hasWithdrawAmount);
    $("withdrawSummary").textContent = !inWithdrawView
      ? ""
      : !hasWithdrawAmount
        ? `Доступно: ${formatCurrencyAmount(cashBalance, "USDT")}`
        : overBalance
          ? `Доступно для вывода: ${formatCurrencyAmount(cashBalance, "USDT")} (основной баланс)`
          : `Спишем ${formatCurrencyAmount(withdrawAmount, "USDT")} · Останется ${formatCurrencyAmount(Math.max(0, cashBalance - withdrawAmount), "USDT")}`;
  }
  renderWithdrawAddressCheck();
  if ($("withdrawSubmitBtn")) {
    $("withdrawSubmitBtn").disabled = isHistoryOpen || isTopupMode || state.withdrawal.pending || !state.user;
    $("withdrawSubmitBtn").textContent = state.withdrawal.pending ? "Создаю заявку..." : "Вывести";
  }
  renderWalletHistory();
  finishSheetContentMorph(walletMorph);
}

function openTopupSheet(amount, reason = "", mode = "topup", currencyOverride = null, afterAction = null) {
  let targetCurrency = normalizeCurrency(currencyOverride || (mode === "withdraw" ? "USDT" : state.currency));
  // Живая заявка важнее валюты по умолчанию: открываем сразу её детали.
  if (mode !== "withdraw" && state.topup.intent?.status === "pending") {
    targetCurrency = "USDT";
  }
  state.topup.amount = hasTopupAmountValue(amount) ? normalizeTopupAmount(amount, targetCurrency) : "";
  state.topup.reason = reason;
  state.topup.mode = mode === "withdraw" ? "withdraw" : "topup";
  state.topup.currency = targetCurrency;
  state.topup.historyOpen = false;
  state.topup.afterAction = afterAction;
  renderTopupSheet();
  openSheet("topupSheet");
}

function closeTopupSheet(options = {}) {
  state.topup.historyOpen = false;
  closeSheet("topupSheet");
  if (options.clearAfterAction !== false) {
    state.topup.afterAction = null;
  }
}

function showButtonPressed(button) {
  if (!button || button.disabled) return;
  triggerButtonLightning(button);
  button.classList.remove("is-pressed");
  void button.offsetWidth;
  button.classList.add("is-pressed");
  setTimeout(() => button.classList.remove("is-pressed"), 150);
}

function setTopMoreMenuOpen(open) {
  const menu = $("topMoreMenu");
  const button = $("topMoreBtn");
  if (!menu || !button) {
    return;
  }
  menu.classList.toggle("hidden", !open);
  button.classList.toggle("active", Boolean(open));
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeTopMoreMenu() {
  setTopMoreMenuOpen(false);
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
    const handled = await maybeRunTopupAfterAction().catch(() => false);
    if (handled) {
      return;
    }
  }
}

async function maybeRunTopupAfterAction() {
  const action = state.topup.afterAction;
  if (!action || action.type !== "loss_refund_stars") {
    return false;
  }
  const requiredBalance = Number(action.startBalance || 0) + Number(action.amount || 0) - 0.01;
  if (Number(state.balance || 0) < requiredBalance) {
    return false;
  }
  state.topup.afterAction = null;
  await claimLossRefundWithStars(action.offerId);
  return true;
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
    saveStoredUsdtIntent(data.intent);
    renderTopupSheet();
    if (data.intent?.status === "credited") {
      stopDepositPolling();
      showTopupSuccessAnimation("TOP UP");
      flyWalletCoinsToBalance("$");
      showToast("USDT зачислены на баланс.");
      await loadMe();
      return;
    }
    if (data.intent?.status === "expired") {
      stopDepositPolling();
      triggerHaptic("warning");
      showToast("Заявка истекла. Создай новую.");
    }
  } catch (error) {
    if (error?.message === "deposit_intent_not_found") {
      // Сервер заявку не знает (удалена/чужая) — не поллим её вечно.
      state.topup.intent = null;
      saveStoredUsdtIntent(null);
      stopDepositPolling();
      renderTopupSheet();
      return;
    }
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

async function copyWalletField(button, value, successMessage) {
  if (!value) {
    triggerHaptic("warning");
    showToast("Пока нечего копировать.");
    return;
  }
  const copied = await copyToClipboard(value);
  if (copied && button) {
    button.classList.remove("is-copied");
    void button.offsetWidth;
    button.classList.add("is-copied");
    window.setTimeout(() => button.classList.remove("is-copied"), 720);
  }
  triggerHaptic(copied ? "success" : "warning");
  showToast(copied ? successMessage : "Не получилось скопировать. Скопируй вручную.");
}

// ===== QR-код адреса депозита =====
// Самодостаточный генератор под одну задачу: EVM-адрес (42 ASCII-символа).
// Версия 3 / ECC M вмещает ровно 42 байта — без выбора версии, мульти-блоков
// и подбора маски (маска 0, формат-константа 0x5412). Если текст не влезает,
// честно возвращаем null и просто не показываем QR.
const QR_SIZE = 29;
const QR_DATA_CODEWORDS = 44;
const QR_EC_CODEWORDS = 26;
const QR_EXP = new Array(512);
const QR_LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    QR_EXP[i] = x;
    QR_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) QR_EXP[i] = QR_EXP[i - 255];
}

function qrGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      if (poly[j] !== 0) {
        next[j + 1] ^= QR_EXP[(QR_LOG[poly[j]] + i) % 255];
      }
    }
    poly = next;
  }
  return poly;
}

function qrEcFor(data) {
  const gen = qrGeneratorPoly(QR_EC_CODEWORDS);
  const buffer = data.concat(new Array(QR_EC_CODEWORDS).fill(0));
  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i];
    if (factor === 0) continue;
    const logFactor = QR_LOG[factor];
    for (let j = 0; j < gen.length; j += 1) {
      if (gen[j] !== 0) {
        buffer[i + j] ^= QR_EXP[(QR_LOG[gen[j]] + logFactor) % 255];
      }
    }
  }
  return buffer.slice(data.length);
}

function qrBuildCodewords(text) {
  const bytes = Array.from(String(text), (ch) => ch.charCodeAt(0) & 0xff);
  if (!bytes.length || bytes.length > 42) {
    return null;
  }
  const bits = [];
  const pushBits = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4); // байтовый режим
  pushBits(bytes.length, 8);
  bytes.forEach((b) => pushBits(b, 8));
  const capacity = QR_DATA_CODEWORDS * 8;
  pushBits(0, Math.min(4, capacity - bits.length)); // терминатор
  while (bits.length % 8) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    codewords.push(value);
  }
  const pads = [0xec, 0x11];
  for (let i = 0; codewords.length < QR_DATA_CODEWORDS; i += 1) {
    codewords.push(pads[i % 2]);
  }
  return codewords.concat(qrEcFor(codewords));
}

function qrBuildMatrix(text) {
  const codewords = qrBuildCodewords(text);
  if (!codewords) {
    return null;
  }
  const n = QR_SIZE;
  const modules = Array.from({ length: n }, () => new Array(n).fill(false));
  const reserved = Array.from({ length: n }, () => new Array(n).fill(false));
  const setFunc = (r, c, value) => {
    modules[r][c] = value;
    reserved[r][c] = true;
  };

  const placeFinder = (top, left) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = top + r;
        const cc = left + c;
        if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunc(rr, cc, inOuter && (isBorder || isCore));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, n - 7);
  placeFinder(n - 7, 0);

  // Выравнивающий узор версии 3 — центр (22, 22).
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      setFunc(22 + r, 22 + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
  }

  for (let i = 8; i < n - 8; i += 1) {
    if (!reserved[6][i]) setFunc(6, i, i % 2 === 0);
    if (!reserved[i][6]) setFunc(i, 6, i % 2 === 0);
  }

  setFunc(n - 8, 8, true); // тёмный модуль

  // Резерв под формат-биты.
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) setFunc(8, i, false);
    if (!reserved[i][8]) setFunc(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][n - 1 - i]) setFunc(8, n - 1 - i, false);
    if (!reserved[n - 1 - i][8]) setFunc(n - 1 - i, 8, false);
  }

  // Данные: змейка парами столбцов справа налево, маска 0 ((r + c) % 2 === 0).
  const totalBits = codewords.length * 8;
  let bitIndex = 0;
  let upward = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < n; i += 1) {
      const r = upward ? n - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (reserved[r][c]) continue;
        const bit = bitIndex < totalBits
          ? ((codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1) === 1
          : false;
        bitIndex += 1;
        modules[r][c] = bit !== ((r + c) % 2 === 0);
      }
    }
    upward = !upward;
  }

  // Формат-биты (ECC M + маска 0): раскладка как в эталонных генераторах.
  const format = 0x5412;
  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >> i) & 1) === 1;
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else modules[n - 15 + i][8] = bit;
    if (i < 8) modules[8][n - 1 - i] = bit;
    else if (i < 9) modules[8][15 - i - 1 + 1] = bit;
    else modules[8][15 - i - 1] = bit;
  }
  modules[n - 8][8] = true;

  return modules;
}

function drawWalletQr(canvas, text) {
  try {
    const matrix = qrBuildMatrix(text);
    if (!matrix || !(canvas instanceof HTMLCanvasElement)) {
      return false;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return false;
    }
    const quiet = 3;
    const total = QR_SIZE + quiet * 2;
    const px = Math.max(2, Math.floor(210 / total));
    const size = px * total;
    canvas.width = size;
    canvas.height = size;
    ctx.fillStyle = "#f2f6fb";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#0a0e14";
    for (let r = 0; r < QR_SIZE; r += 1) {
      for (let c = 0; c < QR_SIZE; c += 1) {
        if (matrix[r][c]) {
          ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
        }
      }
    }
    return true;
  } catch {
    return false; // QR — украшение; депозитный флоу не должен от него зависеть
  }
}

// Быстрые суммы пополнения: одно касание вместо набора.
const WALLET_TOPUP_PRESETS = { USDT: [15, 50, 100, 500], STAR: [100, 500, 1000, 5000] };

// Живая подсказка валидности адреса вывода (без полного пере-рендера).
function renderWithdrawAddressCheck() {
  const label = $("withdrawAddressInput")?.closest("label");
  const check = $("withdrawAddressCheck");
  if (!label || !check) {
    return;
  }
  const address = String(state.withdrawal.address || "").trim();
  const valid = /^0x[a-fA-F0-9]{40}$/.test(address);
  const invalid = !valid && address.length > 8;
  label.classList.toggle("addr-valid", valid);
  label.classList.toggle("addr-invalid", invalid);
  check.textContent = valid ? "✓" : invalid ? "!" : "";
}

// Монеты летят из кошелька к балансу в хедере при зачислении депозита.
function flyWalletCoinsToBalance(glyph = "$") {
  const source = $("usdtDepositStepper") || $("walletFullBalance");
  if (!source) {
    return;
  }
  for (let i = 0; i < 3; i += 1) {
    window.setTimeout(() => flyRewardToBalance(source, glyph), i * 150);
  }
}

// ===== Персистентность депозитной заявки =====
// Заявка не должна пропадать при перезаходе: держим её в localStorage и при
// старте сверяем с сервером (GET intent). Пока сервер не сказал
// credited/expired — карточка заявки живёт.
const USDT_INTENT_KEY = "easymarket_usdt_intent";

function saveStoredUsdtIntent(intent) {
  try {
    if (intent?.id && intent.status === "pending") {
      window.localStorage?.setItem(USDT_INTENT_KEY, JSON.stringify({
        telegram_id: state.user?.telegram_id || null,
        intent,
      }));
    } else {
      window.localStorage?.removeItem(USDT_INTENT_KEY);
    }
  } catch {
    // приватный режим / запрет storage — заявка останется до перезагрузки
  }
}

function restoreUsdtIntent() {
  try {
    const raw = window.localStorage?.getItem(USDT_INTENT_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);
    if (!saved?.intent?.id || saved.intent.status !== "pending") {
      window.localStorage?.removeItem(USDT_INTENT_KEY);
      return;
    }
    if (saved.telegram_id && state.user?.telegram_id
      && String(saved.telegram_id) !== String(state.user.telegram_id)) {
      window.localStorage?.removeItem(USDT_INTENT_KEY);
      return;
    }
    if (state.topup.intent?.status === "pending") {
      return; // уже есть живая заявка в состоянии
    }
    state.topup.intent = saved.intent;
    // Поллинг сразу делает GET и приводит статус к серверной правде
    // (credited -> успех и очистка, expired -> тост и очистка).
    startDepositPolling();
  } catch {
    // повреждённая запись — просто забываем её
    try {
      window.localStorage?.removeItem(USDT_INTENT_KEY);
    } catch {
      // ignore
    }
  }
}

async function createUsdtDepositIntent() {
  if (!state.user?.telegram_id) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь.");
    return;
  }
  if (!hasTopupAmountValue(state.topup.amount)) {
    triggerHaptic("warning");
    showToast("Введи сумму пополнения.");
    return;
  }

  const amount = normalizeTopupAmount(state.topup.amount, "USDT");
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
      }),
    });
    state.topup.intent = result.intent;
    saveStoredUsdtIntent(result.intent);
    triggerHaptic("success");
    triggerLightningFlash("success");
    // Сразу кладём точную сумму в буфер — одним касанием меньше в кошельке.
    const exactAmount = result.intent?.deposit_amount != null
      ? Number(result.intent.deposit_amount).toFixed(2)
      : "";
    const amountCopied = exactAmount ? await copyToClipboard(exactAmount) : false;
    showToast(amountCopied
      ? `Заявка создана. Сумма ${exactAmount} скопирована — вставь в кошелёк.`
      : "Заявка создана. Отправь точную сумму.");
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
    saveStoredUsdtIntent(null);
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
    saveStoredUsdtIntent(null);
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

async function checkUsdtDepositIntent() {
  const intent = state.topup.intent;
  if (!intent?.id || !state.user?.telegram_id) {
    triggerHaptic("warning");
    showToast("Сначала создай заявку.");
    return;
  }

  state.topup.checking = true;
  renderTopupSheet();
  try {
    const result = await api(`/api/usdt/deposits/intents/${intent.id}/check`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
      }),
    });
    state.topup.intent = result.intent || state.topup.intent;
    saveStoredUsdtIntent(state.topup.intent);
    await loadWalletHistory().catch(() => undefined);
    await loadMe().catch(() => undefined);
    if (state.topup.intent?.status === "credited") {
      stopDepositPolling();
      showTopupSuccessAnimation("TOP UP");
      flyWalletCoinsToBalance("$");
      showToast("USDT зачислены.");
    } else {
      triggerHaptic("warning");
      showToast("Пока не вижу перевод. Проверь точную сумму и сеть.");
    }
  } catch (error) {
    triggerHaptic("error");
    showToast(error.message === "deposit_intent_not_found" ? "Заявка не найдена." : "Проверка не прошла.");
  } finally {
    state.topup.checking = false;
    renderTopupSheet();
  }
}

async function createUsdtWithdrawalRequest() {
  if (!state.user?.telegram_id) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь.");
    return;
  }
  const amount = Number(String(state.withdrawal.amount || "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) {
    triggerHaptic("warning");
    showToast("Введи сумму вывода.");
    return;
  }
  if (amount > Number(state.usdtCashBalance || 0)) {
    triggerHaptic("warning");
    showToast("Для вывода доступен только основной USDT-баланс.");
    return;
  }
  const address = String(state.withdrawal.address || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    triggerHaptic("warning");
    showToast("Введи ERC20/BEP20 кошелек.");
    return;
  }

  state.withdrawal.pending = true;
  state.withdrawal.reason = "";
  renderTopupSheet();
  try {
    const result = await api("/api/usdt/withdrawals", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        amount,
        network: state.withdrawal.network,
        to_address: address,
      }),
    });
    state.usdtCashBalance = Number(result.usdt_cash_balance || 0);
    state.usdtBonusBalance = Number(result.usdt_bonus_balance ?? state.usdtBonusBalance ?? 0);
    state.usdtBalance = Number(result.usdt_balance ?? (state.usdtCashBalance + state.usdtBonusBalance));
    state.withdrawal.amount = "";
    state.withdrawal.address = "";
    state.withdrawal.reason = "Заявка создана и отправлена админу. Статус будет в истории.";
    state.topup.historyOpen = true;
    triggerHaptic("success");
    showWalletFlowBurst("out", "ЗАЯВКА СОЗДАНА");
    showToast("Заявка на вывод создана.");
    await loadWalletHistory();
    await loadMe().catch(() => undefined);
  } catch (error) {
    triggerHaptic("error");
    const messages = {
      insufficient_usdt: "Недостаточно доступного USDT.",
      invalid_withdrawal_address: "Проверь кошелек получателя.",
      invalid_withdrawal_network: "Выбери сеть вывода.",
      invalid_withdrawal_amount: "Проверь сумму вывода.",
    };
    showToast(messages[error.message] || "Не получилось создать вывод.");
  } finally {
    state.withdrawal.pending = false;
    renderTopupSheet();
  }
}

async function startStarsTopup() {
  if (!state.user?.telegram_id) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь.");
    return;
  }
  if (!hasTopupAmountValue(state.topup.amount)) {
    triggerHaptic("warning");
    showToast("Введи сумму пополнения.");
    return;
  }

  const amount = normalizeTopupAmount(state.topup.amount, state.topup.currency);
  if (state.topup.currency === "USDT") {
    if (!state.topup.intent || state.topup.intent.status === "expired" || state.topup.intent.status === "credited") {
      await createUsdtDepositIntent();
      return;
    }
    const copied = await copyToClipboard(state.topup.intent.to_address || "");
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
          showTopupSuccessAnimation("TOP UP");
          showToast("Оплата прошла. Обновляю баланс...");
          closeTopupSheet({ clearAfterAction: false });
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
  const market = getDisplayMarket();
  if (!container || !trade?.id || !market || Number(trade.market_id) !== Number(market.id)) {
    return;
  }
  if (state.bubbledActivityIds.has(trade.id)) {
    return;
  }
  state.bubbledActivityIds.add(trade.id);
  if (state.bubbledActivityIds.size > 240) {
    state.bubbledActivityIds.delete(state.bubbledActivityIds.values().next().value);
  }
  const bubble = document.createElement("div");
  const name = formatUserDisplayName(trade);
  const action = trade.action || "BUY";
  bubble.className = `trade-bubble ${sideClass(trade.side)}`;
  bubble.textContent = `${name} ${actionLabel(action)} ${marketSideLabel(market, trade.side)} ${formatCurrencyAmount(trade.amount, trade.currency)}`;
  const duration = 3900 + Math.random() * 1400;
  const delay = Math.random() * 420;
  const rise = -(86 + Math.random() * 84);
  bubble.style.left = `${10 + Math.random() * 72}%`;
  bubble.style.bottom = `${18 + Math.random() * 72}px`;
  bubble.style.animationDelay = `${delay}ms`;
  bubble.style.setProperty("--bubble-duration", `${duration}ms`);
  bubble.style.setProperty("--bubble-start-x", `${-14 + Math.random() * 28}px`);
  bubble.style.setProperty("--bubble-mid-x", `${-36 + Math.random() * 72}px`);
  bubble.style.setProperty("--bubble-end-x", `${-46 + Math.random() * 92}px`);
  bubble.style.setProperty("--bubble-mid-y", `${rise * 0.56}px`);
  bubble.style.setProperty("--bubble-end-y", `${rise}px`);
  container.appendChild(bubble);
  setTimeout(() => bubble.remove(), duration + delay + 500);
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
    avatar_url: getTelegramUserAvatarUrl(state.user?.username),
  };
  state.activity = [enriched, ...state.activity].slice(0, 24);
  rememberChartTrades([enriched]);
  state.seenActivityIds.add(enriched.id);
  showTradeBubble(enriched);
}

async function submitLimitOrder() {
  const market = getDisplayMarket();
  const side = state.orderbookSide || state.selectedSide || "YES";
  const orderSide = state.orderbook.orderSide || "BUY";
  const amount = Number(state.orderbook.formAmount || 0);
  const limitPriceCents = Number(state.orderbook.formPrice || 0);
  const limitPrice = centsInputToOutcomePrice(limitPriceCents);
  const minLimitPrice = getMarketMinOutcomePrice(market);
  if (!state.user || !market) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь и активный рынок.");
    return;
  }
  if (!isMarketOpenForBuy(market)) {
    triggerHaptic("warning");
    showToast("Этот рынок уже завершился.");
    return;
  }
  if (
    !Number.isFinite(amount)
    || amount <= 0
    || !Number.isFinite(limitPriceCents)
    || !Number.isFinite(limitPrice)
    || limitPrice < minLimitPrice
    || limitPrice > 1 - minLimitPrice
  ) {
    triggerHaptic("warning");
    showToast("Проверь цену в центах и сумму лимитки.");
    return;
  }
  if (orderSide === "SELL") {
    const sellablePosition = getSellableLimitPosition(market, side);
    const sellableValue = Number(sellablePosition?.shares || 0) * limitPrice;
    if (!sellablePosition || amount > sellableValue + 0.00000001) {
      triggerHaptic("warning");
      showToast("Не хватает shares для sell-лимитки.");
      return;
    }
  } else if (amount > Number(getActiveBalance() || 0)) {
    const missing = Math.max(1, Math.ceil(amount - Number(getActiveBalance() || 0)));
    triggerHaptic("warning");
    openTopupSheet(missing, `Для лимитки не хватает ${formatCurrencyAmount(missing, state.currency)}.`);
    return;
  }

  state.orderbook.pending = true;
  renderOrderbookPanel();
  try {
    const result = await api(`/api/market/${market.id}/limit-orders`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        side,
        order_side: orderSide,
        amount,
        limit_price: limitPrice,
        currency: state.currency,
      }),
    });
    applyCurrencyBalancePayload(result.currency || state.currency, result);
    upsertLocalPosition(result.position);
    showToast("Лимитка выставлена.");
    triggerHaptic("success");
    await loadOrderbook({ force: true });
    renderMarket();
    renderMe();
  } catch (error) {
    triggerHaptic("error");
    if (error.message === "insufficient_fire" || error.message === "insufficient_usdt") {
      const missing = Math.max(1, Math.ceil(amount - Number(getActiveBalance() || 0)));
      openTopupSheet(missing, `Для лимитки не хватает ${formatCurrencyAmount(missing, state.currency)}.`);
    } else if (error.message === "insufficient_shares" || error.message === "position_not_open") {
      showToast("Не хватает shares для sell-лимитки.");
    } else {
      showToast("Лимитка не создана.");
    }
  } finally {
    state.orderbook.pending = false;
    renderOrderbookPanel();
  }
}

async function cancelLimitOrder(orderId) {
  if (!state.user?.telegram_id || !orderId || state.orderbook.cancelPendingId) {
    return;
  }

  state.orderbook.cancelPendingId = Number(orderId);
  renderOrderbookPanel();
  try {
    const result = await api(`/api/limit-orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
      }),
    });
    applyCurrencyBalancePayload(result.currency || state.currency, result);
    upsertLocalPosition(result.position);
    showToast("Лимитка отменена.");
    triggerHaptic("success");
    await loadOrderbook({ force: true });
    renderMe();
  } catch {
    triggerHaptic("error");
    showToast("Не получилось отменить лимитку.");
  } finally {
    state.orderbook.cancelPendingId = null;
    renderOrderbookPanel();
  }
}

async function buy(amount = state.selectedAmount, forcedIntent = null) {
  const market = forcedIntent?.marketId ? findMarketById(forcedIntent.marketId) : getDisplayMarket();
  if (!state.user || !market) {
    triggerHaptic("warning");
    showToast("Сначала нужен пользователь и активный рынок.");
    return;
  }

  const marketId = market.id;
  const side = forcedIntent?.side || state.selectedSide;
  const buyAmount = Number(amount || forcedIntent?.amount || state.selectedAmount);
  const currency = normalizeCurrency(forcedIntent?.currency || state.currency);
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
    if (state.buyQueue.length < 30) {
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
    // Bet placement keeps its signature lightning (priority), plus the
    // directional up/down surge by side (UP green / DOWN red).
    triggerLightningFlash("success", getTierForAmount(buyAmount, currency));
    const surgeOrigin = document.querySelector(`.outcome-button[data-side="${side}"]`)?.getBoundingClientRect();
    showDirectionalSurge(side, surgeOrigin);
    renderMarket();
    renderMarketChart();
    renderMe();
    renderActivity();
    renderTradeTicket();
    if (state.marketPanel === "book") {
      void loadOrderbook({ force: true });
    }
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
        void buy(nextIntent.amount, nextIntent);
      }, 18);
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
    triggerLightningFlash("success", getTierForAmount(result.trade?.amount || result.sale?.exit_value || 0, result.currency || state.currency));
    const pnl = Number(result.sale?.pnl || 0);
    const sellMarket = result.market || findMarketById(marketId) || getDisplayMarket();
    showToast(`Продано ${marketSideLabel(sellMarket, side)}: ${formatSignedCurrencyAmount(pnl, result.currency || state.currency)}`);
    renderMarket();
    renderMe();
    renderActivity();
    renderTradeTicket();
    if (state.marketPanel === "book") {
      void loadOrderbook({ force: true });
    }
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
      sell_frozen: "В последние секунды продажа закрыта.",
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

async function claimLossRefundWithStars(offerId) {
  if (!state.user?.telegram_id || !offerId) {
    triggerHaptic("warning");
    return;
  }
  try {
    const result = await api(`/api/loss-refund/${offerId}/claim-stars`, {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
      }),
    });
    state.balance = result.balance ?? state.balance;
    state.usdtBalance = result.usdt_balance ?? state.usdtBalance;
    state.usdtCashBalance = result.usdt_cash_balance ?? state.usdtCashBalance;
    state.usdtBonusBalance = result.usdt_bonus_balance ?? state.usdtBonusBalance;
    state.lossRefundOffers = state.lossRefundOffers.filter((offer) => Number(offer.id) !== Number(offerId));
    dismissLossRefundForToday();
    triggerHaptic("success");
    triggerLightningFlash("success");
    showToast(`Возврат начислен: ${formatCurrencyAmount(result.offer?.amount || 0, "USDT")}`);
    renderMe();
  } catch (error) {
    triggerHaptic("error");
    const messages = {
      insufficient_fire: "Не хватает звёзд.",
      loss_refund_offer_not_found: "Предложение уже недоступно.",
      loss_refund_offer_requires_referral: "Этот возврат доступен через друга.",
    };
    showToast(messages[error.message] || "Не получилось вернуть ставку.");
    void loadMe().catch(() => undefined);
  }
}

async function refreshAll({ includeLists = false } = {}) {
  try {
    await loadMarket();
    if (includeLists) {
      await loadBtcMarkets().catch(() => undefined);
      await loadWorldCupMarkets().catch(() => undefined);
      await loadTopMarkets().catch(() => undefined);
      await loadSportsMarkets().catch(() => undefined);
      await loadSpecialMarket().catch(() => undefined);
    }
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
    state.sideSelectedMarketId = getDisplayMarket()?.id || null;
    // One-shot "charge" pulse in the side colour on the picked outcome.
    button.classList.remove("side-charge");
    void button.offsetWidth;
    button.classList.add("side-charge");
    window.setTimeout(() => button.classList.remove("side-charge"), 460);
    renderTradeTicket();
  });
});

document.querySelectorAll(".amount-button").forEach((button) => {
  button.addEventListener("click", () => {
    button.blur();
    state.selectedAmount = Number(button.dataset.amount);
    renderTradeTicket();
    requestMarketBuy(getDisplayMarket(), state.selectedSide, state.selectedAmount);
  });
});

$("quickBetToggle")?.addEventListener("click", () => {
  toggleQuickBetMode();
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
    void refreshAll({ includeLists: true });
  });
}

$("walletBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  openTopupSheet("", "", "topup");
});

$("kyivstonerMarketBtn")?.addEventListener("click", async () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  const button = $("kyivstonerMarketBtn");
  showButtonPressed(button);
  void playKyivstonerMotion(button, {
    onImpact: () => playMotionSound("success"),
  });
  try {
    const market = state.specialMarkets[0]
      || await runSingleFlight("specialMarket", loadSpecialMarket);
    if (market?.id) {
      selectSpecialMarket(market.id);
    }
  } catch {
    showToast("Рынок Киевстонера пока не загрузился.");
  }
});

$("topMoreBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  triggerHaptic("selection");
  showButtonPressed($("topMoreBtn"));
  setTopMoreMenuOpen($("topMoreMenu")?.classList.contains("hidden"));
});

$("leaderboardBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setLeaderboardSheetOpen(true);
  void preloadLeaderboards({ force: true }).catch(() => showToast("Рейтинг пока не загрузился."));
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

$("clansBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setClansSheetOpen(true);
});

$("userClanCard")?.addEventListener("click", () => {
  if (!state.userClan) {
    return;
  }
  triggerHaptic("selection");
  state.selectedClanId = state.userClan.id;
  state.clanView = "detail";
  renderClans();
});

$("clanNameInput")?.addEventListener("input", updateClanCreatePreview);

$("clansCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setClansSheetOpen(false);
});

$("clansSheet")?.addEventListener("click", (event) => {
  if (event.target === $("clansSheet")) {
    setClansSheetOpen(false);
  }
});

$("settingsBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  renderSoundToggle();
  renderAquariumToggle();
  renderShareWinsToggle();
  openSheet($("settingsSheet"));
});

$("settingsCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeSheet($("settingsSheet"));
});

$("settingsSheet")?.addEventListener("click", (event) => {
  if (event.target === $("settingsSheet")) {
    closeSheet($("settingsSheet"));
  }
});

$("shareWinCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeSheet($("shareWinSheet"));
});

$("shareWinSheet")?.addEventListener("click", (event) => {
  if (event.target === $("shareWinSheet")) {
    closeSheet($("shareWinSheet"));
  }
});

$("shareToStoryBtn")?.addEventListener("click", () => shareWinToStory());
$("shareToChatBtn")?.addEventListener("click", () => shareWinToChat());
$("shareCopyBtn")?.addEventListener("click", () => shareWinCopy());
$("winOverlay")?.addEventListener("click", () => {
  if (state.lastWin && isShareWinsEnabled()) {
    openShareWinSheet();
  }
});

$("shareWinsToggleBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setShareWinsEnabled(!isShareWinsEnabled());
  renderShareWinsToggle();
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest(".top-actions")) {
    closeTopMoreMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTopMoreMenu();
  }
});

// Плавная клавиатура для нижних шторок. Когда Telegram сжимает вьюпорт под
// клавиатуру, прижатая к низу панель телепортируется вверх на высоту
// клавиатуры. Компенсируем FLIP-ом: мгновенно возвращаем панель на старое
// место через translate (не конфликтует с transform из bottomSheetIn) и даём
// CSS-переходу довезти её до нового.
let sheetViewportHeight = window.innerHeight;

function glideOpenSheetPanels(delta) {
  document
    .querySelectorAll(".task-sheet:not(.hidden) :is(.task-panel, .bet-panel)")
    .forEach((panel) => {
      // Текущий Y из computed style: если глайд ещё едет, стартуем с него.
      const currentY = parseFloat(String(getComputedStyle(panel).translate || "").split(" ")[1] || "") || 0;
      panel.style.transition = "none";
      panel.style.translate = `0 ${currentY - delta}px`;
      void panel.offsetHeight;
      panel.style.transition = "";
      panel.style.translate = "0 0";
    });
}

window.addEventListener("resize", () => {
  const delta = window.innerHeight - sheetViewportHeight;
  sheetViewportHeight = window.innerHeight;
  if (Math.abs(delta) >= 40) {
    glideOpenSheetPanels(delta);
  }
});

// iOS-клавиатуры-оверлеи не меняют layout-вьюпорт — фиксированная шторка не
// прыгает, но поле оказывается под клавиатурой. Приподнимаем через --kb-inset
// (у .task-sheet есть transition на padding-bottom).
window.visualViewport?.addEventListener("resize", () => {
  const vv = window.visualViewport;
  const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty("--kb-inset", `${Math.round(overlap)}px`);
});

// После того как клавиатура и глайд устаканились, доводим поле до видимости —
// только если его реально перекрыло, и минимальным сдвигом, без прыжка в центр.
document.addEventListener("focusin", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.matches("input, textarea")) {
    return;
  }
  if (!el.closest(".task-sheet")) {
    return;
  }
  window.setTimeout(() => {
    if (document.activeElement !== el) {
      return;
    }
    const vv = window.visualViewport;
    const visibleTop = (vv?.offsetTop ?? 0) + 8;
    const visibleBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 8;
    const rect = el.getBoundingClientRect();
    if (rect.top >= visibleTop && rect.bottom <= visibleBottom) {
      return;
    }
    try {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch {
      el.scrollIntoView();
    }
  }, 360);
});

$("clanInfoBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.clanView = "rules";
  renderClans();
});

$("clanCreateToggleBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.clanView = "create";
  renderClans();
});

$("clansBackBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.clanView = "leaderboard";
  renderClans();
});

$("clanWarPodium")?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-open-clan]");
  if (!item) {
    return;
  }
  state.selectedClanId = Number(item.dataset.openClan);
  state.clanView = "detail";
  triggerHaptic("selection");
  renderClans();
});

$("clansList")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-join-clan]");
  const row = event.target.closest("[data-open-clan]");
  if (row && !button) {
    state.selectedClanId = Number(row.dataset.openClan);
    state.clanView = "detail";
    triggerHaptic("selection");
    renderClans();
    return;
  }

  if (!button || !state.user?.telegram_id) {
    return;
  }
  event.stopPropagation();
  void joinClanFromButton(button);
});

$("clanDetailCard")?.addEventListener("click", (event) => {
  const channelButton = event.target.closest("[data-open-channel]");
  if (channelButton) {
    event.preventDefault();
    triggerHaptic("selection");
    openTelegramUrl(channelButton.dataset.openChannel);
    return;
  }
  const shareButton = event.target.closest("[data-share-clan]");
  if (shareButton) {
    event.preventDefault();
    const clan = state.clans.find((item) => item.id === Number(shareButton.dataset.shareClan))
      || state.userClan;
    void shareClan(clan);
    return;
  }
  const button = event.target.closest("[data-join-clan]");
  if (!button) {
    return;
  }
  event.preventDefault();
  void joinClanFromButton(button);
});

$("clanIconPicker")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-clan-icon]");
  if (!button) {
    return;
  }
  state.selectedClanIconKey = button.dataset.clanIcon || "bull";
  triggerHaptic("selection");
  renderClanIconPicker();
});

$("clanCreateBtn")?.addEventListener("click", async () => {
  const button = $("clanCreateBtn");
  if (state.clanCreating) {
    return;
  }
  showButtonPressed(button);
  triggerHaptic("selection");
  if (!state.user?.telegram_id) {
    showToast("Открой Mini App из Telegram.");
    return;
  }
  const name = $("clanNameInput")?.value;
  const channelUrl = $("clanChannelInput")?.value;
  state.clanCreating = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Создаю...";
  }
  try {
    const result = await api("/api/clans/create", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        name,
        channel_url: channelUrl,
        icon_key: state.selectedClanIconKey,
      }),
    });
    state.clans = result.clans || [];
    state.userClan = result.user_clan || null;
    state.selectedClanId = result.created_clan?.id || state.userClan?.id || null;
    state.clanView = "detail";
    applyCurrencyBalance("STAR", result.balance ?? state.balance);
    renderClans();
    renderMe();
    triggerLightningFlash("success");
    showToast("Клан создан.");
  } catch (error) {
    const messages = {
      insufficient_fire: "Нужно 10 000 звёзд на создание клана.",
      clan_name_required: "Название клана слишком короткое.",
      clan_exists: "Такой клан уже есть.",
      invalid_clan_channel: "Ссылка на канал выглядит неправильно.",
    };
    if (error.message === "insufficient_fire") {
      const missing = Math.max(0, 10000 - Number(state.balance || 0));
      openTopupSheet(missing || 10000, "Для создания клана нужно 10 000 звёзд.", "topup", "STAR");
    }
    showToast(messages[error.message] || "Клан не создан.");
  } finally {
    state.clanCreating = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Создать клан · 10 000 ★";
    }
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
  showButtonPressed($("topupBuyBtn"));
  triggerHaptic("selection");
  void startStarsTopup();
});

$("walletHistoryBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.topup.historyOpen = !state.topup.historyOpen;
  if (state.topup.historyOpen) {
    void loadWalletHistory();
  }
  renderTopupSheet();
});

$("topupCustomAmount")?.addEventListener("input", () => {
  if (state.topup.intent?.status === "pending") {
    return;
  }
  const rawAmount = $("topupCustomAmount").value;
  state.topup.amount = hasTopupAmountValue(rawAmount)
    ? normalizeTopupAmount(rawAmount, state.topup.currency)
    : "";
  state.topup.reason = "";
  renderTopupSheet();
});

$("usdtCancelIntentBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  void cancelUsdtDepositIntent();
});

$("usdtCheckIntentBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  void checkUsdtDepositIntent();
});

$("usdtDepositAmountCopy")?.addEventListener("click", () => {
  triggerHaptic("selection");
  const intent = state.topup.intent;
  const value = intent?.deposit_amount != null ? Number(intent.deposit_amount).toFixed(2) : "";
  void copyWalletField($("usdtDepositAmountCopy"), value, "Точная сумма скопирована.");
});

$("usdtAddressCopy")?.addEventListener("click", () => {
  triggerHaptic("selection");
  // На экране адрес сокращён — копируем всегда полный.
  const value = state.topup.intent?.to_address || $("usdtEvmAddress")?.dataset.full || "";
  void copyWalletField($("usdtAddressCopy"), value, "Адрес для пополнения скопирован.");
});

$("walletModeTopupBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.topup.historyOpen = false;
  state.topup.mode = "topup";
  renderTopupSheet();
});

$("walletModeWithdrawBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.topup.historyOpen = false;
  state.topup.mode = "withdraw";
  state.topup.currency = "USDT";
  renderTopupSheet();
});

$("withdrawAmountInput")?.addEventListener("input", () => {
  state.withdrawal.amount = $("withdrawAmountInput").value;
  state.withdrawal.reason = "";
  renderTopupSheet();
});

$("withdrawAddressInput")?.addEventListener("input", () => {
  state.withdrawal.address = $("withdrawAddressInput").value;
  state.withdrawal.reason = "";
  renderWithdrawAddressCheck();
});

$("withdrawMaxBtn")?.addEventListener("click", (event) => {
  event.preventDefault();
  triggerHaptic("selection");
  const cash = Math.floor(Number(state.usdtCashBalance || 0) * 100) / 100;
  state.withdrawal.amount = cash > 0 ? String(cash) : "";
  state.withdrawal.reason = "";
  renderTopupSheet();
});

$("topupPresets")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topup-preset]");
  if (!button || button.disabled || state.topup.intent?.status === "pending") {
    return;
  }
  triggerHaptic("selection");
  state.topup.amount = normalizeTopupAmount(button.dataset.topupPreset, state.topup.currency);
  state.topup.reason = "";
  renderTopupSheet();
});

document.querySelectorAll("[data-withdraw-network]").forEach((button) => {
  button.addEventListener("click", () => {
    triggerHaptic("selection");
    state.withdrawal.network = button.dataset.withdrawNetwork === "ETH" ? "ETH" : "BSC";
    state.withdrawal.reason = "";
    renderTopupSheet();
  });
});

$("withdrawSubmitBtn")?.addEventListener("click", () => {
  showButtonPressed($("withdrawSubmitBtn"));
  triggerHaptic("selection");
  void createUsdtWithdrawalRequest();
});

document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) {
    return;
  }
  showButtonPressed(button);
}, { passive: true });

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

document.querySelectorAll("[data-feed-panel]").forEach((button) => {
  button.addEventListener("click", () => {
    const panel = button.dataset.feedPanel;
    if (!["positions", "activity", "recent"].includes(panel) || state.feedPanel === panel) {
      return;
    }
    triggerHaptic("selection");
    state.feedPanel = panel;
    renderFeedPanel();
  });
});

let feedTouchStartX = null;
let feedTouchStartY = null;
document.addEventListener("touchstart", (event) => {
  if (!event.target.closest("#activitySection, #recentSection, #marketResultsSection, #feedTabs")) {
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) return;
  feedTouchStartX = touch.clientX;
  feedTouchStartY = touch.clientY;
}, { passive: true });

document.addEventListener("touchend", (event) => {
  if (feedTouchStartX === null || feedTouchStartY === null) {
    return;
  }
  const touch = event.changedTouches?.[0];
  const startX = feedTouchStartX;
  const startY = feedTouchStartY;
  feedTouchStartX = null;
  feedTouchStartY = null;
  if (!touch) return;
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  const panels = ["positions", "activity", "recent"];
  const currentIndex = Math.max(0, panels.indexOf(state.feedPanel));
  const nextIndex = dx < 0
    ? Math.min(panels.length - 1, currentIndex + 1)
    : Math.max(0, currentIndex - 1);
  if (nextIndex === currentIndex) {
    return;
  }
  state.feedPanel = panels[nextIndex];
  triggerHaptic("selection");
  renderFeedPanel();
}, { passive: true });

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
    state.orderbook.currency = nextCurrency;
    state.orderbook.levels = [];
    state.orderbook.myOrders = [];
    state.orderbook.loadedAt = 0;
    state.orderbook.formAmount = String(getAmountsForCurrency(nextCurrency)[0] || "");
    state.orderbook.formPrice = "";
    renderMe();
    renderTradeTicket();
    renderOrderbookPanel();
    if (state.marketPanel === "book") {
      void loadOrderbook({ force: true });
    }
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

document.querySelectorAll("[data-leaderboard-currency]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextCurrency = normalizeCurrency(button.dataset.leaderboardCurrency);
    if (state.leaderboardCurrency === nextCurrency) {
      return;
    }
    triggerHaptic("selection");
    state.leaderboardCurrency = nextCurrency;
    const hasCache = applyLeaderboardCache(state.leaderboardMode, nextCurrency);
    state.leaderboardLoading = !hasCache;
    renderLeaderboard();
    if (!hasCache) {
      void preloadLeaderboards().catch(() => showToast("Рейтинг пока не загрузился."));
    }
  });
});

document.querySelectorAll("[data-leaderboard-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextMode = normalizeLeaderboardMode(button.dataset.leaderboardMode);
    if (state.leaderboardMode === nextMode) {
      return;
    }
    triggerHaptic("selection");
    state.leaderboardMode = nextMode;
    const hasCache = applyLeaderboardCache(nextMode, state.leaderboardCurrency);
    state.leaderboardLoading = !hasCache;
    renderLeaderboard();
    if (!hasCache) {
      void preloadLeaderboards().catch(() => showToast("Рейтинг пока не загрузился."));
    }
  });
});

document.querySelectorAll("[data-copy-address]").forEach((button) => {
  button.addEventListener("click", async () => {
    const address = state.topup.intent?.to_address || "";
    const copied = await copyToClipboard(address);
    triggerHaptic(copied ? "success" : "warning");
    showToast(copied ? "Адрес скопирован." : "Скопируй адрес вручную.");
  });
});

function buildTelegramMiniAppLaunchUrl(startParam = "easymarket") {
  let safeStartParam = String(startParam || "easymarket").trim() || "easymarket";
  if (/^\d+$/.test(safeStartParam)) {
    safeStartParam = `ref_${safeStartParam}`;
  }
  const baseUrl = state.publicConfig.mini_app_url || "https://t.me/voit_help_bot?startapp=easymarket";
  try {
    const url = new URL(baseUrl, window.location.origin);
    if (/^(www\.)?t\.me$/i.test(url.hostname) || /^(www\.)?telegram\.me$/i.test(url.hostname)) {
      url.searchParams.set("startapp", safeStartParam);
      return url.toString();
    }

    if (safeStartParam.startsWith("ref_")) {
      url.searchParams.set("ref", safeStartParam.replace(/^ref_/, ""));
    } else {
      url.searchParams.set("startapp", safeStartParam);
    }
    return url.toString();
  } catch {
    if (safeStartParam.startsWith("ref_")) {
      return `${window.location.origin}/?ref=${encodeURIComponent(safeStartParam.replace(/^ref_/, ""))}`;
    }
    return `${window.location.origin}/?startapp=${encodeURIComponent(safeStartParam)}`;
  }
}

function buildInviteUrl(inviterTelegramId) {
  return buildTelegramMiniAppLaunchUrl(`ref_${inviterTelegramId}`);
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

async function claimShareTask(sourceElement = null) {
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
    if (result.progress) {
      applyDailyTaskProgress("share_friend", result.progress);
    }
    renderMe();
    renderShareFriendTask();
    if (result.already_claimed) {
      showToast("Этот уровень уже забран.");
      return;
    }
    if (Number(result.awarded || 0) > 0) {
      playTaskRewardAnimation(sourceElement);
      showToast(`+${formatFire(result.awarded)} за друзей.`);
      return;
    }
    showToast("Дневной лимит бонусов уже достигнут.");
  } catch (error) {
    showToast(error.message === "task_not_ready" ? "Прогресс ещё не дошёл до награды." : "Не получилось забрать награду.");
  }
}

async function claimSimpleTask(taskKey, sourceElement = null) {
  if (!state.user?.telegram_id) {
    return;
  }
  try {
    const result = await api("/api/tasks/claim", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        task_key: taskKey,
      }),
    });
    state.balance = result.balance ?? state.balance;
    renderMe();
    if (result.already_claimed) {
      showToast("Задание уже засчитано.");
      return;
    }
    if (Number(result.awarded || 0) > 0) {
      playTaskRewardAnimation(sourceElement);
      showToast(`+${formatFire(result.awarded)} за задание.`);
      return;
    }
    showToast("Дневной лимит бонусов уже достигнут.");
  } catch {
    showToast("Открой ссылку и попробуй забрать бонус позже.");
  }
}

// Активные минуты: вкладка видима и было взаимодействие за последние 2 минуты.
function isPresenceAccruing() {
  return !document.hidden && Date.now() - state.presence.lastInteractionAt < 120_000;
}

// Полоска выровнена по трём равным ячейкам чекпоинтов: каждая треть
// заполняется ровно к своему порогу (5 / 15 / 30 минут).
function presenceLadderProgress(minutes) {
  let progress = 0;
  let from = 0;
  for (const step of PRESENCE_LADDER) {
    if (minutes >= step.minutes) {
      progress += 1 / PRESENCE_LADDER.length;
    } else {
      progress += ((minutes - from) / (step.minutes - from)) / PRESENCE_LADDER.length;
      break;
    }
    from = step.minutes;
  }
  return Math.min(1, Math.max(0, progress));
}

function updatePresenceLadder() {
  const minutes = state.presence.activeMs / 60_000;
  const label = $("presenceLadderTime");
  const bar = $("presenceLadderBar");
  if (label) {
    const totalSeconds = Math.floor(state.presence.activeMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    label.textContent = `${mm}:${ss}`;
  }
  if (bar) bar.style.setProperty("--progress", String(presenceLadderProgress(minutes)));
  $("presenceLadder")?.classList.toggle("is-paused", !isPresenceAccruing());
  document.querySelectorAll("[data-presence-key]").forEach((button) => {
    const step = PRESENCE_LADDER.find((item) => item.key === button.dataset.presenceKey);
    if (!step) return;
    const claimed = isTaskClaimedLocally(step.key);
    const ready = minutes >= step.minutes;
    button.classList.toggle("claimed", claimed);
    button.classList.toggle("claimable", ready && !claimed);
    button.disabled = claimed || !ready;
  });
}

async function claimPresenceStep(key, button = null) {
  const step = PRESENCE_LADDER.find((item) => item.key === key);
  if (!step || !state.user?.telegram_id || state.presence.pending || isTaskClaimedLocally(key)) {
    return;
  }
  const minutes = state.presence.activeMs / 60_000;
  if (minutes < step.minutes) {
    showToast(`Ещё ${Math.max(1, Math.ceil(step.minutes - minutes))} мин активной игры.`);
    return;
  }

  state.presence.pending = true;
  const rewardOrigin = captureAnimationOrigin(button);
  try {
    const result = await api("/api/tasks/daily", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        task_key: key,
      }),
    });
    state.balance = result.balance ?? state.balance;
    state.presence.claimed[key] = true;
    markDailyTaskClaimed(key);
    renderMe();
    if (result.already_claimed) {
      showToast("Эта ступень уже забрана.");
    } else if (Number(result.awarded || 0) > 0) {
      playTaskRewardAnimation(rewardOrigin || button, button?.closest?.(".presence-ladder"));
      showToast(`+${formatFire(result.awarded)} за ${step.minutes} минут в игре.`);
    } else {
      showToast("Дневной лимит бонусов уже достигнут.");
    }
  } catch {
    showToast("Не получилось забрать награду.");
  } finally {
    state.presence.pending = false;
    updatePresenceLadder();
  }
}

async function shareInvite({ awardShareTask = false, sourceElement = null } = {}) {
  triggerHaptic("selection");
  if (!state.user?.telegram_id) {
    showToast("Сначала нужен пользователь.");
    return;
  }

  const usdtBonus = Math.round(Number(state.publicConfig.referral_bet_bonus_usdt || 30));
  const inviteUrl = buildInviteUrl(state.user.telegram_id);
  const text = `Залетай в EasyMarket. После первой ставки мне дадут ${formatFire(usdtBonus)} USDT и 1% с твоих побед.`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    showToast(awardShareTask ? "Ссылка для друзей готова." : `+${formatFire(usdtBonus)} USDT и 1% с побед друга.`);
    return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: "EasyMarket",
        text,
        url: inviteUrl,
      });
      if (awardShareTask) showToast("Ссылка для друзей готова.");
      return;
    }
  } catch {
    // Fall through to Telegram share link.
  }

  window.open(shareUrl, "_blank", "noopener,noreferrer");
  showToast(awardShareTask ? "Ссылка для друзей готова." : `+${formatFire(usdtBonus)} USDT и 1% с побед друга.`);
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
    state.commentsOnlineCount = Math.max(1, Number(state.commentsOnlineCount || 0));
    triggerHaptic("success");
    triggerLightningFlash("success");
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

// ===== Стрик «Заряд молнии» + ротация дейликов =====
const TASK_ICON_SVG = {
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.3"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6"/></svg>',
  btc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M9.8 7.8v8.4M12.2 7.6v.9M12.2 15.5v.9M9.6 8.3h4.1c1.1 0 2 .7 2 1.7s-.9 1.7-2 1.7H9.6M9.6 11.7h4.4c1.2 0 2.1.8 2.1 1.8s-.9 1.8-2.1 1.8H9.6"/></svg>',
  ball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7l3.3 2.4-1.25 3.85h-4.1L8.65 9.4 12 7z"/><path d="M12 4.2v2.8M6.4 10.3l2.25.9M17.6 10.3l-2.25.9M9.85 13.25 8.3 15.6M14.15 13.25l1.55 2.35"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20.5h16M7 20.5V14M12 20.5V8.5M17 20.5v-9.5"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5h9v3.4a4.5 4.5 0 0 1-9 0V4.5z"/><path d="M7.5 5.6H5.2v1.1a2.6 2.6 0 0 0 2.7 2.6M16.5 5.6h2.3v1.1a2.6 2.6 0 0 1-2.7 2.6M12 12.4V16M9 19.5h6M9.9 19.5l.5-3.5h3.2l.5 3.5"/></svg>',
  streak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c.8 2.8-2.6 3.9-2.6 7a2.6 2.6 0 0 0 5.2 0c0-.7.35-1.25.35-1.25.95 1 1.65 2.4 1.65 3.9a4.6 4.6 0 0 1-9.2 0c0-3.65 3.4-5.25 4.6-9.65z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 2.8 5.8 13h5.1l-1 8.2 8.2-11h-5.2l.6-7.4z"/></svg>',
  bear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 9.5 5.8 6.8M16.5 9.5l1.7-2.7"/><path d="M6.2 12.8c0-3.1 2.4-5.3 5.8-5.3s5.8 2.2 5.8 5.3-2.4 5.7-5.8 5.7-5.8-2.6-5.8-5.7z"/><path d="M9.5 12.2h.01M14.5 12.2h.01M10.4 15.4c.9.6 2.3.6 3.2 0"/></svg>',
  fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 8.5c3 .4 5.5 2.2 5.5 3.5s-2.5 3.1-5.5 3.5"/><path d="M14.5 8.5C10.9 5.8 4 6.2 4 12s6.9 6.2 10.5 3.5c2-1.5 2-5.5 0-7z"/><path d="M12 11.8h.01"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8l-4 3.2V16.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M7.5 9.5h9M7.5 12.5h6"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="m14.8 9.2-1.5 4.1-4.1 1.5 1.5-4.1 4.1-1.5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 20 4l-4.5 16-3.2-6.8L4 12.5z"/><path d="M20 4 12.3 13.2"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6.2a2.7 2.7 0 0 1-2.7-2.7V7.5z"/><path d="m4.8 7.4 10.4-3a2 2 0 0 1 2.6 1.9v1.2"/><path d="M16.4 13.2h4.1"/></svg>',
  dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 6.8v10.4M15 8.7c-.7-.7-1.6-1.1-2.8-1.1-1.5 0-2.5.7-2.5 1.8s.9 1.6 2.6 2.1c1.9.6 2.9 1.1 2.9 2.6 0 1.3-1.1 2.2-3 2.2-1.3 0-2.5-.4-3.4-1.3"/></svg>',
};

const CORE_DAILY_TASK_KEYS = [
  "daily_bet",
  "daily_topup_stars",
  "daily_topup_usdt",
  "daily_football_prediction",
  "daily_btc_5_predictions",
  "daily_win_1",
  "daily_win_streak_5",
];

const DAILY_TASK_META = {
  share_friend: { title: "Рассказать друзьям", desc: "Зови людей в EasyMarket", icon: "share" },
  daily_bet: { title: "Первая ставка дня", desc: "Поставь 1 ставку", icon: "target" },
  daily_topup_stars: { title: "Пополнить звёзды", desc: "Зачисли минимум 500 звёзд", icon: "wallet" },
  daily_topup_usdt: { title: "Пополнить USDT", desc: "Зачисли минимум 50 USDT", icon: "dollar" },
  daily_btc_prediction: { title: "Прогноз по BTC", desc: "1 прогноз в BTC-маркете", icon: "btc" },
  daily_football_prediction: { title: "Прогноз на футбол", desc: "1 футбольный прогноз", icon: "ball" },
  daily_btc_5_predictions: { title: "BTC-прогнозы", desc: "Лестница прогнозов по BTC", icon: "bars" },
  daily_win_1: { title: "Выиграй прогноз", desc: "Первая победа дня", icon: "trophy" },
  daily_win_streak_5: { title: "5 побед подряд", desc: "Серия из пяти побед", icon: "streak" },
  daily_win_2_row: { title: "2 победы подряд", desc: "Выиграй два раунда подряд", icon: "bolt" },
  daily_sniper: { title: "Снайпер", desc: "Ставка в последние 15 секунд раунда", icon: "target" },
  daily_no_win: { title: "Против толпы", desc: "Выиграй ставкой на NO", icon: "bear" },
  daily_feed_fish: { title: "Покорми рыбок", desc: "Встряхни телефон на BTC 5m", icon: "fish" },
  daily_comment: { title: "Голос рынка", desc: "Оставь комментарий под рынком", icon: "chat" },
  daily_explore_3: { title: "Разведка рынков", desc: "Открой BTC-лист, рынок из него и футбол", icon: "compass" },
  daily_share_story: { title: "Сторис с выигрышем", desc: "Поделись выигрышем в сторис", icon: "share" },
};

function getDailyTaskAmount(taskKey, fallback = 0) {
  const progress = getTaskProgress(taskKey);
  if (progress?.amount != null) {
    return Number(progress.amount || fallback || 0);
  }
  if (taskKey === "daily_bet") {
    return Math.round(Number(state.publicConfig.task_daily_bet_fire || 25));
  }
  if (taskKey === "daily_presence") {
    return Math.round(Number(state.publicConfig.task_daily_presence_fire || 13));
  }
  const rotationTask = state.engagement?.rotation?.find((task) => task.key === taskKey);
  if (rotationTask) {
    return Number(rotationTask.amount || fallback || 0);
  }
  const presenceTask = state.engagement?.presence?.[taskKey];
  if (presenceTask) {
    return Number(presenceTask.amount || fallback || 0);
  }
  const fixed = {
    share_friend: Math.round(Number(state.publicConfig.task_share_fire || 50)),
    daily_topup_stars: 50,
    daily_topup_usdt: 150,
    daily_btc_prediction: 25,
    daily_football_prediction: 25,
    daily_btc_5_predictions: 25,
    daily_win_1: 25,
    daily_win_streak_5: 50,
    daily_win_2_row: 50,
    daily_sniper: 38,
    daily_no_win: 38,
    daily_feed_fish: 6,
    daily_comment: 6,
    daily_explore_3: 6,
    daily_share_story: 25,
    join_clan: 100,
  };
  return fixed[taskKey] ?? fallback;
}

function taskIconMarkup(meta) {
  return TASK_ICON_SVG[meta?.icon] || TASK_ICON_SVG.target;
}

function taskClaimChipMarkup(taskKey, amount) {
  return `<button class="task-reward task-claim-chip" data-daily-task="${taskKey}" data-task-amount="${Number(amount || 0)}" type="button">+${formatFire(amount)}</button>`;
}

function getTaskProgress(taskKey) {
  return state.engagement?.progress?.[taskKey]
    || state.dailyTasks?.[taskKey]?.progress
    || state.engagement?.rotation?.find((task) => task.key === taskKey)?.progress
    || null;
}

function formatTaskProgressValue(value, unit) {
  const numeric = Number(value || 0);
  if (unit === "USDT") {
    return numeric.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }
  return formatFire(numeric);
}

function taskProgressMarkup(taskKey) {
  const progress = getTaskProgress(taskKey);
  if (!progress) return "";
  const value = Math.max(0, Number(progress.value || 0));
  const target = Math.max(1, Number(progress.target || 1));
  const unit = String(progress.unit || "").toUpperCase();
  const percent = Math.max(0, Math.min(100, (value / target) * 100));
  const label = `${formatTaskProgressValue(Math.min(value, target), unit)}/${formatTaskProgressValue(target, unit)}${unit === "USDT" ? " USDT" : ""}`;
  return `
    <span class="task-progress-mini" style="--progress:${percent}%">
      <i></i>
      <em>${label}</em>
    </span>
  `;
}

function renderShareFriendTask() {
  const progress = getTaskProgress("share_friend");
  const amount = getDailyTaskAmount("share_friend", state.publicConfig.task_share_fire || 50);
  const reward = $("shareTaskReward");
  if (reward) reward.textContent = formatFire(amount);
  const progressSlot = $("shareTaskProgressSlot");
  if (progressSlot) {
    progressSlot.innerHTML = taskProgressMarkup("share_friend");
  }
  const button = $("taskShareBtn");
  if (!button) return;
  const ready = Boolean(progress?.ready) && !progress?.claimed;
  const claimed = Boolean(progress?.claimed);
  button.classList.toggle("claimable", ready);
  button.classList.toggle("claimed", claimed);
  button.disabled = claimed;
  button.textContent = claimed ? "Готово" : ready ? "Забрать" : "Share";
}

function getDailyTaskDisplayMeta(taskKey) {
  const base = DAILY_TASK_META[taskKey] || { title: taskKey, desc: "", icon: "target" };
  const progress = getTaskProgress(taskKey);
  if (!progress) {
    return base;
  }

  const target = Math.max(1, Number(progress.target || 1));
  const levels = Math.max(1, Number(progress.levels || 1));
  const level = Math.max(1, Number(progress.level || 1));
  const levelText = levels > 1 ? `Уровень ${level}/${levels}` : base.desc;
  const targetText = formatTaskProgressValue(target, progress.unit);
  const claimedText = progress.claimed ? "Все уровни забраны" : levelText;

  const titleByTask = {
    share_friend: `${targetText} друзей`,
    daily_bet: `${targetText} ставок за день`,
    daily_topup_stars: `Пополнить ${targetText} звёзд`,
    daily_topup_usdt: `Пополнить ${targetText} USDT`,
    daily_btc_prediction: `${targetText} BTC-прогноз`,
    daily_football_prediction: `${targetText} футбольных прогнозов`,
    daily_btc_5_predictions: target === 1 ? "1 BTC-прогноз" : `${targetText} BTC-прогнозов`,
    daily_win_1: `${targetText} побед за день`,
    daily_win_streak_5: `${targetText} побед подряд`,
    daily_win_2_row: `${targetText} победы подряд`,
    daily_sniper: `${targetText} снайперских ставок`,
    daily_no_win: `${targetText} NO-побед`,
    daily_feed_fish: `${targetText} кормление рыбок`,
    daily_comment: `${targetText} сообщений в чат`,
    daily_explore_3: `${targetText} рынков разведать`,
    daily_share_story: `${targetText} сторис с выигрышем`,
  };

  return {
    ...base,
    title: titleByTask[taskKey] || base.title,
    desc: claimedText,
  };
}

function renderDailyTaskRow(taskKey, amount = getDailyTaskAmount(taskKey)) {
  const meta = getDailyTaskDisplayMeta(taskKey);
  return `
    <div class="task-item" data-task-row="${taskKey}">
      <span class="task-ic" aria-hidden="true">${taskIconMarkup(meta)}</span>
      <div class="task-body">
        <strong>${meta.title}</strong>
        <small>${meta.desc}</small>
        ${taskProgressMarkup(taskKey)}
      </div>
      <div class="task-act">
        ${taskClaimChipMarkup(taskKey, amount)}
      </div>
    </div>
  `;
}

const taskEventsSent = new Set();

// Событие прогресса дейлика: fire-and-forget, один раз за день на ключ.
function postTaskEvent(eventKey) {
  if (!state.user?.telegram_id) return;
  const dedupeKey = `${new Date().toISOString().slice(0, 10)}:${eventKey}`;
  if (taskEventsSent.has(dedupeKey)) return;
  taskEventsSent.add(dedupeKey);
  api("/api/tasks/event", {
    method: "POST",
    body: JSON.stringify({
      telegram_id: state.user.telegram_id,
      username: state.user.username,
      first_name: state.user.first_name,
      event_key: eventKey,
    }),
  }).catch(() => taskEventsSent.delete(dedupeKey));
}

async function checkinStreakDaily() {
  if (!state.user?.telegram_id) return;
  try {
    const result = await api("/api/streak/checkin", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
      }),
    });
    state.streak = result;
    if (result.golden_fish) setAquariumGoldenFish(true);
    renderStreakCard();
    if (result.lootbox?.amount) {
      // Даём велком-заставке отыграть, потом — салют лутбокса.
      window.setTimeout(() => {
        showWinOverlay(`+${formatFire(result.lootbox.amount)}`, result.lootbox.amount, 3);
        showToast(`Лутбокс за 7 дней подряд: +${formatFire(result.lootbox.amount)} ⚡`);
      }, 3_400);
      void loadMe().catch(() => undefined);
    } else if (result.freeze_used) {
      showToast("Заморозка спасла твой стрик ❄️");
    } else if (result.new_day && result.current_streak > 1) {
      showToast(`Стрик: ${result.current_streak} дн. подряд ⚡`);
    }
  } catch {
    // стрик не должен мешать запуску
  }
}

function renderStreakCard() {
  const card = $("streakCard");
  if (!card) return;
  const streak = state.streak || {};
  const dayInCycle = Number(streak.day_in_cycle || 0);
  const bolt = $("streakBolt");
  if (bolt && bolt.dataset.built !== "1") {
    bolt.dataset.built = "1";
    bolt.innerHTML = buildShareBoltParticlesSvg();
  }
  // Молния заряжается с каждым днём цикла и вспыхивает на седьмом.
  if (bolt) bolt.style.opacity = String(Math.max(0.22, Math.min(1, dayInCycle / 7)));
  card.classList.toggle("is-charged", dayInCycle >= 7);
  const count = $("streakCount");
  if (count) {
    const days = Number(streak.current_streak || 0);
    count.innerHTML = `<b>${days}</b><span>${days === 1 ? "день" : days >= 2 && days <= 4 ? "дня" : "дней"}</span>`;
  }
  const subtitle = $("streakSubtitle");
  if (subtitle) {
    subtitle.textContent = Number(streak.multiplier || 1) > 1
      ? `Множитель наград x${streak.multiplier} · лутбокс на 7-й день`
      : "Заходи каждый день — на 7-й лутбокс";
  }
  const daysBox = $("streakDays");
  if (daysBox) {
    daysBox.innerHTML = Array.from({ length: 7 }, (_, index) => (
      `<i class="${index < dayInCycle ? "done" : ""}${index === dayInCycle - 1 ? " today" : ""}"></i>`
    )).join("");
  }
}

function applyDailyTaskProgress(taskKey, progress) {
  if (!taskKey || !progress) return;
  state.dailyTasks = {
    ...state.dailyTasks,
    [taskKey]: {
      ...(state.dailyTasks?.[taskKey] || {}),
      ready: Boolean(progress.ready),
      claimed: Boolean(progress.claimed),
      progress,
    },
  };
  if (state.engagement) {
    state.engagement.progress = {
      ...(state.engagement.progress || {}),
      [taskKey]: progress,
    };
  }
  const rotationTask = state.engagement?.rotation?.find((task) => task.key === taskKey);
  if (rotationTask) {
    rotationTask.ready = Boolean(progress.ready);
    rotationTask.claimed = Boolean(progress.claimed);
    rotationTask.amount = Number(progress.amount || rotationTask.amount || 0);
    rotationTask.progress = progress;
  }
}

async function loadEngagementState() {
  if (!state.user?.telegram_id) return;
  try {
    const params = new URLSearchParams({
      telegram_id: String(state.user.telegram_id),
    });
    if (state.user.username) {
      params.set("username", state.user.username);
    }
    if (state.user.first_name) {
      params.set("first_name", state.user.first_name);
    }
    const data = await api(`/api/tasks/state?${params.toString()}`);
    state.engagement = data;
    if (data.streak) {
      state.streak = { ...state.streak, ...data.streak };
      if (data.streak.golden_fish) setAquariumGoldenFish(true);
    }
    // Статусы ротации вливаются в общий dailyTasks — кнопки живут по общим правилам.
    (data.rotation || []).forEach((task) => {
      state.dailyTasks = {
        ...state.dailyTasks,
        [task.key]: { ready: task.ready, claimed: task.claimed, progress: task.progress },
      };
    });
    Object.entries(data.progress || {}).forEach(([key, progress]) => {
      applyDailyTaskProgress(key, progress);
    });
    (Object.entries(data.presence || {})).forEach(([key, info]) => {
      if (info?.claimed) state.presence.claimed[key] = true;
    });
    renderEngagement();
  } catch {
    // покажем ротацию при следующем открытии
  }
}

// Тап живёт между pointerdown и click. Если в этом окне заменить innerHTML
// списка заданий (loadMe обновил прогресс дейликов), click улетает в уже
// отсоединённый узел и пропадает — ни начисления, ни тоста, ни вспышки.
// Поэтому пока палец на списке, пере-рендер откладываем до отпускания.
let taskListPointerHeld = false;
let engagementRenderDeferred = false;
let engagementDeferSafetyTimer = 0;

function flushDeferredEngagementRender() {
  taskListPointerHeld = false;
  if (!engagementRenderDeferred) {
    return;
  }
  engagementRenderDeferred = false;
  window.clearTimeout(engagementDeferSafetyTimer);
  // Небольшая пауза, чтобы click успел дойти до обработчика раньше замены DOM.
  window.setTimeout(() => renderEngagement(), 90);
}

document.addEventListener("pointerdown", (event) => {
  if (event.target instanceof Element && event.target.closest(".task-list")) {
    taskListPointerHeld = true;
  }
}, { capture: true, passive: true });
document.addEventListener("pointerup", flushDeferredEngagementRender, { capture: true, passive: true });
document.addEventListener("pointercancel", flushDeferredEngagementRender, { capture: true, passive: true });

function renderEngagement() {
  if (taskListPointerHeld) {
    engagementRenderDeferred = true;
    // Страховка: если pointerup потерялся (свернули апп с пальцем на экране),
    // через полторы секунды рендерим принудительно.
    window.clearTimeout(engagementDeferSafetyTimer);
    engagementDeferSafetyTimer = window.setTimeout(() => {
      taskListPointerHeld = false;
      if (engagementRenderDeferred) {
        engagementRenderDeferred = false;
        renderEngagement();
      }
    }, 1_500);
    return;
  }
  renderStreakCard();
  const list = $("dailyRotationList");
  if (list && Array.isArray(state.engagement?.rotation)) {
    setInnerHtmlIfChanged(
      list,
      state.engagement.rotation.map((task) => renderDailyTaskRow(task.key, task.amount)).join(""),
    );
  }
  const coreList = $("coreDailyList");
  if (coreList) {
    setInnerHtmlIfChanged(
      coreList,
      CORE_DAILY_TASK_KEYS.map((taskKey) => renderDailyTaskRow(taskKey)).join(""),
    );
  }
  const clanButton = $("joinClanTaskBtn");
  const clanTask = state.engagement?.once?.join_clan;
  if (clanButton && clanTask) {
    setTaskButtonVisualState(clanButton, clanTask);
    if (clanTask.claimed) {
      clanButton.textContent = "Кланы";
    } else if (clanTask.ready) {
      clanButton.textContent = "Забрать";
    } else {
      clanButton.textContent = "Вступить";
      clanButton.classList.remove("not-ready");
    }
  }
  renderTaskButtonStates();
  renderShareFriendTask();
  updatePresenceLadder();
}

async function claimDailyTaskByKey(taskKey, button = null) {
  if (!state.user?.telegram_id) {
    return;
  }
  showButtonPressed(button);
  if (button) {
    button.disabled = true;
  }
  try {
    const result = await api("/api/tasks/daily", {
      method: "POST",
      body: JSON.stringify({
        telegram_id: state.user.telegram_id,
        username: state.user.username,
        first_name: state.user.first_name,
        task_key: taskKey,
      }),
    });
    state.balance = result.balance ?? state.balance;
    const claimOrigin = captureAnimationOrigin(button);
    const claimedRow = button?.closest(".task-item, .task-row");
    if (result.already_claimed || Number(result.awarded || 0) > 0) {
      if (result.progress) {
        applyDailyTaskProgress(taskKey, result.progress);
      } else {
        markDailyTaskClaimed(taskKey);
        const rotationTask = state.engagement?.rotation?.find((task) => task.key === taskKey);
        if (rotationTask) rotationTask.claimed = true;
        if (state.engagement?.once?.[taskKey]) state.engagement.once[taskKey].claimed = true;
      }
      renderEngagement();
    }
    renderMe();
    if (result.already_claimed) {
      showToast("Этот дейлик уже забран.");
    } else if (Number(result.awarded || 0) > 0) {
      playTaskRewardAnimation(claimOrigin || button, claimedRow);
      showToast(`+${formatFire(result.awarded)} за дейлик.`);
    } else {
      showToast("Дневной лимит бонусов уже достигнут.");
    }
  } catch (error) {
    showToast(
      error.message === "task_not_ready"
        ? "Сначала выполни это задание."
        : error.message === "task_not_in_rotation"
          ? "Это задание не из сегодняшней ротации."
          : "Не получилось забрать дейлик.",
    );
  } finally {
    if (button) {
      button.disabled = false;
    }
    renderTaskButtonStates();
  }
}

function setTasksSheetOpen(open) {
  const sheet = $("tasksSheet");
  if (!sheet) return;
  if (open) {
    renderTaskRewards();
    renderTaskTabs();
    renderEngagement();
    void loadEngagementState();
    openSheet(sheet);
    renderTaskStats();
  } else {
    closeSheet(sheet);
  }
}

function setLeaderboardSheetOpen(open) {
  const sheet = $("leaderboardSheet");
  if (!sheet) return;
  if (open) {
    openSheet(sheet);
  } else {
    closeSheet(sheet);
  }
}

async function refreshClanWar() {
  if (!state.user?.telegram_id) {
    return;
  }
  // Poll updates only the live bank + top-3 podium in place — it must NOT rebuild
  // the whole clans list (that recreates every avatar <img> and flickers them).
  const data = await api(`/api/clans?telegram_id=${encodeURIComponent(state.user.telegram_id)}`);
  state.clans = data.clans || state.clans;
  state.userClan = data.user_clan || state.userClan;
  state.clanWar = data.clan_war || state.clanWar;
  renderClanWar();
}

function startClanWarPoll() {
  stopClanWarPoll();
  // Keep the monthly bank feeling live while the user watches the league.
  state.clansPollTimer = window.setInterval(() => {
    if (!isSheetOpen("clansSheet")) {
      stopClanWarPoll();
      return;
    }
    if (state.clanView !== "leaderboard" || document.hidden) {
      return;
    }
    void refreshClanWar().catch(() => undefined);
  }, 15_000);
}

function stopClanWarPoll() {
  if (state.clansPollTimer) {
    window.clearInterval(state.clansPollTimer);
    state.clansPollTimer = null;
  }
}

function setClansSheetOpen(open, options = {}) {
  const sheet = $("clansSheet");
  if (!sheet) return;
  if (open) {
    const requestedView = options.view || "leaderboard";
    state.clanView = requestedView;
    if (options.selectedClanId) {
      state.selectedClanId = Number(options.selectedClanId);
    } else if (requestedView === "detail" && state.userClan?.id) {
      state.selectedClanId = state.userClan.id;
    }
    state.clanWarBankShown = null;
    void loadClans().catch(() => showToast("Кланы пока не загрузились."));
    openSheet(sheet);
    startClanWarPoll();
  } else {
    stopClanWarPoll();
    closeSheet(sheet);
  }
}

function openClansFromJoinTask() {
  closeTopMoreMenu();
  const openClans = () => {
    const hasClan = Boolean(state.userClan?.id);
    setClansSheetOpen(true, {
      view: hasClan ? "detail" : "leaderboard",
      selectedClanId: hasClan ? state.userClan.id : state.selectedClanId,
    });
  };

  if (isSheetOpen("tasksSheet")) {
    closeSheet("tasksSheet", { duration: 180, afterClose: openClans });
    return;
  }

  openClans();
}

function showReferralNudge() {
  if (state.referralNudgeShown || !state.user?.telegram_id || !canShowReferralNudgeToday()) {
    return;
  }
  state.referralNudgeShown = true;
  markReferralNudgeShownToday();
  $("referralNudge")?.classList.remove("hidden");
}

function hideReferralNudge() {
  $("referralNudge")?.classList.add("hidden");
}

function getReferralNudgeStorageKey() {
  const day = new Date().toISOString().slice(0, 10);
  return `easymarket:referral_nudge:${state.user?.telegram_id || "anon"}:${day}`;
}

function getReferralNudgeCountToday() {
  try {
    return Math.max(0, Number(localStorage.getItem(getReferralNudgeStorageKey()) || 0));
  } catch {
    return 0;
  }
}

function canShowReferralNudgeToday() {
  return getReferralNudgeCountToday() < 2;
}

function markReferralNudgeShownToday() {
  try {
    localStorage.setItem(getReferralNudgeStorageKey(), String(getReferralNudgeCountToday() + 1));
  } catch {
    // Storage can be unavailable inside some WebViews; the session flag still prevents spam.
  }
}

$("tasksBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
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

$("taskSettingsToggleBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.taskSettingsOpen = !state.taskSettingsOpen;
  renderTaskSettings();
});

$("motionSoundToggleBtn")?.addEventListener("click", async () => {
  triggerHaptic("selection");
  const enabled = await setMotionSoundEnabled(!isMotionSoundEnabled());
  renderSoundToggle();
  showToast(enabled ? "Звук включен." : "Звук выключен.");
});

$("aquariumToggleBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  const enabled = setAquariumEnabled(!isAquariumEnabled());
  renderAquariumToggle();
  showToast(enabled ? "Аквариум включен." : "Аквариум выключен.");
});

$("legendSceneToggleBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  const on = !legendScenePrefEnabled();
  setLegendScenePref(on);
  syncActiveShakeScene();
  renderLegendSceneToggle();
  showToast(on ? "Премиум анимация включена." : "Премиум выключен — рыбки вернулись.");
});

$("tasksSheet").addEventListener("click", (event) => {
  if (event.target === $("tasksSheet")) {
    setTasksSheetOpen(false);
  }
});

$("taskChannelBtn").addEventListener("click", (event) => {
  triggerHaptic("selection");
  openTelegramUrl(state.publicConfig.av_channel_url || "https://t.me/erc20coin");
  const sourceElement = event.currentTarget;
  window.setTimeout(() => {
    void claimSimpleTask("av_channel", sourceElement);
  }, 900);
});

$("taskChatBtn").addEventListener("click", (event) => {
  triggerHaptic("selection");
  openTelegramUrl(state.publicConfig.av_chat_url || "https://t.me/thedaomaker");
  const sourceElement = event.currentTarget;
  window.setTimeout(() => {
    void claimSimpleTask("av_chat", sourceElement);
  }, 900);
});

$("taskPrivateChatBtn").addEventListener("click", () => {
  triggerHaptic("selection");
  openTelegramUrl(state.publicConfig.private_chat_url || state.publicConfig.av_bot_url);
  showToast(`После подписки на приватку AV-бот начислит аванс ${formatFire(Number(state.publicConfig.task_private_chat_fire || 7500))}.`);
});

$("legendSceneTaskBtn")?.addEventListener("click", () => {
  if (state.legendScene?.unlocked) {
    return;
  }
  triggerHaptic("selection");
  closeSheet("tasksSheet");
  openTopupSheet(1000, "", "topup", "USDT");
});

$("shakeFeedBtn")?.addEventListener("click", (event) => {
  triggerHaptic("selection");
  void claimShakeFeedLevels(event.currentTarget);
});

$("depositBonusBtn")?.addEventListener("click", (event) => {
  triggerHaptic("selection");
  const levels = Array.isArray(state.depositBonus?.levels) ? state.depositBonus.levels : [];
  const hasReady = levels.some((level) => level.ready);
  if (hasReady) {
    void claimDepositBonusLevels(event.currentTarget);
    return;
  }
  const next = levels.find((level) => !level.claimed && !level.ready);
  if (!next) {
    return;
  }
  const total = Math.max(0, Number(state.depositBonus?.total) || 0);
  closeSheet("tasksSheet");
  openTopupSheet(Math.max(1, Math.ceil(Number(next.goal) - total)), "", "topup", "USDT");
});

$("taskShareBtn").addEventListener("click", (event) => {
  const progress = getTaskProgress("share_friend");
  if (progress?.ready && !progress?.claimed) {
    void claimShareTask(event.currentTarget);
    return;
  }
  void shareInvite({ awardShareTask: true, sourceElement: event.currentTarget });
});

$("referralNudgeShareBtn")?.addEventListener("click", (event) => {
  hideReferralNudge();
  void shareInvite({ awardShareTask: true, sourceElement: event.currentTarget });
});

$("referralNudgeCloseBtn")?.addEventListener("click", () => {
  hideReferralNudge();
});

document.querySelector(".presence-ladder")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-presence-key]");
  if (!button) return;
  triggerHaptic("selection");
  void claimPresenceStep(button.dataset.presenceKey, button);
});

$("joinClanTaskBtn")?.addEventListener("click", (event) => {
  triggerHaptic("selection");
  const once = state.engagement?.once?.join_clan;
  if (once?.claimed) {
    openClansFromJoinTask();
    return;
  }
  if (once?.ready) {
    void claimDailyTaskByKey("join_clan", event.currentTarget);
    return;
  }
  // Ещё не в клане — ведём в кланы, награда заберётся после вступления.
  openClansFromJoinTask();
});

document.querySelector(".task-list")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-daily-task]");
  if (!button) {
    return;
  }
  triggerHaptic("selection");
  void claimDailyTaskByKey(button.dataset.dailyTask, button);
});

$("openTelegramAppBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  window.location.href = buildTelegramMiniAppLaunchUrl(getLaunchRefValue() || "easymarket");
});

$("marketChatForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitMarketComment();
});

$("marketPanelChatBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.marketPanel = "chat";
  renderOrderbookPanel();
});

$("marketPanelBookBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.marketPanel = "book";
  renderOrderbookPanel();
  void loadOrderbook({ force: true });
});

$("orderbookYesBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.orderbookSide = "YES";
  state.orderbook.formPrice = "";
  renderOrderbookPanel();
});

$("orderbookNoBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.orderbookSide = "NO";
  state.orderbook.formPrice = "";
  renderOrderbookPanel();
});

$("limitOrderBuyBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.orderbook.orderSide = "BUY";
  state.orderbook.formPrice = "";
  renderOrderbookPanel();
});

$("limitOrderSellBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  state.orderbook.orderSide = "SELL";
  state.orderbook.formPrice = "";
  renderOrderbookPanel();
});

$("limitOrderPriceInput")?.addEventListener("input", (event) => {
  state.orderbook.formPrice = event.target.value;
});

$("limitOrderAmountInput")?.addEventListener("input", (event) => {
  state.orderbook.formAmount = event.target.value;
});

$("limitOrderForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  triggerHaptic("medium");
  void submitLimitOrder();
});

$("myLimitOrders")?.addEventListener("click", (event) => {
  const toggle = event.target?.closest?.("[data-toggle-limit-orders]");
  if (toggle) {
    triggerHaptic("selection");
    state.orderbook.myOrdersOpen = !state.orderbook.myOrdersOpen;
    renderOrderbookPanel();
    return;
  }

  const button = event.target?.closest?.("[data-cancel-limit-order]");
  if (!button) {
    return;
  }
  triggerHaptic("medium");
  void cancelLimitOrder(button.dataset.cancelLimitOrder);
});

let chatPanelTouchStartX = null;
let chatPanelTouchStartY = null;
document.querySelector(".market-chat-card")?.addEventListener("touchstart", (event) => {
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  chatPanelTouchStartX = touch.clientX;
  chatPanelTouchStartY = touch.clientY;
}, { passive: true });

document.querySelector(".market-chat-card")?.addEventListener("touchend", (event) => {
  const touch = event.changedTouches?.[0];
  if (!touch || chatPanelTouchStartX === null || chatPanelTouchStartY === null) return;
  const dx = touch.clientX - chatPanelTouchStartX;
  const dy = touch.clientY - chatPanelTouchStartY;
  chatPanelTouchStartX = null;
  chatPanelTouchStartY = null;
  if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  state.marketPanel = dx < 0 ? "book" : "chat";
  triggerHaptic("selection");
  renderOrderbookPanel();
}, { passive: true });

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loss-refund-share]");
  if (!button) {
    return;
  }
  event.preventDefault();
  triggerHaptic("selection");
  void shareInvite({ awardShareTask: false });
  // Hide the offer after sharing and hold it back for the day.
  dismissLossRefundForToday();
  renderLossRefundOffers();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loss-refund-dismiss]");
  if (!button) {
    return;
  }
  event.preventDefault();
  triggerHaptic("selection");
  dismissLossRefundForToday();
  renderLossRefundOffers();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loss-refund-stars]");
  if (!button) {
    return;
  }
  event.preventDefault();
  triggerHaptic("selection");
  const amount = Math.max(1, Number(button.dataset.lossRefundCost || 0));
  const offerId = Number(button.dataset.lossRefundStars || 0);
  openTopupSheet(
    amount,
    "Пополните новые звезды. После пополнения возврат начислится автоматически, старый баланс не списываем.",
    "topup",
    "STAR",
    {
      type: "loss_refund_stars",
      offerId,
      amount,
      startBalance: Number(state.balance || 0),
    },
  );
});

$("btcMarketsBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setBtcMarketsSheetOpen(true);
  renderBtcMarketsList();
  postTaskEvent("visit_btc_fast"); // дейлик «Разведка рынков»
  void runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => showToast("Маркеты пока не загрузились."));
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
      requestMarketBuy(market, buyButton.dataset.side || "YES", state.selectedAmount);
    }
    return;
  }

  const openButton = event.target.closest("[data-btc-open]");
  if (openButton) {
    triggerHaptic("selection");
    postTaskEvent("visit_btc_slow"); // дейлик «Разведка рынков»
    selectBtcMarket(openButton.dataset.btcOpen);
  }
});

$("worldCupBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setWorldCupSheetOpen(true);
  renderWorldCupList();
  postTaskEvent("visit_football"); // дейлик «Разведка рынков»
  void runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => showToast("Маркеты пока не загрузились."));
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
      requestMarketBuy(market, buyButton.dataset.side || "YES", state.selectedAmount);
    }
    return;
  }

  const openButton = event.target.closest("[data-world-cup-open]");
  if (openButton) {
    triggerHaptic("selection");
    selectWorldCupMarket(openButton.dataset.worldCupOpen);
  }
});

$("topMarketsBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setTopMarketsSheetOpen(true);
  renderTopMarketsList();
  postTaskEvent("visit_top_markets");
  void runSingleFlight("topMarkets", loadTopMarkets).catch(() => showToast("ТОП маркеты пока не загрузились."));
});

$("topMarketsCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setTopMarketsSheetOpen(false);
});

$("topMarketsSheet")?.addEventListener("click", (event) => {
  if (event.target === $("topMarketsSheet")) {
    setTopMarketsSheetOpen(false);
  }
});

$("topMarketsList")?.addEventListener("click", (event) => {
  const buyButton = event.target.closest("[data-top-buy]");
  if (buyButton) {
    event.preventDefault();
    event.stopPropagation();
    const market = state.topMarkets.find((item) => item.id === Number(buyButton.dataset.topBuy));
    if (market) {
      requestMarketBuy(market, buyButton.dataset.side || "YES", state.selectedAmount);
    }
    return;
  }

  const openButton = event.target.closest("[data-top-open]");
  if (openButton) {
    triggerHaptic("selection");
    postTaskEvent("visit_top_markets");
    selectTopMarket(openButton.dataset.topOpen);
  }
});

$("sportsMarketsBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setSportsMarketsSheetOpen(true);
  renderSportsMarketsList();
  void runSingleFlight("sportsMarkets", loadSportsMarkets).catch(() => showToast("Спортивные рынки пока не загрузились."));
});

$("sportsMarketsCloseBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  setSportsMarketsSheetOpen(false);
});

$("sportsMarketsSheet")?.addEventListener("click", (event) => {
  if (event.target === $("sportsMarketsSheet")) setSportsMarketsSheetOpen(false);
});

$("sportsMarketsList")?.addEventListener("click", (event) => {
  const buyButton = event.target.closest("[data-sports-buy]");
  if (buyButton) {
    event.preventDefault();
    event.stopPropagation();
    const market = state.sportsMarkets.find((item) => item.id === Number(buyButton.dataset.sportsBuy));
    if (market) requestMarketBuy(market, buyButton.dataset.side || "YES", state.selectedAmount);
    return;
  }
  const openButton = event.target.closest("[data-sports-open]");
  if (openButton) {
    triggerHaptic("selection");
    selectSportsMarket(openButton.dataset.sportsOpen);
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
    $("betAmountValue")?.classList.remove("amount-pulse");
    void $("betAmountValue")?.offsetWidth;
    $("betAmountValue")?.classList.add("amount-pulse");
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
    state.selectedTopMarketId = null;
    state.selectedSportsMarketId = null;
    state.selectedSpecialMarketId = null;
  } else if (isTopMarket(market)) {
    state.selectedTopMarketId = market.id;
    state.selectedBtcMarketId = null;
    state.selectedWorldCupMarketId = null;
    state.selectedSportsMarketId = null;
    state.selectedSpecialMarketId = null;
  } else if (isSportsListMarket(market)) {
    state.selectedSportsMarketId = market.id;
    state.selectedBtcMarketId = null;
    state.selectedWorldCupMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSpecialMarketId = null;
  } else if (isSpecialMarket(market)) {
    state.selectedSpecialMarketId = market.id;
    state.selectedBtcMarketId = null;
    state.selectedWorldCupMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSportsMarketId = null;
  } else {
    state.selectedWorldCupMarketId = market.id;
    state.selectedBtcMarketId = null;
    state.selectedTopMarketId = null;
    state.selectedSportsMarketId = null;
    state.selectedSpecialMarketId = null;
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
  pruneClosedLocalMarkets({ renderLists: true });
  if (touchStartX === null || touchStartY === null) {
    return;
  }
  if (!state.worldCupMarkets.length && !state.btcMarkets.length && !state.topMarkets.length && !state.sportsMarkets.length && !state.specialMarkets.length) {
    touchStartX = null;
    touchStartY = null;
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
      .filter((market) => !isMarketClosedForCarousel(market))
      .filter((market) => market.id !== state.market?.id)
      .map((market) => ({ type: "btc", id: market.id })),
    ...state.worldCupMarkets
      .filter((market) => !isMarketClosedForCarousel(market))
      .map((market) => ({ type: "world", id: market.id })),
    ...state.topMarkets
      .filter((market) => !isMarketClosedForCarousel(market))
      .map((market) => ({ type: "top", id: market.id })),
    ...state.sportsMarkets
      .filter((market) => !isMarketClosedForCarousel(market))
      .map((market) => ({ type: "sports", id: market.id })),
    ...state.specialMarkets
      .filter((market) => !isMarketClosedForCarousel(market))
      .map((market) => ({ type: "special", id: market.id })),
  ];
  if (markets.length <= 1) {
    return;
  }
  const currentKey = state.selectedSpecialMarketId
    ? `special:${state.selectedSpecialMarketId}`
    : state.selectedSportsMarketId
    ? `sports:${state.selectedSportsMarketId}`
    : state.selectedTopMarketId
    ? `top:${state.selectedTopMarketId}`
    : state.selectedWorldCupMarketId
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
  state.selectedTopMarketId = nextMarket.type === "top" ? nextMarket.id : null;
  state.selectedSportsMarketId = nextMarket.type === "sports" ? nextMarket.id : null;
  state.selectedSpecialMarketId = nextMarket.type === "special" ? nextMarket.id : null;
  state.smoothedPrice = null;
  state.smoothedNoPrice = null;
  state.chartYMin = null;
  state.chartYMax = null;
  state.commentsMarketId = null;
  state.sideSelectedMarketId = null;
  triggerHaptic("selection");
  animateMarketSwitch();
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

// Фоновая пауза: пока мини-апп/вкладка реально скрыты, сетевые поллы и
// DOM-тики стоят — радиомодуль и CPU спят, телефон не греется в кармане.
// В Telegram document.hidden бывает ложно-положительным (iOS WKWebView),
// поэтому скрытость подтверждаем сигналом самого Telegram (isActive,
// Bot API 8.0+). Старые клиенты без isActive ведут себя как раньше.
function isAppInBackground() {
  if (!document.hidden) {
    return false;
  }
  const webApp = window.Telegram?.WebApp;
  if (webApp) {
    return webApp.isActive === false;
  }
  return true;
}

// На возврате из фона сразу освежаем рынок и баланс, не дожидаясь интервалов.
function resumeForegroundPolling() {
  if (isAppInBackground()) {
    return;
  }
  void runSingleFlight("market", loadMarket).catch(() => undefined);
  void runSingleFlight("me", loadMe).catch(() => undefined);
}
document.addEventListener("visibilitychange", resumeForegroundPolling);
try {
  window.Telegram?.WebApp?.onEvent?.("activated", resumeForegroundPolling);
} catch {
  // клиенты без события activated
}

setInterval(() => {
  if (!isAppInBackground() && !isBlockingSheetOpen()) {
    updateTimer();
  }
}, 250);
// Активные минуты для лестницы присутствия: видимая вкладка + недавнее касание.
window.addEventListener("pointerdown", () => {
  state.presence.lastInteractionAt = Date.now();
}, { passive: true });
// Тик раз в секунду: время копится всегда, но DOM лестницы обновляем только
// когда шит заданий открыт — закрытый шит не красим впустую.
setInterval(() => {
  if (isPresenceAccruing()) {
    state.presence.activeMs += 1_000;
  }
  if ($("tasksSheet")?.classList.contains("sheet-open")) {
    updatePresenceLadder();
  }
}, 1_000);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  void runSingleFlight("market", loadMarket).catch(() => setConnection("Ошибка", "error"));
}, ACTIVE_MARKET_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  if (shouldRefreshBtcMarkets()) {
    void runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined);
  }
}, MARKET_LIST_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  if (shouldRefreshWorldCupMarkets()) {
    void runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined);
  }
}, MARKET_LIST_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  if (shouldRefreshTopMarkets()) {
    void runSingleFlight("topMarkets", loadTopMarkets).catch(() => undefined);
  }
}, MARKET_LIST_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  if (shouldRefreshSportsMarkets()) {
    void runSingleFlight("sportsMarkets", loadSportsMarkets).catch(() => undefined);
  }
}, MARKET_LIST_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  if (shouldRefreshSpecialMarket()) {
    void runSingleFlight("specialMarket", loadSpecialMarket).catch(() => undefined);
  }
}, SPECIAL_MARKET_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  maybeLoadComments(true);
}, COMMENTS_POLL_MS);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  void runSingleFlight("activity", loadActivity).catch(() => undefined);
}, 4_000);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
  void runSingleFlight("me", loadMe).catch(() => undefined);
}, 3_500);
setInterval(() => {
  if (isAppInBackground() || isBlockingSheetOpen()) return;
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
renderTradeTicket();

loadPublicConfig()
  .then(upsertMe)
  .then((authorized) => {
    if (!authorized) {
      return null;
    }
    restoreUsdtIntent(); // живая депозитная заявка переживает перезаход
    void checkinStreakDaily(); // стрик «Заряд молнии»: отметка входа + лутбокс
    void loadEngagementState();
    return refreshAll()
      .then(() => handleClanLaunchLink().catch(() => showToast("Клан по ссылке не найден.")))
      .then(() => {
        window.setTimeout(() => {
          void runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined);
        }, 600);
        window.setTimeout(() => {
          void runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined);
        }, 1_200);
        window.setTimeout(() => {
          void runSingleFlight("topMarkets", loadTopMarkets).catch(() => undefined);
        }, 1_800);
        window.setTimeout(() => {
          void runSingleFlight("sportsMarkets", loadSportsMarkets).catch(() => undefined);
        }, 2_400);
        window.setTimeout(() => {
          void runSingleFlight("specialMarket", loadSpecialMarket).catch(() => undefined);
        }, 3_000);
        window.setTimeout(showReferralNudge, 150_000);
      })
      .finally(hideLightningLoader);
  })
  .catch((error) => {
    hideLightningLoader();
    setConnection("Ошибка входа", "error");
    $("authCard").classList.remove("hidden");
    showToast(error.message || "Не удалось создать пользователя.");
  });
