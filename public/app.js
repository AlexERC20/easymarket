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
  setAquariumRuntimeAllowed,
  setAquariumShakeFeeder,
} from "./aquarium.js?v=20260707-02";

const PROFIT_FEE_RATE = 0.05;
const MARKET_MAKER_SPREAD_RATE = 0.03;
const BUY_IMPACT_MULTIPLIER = 1.08;
const SELL_IMPACT_MULTIPLIER = 1.42;
const MARKET_MAKER_DENSITY_MULTIPLIER = 1.4;
const MAX_SINGLE_TRADE_SHIFT = 0.46;
const MIN_TAIL_DEPTH_FACTOR = 0.004;
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
const ACTIVE_MARKET_POLL_MS = 1_500;
const MARKET_LIST_POLL_MS = 10_000;
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
  freshActivityIds: new Set(),
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
    task_share_fire: 100,
    task_subscribe_fire: 500,
    task_private_chat_fire: 15000,
    task_daily_presence_fire: 50,
    task_daily_bet_fire: 50,
    task_daily_cap_fire: 10000,
    av_channel_url: "https://t.me/erc20coin",
    av_chat_url: "https://t.me/thedaomaker",
    private_chat_url: "https://t.me/tribute/app?startapp=stKL",
    usdt_evm_address: "",
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
initAquarium();
// Let a phone shake feed the fish on demand, mid-round, from the current chart.
setAquariumShakeFeeder(() => {
  const market = getDisplayMarket();
  if (!market || !shouldRunAquariumForMarket(market)) {
    return [];
  }
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

function setInnerHtmlIfChanged(element, html) {
  if (!element || element.innerHTML === html) {
    return;
  }

  element.innerHTML = html;
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

function drawChartTradeAvatar(ctx, trade, x, y, radius, bounds) {
  const safeRadius = Math.max(2, radius);
  const centerX = Math.max(bounds.left + safeRadius, Math.min(bounds.right - safeRadius, x));
  const centerY = Math.max(bounds.top + safeRadius, Math.min(bounds.bottom - safeRadius, y));
  const avatarUrl = getTradeAvatarUrl(trade);
  const image = getCachedTradeAvatarImage(avatarUrl);

  ctx.save();
  ctx.shadowColor = trade.side === "YES" ? "rgba(25,195,125,0.34)" : "rgba(239,70,111,0.32)";
  ctx.shadowBlur = Math.max(3, safeRadius * 1.2);
  ctx.beginPath();
  ctx.arc(centerX, centerY, safeRadius, 0, Math.PI * 2);
  ctx.clip();

  if (image) {
    ctx.drawImage(image, centerX - safeRadius, centerY - safeRadius, safeRadius * 2, safeRadius * 2);
  } else {
    const gradient = ctx.createRadialGradient(
      centerX - safeRadius * 0.35,
      centerY - safeRadius * 0.4,
      0,
      centerX,
      centerY,
      safeRadius * 1.4,
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.82)");
    gradient.addColorStop(0.32, getTradeAvatarColor(trade));
    gradient.addColorStop(1, "rgba(14,20,32,0.96)");
    ctx.fillStyle = gradient;
    ctx.fillRect(centerX - safeRadius, centerY - safeRadius, safeRadius * 2, safeRadius * 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(5, safeRadius * 1.15)}px Inter, system-ui, sans-serif`;
    ctx.fillText(getTradeAvatarInitial(trade), centerX, centerY + safeRadius * 0.04);
  }
  ctx.restore();

  ctx.save();
  ctx.lineWidth = Math.max(0.8, safeRadius * 0.26);
  ctx.strokeStyle = trade.side === "YES" ? "rgba(25,195,125,0.86)" : "rgba(239,70,111,0.84)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, safeRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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

function findMarketById(marketId) {
  const id = Number(marketId);
  return state.btcMarkets.find((market) => market.id === id)
    || state.worldCupMarkets.find((market) => market.id === id)
    || (state.market?.id === id ? state.market : null);
}

function isWorldCupMarket(market = getDisplayMarket()) {
  return market?.market_type === "WORLD_CUP_WINNER";
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

function pruneClosedLocalMarkets({ renderLists = false } = {}) {
  const beforeBtc = state.btcMarkets.map((market) => market.id).join(",");
  const beforeWorld = state.worldCupMarkets.map((market) => market.id).join(",");

  state.btcMarkets = openCarouselMarkets(state.btcMarkets);
  state.worldCupMarkets = openCarouselMarkets(state.worldCupMarkets);

  const afterBtc = state.btcMarkets.map((market) => market.id).join(",");
  const afterWorld = state.worldCupMarkets.map((market) => market.id).join(",");
  const btcChanged = beforeBtc !== afterBtc;
  const worldChanged = beforeWorld !== afterWorld;
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

  if (btcChanged) {
    state.btcMarketsListRenderedOrder = "";
  }
  if (worldChanged) {
    state.worldCupListRenderedOrder = "";
  }
  if (renderLists) {
    if (btcChanged) renderBtcMarketsList();
    if (worldChanged) renderWorldCupList();
  }

  return { changed: btcChanged || worldChanged, selectionChanged };
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
  const appBg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#080d16";
  const worldCup = isWorldCupMarket(market);
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
  if (!worldCup && Number.isFinite(openPrice) && openPrice > 0) {
    detectTargetCross(market, openPrice);
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

    ctx.strokeStyle = isUp ? "#19c37d" : "#ef466f";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawSmoothPath(ctx, pathPoints);

    const chartTrades = getChartTradesForMarket(market, windowStart, windowEnd);
    // Only snapshot avatars when the aquarium is on, and at most ~3x/sec, so the
    // chart's hot render loop is not allocating a fresh snapshot every frame.
    const captureAvatars = aquariumAllowed && isAquariumEnabled() && nowMs - (state.aquariumSnapAt || 0) > 300;
    const frameAvatars = captureAvatars ? [] : null;
    chartTrades.forEach((trade) => {
      const x = scaleX(trade.at);
      const nearest = pathPoints.reduce((best, point) => (
        Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best
      ), pathPoints[0]);
      const own = String(trade.telegram_id || "") === String(state.user?.telegram_id || "");
      const dotSize = own ? 4.6 : 2.5;
      const dotY = nearest.y + (own ? -7 : 7);
      const avatarRadius = Math.max(dotSize + 1, CHART_AVATAR_RADIUS_CSS * dpr);
      const avatarDirection = trade.side === "YES" ? -1 : 1;
      const avatarGap = dotSize + avatarRadius + Math.max(1.5, 1.2 * dpr);
      const avatarY = dotY + avatarDirection * avatarGap;
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
      ctx.save();
      ctx.fillStyle = trade.side === "YES" ? "rgba(25,195,125,0.95)" : "rgba(239,70,111,0.92)";
      ctx.shadowColor = trade.side === "YES" ? "rgba(25,195,125,0.75)" : "rgba(239,70,111,0.72)";
      ctx.shadowBlur = own ? 16 : 9;
      ctx.beginPath();
      ctx.arc(x, dotY, dotSize, 0, Math.PI * 2);
      ctx.fill();
      if (own) {
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = "rgba(255,255,255,0.78)";
        ctx.stroke();
      }
      ctx.restore();
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
  if (latest) {
    const headRgb = isUp ? "25,195,125" : "239,70,111";
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
    ctx.fillStyle = isUp ? "#19c37d" : "#ef466f";
    ctx.shadowColor = isUp ? "rgba(25,195,125,0.55)" : "rgba(239,70,111,0.52)";
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

  if (wipeActive) {
    ctx.restore(); // конец wipe-клипа прорисовки линии
  }

  drawTargetCrossFx(ctx, latest, openY, width);

  // "Your bet" pill in the bottom-left corner when the user holds a position.
  const myBet = getMyChartBet(market);
  if (myBet) {
    const sideColor = myBet.side === "YES" ? "#19c37d" : "#ef466f";
    const seg1 = "Твоя ставка: ";
    const seg2 = `${marketSideLabel(market, myBet.side)} ${formatCurrencyAmount(myBet.spent, myBet.currency)}`;
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
    ctx.fillStyle = "rgba(8, 13, 22, 0.74)";
    ctx.beginPath();
    roundedRectPath(ctx, pillX, pillY, pillW, pillH, Math.max(8, height * 0.05));
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
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

  // Dissolve the previous market's snapshot on top of the new chart so the switch
  // reads as a smooth crossfade instead of an abrupt cut + ragged redraw.
  if (intro < 1 && chartSnapshotCanvas) {
    ctx.save();
    ctx.globalAlpha = 1 - introEase;
    ctx.drawImage(chartSnapshotCanvas, 0, 0, width, height);
    ctx.restore();
  }

  if ((market.status === "open" && btc) || Math.abs((state.smoothedPrice || 0) - currentPrice) > 0.04 || intro < 1 || chartCrossFx) {
    state.chartRaf = requestAnimationFrame(drawMarketChartFrame);
    return;
  }

  state.chartRaf = null;
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

// Цифры-барабаны: вместо каунт-апа изменившиеся символы выкатываются по
// вертикали (стиль телеграм-счётчика). Сравнение выравнено по правому краю,
// чтобы у "999 -> 1 000" катились только реально изменившиеся разряды.
const textRollCleanups = new WeakMap();

function rollText(element, nextValue, formatter) {
  if (!element) {
    return false;
  }
  const numericValue = Number(nextValue || 0);
  const previousValue = Number(element.dataset.value);
  element.dataset.value = String(numericValue);
  const nextText = formatter(numericValue);
  if (!Number.isFinite(previousValue) || prefersReducedMotion()) {
    element.textContent = nextText;
    return false;
  }
  // Прокрутка ещё идёт: DOM не трогаем, иначе каждый повторный рендер
  // (рынок рендерится из нескольких поллеров) обрубает анимацию со снэпом.
  // Свежее значение допишет cleanup по завершении текущей прокрутки.
  if (textRollCleanups.has(element)) {
    return false;
  }
  const prevText = formatter(previousValue);
  if (prevText === nextText) {
    if (element.textContent !== nextText) {
      element.textContent = nextText;
    }
    return false;
  }

  const up = numericValue >= previousValue;
  const maxLen = Math.max(prevText.length, nextText.length);
  const fragment = document.createDocumentFragment();
  let rollIndex = 0;
  for (let i = 0; i < maxLen; i += 1) {
    const oldChar = prevText[prevText.length - maxLen + i] ?? "";
    const newChar = nextText[nextText.length - maxLen + i] ?? "";
    if (oldChar === newChar) {
      fragment.appendChild(document.createTextNode(newChar));
      continue;
    }
    const cell = document.createElement("span");
    cell.className = "odo-cell";
    cell.style.setProperty("--odo-i", String(rollIndex));
    rollIndex += 1;
    if (oldChar) {
      const oldSpan = document.createElement("span");
      oldSpan.className = up ? "odo-out-up" : "odo-out-down";
      oldSpan.textContent = oldChar;
      cell.appendChild(oldSpan);
    }
    if (newChar) {
      const newSpan = document.createElement("span");
      newSpan.className = up ? "odo-in-up" : "odo-in-down";
      newSpan.textContent = newChar;
      cell.appendChild(newSpan);
    }
    fragment.appendChild(cell);
  }
  element.replaceChildren(fragment);

  const previousCleanup = textRollCleanups.get(element);
  if (previousCleanup) {
    window.clearTimeout(previousCleanup);
  }
  // После прокрутки сплющиваем DOM обратно в плоский текст.
  textRollCleanups.set(element, window.setTimeout(() => {
    element.textContent = formatter(Number(element.dataset.value || 0));
    textRollCleanups.delete(element);
  }, 380));
  return true;
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
      if (mobileShell) {
        tg.expand();
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
  // Fixed daily rewards come from one source (also drives the progress sum).
  if ($("btcPredictionTaskReward")) $("btcPredictionTaskReward").textContent = formatFire(DAILY_TASK_FIXED_REWARD.daily_btc_prediction);
  if ($("footballPredictionTaskReward")) $("footballPredictionTaskReward").textContent = formatFire(DAILY_TASK_FIXED_REWARD.daily_football_prediction);
  if ($("btc5PredictionsTaskReward")) $("btc5PredictionsTaskReward").textContent = formatFire(DAILY_TASK_FIXED_REWARD.daily_btc_5_predictions);
  if ($("win1TaskReward")) $("win1TaskReward").textContent = formatFire(DAILY_TASK_FIXED_REWARD.daily_win_1);
  if ($("winStreak5TaskReward")) $("winStreak5TaskReward").textContent = formatFire(DAILY_TASK_FIXED_REWARD.daily_win_streak_5);
  renderSoundToggle();
  renderAquariumToggle();
  renderTaskSettings();
  renderTaskButtonStates();
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
  button.classList.toggle("claimable", claimable);
  button.classList.toggle("claimed", claimed);
  button.classList.toggle("not-ready", !claimable && !claimed);
  // Once claimed there's nothing to tap: hide the button and mark the chip earned.
  button.classList.toggle("is-done", claimed);
  button.closest(".task-item")?.querySelector(".task-reward")?.classList.toggle("claimed", claimed);
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

// Daily tasks that count toward the "дейлики сегодня" progress header, with the
// reward each one grants (presence/bet come from config, the rest are fixed).
const DAILY_TASK_KEYS = [
  "daily_presence",
  "daily_bet",
  "daily_btc_prediction",
  "daily_football_prediction",
  "daily_btc_5_predictions",
  "daily_win_1",
  "daily_win_streak_5",
];
const DAILY_TASK_FIXED_REWARD = {
  daily_btc_prediction: 50,
  daily_football_prediction: 50,
  daily_btc_5_predictions: 300,
  daily_win_1: 50,
  daily_win_streak_5: 300,
};

function renderDailyProgress() {
  const countEl = $("dailyProgressCount");
  const sumEl = $("dailyProgressSum");
  const bar = $("dailyProgressBar");
  if (!countEl && !sumEl && !bar) return;

  const presenceReward = Math.round(Number(state.publicConfig.task_daily_presence_fire || 50));
  const betReward = Math.round(Number(state.publicConfig.task_daily_bet_fire || 50));
  const total = DAILY_TASK_KEYS.length;
  let claimed = 0;
  let sum = 0;
  DAILY_TASK_KEYS.forEach((key) => {
    const status = getDailyTaskStatus(key);
    const isClaimed = key === "daily_presence"
      ? Boolean(state.presence?.claimed || status.claimed)
      : Boolean(status.claimed);
    if (!isClaimed) return;
    claimed += 1;
    sum += key === "daily_presence" ? presenceReward
      : key === "daily_bet" ? betReward
      : (DAILY_TASK_FIXED_REWARD[key] || 0);
  });

  if (countEl) countEl.textContent = `${claimed}/${total}`;
  if (sumEl) sumEl.textContent = formatFire(sum);
  if (bar) bar.style.setProperty("--progress", String(total ? claimed / total : 0));
  $("dailyProgressCard")?.classList.toggle("is-complete", claimed >= total);
}

function renderTaskButtonStates() {
  document.querySelectorAll("[data-daily-task]").forEach((button) => {
    setTaskButtonVisualState(button, getDailyTaskStatus(button.dataset.dailyTask));
  });
  updatePresenceTaskButton();
  renderDailyProgress();
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
  if (!stats.length) {
    setInnerHtmlIfChanged(list, `
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

  const rows = stats.slice(0, 30).map((stat) => {
    const currency = normalizeCurrency(stat.currency);
    const pnl = Number(stat.pnl || 0);
    const status = stat.open_positions_count > 0 ? "LIVE" : (stat.status === "resolved" ? "CLOSED" : String(stat.status || "").toUpperCase());
    return `
      <div class="task-stat-row pnl-${pnl >= 0 ? "up" : "down"}">
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
  setInnerHtmlIfChanged(list, summary + rows);
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
  state.dailyTasks = data.daily_tasks || {};
  state.lossRefundOffers = data.loss_refund_offers || [];
  state.presence.startedAt = Date.now();
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
  state.dailyTasks = data.daily_tasks || {};
  state.lossRefundOffers = data.loss_refund_offers || [];
  handleSettlements(state.positions);
  renderMe();
  renderTaskStats();
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
    const name = comment.username || comment.first_name || `user ${comment.telegram_id}`;
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
    state.orderbook.formPrice = getLimitOrderDefaultPrice(market, side).toFixed(3);
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

  const price = Number(state.orderbook.formPrice);
  const amount = Number(state.orderbook.formAmount);
  const sellablePosition = getSellableLimitPosition(market, side);
  const sellableValue = Number(sellablePosition?.shares || 0) * price;
  const canSubmit = Boolean(
    market
    && state.user
    && isMarketOpenForBuy(market)
    && Number.isFinite(price)
    && price > 0
    && Number.isFinite(amount)
    && amount > 0
    && (orderSide !== "SELL" || (sellablePosition && amount <= sellableValue + 0.00000001))
    && !state.orderbook.pending
  );
  submitButton.disabled = !canSubmit;
  submitButton.textContent = state.orderbook.pending
    ? "Placing..."
    : `${orderSide === "SELL" ? "Sell" : "Buy"} ${marketSideLabel(market, side)}`;
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
          <span class="lo-side ${order.order_side === "SELL" ? "sell" : "buy"}">${order.order_side === "SELL" ? "Sell" : "Buy"} ${escapeHtml(marketSideLabel(getDisplayMarket(), order.side))}</span>
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
  $("orderbookYesBtn")?.classList.toggle("active", state.orderbookSide === "YES");
  $("orderbookNoBtn")?.classList.toggle("active", state.orderbookSide === "NO");

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
  const bookKey = `${side}:${state.currency}:${realRows.length}`;
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
      <span>${marketSideLabel(market, side)} book</span>
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
  const incomingMarkets = openCarouselMarkets(data.markets || []);
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

function estimateBuyQuote({ market, side, amount }) {
  const minPrice = getMarketMinOutcomePrice(market);
  const rawPrice = market
    ? Number(side === "YES" ? market.yes_price : market.no_price)
    : 0.5;
  const price = Math.max(minPrice, Math.min(1 - minPrice, rawPrice || 0.5));
  const rawLiquidity = Math.max(1, Number(market?.liquidity || state.market?.liquidity || 10_000));
  const baseLiquidity = isWorldCupMarket(market)
    ? Math.max(1_500, Math.min(30_000, Math.sqrt(rawLiquidity) * 2.1))
    : Math.max(1_200, Math.min(24_000, rawLiquidity));
  const distanceFromCenter = Math.min(1, Math.abs(price - 0.5) / 0.5);
  const depthFactor = MIN_TAIL_DEPTH_FACTOR + (1 - MIN_TAIL_DEPTH_FACTOR) * Math.pow(1 - distanceFromCenter, 2.35);
  const liquidity = Math.max(35, baseLiquidity * MARKET_MAKER_DENSITY_MULTIPLIER * depthFactor);
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
  if (btcMarket) {
    state.selectedBtcMarketId = btcMarket.id === state.market?.id ? null : btcMarket.id;
    state.selectedWorldCupMarketId = null;
  } else if (worldMarket) {
    state.selectedWorldCupMarketId = worldMarket.id;
    state.selectedBtcMarketId = null;
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
  rollText($("currentPrice"), currentPrice, (value) => (
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
  renderOrderbookPanel();
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
  // Build tension in the final seconds of a round (pulse + red on the counter).
  const finalPhase = market.status === "open" && remainingMs > 0;
  const countdownEl = document.querySelector(".countdown");
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
  const rawLiquidity = Math.max(1, Number(market?.liquidity || state.market?.liquidity || 10_000));
  const baseLiquidity = isWorldCupMarket(market)
    ? Math.max(1_500, Math.min(30_000, Math.sqrt(rawLiquidity) * 2.1))
    : Math.max(1_200, Math.min(24_000, rawLiquidity));
  const distanceFromCenter = Math.min(1, Math.abs(price - 0.5) / 0.5);
  const depthFactor = MIN_TAIL_DEPTH_FACTOR + (1 - MIN_TAIL_DEPTH_FACTOR) * Math.pow(1 - distanceFromCenter, 2.35);
  const liquidity = Math.max(35, baseLiquidity * MARKET_MAKER_DENSITY_MULTIPLIER * depthFactor);
  const estimatedGross = shares * price;
  const impact = Math.min(0.42, (estimatedGross / liquidity) * SELL_IMPACT_MULTIPLIER);
  const nextPrice = Math.max(minPrice, price - impact);
  const extraExitPenalty = isWorldCupMarket(market) ? 0.03 : 0.015;
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
  if (rollText(balanceElement, activeBalance, (value) => formatHeaderCurrencyAmount(value, state.currency))) {
    balanceElement.classList.remove("balance-pop");
    void balanceElement.offsetWidth;
    balanceElement.classList.add("balance-pop");
    triggerBalancePulse(balanceElement);
  }

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
    const activeMarket = selectedWorldCupMarket || (position.market_id === state.market?.id ? state.market : null);
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
    // A freshly-opened position slides in with a glow so you see "my bet landed".
    const isNew = state.positionsWarmedUp && !prefersReducedMotion()
      && !state.renderedPositionIds.has(position.id);
    return `
      <div class="mini-row${isNew ? " pos-enter" : ""}"${isNew ? ` style="animation-delay:${Math.min(index, 5) * 55}ms"` : ""}>
        <div>
          <strong class="side-${position.side}">${escapeHtml(marketLabel)} · ${marketSideLabel(activeMarket, position.side)}</strong>
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

  $("ticketTitle").textContent = canBuyMarket
    ? (state.quickBetMode === "confirm"
      ? `Сумма для ${marketSideLabel(market, side)}`
      : `Нажми сумму для ${marketSideLabel(market, side)}`)
    : "Рынок завершён, обновляю...";
  $("ticketPrice").textContent = "";
  $("ticketPrice").classList.add("hidden");
  renderQuickBetToggle();
}

function renderQuickBetToggle() {
  const button = $("quickBetToggle");
  if (!button) return;
  const confirmMode = state.quickBetMode === "confirm";
  button.classList.toggle("confirm-mode", confirmMode);
  button.setAttribute("aria-pressed", confirmMode ? "false" : "true");
  button.setAttribute(
    "aria-label",
    confirmMode ? "Режим подтверждения ставки" : "Режим ставки в один клик",
  );
  const label = button.querySelector("b");
  if (label) {
    label.textContent = confirmMode ? "Confirm" : "1 tap";
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
    const name = trade.username || trade.first_name || `user ${trade.telegram_id}`;
    const action = trade.action || "BUY";
    const marketLabel = getActivityMarketLabel(trade);
    const isFresh = state.freshActivityIds.has(trade.id);
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
    const name = player.username
      ? `@${player.username}`
      : player.first_name || `user ${player.telegram_id}`;
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
      ? `${escapeHtml(player.market_label || player.market_title || "market")} · ${escapeHtml(sideLabel(player.side || ""))} · всего +${formatCurrencyAmount(player.total_pnl_24h || player.best_pnl_24h || 0, player.currency || state.leaderboardCurrency)}`
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
        const name = member.username ? `@${member.username}` : member.first_name || `user ${member.telegram_id}`;
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
  state.smoothedPrice = null;
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
  state.smoothedPrice = null;
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

function renderBetSheet() {
  const { market, side, amount } = state.betSheet;
  if (!market) {
    return;
  }

  const isBtc = isBtcMarket(market);
  const quote = estimateBuyQuote({ market, side, amount });
  const price = quote.executionPrice;
  const shares = Number(amount || 0) / price;
  setTeamIconElement($("betTeamIcon"), isBtc ? "₿" : market.icon, isBtc ? "BTC" : market.team);
  if ($("betMarketTitle")) $("betMarketTitle").textContent = market.title || (isBtc ? "Bitcoin Up / Down" : "World Cup Winner");
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

function renderTopupSheet() {
  const isTopupMode = state.topup.mode !== "withdraw";
  const currency = normalizeCurrency(state.topup.currency);
  const isUsdt = currency === "USDT";
  const isHistoryOpen = Boolean(state.topup.historyOpen);
  const intent = state.topup.intent;
  const hasPendingIntent = isUsdt && intent?.status === "pending";
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
  document.querySelector(".wallet-mode-toggle")?.classList.toggle("hidden", isHistoryOpen);
  document.querySelector(".wallet-currency-toggle")?.classList.toggle("hidden", isHistoryOpen || !isTopupMode);
  document.querySelectorAll("[data-wallet-currency]").forEach((button) => {
    button.classList.toggle("active", normalizeCurrency(button.dataset.walletCurrency) === currency);
  });
  $("usdtDepositPanel")?.classList.toggle("hidden", !isUsdt || !isTopupMode || !hasPendingIntent);
  $("usdtDepositIntentBox")?.classList.toggle("hidden", !hasPendingIntent);
  $("usdtDepositIntentBox")?.classList.toggle("is-waiting", hasPendingIntent);
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
    $("usdtDepositNetworkHint").textContent = hasPendingIntent ? "в BEP20 или ERC20. Баланс после зачисления обновится автоматически." : "";
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
  if ($("usdtEvmAddressLabel")) $("usdtEvmAddressLabel").textContent = "Шаг 1 · кошелёк для пополнения";
  const depositAddress = hasPendingIntent ? (intent?.to_address || "") : "";
  if ($("usdtEvmAddress")) $("usdtEvmAddress").textContent = depositAddress;
  $("usdtAddressCopy")?.setAttribute(
    "aria-label",
    depositAddress ? `Скопировать адрес для пополнения ${depositAddress}` : "Скопировать адрес"
  );
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
  if ($("withdrawSubmitBtn")) {
    $("withdrawSubmitBtn").disabled = isHistoryOpen || isTopupMode || state.withdrawal.pending || !state.user;
    $("withdrawSubmitBtn").textContent = state.withdrawal.pending ? "Создаю заявку..." : "Вывести";
  }
  renderWalletHistory();
  finishSheetContentMorph(walletMorph);
}

function openTopupSheet(amount, reason = "", mode = "topup", currencyOverride = null, afterAction = null) {
  const targetCurrency = normalizeCurrency(currencyOverride || (mode === "withdraw" ? "USDT" : state.currency));
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
    renderTopupSheet();
    if (data.intent?.status === "credited") {
      stopDepositPolling();
      showTopupSuccessAnimation("TOP UP");
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
    triggerHaptic("success");
    triggerLightningFlash("success");
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
    await loadWalletHistory().catch(() => undefined);
    await loadMe().catch(() => undefined);
    if (state.topup.intent?.status === "credited") {
      stopDepositPolling();
      showTopupSuccessAnimation("TOP UP");
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
  const name = trade.username || trade.first_name || "user";
  const action = trade.action || "BUY";
  bubble.className = `trade-bubble ${sideClass(trade.side)}`;
  bubble.textContent = `${name} ${actionLabel(action)} ${sideLabel(trade.side)} ${formatCurrencyAmount(trade.amount, trade.currency)}`;
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
  const limitPrice = Number(state.orderbook.formPrice || 0);
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
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(limitPrice) || limitPrice <= 0) {
    triggerHaptic("warning");
    showToast("Проверь цену и сумму лимитки.");
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
    showToast(`Продано ${sideLabel(side)}: ${formatSignedCurrencyAmount(pnl, result.currency || state.currency)}`);
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

// Keep a focused sheet input visible above the on-screen keyboard so the
// bottom-anchored panel doesn't jump/jitter when the keyboard opens.
document.addEventListener("focusin", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLElement) || !el.matches("input, textarea")) {
    return;
  }
  if (!el.closest(".task-sheet")) {
    return;
  }
  window.setTimeout(() => {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      el.scrollIntoView();
    }
  }, 280);
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
  const value = state.topup.intent?.to_address || $("usdtEvmAddress")?.textContent || "";
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
    renderMe();
    if (result.already_claimed) {
      showToast("Share-бонус сегодня уже забран.");
      return;
    }
    if (Number(result.awarded || 0) > 0) {
      playTaskRewardAnimation(sourceElement);
      showToast(`+${formatFire(result.awarded)} за share.`);
      return;
    }
    showToast("Дневной лимит бонусов уже достигнут.");
  } catch {
    showToast("Share отправлен. Бонус начислим после обновления.");
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

async function claimDailyPresenceTask(sourceElement = null) {
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
  const rewardOrigin = captureAnimationOrigin(sourceElement);
  const rewardRow = sourceElement?.closest?.(".task-item, .task-row");
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
    markDailyTaskClaimed("daily_presence");
    renderMe();
    if (result.already_claimed) {
      showToast("Ежедневный вход уже забран.");
    } else if (Number(result.awarded || 0) > 0) {
      playTaskRewardAnimation(rewardOrigin || sourceElement, rewardRow);
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
  if (!button || !state.presence.startedAt) {
    return;
  }
  const status = getDailyTaskStatus("daily_presence");
  if (state.presence.claimed || status.claimed) {
    setTaskButtonVisualState(button, {
      ready: true,
      claimed: true,
    });
    return;
  }
  const elapsed = Date.now() - state.presence.startedAt;
  const remainingMs = Math.max(0, 5 * 60_000 - elapsed);
  if (remainingMs <= 0) {
    button.textContent = "Забрать";
    setTaskButtonVisualState(button, {
      ready: true,
      claimed: false,
    });
    return;
  }
  const seconds = Math.ceil(remainingMs / 1000);
  button.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  setTaskButtonVisualState(button, {
    ready: false,
    claimed: false,
  });
}

async function shareInvite({ awardShareTask = false, sourceElement = null } = {}) {
  triggerHaptic("selection");
  if (!state.user?.telegram_id) {
    showToast("Сначала нужен пользователь.");
    return;
  }

  const usdtBonus = Math.round(Number(state.publicConfig.referral_bet_bonus_usdt || 30));
  const inviteUrl = buildInviteUrl(state.user.telegram_id);
  const text = `Залетай в EasyMarket. После первой ставки мне дадут ${formatFire(usdtBonus)} USDT.`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(text)}`;
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(shareUrl);
    if (awardShareTask) {
      await claimShareTask(sourceElement);
    } else {
      showToast(`+${formatFire(usdtBonus)} USDT после первой ставки друга.`);
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
        await claimShareTask(sourceElement);
      }
      return;
    }
  } catch {
    // Fall through to Telegram share link.
  }

  window.open(shareUrl, "_blank", "noopener,noreferrer");
  if (awardShareTask) {
    await claimShareTask(sourceElement);
  } else {
    showToast(`+${formatFire(usdtBonus)} USDT после первой ставки друга.`);
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
      markDailyTaskClaimed(taskKey);
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
    showToast(error.message === "task_not_ready" ? "Сначала выполни это задание." : "Не получилось забрать дейлик.");
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

function setTasksSheetOpen(open) {
  const sheet = $("tasksSheet");
  if (!sheet) return;
  if (open) {
    renderTaskRewards();
    renderTaskTabs();
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

function setClansSheetOpen(open) {
  const sheet = $("clansSheet");
  if (!sheet) return;
  if (open) {
    state.clanView = "leaderboard";
    state.clanWarBankShown = null;
    void loadClans().catch(() => showToast("Кланы пока не загрузились."));
    openSheet(sheet);
    startClanWarPoll();
  } else {
    stopClanWarPoll();
    closeSheet(sheet);
  }
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
  showToast(`После подписки на приватку AV-бот начислит аванс ${formatFire(Number(state.publicConfig.task_private_chat_fire || 15000))}.`);
});

$("taskShareBtn").addEventListener("click", (event) => {
  void shareInvite({ awardShareTask: true, sourceElement: event.currentTarget });
});

$("referralNudgeShareBtn")?.addEventListener("click", (event) => {
  hideReferralNudge();
  void shareInvite({ awardShareTask: true, sourceElement: event.currentTarget });
});

$("referralNudgeCloseBtn")?.addEventListener("click", () => {
  hideReferralNudge();
});

$("taskDailyPresenceBtn")?.addEventListener("click", (event) => {
  triggerHaptic("selection");
  void claimDailyPresenceTask(event.currentTarget);
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
    selectBtcMarket(openButton.dataset.btcOpen);
  }
});

$("worldCupBtn")?.addEventListener("click", () => {
  triggerHaptic("selection");
  closeTopMoreMenu();
  setWorldCupSheetOpen(true);
  renderWorldCupList();
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
  pruneClosedLocalMarkets({ renderLists: true });
  if (touchStartX === null || touchStartY === null) {
    return;
  }
  if (!state.worldCupMarkets.length && !state.btcMarkets.length) {
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
  ];
  if (markets.length <= 1) {
    return;
  }
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

setInterval(updateTimer, 250);
setInterval(updatePresenceTaskButton, 1_000);
setInterval(() => {
  void runSingleFlight("market", loadMarket).catch(() => setConnection("Ошибка", "error"));
}, ACTIVE_MARKET_POLL_MS);
setInterval(() => {
  if (shouldRefreshBtcMarkets()) {
    void runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined);
  }
}, MARKET_LIST_POLL_MS);
setInterval(() => {
  if (shouldRefreshWorldCupMarkets()) {
    void runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined);
  }
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
renderTradeTicket();

loadPublicConfig()
  .then(upsertMe)
  .then((authorized) => {
    if (!authorized) {
      return null;
    }
    return refreshAll()
      .then(() => handleClanLaunchLink().catch(() => showToast("Клан по ссылке не найден.")))
      .then(() => {
        window.setTimeout(() => {
          void runSingleFlight("btcMarkets", loadBtcMarkets).catch(() => undefined);
        }, 600);
        window.setTimeout(() => {
          void runSingleFlight("worldCupMarkets", loadWorldCupMarkets).catch(() => undefined);
        }, 1_200);
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
