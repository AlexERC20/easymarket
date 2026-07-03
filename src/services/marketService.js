import { clamp, config } from "../config.js";
import { query, toNumber, withTransaction } from "../db.js";
import { getBtcPrice, PriceUnavailableError } from "./priceService.js";

const MARKET_SYMBOL = "BTCUSDT";
const WORLD_CUP_EVENT_SLUG = "world-cup-winner";
const WORLD_CUP_SYMBOL_PREFIX = "WCUP:";
const MIN_PRICE = 0.001;
const MAX_PRICE = 0.999;
const BTC_MIN_PRICE = 0.001;
const DEFAULT_FEE_BPS = 200;
const DEFAULT_PROFIT_FEE_BPS = 700;
const DEFAULT_REFERRAL_PROFIT_SHARE_BPS = 100;
const DEFAULT_CLAN_PROFIT_SHARE_BPS = 100;
const DEFAULT_MARKET_MAKER_SPREAD_BPS = 300;
const BUY_IMPACT_MULTIPLIER = 1.08;
const SELL_IMPACT_MULTIPLIER = 1.42;
const MARKET_MAKER_DENSITY_MULTIPLIER = 1.4;
const MAX_SINGLE_TRADE_SHIFT = 0.46;
const MIN_TAIL_DEPTH_FACTOR = 0.004;
const REFERRAL_SIGNUP_BONUS = 100;
const CURRENCIES = new Set(["STAR", "USDT"]);
const WORLD_CUP_SYNC_INTERVAL_MS = 90_000;

const BTC_MARKET_DEFS = [
  { key: "5M", symbol: MARKET_SYMBOL, label: "5m", title: "BTC Up or Down 5m", durationMinutes: null },
  { key: "15M", symbol: "BTCUSDT_15M", label: "15m", title: "BTC Up or Down 15m", durationMinutes: 15 },
  { key: "1H", symbol: "BTCUSDT_1H", label: "1h", title: "BTC Up or Down 1h", durationMinutes: 60 },
  { key: "12H", symbol: "BTCUSDT_12H", label: "12h", title: "BTC Up or Down 12h", durationMinutes: 720 },
  { key: "24H", symbol: "BTCUSDT_24H", label: "24h", title: "BTC Up or Down 24h", durationMinutes: 1440 },
  { key: "7D", symbol: "BTCUSDT_7D", label: "7d", title: "BTC Up or Down 7d", durationMinutes: 10080 },
];

const BTC_MARKET_SYMBOLS = BTC_MARKET_DEFS.map((definition) => definition.symbol);
const DAILY_TASK_KEYS = [
  "daily_presence",
  "daily_bet",
  "daily_btc_prediction",
  "daily_football_prediction",
  "daily_btc_5_predictions",
  "daily_win_1",
  "daily_win_streak_5",
];

const WORLD_CUP_FALLBACK_MARKETS = [
  { polymarketId: "fallback-france", team: "France", icon: "🇫🇷", yesPrice: 0.171, volume: 54_606_121 },
  { polymarketId: "fallback-spain", team: "Spain", icon: "🇪🇸", yesPrice: 0.146, volume: 48_880_678 },
  { polymarketId: "fallback-portugal", team: "Portugal", icon: "🇵🇹", yesPrice: 0.108, volume: 48_252_376 },
  { polymarketId: "fallback-england", team: "England", icon: "🏴", yesPrice: 0.105, volume: 45_020_000 },
  { polymarketId: "fallback-brazil", team: "Brazil", icon: "🇧🇷", yesPrice: 0.093, volume: 44_500_000 },
  { polymarketId: "fallback-argentina", team: "Argentina", icon: "🇦🇷", yesPrice: 0.084, volume: 43_700_000 },
  { polymarketId: "fallback-germany", team: "Germany", icon: "🇩🇪", yesPrice: 0.061, volume: 38_200_000 },
  { polymarketId: "fallback-netherlands", team: "Netherlands", icon: "🇳🇱", yesPrice: 0.049, volume: 31_900_000 },
  { polymarketId: "fallback-belgium", team: "Belgium", icon: "🇧🇪", yesPrice: 0.035, volume: 24_700_000 },
  { polymarketId: "fallback-usa", team: "USA", icon: "🇺🇸", yesPrice: 0.026, volume: 21_000_000 },
  { polymarketId: "fallback-mexico", team: "Mexico", icon: "🇲🇽", yesPrice: 0.018, volume: 16_600_000 },
  { polymarketId: "fallback-canada", team: "Canada", icon: "🇨🇦", yesPrice: 0.012, volume: 12_300_000 },
];

const ACTIVE_WORLD_CUP_TEAM_KEYS = new Set([
  "south-africa",
  "canada",
  "brazil",
  "japan",
  "germany",
  "paraguay",
  "netherlands",
  "morocco",
  "cote-d-ivoire",
  "ivory-coast",
  "norway",
  "france",
  "sweden",
  "mexico",
  "ecuador",
  "england",
  "dr-congo",
  "congo-dr",
  "democratic-republic-of-congo",
  "belgium",
  "senegal",
  "usa",
  "united-states",
  "united-states-of-america",
  "bosnia-and-herzegovina",
  "spain",
  "austria",
  "portugal",
  "croatia",
  "switzerland",
  "algeria",
  "australia",
  "egypt",
  "argentina",
  "cabo-verde",
  "cape-verde",
  "colombia",
  "ghana",
]);

let worldCupSyncPromise = null;
let worldCupLastSyncAt = 0;
let worldCupLastSource = "cache";

function getBtcMarketDef(symbol) {
  return BTC_MARKET_DEFS.find((definition) => definition.symbol === symbol) || null;
}

function isBtcMarketSymbol(symbol) {
  return Boolean(getBtcMarketDef(symbol));
}

function normalizeCurrency(value) {
  const normalized = String(value || "STAR").trim().toUpperCase();
  return CURRENCIES.has(normalized) ? normalized : "STAR";
}

function balanceTableForCurrency(currency) {
  return normalizeCurrency(currency) === "USDT" ? "usdt_balances" : "fire_balances";
}

function ledgerTableForCurrency(currency) {
  return normalizeCurrency(currency) === "USDT" ? "usdt_ledger" : "fire_ledger";
}

function balanceReasonSuffix(currency) {
  return normalizeCurrency(currency) === "USDT" ? "_usdt" : "";
}

function insufficientBalanceError(currency) {
  return normalizeCurrency(currency) === "USDT" ? "insufficient_usdt" : "insufficient_fire";
}

function getBtcMarketDurationMinutes(definition) {
  return definition?.durationMinutes ?? config.marketDurationMinutes;
}

function mapMarket(row) {
  if (!row) {
    return null;
  }
  const btcDefinition = getBtcMarketDef(row.symbol);
  const minPrice = btcDefinition ? BTC_MIN_PRICE : MIN_PRICE;
  const yesPrice = roundOutcomePrice(toNumber(row.yes_price), minPrice);
  const noPrice = roundOutcomePrice(toNumber(row.no_price, 1 - yesPrice), minPrice);

  return {
    id: Number(row.id),
    symbol: row.symbol,
    market_type: btcDefinition ? "BTC_UPDOWN" : undefined,
    title: btcDefinition?.title,
    label: btcDefinition?.label,
    question: row.question,
    open_price: toNumber(row.open_price),
    close_price: row.close_price === null ? null : toNumber(row.close_price),
    current_price: row.current_price === null ? null : toNumber(row.current_price),
    yes_price: yesPrice,
    no_price: noPrice,
    yes_volume: toNumber(row.yes_volume),
    no_volume: toNumber(row.no_volume),
    liquidity: toNumber(row.liquidity),
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    winner: row.winner,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
  };
}

function mapUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    referred_by_telegram_id: row.referred_by_telegram_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPosition(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market_id: Number(row.market_id),
    side: row.side,
    shares: toNumber(row.shares),
    spent: toNumber(row.spent),
    bonus_spent: toNumber(row.bonus_spent),
    avg_price: toNumber(row.avg_price),
    payout: toNumber(row.payout),
    pnl: toNumber(row.pnl),
    currency: normalizeCurrency(row.currency),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    question: row.question,
    winner: row.winner,
    market_status: row.market_status,
    market_end_time: row.market_end_time,
    market_symbol: row.market_symbol,
    team: row.team,
    yes_price: row.yes_price === undefined ? undefined : toNumber(row.yes_price),
    no_price: row.no_price === undefined ? undefined : toNumber(row.no_price),
  };
}

function mapTrade(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market_id: Number(row.market_id),
    action: row.action || "BUY",
    side: row.side,
    amount: toNumber(row.amount),
    fee: toNumber(row.fee),
    price: toNumber(row.price),
    shares: toNumber(row.shares),
    currency: normalizeCurrency(row.currency),
    created_at: row.created_at,
  };
}

function mapLimitOrder(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market_id: Number(row.market_id),
    position_id: row.position_id === null || row.position_id === undefined ? null : Number(row.position_id),
    side: row.side,
    order_side: row.order_side || "BUY",
    currency: normalizeCurrency(row.currency),
    limit_price: toNumber(row.limit_price),
    shares: toNumber(row.shares),
    remaining_shares: toNumber(row.remaining_shares),
    reserved_amount: toNumber(row.reserved_amount),
    remaining_reserved: toNumber(row.remaining_reserved),
    bonus_reserved: toNumber(row.bonus_reserved),
    reserved_spent: toNumber(row.reserved_spent),
    remaining_spent: toNumber(row.remaining_spent),
    reserved_bonus_spent: toNumber(row.reserved_bonus_spent),
    remaining_bonus_spent: toNumber(row.remaining_bonus_spent),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    filled_at: row.filled_at,
    cancelled_at: row.cancelled_at,
  };
}

function mapMarketActivity(row) {
  return {
    id: Number(row.id),
    market_id: Number(row.market_id),
    market_symbol: row.market_symbol,
    market_question: row.market_question,
    market_status: row.market_status,
    market_winner: row.market_winner,
    team: row.team,
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    avatar_url: getTelegramUserAvatarUrl(row.username),
    action: row.action || "BUY",
    side: row.side,
    amount: toNumber(row.amount),
    fee: toNumber(row.fee),
    price: toNumber(row.price),
    shares: toNumber(row.shares),
    currency: normalizeCurrency(row.currency),
    created_at: row.created_at,
  };
}

function mapMarketComment(row) {
  const latestBetAmount = row.latest_bet_amount === null || row.latest_bet_amount === undefined
    ? null
    : toNumber(row.latest_bet_amount);
  const yesBetAmount = toNumber(row.yes_bet_amount);
  const noBetAmount = toNumber(row.no_bet_amount);
  return {
    id: Number(row.id),
    market_id: Number(row.market_id),
    message: row.message,
    created_at: row.created_at,
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    latest_bet: latestBetAmount === null
      ? null
      : {
        action: row.latest_bet_action || "BUY",
        side: row.latest_bet_side,
        amount: latestBetAmount,
        price: toNumber(row.latest_bet_price),
        shares: toNumber(row.latest_bet_shares),
        currency: normalizeCurrency(row.latest_bet_currency),
        created_at: row.latest_bet_created_at,
      },
    bet_summary: {
      yes_amount: yesBetAmount,
      no_amount: noBetAmount,
      currency: normalizeCurrency(row.bet_summary_currency || row.latest_bet_currency),
      total_amount: Math.round((yesBetAmount + noBetAmount) * 100) / 100,
    },
  };
}

function mapWorldCupMarket(row) {
  const yesPrice = toNumber(row.yes_price);
  const localVolume = toNumber(row.yes_volume) + toNumber(row.no_volume);
  const externalVolume = toNumber(row.meta_volume ?? row.volume);
  return {
    id: Number(row.id),
    symbol: row.symbol,
    market_type: "WORLD_CUP_WINNER",
    title: "World Cup Winner",
    team: row.team,
    icon: row.icon || "🏆",
    image: row.icon || null,
    slug: row.slug,
    polymarket_id: row.polymarket_id,
    question: row.question,
    open_price: toNumber(row.open_price),
    current_price: yesPrice,
    yes_price: yesPrice,
    no_price: toNumber(row.no_price, 1 - yesPrice),
    chance_pct: Math.round(yesPrice * 1000) / 10,
    volume: localVolume,
    external_volume: externalVolume,
    yes_volume: toNumber(row.yes_volume),
    no_volume: toNumber(row.no_volume),
    chart: row.chart || [],
    start_time: row.start_time,
    status: row.status,
    end_time: row.end_time,
  };
}

function mapMarketChartPoint(row) {
  return {
    price: toNumber(row.price),
    source: row.source,
    created_at: row.created_at,
  };
}

function mapFireLedgerEvent(row) {
  return {
    id: Number(row.id),
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    amount: toNumber(row.amount),
    reason: row.reason,
    source: row.source,
    created_at: row.created_at,
  };
}

function mapUsdtLedgerEvent(row) {
  return {
    id: Number(row.id),
    event_id: row.event_id,
    ledger_type: row.ledger_type,
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    amount: toNumber(row.amount),
    reason: row.reason,
    source: row.source,
    created_at: row.created_at,
  };
}

function mapUserMarketStat(row) {
  return {
    market_id: Number(row.market_id),
    symbol: row.symbol,
    market_type: row.market_type,
    label: row.label,
    title: row.title,
    question: row.question,
    team: row.team,
    icon: row.icon,
    status: row.market_status,
    winner: row.winner,
    currency: normalizeCurrency(row.currency),
    positions_count: Number(row.positions_count || 0),
    open_positions_count: Number(row.open_positions_count || 0),
    spent: toNumber(row.spent),
    payout: toNumber(row.payout),
    pnl: toNumber(row.pnl),
    updated_at: row.updated_at,
  };
}

async function persistPriceTick(db, symbol, price, source) {
  if (!config.priceTicksEnabled) {
    return;
  }

  await db.query(
    `
      INSERT INTO price_ticks (symbol, price, source)
      VALUES ($1, $2, $3)
    `,
    [symbol, price, source],
  );
}

function questionForPrice(price, definition = getBtcMarketDef(MARKET_SYMBOL)) {
  return `BTC будет выше ${Math.round(price).toLocaleString("ru-RU")} через ${definition?.label || "5m"}?`;
}

function getMarketProgress(market) {
  const start = new Date(market.start_time).getTime();
  const end = new Date(market.end_time).getTime();
  const duration = Math.max(1, end - start);
  return clamp((Date.now() - start) / duration, 0, 1);
}

function getMarketMinOutcomePrice(market) {
  return isBtcMarketSymbol(market?.symbol) ? BTC_MIN_PRICE : MIN_PRICE;
}

function isSportsMarket(market) {
  return String(market?.symbol || "").startsWith(WORLD_CUP_SYMBOL_PREFIX);
}

function getMarketMakerYesPrice(market, currentPrice, options = {}) {
  const openPrice = toNumber(market.open_price);
  const minPrice = getMarketMinOutcomePrice(market);
  const maxPrice = 1 - minPrice;
  const previousYesPrice = clamp(toNumber(market.yes_price, 0.5), minPrice, maxPrice);
  if (!openPrice || !currentPrice) {
    return previousYesPrice;
  }

  const progress = getMarketProgress(market);
  const movementPct = ((currentPrice - openPrice) / openPrice) * 100;
  const previousPrice = toNumber(market.current_price, openPrice);
  const momentumPct = ((currentPrice - previousPrice) / openPrice) * 100;

  const signalScalePct = Math.max(0.006, 0.12 - progress * 0.105);
  const directionalSignal = Math.tanh(movementPct / signalScalePct);
  const momentumSignal = Math.tanh(momentumPct / 0.012);
  const deadlineSignal = Math.tanh(movementPct / Math.max(0.004, 0.04 - progress * 0.034));
  const directionalWeight = 0.36 + progress * 0.38;
  const deadlineWeight = Math.max(0, progress - 0.72) * 0.68;
  const priceProbability = 0.5
    + directionalSignal * directionalWeight
    + deadlineSignal * deadlineWeight
    + momentumSignal * (0.04 + progress * 0.035);

  const yesVolume = toNumber(market.yes_volume);
  const noVolume = toNumber(market.no_volume);
  const liquidity = toNumber(market.liquidity, config.marketLiquidity);
  const volumeTotal = yesVolume + noVolume;
  const imbalance = volumeTotal > 0
    ? (yesVolume - noVolume) / (volumeTotal + liquidity * 0.08)
    : 0;
  const orderProbability = 0.5 + clamp(imbalance, -1, 1) * 0.42;

  const target = clamp(priceProbability * 0.86 + orderProbability * 0.14, minPrice, maxPrice);
  const adaptiveInertia = options.fast
    ? 0.24
    : Math.max(0.08, 0.48 - progress * 0.4);
  const panicInertia = Math.abs(target - previousYesPrice) > 0.18 ? 0.08 : adaptiveInertia;
  const tradeShift = Number(options.tradeShift || 0);

  return clamp(previousYesPrice * panicInertia + target * (1 - panicInertia) + tradeShift, minPrice, maxPrice);
}

function ensurePositiveAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("amount_must_be_positive");
  }

  return Math.round(value * 100) / 100;
}

function ensureNonNegativeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("amount_must_be_non_negative");
  }

  return Math.round(value * 100) / 100;
}

function getFeeBps() {
  return Number.isFinite(config.marketFeeBps) ? config.marketFeeBps : DEFAULT_FEE_BPS;
}

function calculateFee(amount) {
  return Math.round(Number(amount || 0) * (getFeeBps() / 10_000) * 100) / 100;
}

function getProfitFeeBps() {
  return Number.isFinite(config.marketProfitFeeBps) ? config.marketProfitFeeBps : DEFAULT_PROFIT_FEE_BPS;
}

function normalizeEconomySettings(row = {}) {
  const profitFeeBps = Math.max(0, Math.round(toNumber(row.profit_fee_bps, getProfitFeeBps())));
  const referralProfitShareBps = Math.max(0, Math.round(toNumber(
    row.referral_profit_share_bps,
    DEFAULT_REFERRAL_PROFIT_SHARE_BPS,
  )));
  const clanProfitShareBps = Math.max(0, Math.round(toNumber(
    row.clan_profit_share_bps,
    DEFAULT_CLAN_PROFIT_SHARE_BPS,
  )));
  const cappedReferralBps = Math.min(referralProfitShareBps, profitFeeBps);
  const cappedClanBps = Math.min(clanProfitShareBps, Math.max(0, profitFeeBps - cappedReferralBps));

  return {
    profit_fee_bps: profitFeeBps,
    referral_profit_share_bps: cappedReferralBps,
    clan_profit_share_bps: cappedClanBps,
    project_profit_share_bps: Math.max(0, profitFeeBps - cappedReferralBps - cappedClanBps),
    updated_by_telegram_id: row.updated_by_telegram_id ?? null,
    updated_by_username: row.updated_by_username ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function getEconomySettingsWithClient(client) {
  const result = await client.query(
    `
      INSERT INTO project_economy_settings (
        id,
        profit_fee_bps,
        referral_profit_share_bps,
        clan_profit_share_bps
      )
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `,
    [
      DEFAULT_PROFIT_FEE_BPS,
      DEFAULT_REFERRAL_PROFIT_SHARE_BPS,
      DEFAULT_CLAN_PROFIT_SHARE_BPS,
    ],
  );

  if (result.rows[0]) {
    return normalizeEconomySettings(result.rows[0]);
  }

  const existing = await client.query(
    `
      SELECT *
      FROM project_economy_settings
      WHERE id = 1
      LIMIT 1
    `,
  );
  return normalizeEconomySettings(existing.rows[0]);
}

export async function getProjectEconomySettings() {
  const result = await query(
    `
      SELECT *
      FROM project_economy_settings
      WHERE id = 1
      LIMIT 1
    `,
  );
  if (result.rows[0]) {
    return normalizeEconomySettings(result.rows[0]);
  }

  return withTransaction((client) => getEconomySettingsWithClient(client));
}

function parseBpsValue(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.round(parsed));
}

function parsePercentOrBps(input, bpsInput, fallback = 0) {
  if (bpsInput !== undefined && bpsInput !== null && bpsInput !== "") {
    return parseBpsValue(bpsInput, fallback);
  }
  if (input === undefined || input === null || input === "") {
    return fallback;
  }
  return parseBpsValue(Number(input) * 100, fallback);
}

export async function updateProjectEconomySettings(input = {}) {
  const current = await getProjectEconomySettings();
  const profitFeeBps = parsePercentOrBps(
    input.profit_fee_pct ?? input.profitFeePct,
    input.profit_fee_bps ?? input.profitFeeBps,
    current.profit_fee_bps,
  );
  const referralProfitShareBps = parsePercentOrBps(
    input.referral_profit_share_pct ?? input.referralProfitSharePct,
    input.referral_profit_share_bps ?? input.referralProfitShareBps,
    current.referral_profit_share_bps,
  );
  const clanProfitShareBps = parsePercentOrBps(
    input.clan_profit_share_pct ?? input.clanProfitSharePct,
    input.clan_profit_share_bps ?? input.clanProfitShareBps,
    current.clan_profit_share_bps,
  );

  if (profitFeeBps > 5_000 || referralProfitShareBps > 5_000 || clanProfitShareBps > 5_000) {
    throw new Error("invalid_economy_settings");
  }
  if (referralProfitShareBps + clanProfitShareBps > profitFeeBps) {
    throw new Error("invalid_economy_settings");
  }

  const result = await query(
    `
      INSERT INTO project_economy_settings (
        id,
        profit_fee_bps,
        referral_profit_share_bps,
        clan_profit_share_bps,
        updated_by_telegram_id,
        updated_by_username,
        updated_at
      )
      VALUES (1, $1, $2, $3, $4, $5, now())
      ON CONFLICT (id) DO UPDATE SET
        profit_fee_bps = EXCLUDED.profit_fee_bps,
        referral_profit_share_bps = EXCLUDED.referral_profit_share_bps,
        clan_profit_share_bps = EXCLUDED.clan_profit_share_bps,
        updated_by_telegram_id = EXCLUDED.updated_by_telegram_id,
        updated_by_username = EXCLUDED.updated_by_username,
        updated_at = now()
      RETURNING *
    `,
    [
      profitFeeBps,
      referralProfitShareBps,
      clanProfitShareBps,
      input.admin_telegram_id ? String(input.admin_telegram_id) : null,
      input.admin_username ? String(input.admin_username).replace(/^@/, "") : null,
    ],
  );
  return normalizeEconomySettings(result.rows[0]);
}

function calculateProfitFeeFromSettings(profit, settings) {
  return Math.round(Math.max(0, Number(profit || 0)) * (settings.profit_fee_bps / 10_000) * 100) / 100;
}

function getMarketMakerSpreadBps() {
  return Number.isFinite(config.marketMakerSpreadBps)
    ? config.marketMakerSpreadBps
    : DEFAULT_MARKET_MAKER_SPREAD_BPS;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundOutcomePrice(value, minPrice = MIN_PRICE) {
  return Math.round(clamp(Number(value || 0), minPrice, 1 - minPrice) * 100_000_000) / 100_000_000;
}

function getMarketOutcomePrice(market, side) {
  const minPrice = getMarketMinOutcomePrice(market);
  return side === "YES"
    ? roundOutcomePrice(toNumber(market.yes_price), minPrice)
    : roundOutcomePrice(toNumber(market.no_price), minPrice);
}

function getOppositeSide(side) {
  return side === "YES" ? "NO" : "YES";
}

function getCurrentPriceForMarket(market) {
  return toNumber(market.current_price, toNumber(market.open_price));
}

function getTailDepthFactor(outcomePrice, minPrice = MIN_PRICE) {
  const price = clamp(Number(outcomePrice || 0.5), minPrice, 1 - minPrice);
  const distanceFromCenter = Math.min(1, Math.abs(price - 0.5) / 0.5);
  const centerDepth = Math.pow(1 - distanceFromCenter, 2.35);
  return MIN_TAIL_DEPTH_FACTOR + (1 - MIN_TAIL_DEPTH_FACTOR) * centerDepth;
}

function getEffectiveMarketMakerLiquidity(market, outcomePrice) {
  const rawLiquidity = Math.max(1, toNumber(market.liquidity, config.marketLiquidity));
  const baseLiquidity = isSportsMarket(market)
    ? Math.max(1_500, Math.min(30_000, Math.sqrt(rawLiquidity) * 2.1))
    : Math.max(1_200, Math.min(24_000, rawLiquidity));
  return Math.max(35, baseLiquidity * MARKET_MAKER_DENSITY_MULTIPLIER * getTailDepthFactor(outcomePrice, getMarketMinOutcomePrice(market)));
}

function getFairOutcomePrice(market, side, currentPrice = getCurrentPriceForMarket(market)) {
  const minPrice = getMarketMinOutcomePrice(market);
  if (isSportsMarket(market)) {
    const yesPrice = roundOutcomePrice(toNumber(market.yes_price, 0.5), minPrice);
    const noPrice = roundOutcomePrice(toNumber(market.no_price, 1 - yesPrice), minPrice);
    return side === "YES" ? yesPrice : noPrice;
  }

  const fairYesPrice = roundOutcomePrice(getMarketMakerYesPrice(market, currentPrice, { fast: true }), minPrice);
  return side === "YES" ? fairYesPrice : roundOutcomePrice(1 - fairYesPrice, minPrice);
}

function driftOutcomePrice(market, side, currentPrice, strength = 0.08) {
  const minPrice = getMarketMinOutcomePrice(market);
  const current = getMarketOutcomePrice(market, side);
  const fair = getFairOutcomePrice(market, side, currentPrice);
  return roundOutcomePrice(current * (1 - strength) + fair * strength, minPrice);
}

function buildDualBookPrices(market, side, nextSidePrice, options = {}) {
  const currentPrice = options.currentPrice ?? getCurrentPriceForMarket(market);
  const oppositeSide = getOppositeSide(side);
  const minPrice = getMarketMinOutcomePrice(market);
  const driftStrength = options.oppositeDriftStrength ?? 0.08;
  const nextOppositePrice = driftOutcomePrice(market, oppositeSide, currentPrice, driftStrength);

  return {
    nextYesPrice: side === "YES"
      ? roundOutcomePrice(nextSidePrice, minPrice)
      : nextOppositePrice,
    nextNoPrice: side === "NO"
      ? roundOutcomePrice(nextSidePrice, minPrice)
      : nextOppositePrice,
  };
}

function getBuyExecutionQuote(market, side, amount) {
  const minPrice = getMarketMinOutcomePrice(market);
  const oldOutcomePrice = getMarketOutcomePrice(market, side);
  const fairOutcomePrice = getFairOutcomePrice(market, side);
  const bookPrice = Math.max(oldOutcomePrice, fairOutcomePrice);
  const liquidity = getEffectiveMarketMakerLiquidity(market, bookPrice);
  const rawTradeShift = (amount / liquidity) * BUY_IMPACT_MULTIPLIER;
  const tradeShift = Math.min(MAX_SINGLE_TRADE_SHIFT, rawTradeShift);
  const repricedMarket = {
    ...market,
    yes_volume: toNumber(market.yes_volume) + (side === "YES" ? amount : 0),
    no_volume: toNumber(market.no_volume) + (side === "NO" ? amount : 0),
  };
  const nextOutcomePrice = roundOutcomePrice(
    Math.max(bookPrice, oldOutcomePrice * 0.72 + fairOutcomePrice * 0.28) + tradeShift,
    minPrice,
  );
  const { nextYesPrice, nextNoPrice } = buildDualBookPrices(
    repricedMarket,
    side,
    nextOutcomePrice,
    { oppositeDriftStrength: 0.05 },
  );
  const spread = getMarketMakerSpreadBps() / 10_000;
  const executionPrice = roundOutcomePrice(Math.max(oldOutcomePrice, nextOutcomePrice) * (1 + spread), minPrice);

  return {
    oldOutcomePrice,
    executionPrice,
    nextYesPrice,
    nextNoPrice,
  };
}

function getSellExecutionQuote(market, side, sharesToSell) {
  const minPrice = getMarketMinOutcomePrice(market);
  const oldOutcomePrice = getMarketOutcomePrice(market, side);
  const estimatedGross = Math.max(0, sharesToSell * oldOutcomePrice);
  const fairOutcomePrice = getFairOutcomePrice(market, side);
  const liquidity = getEffectiveMarketMakerLiquidity(market, oldOutcomePrice);
  const rawTradeShift = (estimatedGross / liquidity) * SELL_IMPACT_MULTIPLIER;
  const tradeShift = Math.min(MAX_SINGLE_TRADE_SHIFT, rawTradeShift);
  const repricedMarket = {
    ...market,
    yes_volume: side === "YES"
      ? Math.max(0, toNumber(market.yes_volume) - estimatedGross)
      : toNumber(market.yes_volume),
    no_volume: side === "NO"
      ? Math.max(0, toNumber(market.no_volume) - estimatedGross)
      : toNumber(market.no_volume),
  };
  const driftedOutcomePrice = oldOutcomePrice * 0.86 + fairOutcomePrice * 0.14;
  const nextOutcomePrice = roundOutcomePrice(Math.min(oldOutcomePrice, driftedOutcomePrice) - tradeShift, minPrice);
  const { nextYesPrice, nextNoPrice } = buildDualBookPrices(
    repricedMarket,
    side,
    nextOutcomePrice,
    { oppositeDriftStrength: 0.04 },
  );
  const spread = getMarketMakerSpreadBps() / 10_000;
  const exitPenalty = isSportsMarket(market) ? 0.03 : 0.015;
  const executionPrice = roundOutcomePrice(Math.min(oldOutcomePrice, nextOutcomePrice) * (1 - spread - exitPenalty), minPrice);
  const gross = roundMoney(sharesToSell * executionPrice);

  return {
    oldOutcomePrice,
    executionPrice,
    gross,
    nextYesPrice,
    nextNoPrice,
    nextYesVolume: repricedMarket.yes_volume,
    nextNoVolume: repricedMarket.no_volume,
  };
}

function normalizeWorldCupTeam(question) {
  return String(question || "")
    .replace(/^Will\s+/i, "")
    .replace(/\s+win the 2026 FIFA World Cup\??$/i, "")
    .trim();
}

function normalizeWorldCupTeamKey(team) {
  return String(team || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "-")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isActiveWorldCupTeam(team) {
  return ACTIVE_WORLD_CUP_TEAM_KEYS.has(normalizeWorldCupTeamKey(team));
}

function isImageIcon(icon) {
  return /^https?:\/\//i.test(String(icon || ""));
}

function isFallbackWorldCupSymbol(symbol) {
  return String(symbol || "").startsWith(`${WORLD_CUP_SYMBOL_PREFIX}fallback-`);
}

function rankWorldCupRow(row) {
  const localVolume = toNumber(row.yes_volume) + toNumber(row.no_volume);
  return (
    localVolume * 1_000
    + (isImageIcon(row.icon) ? 100 : 0)
    + (isFallbackWorldCupSymbol(row.symbol) ? -50 : 0)
    + toNumber(row.meta_volume ?? row.volume) / 1_000_000
    + Number(row.id || 0) / 1_000_000_000
  );
}

function dedupeWorldCupRows(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    const key = normalizeWorldCupTeamKey(row.team || normalizeWorldCupTeam(row.question));
    if (!key) {
      continue;
    }

    const current = byTeam.get(key);
    if (!current || rankWorldCupRow(row) > rankWorldCupRow(current)) {
      byTeam.set(key, row);
    }
  }

  return Array.from(byTeam.values()).sort((a, b) => {
    const priceDiff = toNumber(b.yes_price) - toNumber(a.yes_price);
    if (Math.abs(priceDiff) > 0.000001) {
      return priceDiff;
    }
    return toNumber(b.meta_volume ?? b.volume) - toNumber(a.meta_volume ?? a.volume);
  });
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  try {
    return JSON.parse(String(value || "[]"));
  } catch {
    return [];
  }
}

function normalizeWorldCupFeedMarket(market) {
  const outcomePrices = parseJsonArray(market.outcomePrices);
  const rawYesPrice = Number(outcomePrices[0]);
  const team = normalizeWorldCupTeam(market.question);
  if (!team || !Number.isFinite(rawYesPrice)) {
    return null;
  }
  const yesPrice = clamp(rawYesPrice, MIN_PRICE, MAX_PRICE);

  return {
    polymarketId: String(market.id || market.slug || team),
    team,
    icon: market.icon || market.image || "",
    slug: market.slug || "",
    yesPrice,
    volume: toNumber(market.volumeNum ?? market.volume),
  };
}

async function fetchWorldCupMarketsFromPolymarket() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/events/slug/${WORLD_CUP_EVENT_SLUG}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`polymarket_${response.status}`);
    }
    const event = await response.json();
    return (event.markets || [])
      .map(normalizeWorldCupFeedMarket)
      .filter(Boolean)
      .filter((market) => isActiveWorldCupTeam(market.team))
      .sort((a, b) => b.yesPrice - a.yesPrice)
      .slice(0, 60);
  } finally {
    clearTimeout(timeout);
  }
}

function worldCupSymbol(input) {
  return `${WORLD_CUP_SYMBOL_PREFIX}${String(input.polymarketId).replace(/[^a-z0-9_-]/gi, "_")}`;
}

async function getWorldCupFeedMarkets() {
  try {
    const markets = await fetchWorldCupMarketsFromPolymarket();
    if (markets.length) {
      return {
        source: "polymarket",
        markets,
      };
    }
  } catch (error) {
    console.warn("[EasyMarket] Polymarket World Cup fetch failed", error instanceof Error ? error.message : String(error));
  }

  return {
    source: "fallback",
    markets: WORLD_CUP_FALLBACK_MARKETS.filter((market) => isActiveWorldCupTeam(market.team)),
  };
}

function getDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getTaskReason(taskKey) {
  return `task_${String(taskKey || "").replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
}

function getClanTaskPoints(taskKey) {
  const points = {
    share_friend: 2,
    av_channel: 5,
    av_chat: 5,
    private_chat: 10,
    daily_presence: 2,
    daily_bet: 3,
    daily_btc_prediction: 3,
    daily_football_prediction: 3,
    daily_btc_5_predictions: 8,
    daily_win_1: 5,
    daily_win_streak_5: 12,
  };
  return points[String(taskKey || "").trim()] || 0;
}

async function getDailyBonusRemaining(client, userId) {
  const result = await client.query(
    `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM fire_ledger
      WHERE user_id = $1
        AND amount > 0
        AND reason IN (
          'task_share_friend',
          'task_av_channel',
          'task_av_chat',
          'task_daily_presence',
          'task_daily_bet',
          'task_daily_btc_prediction',
          'task_daily_football_prediction',
          'task_daily_btc_5_predictions',
          'task_daily_win_1',
          'task_daily_win_streak_5',
          'referral_bet_bonus'
        )
        AND created_at >= date_trunc('day', now())
    `,
    [userId],
  );
  const used = Math.max(0, toNumber(result.rows[0]?.total));
  return Math.max(0, Math.round((config.taskDailyCapFire - used) * 100) / 100);
}

async function awardBonusWithDailyCap(client, userId, amount, reason, source) {
  const requestedAmount = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  const remaining = await getDailyBonusRemaining(client, userId);
  const awarded = Math.min(requestedAmount, remaining);
  if (awarded <= 0) {
    return {
      awarded: 0,
      daily_remaining: remaining,
      cap_reached: true,
    };
  }

  await client.query(
    `
      UPDATE fire_balances
      SET balance = balance + $2,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, awarded],
  );
  await client.query(
    `
      INSERT INTO fire_ledger (user_id, amount, reason, source)
      VALUES ($1, $2, $3, $4)
    `,
    [userId, awarded, reason, source],
  );

  return {
    awarded,
    daily_remaining: Math.max(0, Math.round((remaining - awarded) * 100) / 100),
    cap_reached: awarded < requestedAmount,
  };
}

async function createUsdtLossRefundOffer(client, position, pnl) {
  if (normalizeCurrency(position.currency) !== "USDT" || Number(pnl || 0) >= 0) {
    return null;
  }

  const refundAmount = Math.min(30, Math.max(0, Math.round(toNumber(position.spent) * 100) / 100));
  if (refundAmount <= 0) {
    return null;
  }

  const dayKey = getDayKey();
  const existingToday = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM usdt_loss_refund_offers
      WHERE user_id = $1
        AND day_key = $2
    `,
    [position.user_id, dayKey],
  );
  const offerIndex = Number(existingToday.rows[0]?.count || 0);
  if (offerIndex >= 2) {
    return null;
  }
  const offerType = offerIndex === 0 ? "referral" : (refundAmount <= 10 ? "stars_100" : "stars_500");

  const result = await client.query(
    `
      INSERT INTO usdt_loss_refund_offers (
        user_id,
        position_id,
        market_id,
        offer_type,
        amount,
        day_key
      )
      VALUES ($1, $2, $3, $4, $5::numeric, $6)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [position.user_id, position.id, position.market_id, offerType, refundAmount, dayKey],
  );
  return result.rows[0] || null;
}

async function claimReferralLossRefundIfAny(client, inviterUserId, referredUserId) {
  const offerResult = await client.query(
    `
      SELECT *
      FROM usdt_loss_refund_offers
      WHERE user_id = $1
        AND status = 'pending'
        AND offer_type = 'referral'
        AND day_key = $2
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    `,
    [inviterUserId, getDayKey()],
  );
  const offer = offerResult.rows[0];
  if (!offer) {
    return null;
  }

  await adjustUsdtBonusBalance(
    client,
    inviterUserId,
    toNumber(offer.amount),
    "loss_refund_referral",
    `loss_refund:${offer.id}:referral:${referredUserId}`,
  );
  await client.query(
    `
      UPDATE usdt_loss_refund_offers
      SET status = 'claimed',
          referred_user_id = $2,
          claimed_at = now()
      WHERE id = $1
    `,
    [offer.id, referredUserId],
  );

  return {
    id: Number(offer.id),
    amount: toNumber(offer.amount),
    offer_type: offer.offer_type,
  };
}

export async function claimLossRefundWithStars(input) {
  const offerId = Number(input.offer_id ?? input.offerId);
  if (!Number.isSafeInteger(offerId) || offerId <= 0) {
    throw new Error("invalid_loss_refund_offer");
  }
  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const offerResult = await client.query(
      `
        SELECT *
        FROM usdt_loss_refund_offers
        WHERE id = $1
          AND user_id = $2
          AND status = 'pending'
        FOR UPDATE
      `,
      [offerId, user.id],
    );
    const offer = offerResult.rows[0];
    if (!offer) {
      throw new Error("loss_refund_offer_not_found");
    }
    const cost = offer.offer_type === "stars_100"
      ? 100
      : offer.offer_type === "stars_500"
        ? 500
        : 0;
    if (cost <= 0) {
      throw new Error("loss_refund_offer_requires_referral");
    }

    await debitCurrencyBalance(
      client,
      user.id,
      "STAR",
      cost,
      "loss_refund_star_fee",
      `loss_refund:${offer.id}`,
    );
    await adjustUsdtBonusBalance(
      client,
      user.id,
      toNumber(offer.amount),
      "loss_refund_stars",
      `loss_refund:${offer.id}`,
    );
    await client.query(
      `
        UPDATE usdt_loss_refund_offers
        SET status = 'claimed',
            claimed_at = now()
        WHERE id = $1
      `,
      [offer.id],
    );
    const [starBalance, usdtTotal, usdtCash, usdtBonus] = await Promise.all([
      getBalanceByUserId(user.id),
      getUsdtTotalBalanceByUserId(user.id),
      getUsdtBalanceByUserId(user.id),
      getUsdtBonusBalanceByUserId(user.id),
    ]);

    return {
      ok: true,
      user,
      balance: starBalance,
      usdt_balance: usdtTotal,
      usdt_cash_balance: usdtCash,
      usdt_bonus_balance: usdtBonus,
      offer: {
        id: Number(offer.id),
        amount: toNumber(offer.amount),
        offer_type: offer.offer_type,
        status: "claimed",
      },
    };
  });
}

function slugifyClanName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `clan-${Date.now()}`;
}

const ALLOWED_CLAN_ICON_KEYS = new Set([
  "bull",
  "bear",
  "fox",
  "wolf",
  "eagle",
  "tiger",
  "lion",
  "shark",
]);

function normalizeClanIconKey(value) {
  const iconKey = String(value || "").trim().toLowerCase();
  return ALLOWED_CLAN_ICON_KEYS.has(iconKey) ? iconKey : "bull";
}

function getTelegramChannelUsername(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  if (/^@[\w\d_]{4,}$/i.test(raw)) {
    return raw.replace(/^@/, "");
  }
  const withoutProtocol = raw.replace(/^https?:\/\//i, "");
  const match = withoutProtocol.match(/^(?:www\.)?t\.me\/([A-Za-z0-9_]{4,})(?:[/?#].*)?$/i);
  return match?.[1] || null;
}

function getClanChannelAvatarUrl(channelUrl) {
  const username = getTelegramChannelUsername(channelUrl);
  return username ? `https://t.me/i/userpic/320/${encodeURIComponent(username)}.jpg` : null;
}

function getTelegramUserAvatarUrl(username) {
  const cleanUsername = String(username || "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{4,}$/.test(cleanUsername)
    ? `https://t.me/i/userpic/320/${encodeURIComponent(cleanUsername)}.jpg`
    : null;
}

async function ensureDefaultClans(client) {
  await client.query(
    `
      INSERT INTO clans (name, slug, kind, icon_key)
      VALUES
        ('BTC Bulls', 'btc-bulls', 'default', 'bull'),
        ('BTC Bears', 'btc-bears', 'default', 'bear')
      ON CONFLICT (slug) DO UPDATE SET
        icon_key = EXCLUDED.icon_key,
        kind = EXCLUDED.kind
    `,
  );
}

async function awardClanPoints(client, userId, marketId, points, reason, currency = null) {
  const numericPoints = Math.round(Number(points || 0) * 100) / 100;
  if (!numericPoints) {
    return null;
  }

  const memberResult = await client.query(
    `
      SELECT clan_id
      FROM clan_members
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );
  const clanId = memberResult.rows[0]?.clan_id;
  if (!clanId) {
    return null;
  }

  if (marketId) {
    const existingResult = await client.query(
      `
        SELECT id
        FROM clan_score_events
        WHERE user_id = $1
          AND market_id = $2
          AND reason = $3
        LIMIT 1
      `,
      [userId, marketId, reason],
    );
    if (existingResult.rows[0]) {
      return null;
    }
  } else {
    const existingResult = await client.query(
      `
        SELECT id
        FROM clan_score_events
        WHERE user_id = $1
          AND market_id IS NULL
          AND reason = $2
          AND created_at >= date_trunc('day', now())
        LIMIT 1
      `,
      [userId, reason],
    );
    if (existingResult.rows[0]) {
      return null;
    }
  }

  await client.query(
    `
      INSERT INTO clan_score_events (clan_id, user_id, market_id, points, reason, currency)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [clanId, userId, marketId || null, numericPoints, reason, currency],
  );
  await client.query(
    `
      UPDATE clan_members
      SET contribution_score = contribution_score + $2
      WHERE user_id = $1
    `,
    [userId, numericPoints],
  );

  return {
    clan_id: Number(clanId),
    points: numericPoints,
  };
}

async function getTopClanForReward(client) {
  await ensureDefaultClans(client);
  const result = await client.query(
    `
      WITH scores AS (
        SELECT clan_id, COALESCE(SUM(points), 0) AS score
        FROM clan_score_events
        GROUP BY clan_id
      ),
      members AS (
        SELECT clan_id, COUNT(*)::int AS members_count
        FROM clan_members
        GROUP BY clan_id
      )
      SELECT
        clans.id,
        COALESCE(scores.score, 0) AS score,
        COALESCE(members.members_count, 0) AS members_count
      FROM clans
      LEFT JOIN scores ON scores.clan_id = clans.id
      LEFT JOIN members ON members.clan_id = clans.id
      ORDER BY COALESCE(scores.score, 0) DESC, COALESCE(members.members_count, 0) DESC, clans.id ASC
      LIMIT 1
    `,
  );
  return result.rows[0] || null;
}

async function getReferrerForUser(client, userId) {
  const userResult = await client.query(
    `
      SELECT telegram_id, referred_by_telegram_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const referredByTelegramId = String(userResult.rows[0]?.referred_by_telegram_id || "").trim();
  const ownTelegramId = String(userResult.rows[0]?.telegram_id || "").trim();
  if (!referredByTelegramId || referredByTelegramId === ownTelegramId) {
    return null;
  }

  const referrerResult = await client.query(
    `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      LIMIT 1
    `,
    [referredByTelegramId],
  );
  return referrerResult.rows[0] || null;
}

function getMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

async function distributeProfitFee(client, input) {
  const grossProfit = Math.max(0, Math.round(Number(input.grossProfit || 0) * 100) / 100);
  const totalFee = Math.max(0, Math.round(Number(input.totalFee || 0) * 100) / 100);
  if (grossProfit <= 0 || totalFee <= 0) {
    return {
      total_fee: 0,
      project_fee: 0,
      referral_fee: 0,
      clan_fee: 0,
    };
  }

  const currency = normalizeCurrency(input.currency);
  const settings = input.settings || await getEconomySettingsWithClient(client);
  let referralFee = Math.min(
    totalFee,
    Math.round(grossProfit * (settings.referral_profit_share_bps / 10_000) * 100) / 100,
  );
  let clanFee = Math.min(
    Math.max(0, totalFee - referralFee),
    Math.round(grossProfit * (settings.clan_profit_share_bps / 10_000) * 100) / 100,
  );
  let projectFee = Math.max(0, Math.round((totalFee - referralFee - clanFee) * 100) / 100);
  const reason = String(input.reason || "profit_fee");
  const source = String(input.source || `market:${input.marketId || "unknown"}`);
  const eventKey = String(input.eventKey || `${reason}:${input.positionId || "-"}:${input.tradeId || "-"}`);

  let referrer = null;
  if (referralFee > 0) {
    referrer = await getReferrerForUser(client, input.userId);
    if (referrer) {
      await creditCurrencyBalance(
        client,
        referrer.id,
        currency,
        referralFee,
        `profit_fee_referral${balanceReasonSuffix(currency)}`,
        source,
      );
    } else {
      projectFee = Math.round((projectFee + referralFee) * 100) / 100;
      referralFee = 0;
    }
  }

  let topClan = null;
  if (clanFee > 0) {
    topClan = await getTopClanForReward(client);
    if (topClan) {
      await client.query(
        `
          INSERT INTO clan_reward_fund_ledger (
            clan_id,
            market_id,
            position_id,
            trade_id,
            currency,
            amount,
            month_key,
            source
          )
          VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
        `,
        [
          topClan.id,
          input.marketId || null,
          input.positionId || null,
          input.tradeId || null,
          currency,
          clanFee,
          getMonthKey(),
          source,
        ],
      );
    } else {
      projectFee = Math.round((projectFee + clanFee) * 100) / 100;
      clanFee = 0;
    }
  }

  await client.query(
    `
      INSERT INTO profit_fee_distributions (
        event_key,
        position_id,
        trade_id,
        market_id,
        user_id,
        currency,
        gross_profit,
        total_fee,
        project_fee,
        referral_fee,
        clan_fee,
        referrer_user_id,
        clan_id,
        reason
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12, $13, $14)
      ON CONFLICT (event_key) DO NOTHING
    `,
    [
      eventKey,
      input.positionId || null,
      input.tradeId || null,
      input.marketId || null,
      input.userId || null,
      currency,
      grossProfit,
      totalFee,
      projectFee,
      referralFee,
      clanFee,
      referrer?.id || null,
      topClan?.id || null,
      reason,
    ],
  );

  return {
    total_fee: totalFee,
    project_fee: projectFee,
    referral_fee: referralFee,
    clan_fee: clanFee,
    referrer_user_id: referrer ? Number(referrer.id) : null,
    clan_id: topClan ? Number(topClan.id) : null,
  };
}

// Only the most active members share the monthly bank so inactive "dead souls"
// don't dilute everyone's cut. Sorted by monthly contribution, capped here.
const CLAN_REWARD_MAX_MEMBERS = 30;

export async function distributeDueClanRewardFunds() {
  const currentMonthKey = getMonthKey();
  return withTransaction(async (client) => {
    // Closed months that accrued a bank. Winner-takes-all: the whole month pool
    // goes to the single clan that scored the most that month, split across its
    // top-30 members by monthly contribution. This mirrors the "клан №1 забирает
    // банк" model shown in the UI, so the displayed bank == what the winner wins.
    const monthsResult = await client.query(
      `
        SELECT month_key
        FROM clan_reward_fund_ledger
        WHERE month_key < $1
        GROUP BY month_key
        HAVING COALESCE(SUM(amount), 0) > 0
        ORDER BY month_key ASC
        LIMIT 12
      `,
      [currentMonthKey],
    );

    const summaries = [];
    for (const monthRow of monthsResult.rows) {
      const monthKey = String(monthRow.month_key || "");
      if (!monthKey) {
        continue;
      }

      // Winner = the clan with the highest score earned during that month.
      const winnerResult = await client.query(
        `
          SELECT clan_id
          FROM clan_score_events
          WHERE to_char(created_at, 'YYYY-MM') = $1
          GROUP BY clan_id
          ORDER BY COALESCE(SUM(points), 0) DESC, clan_id ASC
          LIMIT 1
        `,
        [monthKey],
      );
      const winnerClanId = winnerResult.rows[0]?.clan_id;
      if (!winnerClanId) {
        continue;
      }

      // One bank per currency for the whole month — every clan's fees fought for it.
      const poolResult = await client.query(
        `
          SELECT currency, COALESCE(SUM(amount), 0) AS amount
          FROM clan_reward_fund_ledger
          WHERE month_key = $1
          GROUP BY currency
          HAVING COALESCE(SUM(amount), 0) > 0
        `,
        [monthKey],
      );

      for (const poolRow of poolResult.rows) {
        const currency = normalizeCurrency(poolRow.currency);
        const amount = Math.round(toNumber(poolRow.amount) * 100) / 100;
        if (amount <= 0) {
          continue;
        }

        const alreadyPaidResult = await client.query(
          `
            SELECT COALESCE(SUM(amount), 0) AS paid
            FROM clan_reward_payouts
            WHERE month_key = $1
              AND clan_id = $2
              AND currency = $3
          `,
          [monthKey, winnerClanId, currency],
        );
        if (toNumber(alreadyPaidResult.rows[0]?.paid) >= amount - 0.01) {
          continue;
        }

        const membersResult = await client.query(
          `
            WITH monthly_scores AS (
              SELECT
                user_id,
                GREATEST(COALESCE(SUM(points), 0), 0) AS contribution_score
              FROM clan_score_events
              WHERE clan_id = $1
                AND to_char(created_at, 'YYYY-MM') = $2
              GROUP BY user_id
            )
            SELECT
              clan_members.user_id,
              COALESCE(monthly_scores.contribution_score, 0) AS contribution_score
            FROM clan_members
            LEFT JOIN monthly_scores ON monthly_scores.user_id = clan_members.user_id
            WHERE clan_members.clan_id = $1
            ORDER BY COALESCE(monthly_scores.contribution_score, 0) DESC, clan_members.joined_at ASC
            LIMIT ${CLAN_REWARD_MAX_MEMBERS}
          `,
          [winnerClanId, monthKey],
        );
        const members = membersResult.rows;
        if (!members.length) {
          continue;
        }

        const totalContribution = members.reduce(
          (sum, member) => sum + Math.max(0, toNumber(member.contribution_score)),
          0,
        );
        let remaining = amount;
        let paidCount = 0;
        for (let index = 0; index < members.length; index += 1) {
          const member = members[index];
          const isLast = index === members.length - 1;
          const contribution = Math.max(0, toNumber(member.contribution_score));
          const rawShare = totalContribution > 0
            ? amount * (contribution / totalContribution)
            : amount / members.length;
          const payout = isLast
            ? Math.max(0, Math.round(remaining * 100) / 100)
            : Math.max(0, Math.round(rawShare * 100) / 100);
          remaining = Math.max(0, Math.round((remaining - payout) * 100) / 100);
          if (payout <= 0) {
            continue;
          }

          const payoutResult = await client.query(
            `
              INSERT INTO clan_reward_payouts (
                month_key,
                clan_id,
                user_id,
                currency,
                amount,
                contribution_score
              )
              VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric)
              ON CONFLICT DO NOTHING
              RETURNING *
            `,
            [monthKey, winnerClanId, member.user_id, currency, payout, contribution],
          );
          if (!payoutResult.rows[0]) {
            continue;
          }

          await creditCurrencyBalance(
            client,
            member.user_id,
            currency,
            payout,
            `clan_monthly_reward${balanceReasonSuffix(currency)}`,
            `clan:${winnerClanId}:month:${monthKey}`,
          );
          paidCount += 1;
        }

        summaries.push({
          month_key: monthKey,
          clan_id: Number(winnerClanId),
          currency,
          amount,
          paid_count: paidCount,
        });
      }
    }

    return {
      ok: true,
      summaries,
    };
  });
}

export async function upsertUser(input) {
  const telegramId = String(input.telegram_id ?? "").trim();
  if (!telegramId) {
    throw new Error("telegram_id_required");
  }
  const referredByTelegramId = String(input.referred_by_telegram_id ?? input.ref ?? "")
    .trim()
    .replace(/^ref_/, "");
  const safeReferredBy = referredByTelegramId && referredByTelegramId !== telegramId
    ? referredByTelegramId
    : null;

  return withTransaction(async (client) => {
    const userResult = await client.query(
      `
        INSERT INTO users (telegram_id, username, first_name, referred_by_telegram_id, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (telegram_id) DO UPDATE SET
          username = EXCLUDED.username,
          first_name = EXCLUDED.first_name,
          referred_by_telegram_id = COALESCE(users.referred_by_telegram_id, EXCLUDED.referred_by_telegram_id),
          updated_at = now()
        RETURNING *
      `,
      [
        telegramId,
        input.username ? String(input.username).replace(/^@/, "") : null,
        input.first_name ? String(input.first_name) : null,
        safeReferredBy,
      ],
    );
    const user = userResult.rows[0];

    await client.query(
      `
        INSERT INTO fire_balances (user_id, balance, updated_at)
        VALUES ($1, 0, now())
        ON CONFLICT (user_id) DO NOTHING
      `,
      [user.id],
    );
    await client.query(
      `
        INSERT INTO usdt_balances (user_id, balance, updated_at)
        VALUES ($1, 0, now())
        ON CONFLICT (user_id) DO NOTHING
      `,
      [user.id],
    );
    await client.query(
      `
        INSERT INTO usdt_bonus_balances (user_id, balance, updated_at)
        VALUES ($1, 0, now())
        ON CONFLICT (user_id) DO NOTHING
      `,
      [user.id],
    );

    if (safeReferredBy) {
      const referralSignupResult = await client.query(
        `
          INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
          VALUES ($1, 'referral_signup', $2, 'once', $3)
          ON CONFLICT DO NOTHING
          RETURNING *
        `,
        [user.id, REFERRAL_SIGNUP_BONUS, `referral:${safeReferredBy}`],
      );
      if (referralSignupResult.rows[0]) {
        await adjustBalance(
          client,
          user.id,
          REFERRAL_SIGNUP_BONUS,
          "referral_signup_bonus",
          `referral:${safeReferredBy}`,
        );
      }
      const signupBonusUsdt = Math.round(Number(config.referralSignupBonusUsdt || 0) * 100) / 100;
      if (signupBonusUsdt > 0) {
        const usdtSignupResult = await client.query(
          `
            INSERT INTO usdt_bonus_claims (user_id, task_key, amount, source)
            VALUES ($1, 'referral_signup_usdt', $2::numeric, $3)
            ON CONFLICT DO NOTHING
            RETURNING *
          `,
          [user.id, signupBonusUsdt, `referral:${safeReferredBy}`],
        );
        if (usdtSignupResult.rows[0]) {
          await adjustUsdtBonusBalance(
            client,
            user.id,
            signupBonusUsdt,
            "referral_signup_bonus_usdt",
            `referral:${safeReferredBy}`,
          );
        }
      }
    }

    return mapUser(user);
  });
}

export async function getUserByTelegramId(telegramId) {
  const result = await query(
    `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      LIMIT 1
    `,
    [String(telegramId)],
  );

  return mapUser(result.rows[0]);
}

async function getBalanceByUserId(userId) {
  const result = await query(
    `
      SELECT balance
      FROM fire_balances
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return toNumber(result.rows[0]?.balance);
}

async function getUsdtBalanceByUserId(userId) {
  const result = await query(
    `
      SELECT balance
      FROM usdt_balances
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return toNumber(result.rows[0]?.balance);
}

async function getUsdtBonusBalanceByUserId(userId) {
  const result = await query(
    `
      SELECT balance
      FROM usdt_bonus_balances
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return toNumber(result.rows[0]?.balance);
}

async function getUsdtTotalBalanceByUserId(userId) {
  const [cashBalance, bonusBalance] = await Promise.all([
    getUsdtBalanceByUserId(userId),
    getUsdtBonusBalanceByUserId(userId),
  ]);
  return Math.round((cashBalance + bonusBalance) * 100) / 100;
}

async function getBalanceByUserIdAndCurrency(userId, currency) {
  if (normalizeCurrency(currency) === "USDT") {
    return getUsdtTotalBalanceByUserId(userId);
  }

  const table = balanceTableForCurrency(currency);
  const result = await query(
    `
      SELECT balance
      FROM ${table}
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId],
  );

  return toNumber(result.rows[0]?.balance);
}

async function adjustBalance(client, userId, amount, reason, source) {
  const delta = Math.round(Number(amount || 0) * 100) / 100;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) {
    return;
  }

  await client.query(
    `
      UPDATE fire_balances
      SET balance = balance + $2::numeric,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, delta],
  );
  await client.query(
    `
      INSERT INTO fire_ledger (user_id, amount, reason, source)
      VALUES ($1, $2::numeric, $3, $4)
    `,
    [userId, delta, reason, source],
  );
}

async function adjustUsdtBonusBalance(client, userId, amount, reason, source) {
  const delta = Math.round(Number(amount || 0) * 100) / 100;
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) {
    return;
  }

  await client.query(
    `
      UPDATE usdt_bonus_balances
      SET balance = balance + $2::numeric,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, delta],
  );
  await client.query(
    `
      INSERT INTO usdt_bonus_ledger (user_id, amount, reason, source)
      VALUES ($1, $2::numeric, $3, $4)
    `,
    [userId, delta, reason, source],
  );
}

async function getLockedCurrencyBalance(client, userId, currency) {
  if (normalizeCurrency(currency) !== "USDT") {
    const result = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
        FOR UPDATE
      `,
      [userId],
    );
    return {
      cash: toNumber(result.rows[0]?.balance),
      bonus: 0,
      total: toNumber(result.rows[0]?.balance),
    };
  }

  const cashResult = await client.query(
    `
      SELECT balance
      FROM usdt_balances
      WHERE user_id = $1
      FOR UPDATE
    `,
    [userId],
  );
  const bonusResult = await client.query(
    `
      SELECT balance
      FROM usdt_bonus_balances
      WHERE user_id = $1
      FOR UPDATE
    `,
    [userId],
  );
  const cash = toNumber(cashResult.rows[0]?.balance);
  const bonus = toNumber(bonusResult.rows[0]?.balance);
  return {
    cash,
    bonus,
    total: Math.round((cash + bonus) * 100) / 100,
  };
}

function splitUsdtSpend(amount, balances) {
  const total = Math.round(Number(amount || 0) * 100) / 100;
  const bonus = Math.min(Math.max(0, balances.bonus), total);
  return {
    bonus: Math.round(bonus * 100) / 100,
    cash: Math.round((total - bonus) * 100) / 100,
  };
}

function splitUsdtCredit(amount, bonusRatio) {
  const total = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  const safeRatio = clamp(Number(bonusRatio || 0), 0, 1);
  const bonus = Math.round(total * safeRatio * 100) / 100;
  return {
    bonus,
    cash: Math.max(0, Math.round((total - bonus) * 100) / 100),
  };
}

async function debitCurrencyBalance(client, userId, currency, amount, reason, source) {
  const normalized = normalizeCurrency(currency);
  const balances = await getLockedCurrencyBalance(client, userId, normalized);
  const total = Math.round(Number(amount || 0) * 100) / 100;
  if (total > balances.total) {
    throw new Error(insufficientBalanceError(normalized));
  }

  if (normalized !== "USDT") {
    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance - $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [userId, total],
    );
    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, $3, $4)
      `,
      [userId, -total, reason, source],
    );
    return {
      cash_spent: total,
      bonus_spent: 0,
      balance: Math.round((balances.total - total) * 100) / 100,
    };
  }

  const split = splitUsdtSpend(total, balances);
  if (split.cash > 0) {
    await client.query(
      `
        UPDATE usdt_balances
        SET balance = balance - $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [userId, split.cash],
    );
    await client.query(
      `
        INSERT INTO usdt_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, $3, $4)
      `,
      [userId, -split.cash, reason, source],
    );
  }
  if (split.bonus > 0) {
    await adjustUsdtBonusBalance(client, userId, -split.bonus, `${reason}_bonus`, source);
  }

  return {
    cash_spent: split.cash,
    bonus_spent: split.bonus,
    balance: Math.round((balances.total - total) * 100) / 100,
  };
}

async function creditCurrencyBalance(client, userId, currency, amount, reason, source, bonusRatio = 0) {
  const normalized = normalizeCurrency(currency);
  const total = Math.max(0, Math.round(Number(amount || 0) * 100) / 100);
  if (total <= 0) {
    return {
      cash: 0,
      bonus: 0,
    };
  }

  if (normalized !== "USDT") {
    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance + $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [userId, total],
    );
    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, $3, $4)
      `,
      [userId, total, reason, source],
    );
    return {
      cash: total,
      bonus: 0,
    };
  }

  const split = splitUsdtCredit(total, bonusRatio);
  if (split.cash > 0) {
    await client.query(
      `
        UPDATE usdt_balances
        SET balance = balance + $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [userId, split.cash],
    );
    await client.query(
      `
        INSERT INTO usdt_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, $3, $4)
      `,
      [userId, split.cash, reason, source],
    );
  }
  if (split.bonus > 0) {
    await adjustUsdtBonusBalance(client, userId, split.bonus, `${reason}_bonus`, source);
  }

  return split;
}

async function getCurrencyBalanceSnapshot(client, userId, currency) {
  const normalized = normalizeCurrency(currency);
  if (normalized !== "USDT") {
    const result = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [userId],
    );
    return {
      cash: toNumber(result.rows[0]?.balance),
      bonus: 0,
      total: toNumber(result.rows[0]?.balance),
    };
  }

  const cashResult = await client.query("SELECT balance FROM usdt_balances WHERE user_id = $1", [userId]);
  const bonusResult = await client.query("SELECT balance FROM usdt_bonus_balances WHERE user_id = $1", [userId]);
  const cash = toNumber(cashResult.rows[0]?.balance);
  const bonus = toNumber(bonusResult.rows[0]?.balance);
  return {
    cash,
    bonus,
    total: Math.round((cash + bonus) * 100) / 100,
  };
}

function getBonusRatioForAmount(bonusAmount, totalAmount) {
  const total = Number(totalAmount || 0);
  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return clamp(Number(bonusAmount || 0) / total, 0, 1);
}

async function getUserMarketStats(userId, limit = 40) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  const result = await query(
    `
      WITH grouped_stats AS (
        SELECT
          p.market_id,
          p.currency,
          m.symbol,
          CASE
            WHEN m.symbol = ANY($2) THEN 'BTC_UPDOWN'
            WHEN m.symbol LIKE '${WORLD_CUP_SYMBOL_PREFIX}%' THEN 'WORLD_CUP_WINNER'
            ELSE NULL
          END AS market_type,
          meta.team,
          meta.icon,
          m.question,
          m.status AS market_status,
          m.winner,
          COUNT(*) AS positions_count,
          COUNT(*) FILTER (WHERE p.status = 'open') AS open_positions_count,
          SUM(p.spent) AS spent,
          SUM(p.payout) AS payout,
          SUM(p.pnl) AS pnl,
          MAX(p.updated_at) AS updated_at
        FROM positions p
        JOIN markets m ON m.id = p.market_id
        LEFT JOIN world_cup_market_meta meta ON meta.symbol = m.symbol
        WHERE p.user_id = $1
        GROUP BY
          p.market_id,
          p.currency,
          m.symbol,
          meta.team,
          meta.icon,
          m.question,
          m.status,
          m.winner
      ),
      ranked_stats AS (
        SELECT
          grouped_stats.*,
          ROW_NUMBER() OVER (ORDER BY updated_at DESC) AS recent_rank
        FROM grouped_stats
      )
      SELECT *
      FROM ranked_stats
      WHERE open_positions_count > 0
        OR market_status NOT IN ('resolved', 'price_error', 'superseded')
        OR recent_rank <= $3
      ORDER BY
        CASE
          WHEN open_positions_count > 0 AND market_status = 'open' THEN 0
          WHEN market_status NOT IN ('resolved', 'price_error', 'superseded') THEN 1
          ELSE 2
        END,
        updated_at DESC
      LIMIT 120
    `,
    [userId, BTC_MARKET_SYMBOLS, safeLimit],
  );

  return result.rows.map((row) => {
    const btcDefinition = getBtcMarketDef(row.symbol);
    return mapUserMarketStat({
      ...row,
      title: btcDefinition?.title,
      label: btcDefinition?.label,
    });
  });
}

export async function getUserSnapshot(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return null;
  }

  await query(
    `
      UPDATE users
      SET updated_at = now()
      WHERE id = $1
    `,
    [user.id],
  );

  const [balance, usdtCashBalance, usdtBonusBalance, positionsResult, tradesResult, marketStats, dailyTasks, lossRefundOffersResult] = await Promise.all([
    getBalanceByUserId(user.id),
    getUsdtBalanceByUserId(user.id),
    getUsdtBonusBalanceByUserId(user.id),
    query(
      `
        WITH recent_positions AS (
          SELECT id
          FROM positions
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT 20
        )
        SELECT
          p.*,
          m.question,
          m.winner,
          m.status AS market_status,
          m.end_time AS market_end_time,
          m.symbol AS market_symbol,
          meta.team AS team,
          m.yes_price,
          m.no_price
        FROM positions p
        JOIN markets m ON m.id = p.market_id
        LEFT JOIN world_cup_market_meta meta ON meta.symbol = m.symbol
        WHERE p.user_id = $1
          AND (
            p.status = 'open'
            OR m.status NOT IN ('resolved', 'price_error', 'superseded')
            OR p.id IN (SELECT id FROM recent_positions)
          )
        ORDER BY
          CASE
            WHEN p.status = 'open' AND m.status = 'open' THEN 0
            WHEN m.status NOT IN ('resolved', 'price_error', 'superseded') THEN 1
            ELSE 2
          END,
          p.updated_at DESC
        LIMIT 120
      `,
      [user.id],
    ),
    query(
      `
        SELECT *
        FROM trades
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [user.id],
    ),
    getUserMarketStats(user.id),
    getUserDailyTaskStatus(user.id),
    query(
      `
        SELECT *
        FROM usdt_loss_refund_offers
        WHERE user_id = $1
          AND status = 'pending'
          AND day_key = $2
        ORDER BY created_at DESC
        LIMIT 3
      `,
      [user.id, getDayKey()],
    ),
  ]);
  const usdtTotalBalance = Math.round((usdtCashBalance + usdtBonusBalance) * 100) / 100;

  return {
    user,
    balance,
    usdt_balance: usdtTotalBalance,
    usdt_cash_balance: usdtCashBalance,
    usdt_bonus_balance: usdtBonusBalance,
    positions: positionsResult.rows.map(mapPosition),
    recent_trades: tradesResult.rows.map(mapTrade),
    market_stats: marketStats,
    daily_tasks: dailyTasks,
    loss_refund_offers: lossRefundOffersResult.rows.map((row) => ({
      id: Number(row.id),
      position_id: Number(row.position_id),
      market_id: Number(row.market_id),
      offer_type: row.offer_type,
      amount: toNumber(row.amount),
      status: row.status,
      created_at: row.created_at,
    })),
  };
}

export async function addFireToUser(input) {
  const amount = ensurePositiveAmount(input.amount);
  const reason = input.reason || "admin_adjustment";
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const result = await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE fire_balances
        SET balance = balance + $2,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, amount],
    );
    await client.query(
      `
        INSERT INTO fire_ledger (user_id, amount, reason, source)
        VALUES ($1, $2, $3, $4)
      `,
      [user.id, amount, reason, input.source || "api"],
    );
    const balanceResult = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [user.id],
    );
    return toNumber(balanceResult.rows[0]?.balance);
  });

  return {
    user,
    balance: result,
  };
}

export async function addUsdtToUser(input) {
  const amount = ensurePositiveAmount(input.amount);
  const reason = input.reason || "admin_usdt_adjustment";
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const result = await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE usdt_balances
        SET balance = balance + $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, amount],
    );
    await client.query(
      `
        INSERT INTO usdt_ledger (user_id, amount, reason, source)
        VALUES ($1, $2::numeric, $3, $4)
      `,
      [user.id, amount, reason, input.source || "api"],
    );
    const balanceResult = await client.query(
      "SELECT balance FROM usdt_balances WHERE user_id = $1",
      [user.id],
    );
    return toNumber(balanceResult.rows[0]?.balance);
  });

  return {
    user,
    balance: result,
    usdt_balance: result,
  };
}

export async function syncFireBalance(input) {
  const balance = ensureNonNegativeAmount(input.amount ?? input.balance);
  const reason = input.reason || "admin_adjustment";
  const source = input.source || "bridge_sync";
  const allowDecrease = input.allow_decrease === true || input.allowDecrease === true;
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  const result = await withTransaction(async (client) => {
    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
        FOR UPDATE
      `,
      [user.id],
    );
    const previousBalance = toNumber(balanceResult.rows[0]?.balance);
    const nextBalance = !allowDecrease && source === "bridge_sync" && balance < previousBalance
      ? previousBalance
      : balance;
    const delta = Math.round((nextBalance - previousBalance) * 100) / 100;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = $2,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, nextBalance],
    );

    if (Math.abs(delta) >= 0.01) {
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1, $2, $3, $4)
        `,
        [user.id, delta, reason, source],
      );
    }

    return {
      balance: nextBalance,
      previous_balance: previousBalance,
      delta,
      ignored_decrease: nextBalance === previousBalance && balance < previousBalance,
    };
  });

  return {
    user,
    ...result,
  };
}

export async function syncFireBalanceByUsername(input) {
  const username = String(input.username || "").trim().replace(/^@/, "");
  if (!username) {
    throw new Error("username_required");
  }
  const balance = ensureNonNegativeAmount(input.amount ?? input.balance);
  const reason = input.reason || "admin_adjustment";
  const source = input.source || "bridge_sync";
  const allowDecrease = input.allow_decrease === true || input.allowDecrease === true;

  return withTransaction(async (client) => {
    const userResult = await client.query(
      `
        SELECT *
        FROM users
        WHERE lower(username) = lower($1)
        ORDER BY updated_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [username],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error("user_not_found");
    }

    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1
        FOR UPDATE
      `,
      [user.id],
    );
    const previousBalance = toNumber(balanceResult.rows[0]?.balance);
    const nextBalance = !allowDecrease && source === "bridge_sync_username" && balance < previousBalance
      ? previousBalance
      : balance;
    const delta = Math.round((nextBalance - previousBalance) * 100) / 100;

    await client.query(
      `
        UPDATE fire_balances
        SET balance = $2::numeric,
            updated_at = now()
        WHERE user_id = $1
      `,
      [user.id, nextBalance],
    );

    if (Math.abs(delta) >= 0.01) {
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1, $2::numeric, $3, $4)
        `,
        [user.id, delta, reason, source],
      );
    }

    return {
      user: mapUser(user),
      balance: nextBalance,
      previous_balance: previousBalance,
      delta,
      ignored_decrease: nextBalance === previousBalance && balance < previousBalance,
    };
  });
}

export async function resetUserMarketStateByUsername(input) {
  const username = String(input.username || "").trim().replace(/^@/, "");
  const telegramId = String(input.telegram_id || input.telegramId || "").trim();
  if (!username && !telegramId) {
    throw new Error("username_required");
  }
  const balance = ensureNonNegativeAmount(input.amount ?? input.balance);
  const reason = input.reason || "bug_bounty_reset";
  const source = input.source || "bridge_user_reset";

  return withTransaction(async (client) => {
    const userLookupParams = telegramId && username
      ? [telegramId, username]
      : [telegramId || username];
    const userLookupSql = telegramId && username
      ? `
        SELECT *
        FROM users
        WHERE telegram_id = $1::text
           OR lower(username) = lower($2::text)
        ORDER BY CASE WHEN telegram_id = $1::text THEN 0 ELSE 1 END,
                 updated_at DESC
        LIMIT 1
        FOR UPDATE
      `
      : telegramId
        ? `
          SELECT *
          FROM users
          WHERE telegram_id = $1::text
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE
        `
        : `
          SELECT *
          FROM users
          WHERE lower(username) = lower($1::text)
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE
        `;
    const userResult = await client.query(
      userLookupSql,
      userLookupParams,
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error("user_not_found");
    }

    const balanceResult = await client.query(
      `
        SELECT balance
        FROM fire_balances
        WHERE user_id = $1::bigint
        FOR UPDATE
      `,
      [user.id],
    );
    const previousBalance = toNumber(balanceResult.rows[0]?.balance);
    const delta = Math.round((balance - previousBalance) * 100) / 100;

    const touchedMarketResult = await client.query(
      `
        SELECT DISTINCT market_id
        FROM (
          SELECT market_id FROM positions WHERE user_id = $1::bigint
          UNION
          SELECT market_id FROM trades WHERE user_id = $1::bigint
        ) touched
      `,
      [user.id],
    );
    const touchedMarketIds = touchedMarketResult.rows
      .map((row) => Number(row.market_id))
      .filter(Number.isSafeInteger);

    const deletedTrades = await client.query(
      `
        DELETE FROM trades
        WHERE user_id = $1::bigint
      `,
      [user.id],
    );
    const deletedPositions = await client.query(
      `
        DELETE FROM positions
        WHERE user_id = $1::bigint
      `,
      [user.id],
    );

    if (touchedMarketIds.length) {
      await client.query(
        `
          WITH rebuilt AS (
            SELECT
              market_id,
              SUM(CASE WHEN side = 'YES' AND status = 'open' THEN spent ELSE 0 END) AS yes_volume,
              SUM(CASE WHEN side = 'NO' AND status = 'open' THEN spent ELSE 0 END) AS no_volume
            FROM positions
            WHERE market_id = ANY($1::bigint[])
            GROUP BY market_id
          )
          UPDATE markets
          SET yes_volume = COALESCE(rebuilt.yes_volume, 0),
              no_volume = COALESCE(rebuilt.no_volume, 0)
          FROM rebuilt
          WHERE markets.id = rebuilt.market_id
            AND markets.status = 'open'
        `,
        [touchedMarketIds],
      );
      await client.query(
        `
          UPDATE markets
          SET yes_volume = 0,
              no_volume = 0
          WHERE id = ANY($1::bigint[])
            AND status = 'open'
            AND NOT EXISTS (
              SELECT 1
              FROM positions
              WHERE positions.market_id = markets.id
                AND positions.status = 'open'
            )
        `,
        [touchedMarketIds],
      );
    }

    await client.query(
      `
        UPDATE fire_balances
        SET balance = $2::numeric,
            updated_at = now()
        WHERE user_id = $1::bigint
      `,
      [user.id, balance],
    );

    if (Math.abs(delta) >= 0.01) {
      await client.query(
        `
          INSERT INTO fire_ledger (user_id, amount, reason, source)
          VALUES ($1::bigint, $2::numeric, $3::text, $4::text)
        `,
        [user.id, delta, reason, source],
      );
    }

    return {
      user: mapUser(user),
      balance,
      previous_balance: previousBalance,
      delta,
      deleted_positions: deletedPositions.rowCount ?? 0,
      deleted_trades: deletedTrades.rowCount ?? 0,
      touched_markets: touchedMarketIds.length,
    };
  });
}

export async function claimShareTask(input) {
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });
  const taskKey = "share_friend";
  const dayKey = getDayKey();
  const amount = Math.round(Number(config.taskShareFire || 0));

  return withTransaction(async (client) => {
    const claimResult = await client.query(
      `
        INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
        VALUES ($1, $2, $3, $4, 'mini_app')
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [user.id, taskKey, amount, dayKey],
    );

    let bonus = {
      awarded: 0,
      daily_remaining: await getDailyBonusRemaining(client, user.id),
      cap_reached: false,
    };
    if (claimResult.rows[0] && amount > 0) {
      bonus = await awardBonusWithDailyCap(
        client,
        user.id,
        amount,
        getTaskReason(taskKey),
        `task:${taskKey}:${dayKey}`,
      );
      await awardClanPoints(client, user.id, null, getClanTaskPoints(taskKey), `task:${taskKey}:${dayKey}`, "STAR");
    }

    const balanceResult = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [user.id],
    );

    return {
      ok: true,
      user,
      task_key: taskKey,
      already_claimed: !claimResult.rows[0],
      ...bonus,
      balance: toNumber(balanceResult.rows[0]?.balance),
    };
  });
}

export async function completeVerifiedTask(input) {
  const taskKey = String(input.task_key || input.taskKey || "").trim();
  const allowedTasks = new Set(["av_channel", "av_chat", "private_chat"]);
  if (!allowedTasks.has(taskKey)) {
    throw new Error("invalid_task");
  }

  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });
  const defaultAmount = taskKey === "private_chat"
    ? config.taskPrivateChatFire
    : config.taskSubscribeFire;
  const amount = Math.round(Number(input.amount ?? defaultAmount ?? 0));
  const dayKey = "once";

  return withTransaction(async (client) => {
    const claimResult = await client.query(
      `
        INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [user.id, taskKey, amount, dayKey, input.source || "bridge_task"],
    );

    let bonus = {
      awarded: 0,
      daily_remaining: await getDailyBonusRemaining(client, user.id),
      cap_reached: false,
    };
    if (claimResult.rows[0] && amount > 0) {
      if (taskKey === "private_chat") {
        await adjustBalance(
          client,
          user.id,
          amount,
          getTaskReason(taskKey),
          `task:${taskKey}`,
        );
        bonus = {
          awarded: amount,
          daily_remaining: await getDailyBonusRemaining(client, user.id),
          cap_reached: false,
        };
      } else {
        bonus = await awardBonusWithDailyCap(
          client,
          user.id,
          amount,
          getTaskReason(taskKey),
          `task:${taskKey}`,
        );
      }
      await awardClanPoints(client, user.id, null, getClanTaskPoints(taskKey), `verified_task:${taskKey}`, "STAR");
    }

    const balanceResult = await client.query(
      "SELECT balance FROM fire_balances WHERE user_id = $1",
      [user.id],
    );

    return {
      ok: true,
      user,
      task_key: taskKey,
      already_claimed: !claimResult.rows[0],
      ...bonus,
      balance: toNumber(balanceResult.rows[0]?.balance),
    };
  });
}

async function claimDailyTaskForUser(client, user, taskKey) {
  const normalizedTaskKey = String(taskKey || "").trim();
  const taskAmounts = {
    daily_presence: Math.round(Number(config.taskDailyPresenceFire || 0)),
    daily_bet: Math.round(Number(config.taskDailyBetFire || 0)),
    daily_btc_prediction: 50,
    daily_football_prediction: 50,
    daily_btc_5_predictions: 300,
    daily_win_1: 50,
    daily_win_streak_5: 300,
  };
  const amount = taskAmounts[normalizedTaskKey];
  if (!amount) {
    throw new Error("invalid_task");
  }

  const isReady = await isDailyTaskReady(client, user.id, normalizedTaskKey);
  if (!isReady) {
    throw new Error("task_not_ready");
  }

  const dayKey = getDayKey();
  const claimResult = await client.query(
    `
      INSERT INTO fire_task_claims (user_id, task_key, amount, day_key, source)
      VALUES ($1, $2, $3, $4, 'mini_app')
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [user.id, normalizedTaskKey, amount, dayKey],
  );

  let bonus = {
    awarded: 0,
    daily_remaining: await getDailyBonusRemaining(client, user.id),
    cap_reached: false,
  };
  if (claimResult.rows[0] && amount > 0) {
    bonus = await awardBonusWithDailyCap(
      client,
      user.id,
      amount,
      getTaskReason(normalizedTaskKey),
      `task:${normalizedTaskKey}:${dayKey}`,
    );
    await awardClanPoints(
      client,
      user.id,
      null,
      getClanTaskPoints(normalizedTaskKey),
      `daily_task:${normalizedTaskKey}:${dayKey}`,
      "STAR",
    );
  }

  const balanceResult = await client.query(
    "SELECT balance FROM fire_balances WHERE user_id = $1",
    [user.id],
  );

  return {
    ok: true,
    user,
    task_key: normalizedTaskKey,
    already_claimed: !claimResult.rows[0],
    ...bonus,
    balance: toNumber(balanceResult.rows[0]?.balance),
  };
}

async function isDailyTaskReady(client, userId, taskKey) {
  if (taskKey === "daily_presence") {
    return true;
  }

  if (taskKey === "daily_bet") {
    const result = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM trades
        WHERE user_id = $1
          AND action = 'BUY'
          AND created_at >= date_trunc('day', now())
      `,
      [userId],
    );
    return Number(result.rows[0]?.count || 0) >= 1;
  }

  if (taskKey === "daily_btc_prediction" || taskKey === "daily_btc_5_predictions") {
    const result = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM trades
        JOIN markets ON markets.id = trades.market_id
        WHERE trades.user_id = $1
          AND trades.action = 'BUY'
          AND markets.symbol = ANY($2)
          AND trades.created_at >= date_trunc('day', now())
      `,
      [userId, BTC_MARKET_SYMBOLS],
    );
    return Number(result.rows[0]?.count || 0) >= (taskKey === "daily_btc_5_predictions" ? 5 : 1);
  }

  if (taskKey === "daily_football_prediction") {
    const result = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM trades
        JOIN markets ON markets.id = trades.market_id
        WHERE trades.user_id = $1
          AND trades.action = 'BUY'
          AND markets.symbol LIKE $2
          AND trades.created_at >= date_trunc('day', now())
      `,
      [userId, `${WORLD_CUP_SYMBOL_PREFIX}%`],
    );
    return Number(result.rows[0]?.count || 0) >= 1;
  }

  if (taskKey === "daily_win_1") {
    const result = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM positions
        WHERE user_id = $1
          AND status = 'resolved'
          AND pnl > 0
          AND updated_at >= date_trunc('day', now())
      `,
      [userId],
    );
    return Number(result.rows[0]?.count || 0) >= 1;
  }

  if (taskKey === "daily_win_streak_5") {
    const streakResult = await client.query(
      `
        SELECT
          p.market_id,
          MAX(CASE WHEN p.pnl > 0 THEN 1 ELSE 0 END) AS won,
          MAX(m.resolved_at) AS resolved_at
        FROM positions p
        JOIN markets m ON m.id = p.market_id
        WHERE p.user_id = $1
          AND p.status = 'resolved'
          AND m.status = 'resolved'
        GROUP BY p.market_id
        ORDER BY MAX(m.resolved_at) DESC
        LIMIT 5
      `,
      [userId],
    );
    return streakResult.rows.length >= 5
      && streakResult.rows.every((row) => Number(row.won || 0) > 0);
  }

  return false;
}

async function getUserDailyTaskStatus(userId) {
  const dayKey = getDayKey();
  const claimsResult = await query(
    `
      SELECT task_key
      FROM fire_task_claims
      WHERE user_id = $1
        AND day_key = $2
        AND task_key = ANY($3::text[])
    `,
    [userId, dayKey, DAILY_TASK_KEYS],
  );
  const claimedTasks = new Set(claimsResult.rows.map((row) => row.task_key));
  const queryClient = { query };
  const entries = await Promise.all(DAILY_TASK_KEYS.map(async (taskKey) => {
    let ready = false;
    try {
      ready = await isDailyTaskReady(queryClient, userId, taskKey);
    } catch {
      ready = false;
    }
    return [taskKey, {
      ready,
      claimed: claimedTasks.has(taskKey),
    }];
  }));

  return Object.fromEntries(entries);
}

export async function claimDailyTask(input) {
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  return withTransaction(async (client) => claimDailyTaskForUser(client, user, input.task_key ?? input.taskKey));
}

function mapClan(row) {
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    channel_url: row.channel_url,
    channel_avatar_url: getClanChannelAvatarUrl(row.channel_url),
    icon_key: normalizeClanIconKey(row.icon_key),
    kind: row.kind,
    members_count: Number(row.members_count || 0),
    score: toNumber(row.score),
    user_is_member: Boolean(row.user_is_member),
    user_contribution_score: toNumber(row.user_contribution_score),
    rank: Number(row.rank || 0),
  };
}

function getMonthEndIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
}

// Live "bank" that clans fight for this month: 1% of profit fees accrued so far.
async function getClanWarSummary(client) {
  const monthKey = getMonthKey();
  const result = await client.query(
    `
      SELECT currency, COALESCE(SUM(amount), 0) AS amount
      FROM clan_reward_fund_ledger
      WHERE month_key = $1
      GROUP BY currency
    `,
    [monthKey],
  );
  let bankUsdt = 0;
  let bankFire = 0;
  for (const row of result.rows) {
    if (normalizeCurrency(row.currency) === "USDT") {
      bankUsdt += toNumber(row.amount);
    } else {
      bankFire += toNumber(row.amount);
    }
  }
  return {
    month_key: monthKey,
    bank_usdt: Math.round(bankUsdt * 100) / 100,
    bank_fire: Math.round(bankFire),
    ends_at: getMonthEndIso(),
    max_members: CLAN_REWARD_MAX_MEMBERS,
  };
}

async function getClansWithClient(client, userId = 0) {
  await ensureDefaultClans(client);
  const result = await client.query(
      `
        WITH scores AS (
          SELECT clan_id, COALESCE(SUM(points), 0) AS score
          FROM clan_score_events
          GROUP BY clan_id
        ),
        members AS (
          SELECT clan_id, COUNT(*)::int AS members_count
          FROM clan_members
          GROUP BY clan_id
        ),
        user_membership AS (
          SELECT clan_id, contribution_score
          FROM clan_members
          WHERE user_id = $1
        ),
        clan_totals AS (
          SELECT
            clans.*,
            COALESCE(scores.score, 0) AS score,
            COALESCE(members.members_count, 0) AS members_count,
            CASE WHEN user_membership.clan_id IS NULL THEN 0 ELSE 1 END AS user_is_member,
            COALESCE(user_membership.contribution_score, 0) AS user_contribution_score
          FROM clans
          LEFT JOIN scores ON scores.clan_id = clans.id
          LEFT JOIN members ON members.clan_id = clans.id
          LEFT JOIN user_membership ON user_membership.clan_id = clans.id
        )
        SELECT
          *,
          RANK() OVER (ORDER BY score DESC, members_count DESC, id ASC)::int AS rank
        FROM clan_totals
        ORDER BY score DESC, members_count DESC, id ASC
        LIMIT 50
      `,
    [userId || 0],
  );

  const clans = result.rows.map(mapClan);
  if (clans.length) {
    const membersResult = await client.query(
      `
        SELECT
          clan_members.clan_id,
          clan_members.contribution_score,
          clan_members.role,
          clan_members.joined_at,
          users.telegram_id,
          users.username,
          users.first_name,
          ROW_NUMBER() OVER (
            PARTITION BY clan_members.clan_id
            ORDER BY clan_members.contribution_score DESC, clan_members.joined_at ASC
          ) AS rank
        FROM clan_members
        JOIN users ON users.id = clan_members.user_id
        WHERE clan_members.clan_id = ANY($1)
        ORDER BY clan_members.clan_id, clan_members.contribution_score DESC, clan_members.joined_at ASC
      `,
      [clans.map((clan) => clan.id)],
    );

    const membersByClan = new Map();
    for (const row of membersResult.rows) {
      const clanId = Number(row.clan_id);
      if (!membersByClan.has(clanId)) {
        membersByClan.set(clanId, []);
      }
      membersByClan.get(clanId).push({
        telegram_id: row.telegram_id,
        username: row.username,
        first_name: row.first_name,
        avatar_url: getTelegramUserAvatarUrl(row.username),
        role: row.role,
        contribution_score: toNumber(row.contribution_score),
        rank: Number(row.rank || 0),
        joined_at: row.joined_at,
      });
    }

    for (const clan of clans) {
      clan.members = membersByClan.get(clan.id) || [];
    }
  }

  const clanWar = await getClanWarSummary(client);

  return {
    ok: true,
    clans,
    user_clan: clans.find((clan) => clan.user_is_member) || null,
    clan_war: clanWar,
    rules: {
      join_points: 5,
      win_points: 3,
      loss_points: -1,
      daily_task_points: 2,
      daily_bet_points: 3,
      daily_hard_task_points: 8,
      streak_points: 12,
      share_points: 2,
      subscribe_points: 5,
      private_chat_points: 10,
      create_cost: 10000,
      weekly_prizes_usdt: [5000, 3000, 1000],
    },
  };
}

export async function getClans(input = {}) {
  const telegramId = String(input.telegram_id ?? "").trim();
  const user = telegramId ? await getUserByTelegramId(telegramId) : null;

  return withTransaction((client) => getClansWithClient(client, user?.id || 0));
}

export async function getBridgeClans() {
  return withTransaction((client) => getClansWithClient(client, 0));
}

export async function joinClan(input) {
  const clanId = Number(input.clan_id ?? input.clanId);
  const clanSlug = String(input.clan_slug ?? input.clanSlug ?? "").trim();
  const hasClanId = Number.isSafeInteger(clanId) && clanId > 0;
  if (!hasClanId && !clanSlug) {
    throw new Error("clan_not_found");
  }
  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  return withTransaction(async (client) => {
    await ensureDefaultClans(client);
    const clanResult = hasClanId
      ? await client.query("SELECT * FROM clans WHERE id = $1", [clanId])
      : await client.query("SELECT * FROM clans WHERE slug = $1", [clanSlug]);
    if (!clanResult.rows[0]) {
      throw new Error("clan_not_found");
    }
    const targetClanId = clanResult.rows[0].id;

    const existingResult = await client.query("SELECT * FROM clan_members WHERE user_id = $1", [user.id]);
    await client.query(
      `
        INSERT INTO clan_members (clan_id, user_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT (user_id) DO UPDATE SET
          clan_id = EXCLUDED.clan_id,
          role = 'member'
      `,
      [targetClanId, user.id],
    );

    if (!existingResult.rows[0]) {
      await awardClanPoints(client, user.id, null, 5, "member_join", null);
    }

    return getClansWithClient(client, user.id);
  });
}

export async function createClan(input) {
  const name = String(input.name || "").trim().slice(0, 28);
  const channelUrl = String(input.channel_url ?? input.channelUrl ?? "").trim().slice(0, 160) || null;
  const iconKey = normalizeClanIconKey(input.icon_key ?? input.iconKey);
  if (name.length < 3) {
    throw new Error("clan_name_required");
  }
  if (channelUrl && !/^https?:\/\/|^t\.me\/|^@/i.test(channelUrl)) {
    throw new Error("invalid_clan_channel");
  }

  const user = await upsertUser({
    telegram_id: input.telegram_id,
    username: input.username,
    first_name: input.first_name,
  });

  return withTransaction(async (client) => {
    await ensureDefaultClans(client);
    const duplicateResult = await client.query(
      "SELECT id FROM clans WHERE LOWER(name) = LOWER($1) LIMIT 1",
      [name],
    );
    if (duplicateResult.rows[0]) {
      throw new Error("clan_exists");
    }

    await debitCurrencyBalance(client, user.id, "STAR", 10000, "clan_create", "clan:create");
    const baseSlug = slugifyClanName(name);
    let slug = `${baseSlug}-${String(user.id).slice(-5)}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const existingSlug = await client.query("SELECT id FROM clans WHERE slug = $1 LIMIT 1", [slug]);
      if (!existingSlug.rows[0]) {
        break;
      }
      slug = `${baseSlug}-${String(user.id).slice(-5)}-${attempt + 2}`;
    }
    const clanResult = await client.query(
      `
        INSERT INTO clans (name, slug, owner_user_id, channel_url, icon_key, kind)
        VALUES ($1, $2, $3, $4, $5, 'custom')
        RETURNING *
      `,
      [name, slug, user.id, channelUrl, iconKey],
    );

    await client.query(
      `
        INSERT INTO clan_members (clan_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (user_id) DO UPDATE SET
          clan_id = EXCLUDED.clan_id,
          role = 'owner'
      `,
      [clanResult.rows[0].id, user.id],
    );
    await awardClanPoints(client, user.id, null, 5, "member_join", null);

    const balance = await getCurrencyBalanceSnapshot(client, user.id, "STAR");
    const clans = await getClansWithClient(client, user.id);
    const createdClan = mapClan({
      ...clanResult.rows[0],
      members_count: 1,
      score: 5,
      user_is_member: 1,
      user_contribution_score: 5,
      rank: 0,
    });
    if (!clans.clans.some((clan) => clan.id === createdClan.id)) {
      clans.clans.unshift({
        ...createdClan,
        members: [{
          telegram_id: user.telegram_id,
          username: user.username,
          first_name: user.first_name,
          role: "owner",
          contribution_score: 5,
          rank: 1,
          joined_at: new Date().toISOString(),
        }],
      });
    }
    clans.user_clan = clans.clans.find((clan) => clan.id === createdClan.id) || createdClan;
    return {
      ...clans,
      balance: balance.total,
      created_clan: createdClan,
    };
  });
}

export async function deleteClan(input) {
  const clanId = Number(input.clan_id ?? input.clanId);
  if (!Number.isSafeInteger(clanId) || clanId <= 0) {
    throw new Error("clan_not_found");
  }

  return withTransaction(async (client) => {
    await ensureDefaultClans(client);
    const clanResult = await client.query("SELECT * FROM clans WHERE id = $1", [clanId]);
    const clan = clanResult.rows[0];
    if (!clan) {
      throw new Error("clan_not_found");
    }
    if (String(clan.kind || "") === "default") {
      throw new Error("clan_default_locked");
    }

    await client.query("DELETE FROM clans WHERE id = $1", [clanId]);
    const clans = await getClansWithClient(client, 0);
    return {
      ...clans,
      deleted_clan: mapClan({
        ...clan,
        members_count: 0,
        score: 0,
        user_is_member: 0,
        user_contribution_score: 0,
        rank: 0,
      }),
    };
  });
}

export async function getFireLedgerEvents(input = {}) {
  const afterId = Math.max(0, Math.floor(Number(input.after_id ?? input.afterId ?? 0) || 0));
  const limit = Math.max(1, Math.min(250, Math.floor(Number(input.limit ?? 100) || 100)));
  const result = await query(
    `
      SELECT
        ledger.id,
        users.telegram_id,
        users.username,
        users.first_name,
        ledger.amount,
        ledger.reason,
        ledger.source,
        ledger.created_at
      FROM fire_ledger ledger
      JOIN users ON users.id = ledger.user_id
      WHERE ledger.id > $1
      ORDER BY ledger.id ASC
      LIMIT $2
    `,
    [afterId, limit],
  );

  return result.rows.map(mapFireLedgerEvent);
}

export async function getUsdtLedgerEvents(input = {}) {
  const limit = Math.max(1, Math.min(250, Math.floor(Number(input.limit ?? 100) || 100)));
  const rawAfterTs = input.after_ts ?? input.afterTs;
  const afterDate = rawAfterTs
    ? new Date(Number.isFinite(Number(rawAfterTs)) ? Number(rawAfterTs) : rawAfterTs)
    : new Date(0);
  const safeAfterDate = Number.isFinite(afterDate.getTime()) ? afterDate : new Date(0);
  const result = await query(
    `
      SELECT *
      FROM (
        SELECT
          ledger.id,
          'cash:' || ledger.id::text AS event_id,
          'cash' AS ledger_type,
          users.telegram_id,
          users.username,
          users.first_name,
          ledger.amount,
          ledger.reason,
          ledger.source,
          ledger.created_at
        FROM usdt_ledger ledger
        JOIN users ON users.id = ledger.user_id
        WHERE ledger.created_at > $1

        UNION ALL

        SELECT
          ledger.id,
          'bonus:' || ledger.id::text AS event_id,
          'bonus' AS ledger_type,
          users.telegram_id,
          users.username,
          users.first_name,
          ledger.amount,
          ledger.reason,
          ledger.source,
          ledger.created_at
        FROM usdt_bonus_ledger ledger
        JOIN users ON users.id = ledger.user_id
        WHERE ledger.created_at > $1
      ) ledger_events
      ORDER BY created_at ASC, event_id ASC
      LIMIT $2
    `,
    [safeAfterDate, limit],
  );

  return result.rows.map(mapUsdtLedgerEvent);
}

export async function createBtcMarket(definition = BTC_MARKET_DEFS[0], btcInput = null) {
  const existing = await getOpenMarket(definition.symbol);
  if (existing) {
    return existing;
  }

  const btc = btcInput || await getBtcPrice();
  const startTime = new Date();
  const durationMinutes = getBtcMarketDurationMinutes(definition);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

  const result = await query(
    `
      INSERT INTO markets (
        symbol,
        question,
        open_price,
        current_price,
        yes_price,
        no_price,
        yes_volume,
        no_volume,
        liquidity,
        start_time,
        end_time,
        status
      )
      VALUES ($1, $2, $3, $3, 0.5, 0.5, 0, 0, $4, $5, $6, 'open')
      RETURNING *
    `,
    [
      definition.symbol,
      questionForPrice(btc.price, definition),
      btc.price,
      config.marketLiquidity,
      startTime,
      endTime,
    ],
  );

  await persistPriceTick({ query }, definition.symbol, btc.price, btc.source);

  return mapMarket(result.rows[0]);
}

export async function createBtc5mMarket() {
  return createBtcMarket(BTC_MARKET_DEFS[0]);
}

export async function getOpenMarket(symbol = MARKET_SYMBOL) {
  const result = await query(
      `
        SELECT *
        FROM markets
        WHERE status = 'open'
          AND symbol = $1
        ORDER BY end_time ASC
        LIMIT 1
      `,
    [symbol],
  );

  return mapMarket(result.rows[0]);
}

export async function ensureActiveBtcMarkets() {
  await resolveExpiredMarkets();
  let btc = null;
  const markets = [];
  for (const definition of BTC_MARKET_DEFS) {
    const existing = await getOpenMarket(definition.symbol);
    if (existing) {
      markets.push(existing);
      continue;
    }
    try {
      btc = btc || await getBtcPrice();
      markets.push(await createBtcMarket(definition, btc));
    } catch (error) {
      if (error?.code === "23505") {
        const duplicateWinner = await getOpenMarket(definition.symbol);
        if (duplicateWinner) {
          markets.push(duplicateWinner);
          continue;
        }
      }
      throw error;
    }
  }

  return markets;
}

export async function ensureActiveMarket() {
  const markets = await ensureActiveBtcMarkets();
  return markets.find((market) => market.symbol === MARKET_SYMBOL) || markets[0] || null;
}

export async function updateLiveBtcPrice() {
  const btc = await getBtcPrice();
  await withTransaction(async (client) => {
    await persistPriceTick(client, btc.symbol, btc.price, btc.source);

    const markets = await client.query(
      `
        SELECT *
        FROM markets
        WHERE status = 'open'
          AND symbol = ANY($1)
      `,
      [BTC_MARKET_SYMBOLS],
    );

    for (const market of markets.rows) {
      const yesPrice = getMarketMakerYesPrice(market, btc.price);
      const noTargetPrice = roundOutcomePrice(1 - yesPrice, getMarketMinOutcomePrice(market));
      const noPrice = roundOutcomePrice(
        toNumber(market.no_price, noTargetPrice) * 0.32 + noTargetPrice * 0.68,
        getMarketMinOutcomePrice(market),
      );

      await client.query(
        `
          UPDATE markets
          SET current_price = $2,
              yes_price = $3,
              no_price = $4
          WHERE id = $1
        `,
        [market.id, btc.price, yesPrice, noPrice],
      );

      if (!isBtcMarketSymbol(market.symbol) && market.symbol !== btc.symbol) {
        await persistPriceTick(client, market.symbol, btc.price, btc.source);
      }
    }
  });

  return btc;
}

export async function getActiveMarket() {
  const market = await ensureActiveMarket();
  return market;
}

export async function getBtcMarkets() {
  await ensureActiveBtcMarkets();
  const result = await query(
    `
      SELECT *
      FROM markets
      WHERE status = 'open'
        AND symbol = ANY($1)
      ORDER BY array_position($1::text[], symbol)
    `,
    [BTC_MARKET_SYMBOLS],
  );

  const markets = result.rows.map(mapMarket);
  const charts = await Promise.all(markets.map((market) => getMarketChart(market, 260)));
  return markets.map((market, index) => ({
    ...market,
    chart: charts[index],
  }));
}

export async function getMarketActivity(marketId, limit = 20) {
  const result = await query(
    `
      SELECT
        trades.*,
        users.telegram_id,
        users.username,
        users.first_name
      FROM trades
      JOIN users ON users.id = trades.user_id
      WHERE trades.market_id = $1
      ORDER BY trades.created_at DESC
      LIMIT $2
    `,
    [Number(marketId), Math.max(1, Math.min(50, Number(limit) || 20))],
  );

  return result.rows.map(mapMarketActivity);
}

export async function getMarketComments(marketId, limit = 30) {
  const id = Number(marketId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("invalid_market_id");
  }

  const result = await query(
    `
      SELECT
        comments.*,
        users.telegram_id,
        users.username,
        users.first_name,
        latest_trade.action AS latest_bet_action,
        latest_trade.side AS latest_bet_side,
        latest_trade.amount AS latest_bet_amount,
        latest_trade.price AS latest_bet_price,
        latest_trade.shares AS latest_bet_shares,
        latest_trade.currency AS latest_bet_currency,
        latest_trade.created_at AS latest_bet_created_at,
        bet_summary.yes_amount AS yes_bet_amount,
        bet_summary.no_amount AS no_bet_amount,
        bet_summary.currency AS bet_summary_currency
      FROM market_comments comments
      JOIN users ON users.id = comments.user_id
      LEFT JOIN LATERAL (
        SELECT action, side, amount, price, shares, currency, created_at
        FROM trades
        WHERE trades.user_id = comments.user_id
          AND trades.market_id = comments.market_id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_trade ON true
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(CASE WHEN side = 'YES' AND action = 'BUY' THEN amount WHEN side = 'YES' AND action = 'SELL' THEN -amount ELSE 0 END), 0) AS yes_amount,
          COALESCE(SUM(CASE WHEN side = 'NO' AND action = 'BUY' THEN amount WHEN side = 'NO' AND action = 'SELL' THEN -amount ELSE 0 END), 0) AS no_amount,
          (ARRAY_AGG(currency ORDER BY created_at DESC))[1] AS currency
        FROM trades
        WHERE trades.user_id = comments.user_id
          AND trades.market_id = comments.market_id
      ) bet_summary ON true
      WHERE comments.market_id = $1
      ORDER BY comments.created_at DESC
      LIMIT $2
    `,
    [id, Math.max(1, Math.min(80, Number(limit) || 30))],
  );

  return result.rows.map(mapMarketComment);
}

export async function getMarketOnlineCount(marketId) {
  const id = Number(marketId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("invalid_market_id");
  }

  const result = await query(
    `
      SELECT COUNT(DISTINCT user_id)::int AS online_count
      FROM (
        SELECT user_id
        FROM market_comments
        WHERE market_id = $1
          AND created_at > now() - interval '15 minutes'

        UNION

        SELECT user_id
        FROM trades
        WHERE market_id = $1
          AND created_at > now() - interval '15 minutes'
      ) active_users
    `,
    [id],
  );

  return Number(result.rows[0]?.online_count || 0);
}

export async function getAppActivityStats() {
  const result = await query(
    `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM users
          WHERE updated_at > now() - interval '5 minutes'
        ) AS online_count,
        (
          SELECT COUNT(*)::int
          FROM trades
          WHERE action = 'BUY'
        ) AS total_bets
    `,
  );

  return {
    online_count: Number(result.rows[0]?.online_count || 0),
    total_bets: Number(result.rows[0]?.total_bets || 0),
  };
}

export async function addMarketComment(input) {
  const marketId = Number(input.marketId);
  const message = String(input.message || "").trim().slice(0, 240);
  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error("invalid_market_id");
  }
  if (!message) {
    throw new Error("comment_required");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  const result = await query(
    `
      WITH inserted AS (
        INSERT INTO market_comments (market_id, user_id, message)
        VALUES ($1, $2, $3)
        RETURNING *
      )
      SELECT
        inserted.*,
        users.telegram_id,
        users.username,
        users.first_name,
        latest_trade.action AS latest_bet_action,
        latest_trade.side AS latest_bet_side,
        latest_trade.amount AS latest_bet_amount,
        latest_trade.price AS latest_bet_price,
        latest_trade.shares AS latest_bet_shares,
        latest_trade.currency AS latest_bet_currency,
        latest_trade.created_at AS latest_bet_created_at
      FROM inserted
      JOIN users ON users.id = inserted.user_id
      LEFT JOIN LATERAL (
        SELECT action, side, amount, price, shares, currency, created_at
        FROM trades
        WHERE trades.user_id = inserted.user_id
          AND trades.market_id = inserted.market_id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_trade ON true
    `,
    [marketId, user.id, message],
  );

  return mapMarketComment(result.rows[0]);
}

export async function getRecentActivity(limit = 30) {
  const result = await query(
    `
      SELECT
        trades.*,
        users.telegram_id,
        users.username,
        users.first_name,
        markets.symbol AS market_symbol,
        markets.question AS market_question,
        markets.status AS market_status,
        markets.winner AS market_winner,
        meta.team AS team
      FROM trades
      JOIN users ON users.id = trades.user_id
      JOIN markets ON markets.id = trades.market_id
      LEFT JOIN world_cup_market_meta meta ON meta.symbol = markets.symbol
      ORDER BY trades.created_at DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(80, Number(limit) || 30))],
  );

  return result.rows.map(mapMarketActivity);
}

export async function getMarketChart(market, limit = 240) {
  if (!market) {
    return [];
  }
  const btcDefinition = getBtcMarketDef(market.symbol);
  const chartSymbol = btcDefinition ? MARKET_SYMBOL : market.symbol;
  const lookbackMs = btcDefinition
    ? Math.min(getBtcMarketDurationMinutes(btcDefinition) * 60_000, 7 * 24 * 60 * 60 * 1_000)
    : 0;
  const since = btcDefinition
    ? new Date(Date.now() - lookbackMs)
    : market.start_time;

  const result = await query(
    `
      SELECT price, source, created_at
      FROM (
        SELECT price, source, created_at
        FROM price_ticks
        WHERE symbol = $1
          AND created_at >= $2
        ORDER BY created_at DESC
        LIMIT $3
      ) recent_ticks
      ORDER BY created_at ASC
    `,
    [chartSymbol, since, Math.max(30, Math.min(600, Number(limit) || 240))],
  );

  return result.rows.map(mapMarketChartPoint);
}

async function performWorldCupSync() {
  const feed = await getWorldCupFeedMarkets();
  const endTime = new Date("2026-07-20T00:00:00Z");
  const now = new Date();

  await withTransaction(async (client) => {
    for (const feedMarket of feed.markets) {
      const symbol = worldCupSymbol(feedMarket);
      const yesPrice = clamp(feedMarket.yesPrice, MIN_PRICE, MAX_PRICE);
      const noPrice = 1 - yesPrice;
      const question = `Will ${feedMarket.team} win the 2026 FIFA World Cup?`;
      const liquidity = Math.max(1_000, toNumber(feedMarket.volume) || config.marketLiquidity);
      const existingResult = await client.query(
        `
          SELECT m.*
          FROM markets m
          LEFT JOIN world_cup_market_meta meta ON meta.symbol = m.symbol
          WHERE m.status = 'open'
            AND (
              m.symbol = $1
              OR LOWER(meta.team) = LOWER($2)
            )
          ORDER BY
            (COALESCE(m.yes_volume, 0) + COALESCE(m.no_volume, 0)) DESC,
            CASE WHEN m.symbol = $1 THEN 1 ELSE 0 END DESC,
            m.id DESC
          LIMIT 1
        `,
        [symbol, feedMarket.team],
      );
      const existingMarket = existingResult.rows[0];
      const marketResult = existingMarket
        ? await client.query(
          `
            UPDATE markets
            SET question = $2,
                current_price = $3,
                yes_price = (yes_price * 0.75 + $3::numeric * 0.25),
                no_price = (no_price * 0.75 + $4::numeric * 0.25),
                liquidity = $5,
                end_time = $6
            WHERE id = $1
            RETURNING *
          `,
          [existingMarket.id, question, yesPrice, noPrice, liquidity, endTime],
        )
        : await client.query(
          `
            INSERT INTO markets (
              symbol,
              question,
              open_price,
              current_price,
              yes_price,
              no_price,
              yes_volume,
              no_volume,
              liquidity,
              start_time,
              end_time,
              status
            )
            VALUES ($1, $2, $3, $3, $3, $4, 0, 0, $5, $6, $7, 'open')
            RETURNING *
          `,
          [symbol, question, yesPrice, noPrice, liquidity, now, endTime],
        );

      await client.query(
        `
          INSERT INTO world_cup_market_meta (
            symbol,
            polymarket_id,
            team,
            slug,
            icon,
            volume,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (symbol) DO UPDATE SET
            polymarket_id = EXCLUDED.polymarket_id,
            team = EXCLUDED.team,
            slug = EXCLUDED.slug,
            icon = EXCLUDED.icon,
            volume = EXCLUDED.volume,
            updated_at = now()
        `,
        [
          symbol,
          feedMarket.polymarketId,
          feedMarket.team,
          feedMarket.slug || "",
          feedMarket.icon || "",
          toNumber(feedMarket.volume),
        ],
      );

      const market = marketResult.rows[0];
      await persistPriceTick(client, symbol, toNumber(market.yes_price), feed.source);
    }
  });

  return feed.source;
}

export async function syncWorldCupMarkets({ force = false } = {}) {
  const now = Date.now();
  if (!force && worldCupLastSyncAt && now - worldCupLastSyncAt < WORLD_CUP_SYNC_INTERVAL_MS) {
    return worldCupLastSource;
  }

  if (!worldCupSyncPromise) {
    worldCupSyncPromise = performWorldCupSync()
      .then((source) => {
        worldCupLastSyncAt = Date.now();
        worldCupLastSource = source;
        return source;
      })
      .finally(() => {
        worldCupSyncPromise = null;
      });
  }

  return worldCupSyncPromise;
}

export async function getWorldCupMarkets() {
  const source = await syncWorldCupMarkets();
  const result = await query(
    `
      SELECT
        markets.*,
        meta.team,
        meta.polymarket_id,
        meta.slug,
        meta.icon,
        meta.volume AS meta_volume
      FROM markets
      JOIN world_cup_market_meta meta ON meta.symbol = markets.symbol
      WHERE markets.status = 'open'
        AND markets.symbol LIKE $1
      ORDER BY markets.yes_price DESC, meta.volume DESC
    `,
    [`${WORLD_CUP_SYMBOL_PREFIX}%`],
  );
  const rows = dedupeWorldCupRows(result.rows)
    .filter((row) => isActiveWorldCupTeam(row.team));
  const symbols = rows.map((row) => row.symbol);
  let chartBySymbol = new Map();
  if (symbols.length) {
    const chartResult = await query(
      `
        SELECT symbol, price, created_at
        FROM (
          SELECT
            symbol,
            price,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY created_at DESC) AS rn
          FROM price_ticks
          WHERE symbol = ANY($1)
        ) ranked_ticks
        WHERE rn <= 120
        ORDER BY symbol ASC, created_at ASC
      `,
      [symbols],
    );
    chartBySymbol = chartResult.rows.reduce((map, row) => {
      const current = map.get(row.symbol) || [];
      current.push({
        price: toNumber(row.price),
        created_at: row.created_at,
      });
      map.set(row.symbol, current);
      return map;
    }, new Map());
  }

  return {
    source,
    markets: rows.map((row) => mapWorldCupMarket({
      ...row,
      chart: chartBySymbol.get(row.symbol) || [],
    })),
  };
}

async function awardReferralBetBonus(client, buyerUser, marketId) {
  const bonusAmount = Math.round(Number(config.referralBetBonusFire || 0));
  const usdtBonusAmount = Math.round(Number(config.referralBetBonusUsdt || 0) * 100) / 100;
  const inviterTelegramId = String(buyerUser.referred_by_telegram_id || "").trim();
  if ((bonusAmount <= 0 && usdtBonusAmount <= 0) || !inviterTelegramId || inviterTelegramId === String(buyerUser.telegram_id)) {
    return null;
  }

  const inviterResult = await client.query(
    `
      SELECT *
      FROM users
      WHERE telegram_id = $1
      LIMIT 1
    `,
    [inviterTelegramId],
  );
  const inviter = inviterResult.rows[0];
  if (!inviter) {
    return null;
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const bonusResult = await client.query(
    `
      INSERT INTO fire_referral_bonuses (
        inviter_user_id,
        referred_user_id,
        market_id,
        amount,
        day_key
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [inviter.id, buyerUser.id, marketId, bonusAmount, dayKey],
  );
  if (!bonusResult.rows[0]) {
    return null;
  }

  const bonus = bonusAmount > 0
    ? await awardBonusWithDailyCap(
      client,
      inviter.id,
      bonusAmount,
      "referral_bet_bonus",
      `referral:${buyerUser.telegram_id}:market:${marketId}`,
    )
    : {
      awarded: 0,
      daily_remaining: await getDailyBonusRemaining(client, inviter.id),
      cap_reached: false,
    };

  let usdtBonus = null;
  if (usdtBonusAmount > 0) {
    const usdtBonusResult = await client.query(
      `
        INSERT INTO usdt_referral_bonuses (
          inviter_user_id,
          referred_user_id,
          market_id,
          amount
        )
        VALUES ($1, $2, $3, $4::numeric)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [inviter.id, buyerUser.id, marketId, usdtBonusAmount],
    );
    if (usdtBonusResult.rows[0]) {
      await adjustUsdtBonusBalance(
        client,
        inviter.id,
        usdtBonusAmount,
        "referral_bet_bonus_usdt",
        `referral:${buyerUser.telegram_id}:market:${marketId}`,
      );
      usdtBonus = {
        amount: usdtBonusAmount,
      };
    }
  }

  const lossRefund = await claimReferralLossRefundIfAny(client, inviter.id, buyerUser.id);

  return {
    inviter: mapUser(inviter),
    referred: mapUser(buyerUser),
    amount: bonus.awarded,
    usdt_bonus: usdtBonus,
    loss_refund: lossRefund,
    daily_remaining: bonus.daily_remaining,
    cap_reached: bonus.cap_reached,
    day_key: dayKey,
  };
}

function ensureLimitPrice(price, market) {
  const value = Number(price);
  const minPrice = getMarketMinOutcomePrice(market);
  if (!Number.isFinite(value) || value < minPrice || value > 1 - minPrice) {
    throw new Error("invalid_limit_price");
  }

  return roundOutcomePrice(value, minPrice);
}

function roundShares(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100_000_000) / 100_000_000);
}

async function refundLimitOrder(client, order, reason = "limit_order_cancel") {
  if (String(order.order_side || "BUY").toUpperCase() === "SELL") {
    const shares = roundShares(order.remaining_shares);
    const spent = roundMoney(order.remaining_spent);
    const bonusSpent = roundMoney(order.remaining_bonus_spent);
    if (shares > 0) {
      await client.query(
        `
          UPDATE positions
          SET shares = shares + $2::numeric,
              spent = spent + $3::numeric,
              bonus_spent = bonus_spent + $4::numeric,
              avg_price = CASE
                WHEN shares + $2::numeric > 0
                  THEN (spent + $3::numeric) / NULLIF(shares + $2::numeric, 0)
                ELSE 0::numeric
              END,
              status = 'open',
              updated_at = now()
          WHERE id = $1::bigint
            AND user_id = $5::bigint
        `,
        [order.position_id, shares, spent, bonusSpent, order.user_id],
      );
    }

    const result = await client.query(
      `
        UPDATE limit_orders
        SET status = 'cancelled',
            remaining_shares = 0,
            remaining_reserved = 0,
            remaining_spent = 0,
            remaining_bonus_spent = 0,
            updated_at = now(),
            cancelled_at = now()
        WHERE id = $1::bigint
        RETURNING *
      `,
      [order.id],
    );

    return mapLimitOrder(result.rows[0]);
  }

  const amount = roundMoney(order.remaining_reserved);
  const bonusReserved = toNumber(order.bonus_reserved);
  const reservedAmount = toNumber(order.reserved_amount);
  if (amount > 0) {
    await creditCurrencyBalance(
      client,
      order.user_id,
      order.currency,
      amount,
      `${reason}${balanceReasonSuffix(order.currency)}`,
      `limit_order:${order.id}`,
      getBonusRatioForAmount(bonusReserved, reservedAmount),
    );
  }

  const result = await client.query(
    `
      UPDATE limit_orders
      SET status = 'cancelled',
          remaining_shares = 0,
          remaining_reserved = 0,
          updated_at = now(),
          cancelled_at = now()
      WHERE id = $1::bigint
      RETURNING *
    `,
    [order.id],
  );

  return mapLimitOrder(result.rows[0]);
}

async function cancelOpenLimitOrdersForMarket(client, marketId, reason = "market_closed") {
  const orders = await client.query(
    `
      SELECT *
      FROM limit_orders
      WHERE market_id = $1::bigint
        AND status = 'open'
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `,
    [marketId],
  );

  const cancelled = [];
  for (const order of orders.rows) {
    cancelled.push(await refundLimitOrder(client, order, reason));
  }

  return cancelled;
}

export async function getMarketOrderBook(input) {
  const marketId = Number(input.marketId);
  const currency = normalizeCurrency(input.currency);
  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error("invalid_market_id");
  }

  const marketResult = await query("SELECT * FROM markets WHERE id = $1::bigint", [marketId]);
  const market = marketResult.rows[0];
  if (!market) {
    throw new Error("market_not_found");
  }

  const levelsResult = await query(
    `
      SELECT
        side,
        currency,
        order_side,
        limit_price,
        SUM(remaining_shares) AS shares,
        SUM(remaining_reserved) AS amount,
        COUNT(*) AS orders_count
      FROM limit_orders
      WHERE market_id = $1::bigint
        AND status = 'open'
        AND currency = $2::text
      GROUP BY side, currency, order_side, limit_price
      ORDER BY side ASC, order_side ASC, limit_price DESC
      LIMIT 80
    `,
    [marketId, currency],
  );

  let myOrders = [];
  const telegramId = String(input.telegram_id || "").trim();
  if (telegramId) {
    const user = await getUserByTelegramId(telegramId);
    if (user) {
      const myOrdersResult = await query(
        `
          SELECT *
          FROM limit_orders
          WHERE user_id = $1::bigint
            AND market_id = $2::bigint
            AND status = 'open'
          ORDER BY created_at DESC, id DESC
          LIMIT 20
        `,
        [user.id, marketId],
      );
      myOrders = myOrdersResult.rows.map(mapLimitOrder);
    }
  }

  return {
    ok: true,
    market_id: marketId,
    currency,
    market: mapMarket(market),
    levels: levelsResult.rows.map((row) => ({
      side: row.side,
      currency: normalizeCurrency(row.currency),
      price: toNumber(row.limit_price),
      shares: toNumber(row.shares),
      amount: toNumber(row.amount),
      orders_count: Number(row.orders_count || 0),
      order_side: String(row.order_side || "BUY").toUpperCase(),
    })),
    my_orders: myOrders,
  };
}

export async function createLimitOrder(input) {
  const marketId = Number(input.marketId);
  const side = String(input.side || "").toUpperCase();
  const orderSide = String(input.order_side || input.orderSide || "BUY").toUpperCase();
  const amount = ensurePositiveAmount(input.amount);
  const currency = normalizeCurrency(input.currency);
  const reasonSuffix = balanceReasonSuffix(currency);

  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error("invalid_market_id");
  }
  if (!["YES", "NO"].includes(side)) {
    throw new Error("invalid_side");
  }
  if (!["BUY", "SELL"].includes(orderSide)) {
    throw new Error("invalid_limit_order_side");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const marketResult = await client.query(
      `
        SELECT *
        FROM markets
        WHERE id = $1::bigint
        FOR UPDATE
      `,
      [marketId],
    );
    const market = marketResult.rows[0];
    if (!market || market.status !== "open") {
      throw new Error("market_not_open");
    }
    if (new Date(market.end_time).getTime() <= Date.now()) {
      throw new Error("market_closed");
    }

    const limitPrice = ensureLimitPrice(input.limit_price ?? input.price, market);
    const shares = roundShares(amount / limitPrice);
    if (shares <= 0) {
      throw new Error("invalid_limit_order");
    }

    if (orderSide === "SELL") {
      const positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE user_id = $1::bigint
            AND market_id = $2::bigint
            AND side = $3::text
            AND currency = $4::text
            AND status = 'open'
          FOR UPDATE
        `,
        [user.id, marketId, side, currency],
      );
      const position = positionResult.rows[0];
      if (!position) {
        throw new Error("position_not_open");
      }

      const positionShares = toNumber(position.shares);
      if (positionShares <= 0) {
        throw new Error("position_not_open");
      }
      if (shares > positionShares + 0.00000001) {
        throw new Error("insufficient_shares");
      }

      const reserveRatio = shares / positionShares;
      const reservedSpent = roundMoney(toNumber(position.spent) * reserveRatio);
      const reservedBonusSpent = roundMoney(toNumber(position.bonus_spent) * reserveRatio);
      const remainingShares = roundShares(positionShares - shares);
      const remainingSpent = roundMoney(toNumber(position.spent) - reservedSpent);
      const remainingBonusSpent = roundMoney(toNumber(position.bonus_spent) - reservedBonusSpent);
      const nextPositionStatus = remainingShares <= 0.00000001 ? "reserved" : "open";
      const positionUpdateResult = await client.query(
        `
          UPDATE positions
          SET shares = $2::numeric,
              spent = $3::numeric,
              bonus_spent = $4::numeric,
              avg_price = CASE
                WHEN $2::numeric > 0 THEN $3::numeric / NULLIF($2::numeric, 0)
                ELSE 0::numeric
              END,
              status = $5::text,
              updated_at = now()
          WHERE id = $1::bigint
          RETURNING *
        `,
        [position.id, remainingShares, remainingSpent, remainingBonusSpent, nextPositionStatus],
      );

      const orderResult = await client.query(
        `
          INSERT INTO limit_orders (
            user_id,
            market_id,
            position_id,
            side,
            order_side,
            currency,
            limit_price,
            shares,
            remaining_shares,
            reserved_amount,
            remaining_reserved,
            bonus_reserved,
            reserved_spent,
            remaining_spent,
            reserved_bonus_spent,
            remaining_bonus_spent,
            status
          )
          VALUES ($1::bigint, $2::bigint, $3::bigint, $4::text, 'SELL', $5::text, $6::numeric, $7::numeric, $7::numeric, $8::numeric, $8::numeric, 0, $9::numeric, $9::numeric, $10::numeric, $10::numeric, 'open')
          RETURNING *
        `,
        [
          user.id,
          marketId,
          position.id,
          side,
          currency,
          limitPrice,
          shares,
          roundMoney(shares * limitPrice),
          reservedSpent,
          reservedBonusSpent,
        ],
      );

      const finalBalance = await getCurrencyBalanceSnapshot(client, user.id, currency);

      return {
        ok: true,
        currency,
        balance: finalBalance.total,
        currency_balance: finalBalance.total,
        currency_cash_balance: finalBalance.cash,
        currency_bonus_balance: finalBalance.bonus,
        order: mapLimitOrder(orderResult.rows[0]),
        position: mapPosition(positionUpdateResult.rows[0]),
      };
    }

    const debit = await debitCurrencyBalance(
      client,
      user.id,
      currency,
      amount,
      `limit_buy_${side.toLowerCase()}${reasonSuffix}`,
      `market:${marketId}:limit_order`,
    );

    const orderResult = await client.query(
      `
        INSERT INTO limit_orders (
          user_id,
          market_id,
          position_id,
          side,
          order_side,
          currency,
          limit_price,
          shares,
          remaining_shares,
          reserved_amount,
          remaining_reserved,
          bonus_reserved,
          status
        )
        VALUES ($1::bigint, $2::bigint, NULL, $3::text, 'BUY', $4::text, $5::numeric, $6::numeric, $6::numeric, $7::numeric, $7::numeric, $8::numeric, 'open')
        RETURNING *
      `,
      [user.id, marketId, side, currency, limitPrice, shares, amount, debit.bonus_spent],
    );

    // Limit orders are passive. The internal market maker must not fill them;
    // execution will be added later through a user-to-user matcher.
    const finalBalance = await getCurrencyBalanceSnapshot(client, user.id, currency);

    return {
      ok: true,
      currency,
      balance: finalBalance.total,
      currency_balance: finalBalance.total,
      currency_cash_balance: finalBalance.cash,
      currency_bonus_balance: finalBalance.bonus,
      order: mapLimitOrder(orderResult.rows[0]),
    };
  });
}

export async function cancelLimitOrder(input) {
  const orderId = Number(input.orderId);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new Error("invalid_limit_order_id");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const orderResult = await client.query(
      `
        SELECT *
        FROM limit_orders
        WHERE id = $1::bigint
          AND user_id = $2::bigint
        FOR UPDATE
      `,
      [orderId, user.id],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw new Error("limit_order_not_found");
    }
    if (order.status !== "open") {
      throw new Error("limit_order_not_open");
    }

    const cancelled = await refundLimitOrder(client, order, "limit_order_cancel");
    const currency = normalizeCurrency(order.currency);
    const finalBalance = await getCurrencyBalanceSnapshot(client, user.id, currency);
    let restoredPosition = null;
    if (String(order.order_side || "BUY").toUpperCase() === "SELL" && order.position_id) {
      const positionResult = await client.query(
        "SELECT * FROM positions WHERE id = $1::bigint AND user_id = $2::bigint",
        [order.position_id, user.id],
      );
      restoredPosition = positionResult.rows[0] ? mapPosition(positionResult.rows[0]) : null;
    }

    return {
      ok: true,
      currency,
      balance: finalBalance.total,
      currency_balance: finalBalance.total,
      currency_cash_balance: finalBalance.cash,
      currency_bonus_balance: finalBalance.bonus,
      order: cancelled,
      position: restoredPosition,
    };
  });
}

export async function buyOutcome(input) {
  const marketId = Number(input.marketId);
  const side = String(input.side || "").toUpperCase();
  const amount = ensurePositiveAmount(input.amount);
  const currency = normalizeCurrency(input.currency);
  const reasonSuffix = balanceReasonSuffix(currency);

  if (!Number.isSafeInteger(marketId) || marketId <= 0) {
    throw new Error("invalid_market_id");
  }

  if (!["YES", "NO"].includes(side)) {
    throw new Error("invalid_side");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    const marketResult = await client.query(
      `
        SELECT *
        FROM markets
        WHERE id = $1
        FOR UPDATE
      `,
      [marketId],
    );
    const market = marketResult.rows[0];
    if (!market || market.status !== "open") {
      throw new Error("market_not_open");
    }

    if (new Date(market.end_time).getTime() <= Date.now()) {
      throw new Error("market_closed");
    }

    const marketMinPrice = getMarketMinOutcomePrice(market);
    const quote = getBuyExecutionQuote(market, side, amount);
    if (quote.executionPrice < marketMinPrice || quote.executionPrice > 1 - marketMinPrice) {
      throw new Error("invalid_market_price");
    }

    const fee = 0;
    const netAmount = Math.max(0, amount - fee);
    const shares = netAmount / quote.executionPrice;
    const nextYesPrice = quote.nextYesPrice;
    const nextNoPrice = quote.nextNoPrice;
    const debit = await debitCurrencyBalance(
      client,
      user.id,
      currency,
      amount,
      `${side === "YES" ? "buy_yes" : "buy_no"}${reasonSuffix}`,
      `market:${marketId}`,
    );

    await client.query(
      `
        UPDATE markets
        SET yes_price = $2::numeric,
            no_price = $3::numeric,
            yes_volume = yes_volume + $4::numeric,
            no_volume = no_volume + $5::numeric
        WHERE id = $1
      `,
      [
        marketId,
        nextYesPrice,
        nextNoPrice,
        side === "YES" ? netAmount : 0,
        side === "NO" ? netAmount : 0,
      ],
    );

    const positionResult = await client.query(
      `
        INSERT INTO positions (
          user_id,
          market_id,
          side,
          shares,
          spent,
          avg_price,
          bonus_spent,
          currency,
          status,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', now())
        ON CONFLICT (user_id, market_id, side, currency) DO UPDATE SET
          shares = positions.shares + EXCLUDED.shares,
          spent = positions.spent + EXCLUDED.spent,
          bonus_spent = positions.bonus_spent + EXCLUDED.bonus_spent,
          avg_price = (positions.spent + EXCLUDED.spent) / NULLIF(positions.shares + EXCLUDED.shares, 0),
          status = 'open',
          updated_at = now()
        RETURNING *
      `,
      [user.id, marketId, side, shares, amount, quote.executionPrice, debit.bonus_spent, currency],
    );

    const tradeResult = await client.query(
      `
        INSERT INTO trades (user_id, market_id, action, side, amount, fee, price, shares, currency)
        VALUES ($1, $2, 'BUY', $3, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8)
        RETURNING *
      `,
      [user.id, marketId, side, amount, fee, quote.executionPrice, shares, currency],
    );

    const referralBonus = await awardReferralBetBonus(client, user, marketId);

    const finalBalance = await getCurrencyBalanceSnapshot(client, user.id, currency);

    return {
      ok: true,
      currency,
      balance: finalBalance.total,
      currency_balance: finalBalance.total,
      currency_cash_balance: finalBalance.cash,
      currency_bonus_balance: finalBalance.bonus,
      position: mapPosition(positionResult.rows[0]),
      trade: mapTrade(tradeResult.rows[0]),
      referral_bonus: referralBonus,
      market: mapMarket({
        ...market,
        yes_price: nextYesPrice,
        no_price: nextNoPrice,
        yes_volume: toNumber(market.yes_volume) + (side === "YES" ? netAmount : 0),
        no_volume: toNumber(market.no_volume) + (side === "NO" ? netAmount : 0),
      }),
    };
  });
}

export async function sellOutcome(input) {
  const requestedMarketId = Number(input.marketId);
  const requestedSide = String(input.side || "").toUpperCase();
  const positionId = input.positionId === undefined || input.positionId === null
    ? null
    : Number(input.positionId);

  if (positionId === null && (!Number.isSafeInteger(requestedMarketId) || requestedMarketId <= 0)) {
    throw new Error("invalid_market_id");
  }

  if (positionId !== null && (!Number.isSafeInteger(positionId) || positionId <= 0)) {
    throw new Error("invalid_position_id");
  }

  if (positionId === null && !["YES", "NO"].includes(requestedSide)) {
    throw new Error("invalid_side");
  }

  const user = await getUserByTelegramId(input.telegram_id);
  if (!user) {
    throw new Error("user_not_found");
  }

  return withTransaction(async (client) => {
    let positionResult;
    if (positionId !== null) {
      positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE id = $1::bigint
            AND user_id = $2::bigint
            AND status = 'open'
          FOR UPDATE
        `,
        [positionId, user.id],
      );
    } else {
      positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE user_id = $1::bigint
            AND market_id = $2::bigint
            AND side = $3::text
            AND status = 'open'
          FOR UPDATE
        `,
        [user.id, requestedMarketId, requestedSide],
      );
    }
    if (!positionResult.rows[0] && positionId === null) {
      positionResult = await client.query(
        `
          SELECT p.*
          FROM positions p
          JOIN markets m ON m.id = p.market_id
          WHERE p.user_id = $1::bigint
            AND p.side = $2::text
            AND p.status = 'open'
            AND m.status = 'open'
            AND m.end_time > now()
          ORDER BY p.updated_at DESC, p.id DESC
          LIMIT 1
          FOR UPDATE OF p
        `,
        [user.id, requestedSide],
      );
    }
    if (
      !positionResult.rows[0]
      && positionId !== null
      && Number.isSafeInteger(requestedMarketId)
      && requestedMarketId > 0
      && ["YES", "NO"].includes(requestedSide)
    ) {
      positionResult = await client.query(
        `
          SELECT *
          FROM positions
          WHERE user_id = $1::bigint
            AND market_id = $2::bigint
            AND side = $3::text
            AND status = 'open'
          FOR UPDATE
        `,
        [user.id, requestedMarketId, requestedSide],
      );
    }
    const position = positionResult.rows[0];
    if (!position) {
      throw new Error("position_not_open");
    }

    const side = String(position.side || requestedSide).toUpperCase();
    const currency = normalizeCurrency(position.currency);
    const reasonSuffix = balanceReasonSuffix(currency);
    const marketId = Number(position.market_id);
    const marketResult = await client.query(
      `
        SELECT *
        FROM markets
        WHERE id = $1::bigint
        FOR UPDATE
      `,
      [marketId],
    );
    const market = marketResult.rows[0];
    if (!market || market.status !== "open") {
      throw new Error("market_not_open");
    }

    if (new Date(market.end_time).getTime() <= Date.now()) {
      throw new Error("market_closed");
    }

    const nowMs = Date.now();
    const endMs = new Date(market.end_time).getTime();
    if (Number(config.marketSellFreezeSeconds || 0) > 0 && endMs - nowMs <= config.marketSellFreezeSeconds * 1000) {
      throw new Error("sell_frozen");
    }

    const positionShares = toNumber(position.shares);
    if (positionShares <= 0) {
      throw new Error("position_not_open");
    }

    const requestedShares = input.shares === undefined || input.shares === null
      ? positionShares
      : Number(input.shares);
    if (!Number.isFinite(requestedShares) || requestedShares <= 0) {
      throw new Error("invalid_sell_shares");
    }
    if (requestedShares > positionShares + 0.00000001) {
      throw new Error("insufficient_shares");
    }

    const sharesToSell = Math.min(positionShares, requestedShares);
    const marketMinPrice = getMarketMinOutcomePrice(market);
    const quote = getSellExecutionQuote(market, side, sharesToSell);
    if (quote.executionPrice < marketMinPrice || quote.executionPrice > 1 - marketMinPrice) {
      throw new Error("invalid_market_price");
    }

    const gross = quote.gross;
    const soldRatio = sharesToSell / positionShares;
    const spentSold = toNumber(position.spent) * soldRatio;
    const bonusSpentSold = toNumber(position.bonus_spent) * soldRatio;
    const grossProfit = gross - spentSold;
    const economySettings = await getEconomySettingsWithClient(client);
    const fee = calculateProfitFeeFromSettings(grossProfit, economySettings);
    const proceeds = Math.max(0, Math.round((gross - fee) * 100) / 100);
    const realizedPnl = proceeds - spentSold;
    const remainingShares = Math.max(0, positionShares - sharesToSell);
    const remainingSpent = Math.max(0, toNumber(position.spent) - spentSold);
    const remainingBonusSpent = Math.max(0, toNumber(position.bonus_spent) - bonusSpentSold);
    const isFullExit = remainingShares <= 0.00000001;
    const bonusRatio = getBonusRatioForAmount(bonusSpentSold, spentSold);
    await creditCurrencyBalance(
      client,
      user.id,
      currency,
      proceeds,
      `${side === "YES" ? "sell_yes" : "sell_no"}${reasonSuffix}`,
      `market:${marketId}`,
      bonusRatio,
    );

    const tradeResult = await client.query(
      `
        INSERT INTO trades (user_id, market_id, action, side, amount, fee, price, shares, currency)
        VALUES ($1::bigint, $2::bigint, 'SELL', $3::text, $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::text)
        RETURNING *
      `,
      [user.id, marketId, side, proceeds, fee, quote.executionPrice, sharesToSell, currency],
    );
    await distributeProfitFee(client, {
      settings: economySettings,
      userId: user.id,
      marketId,
      positionId: position.id,
      tradeId: tradeResult.rows[0]?.id,
      currency,
      grossProfit,
      totalFee: fee,
      reason: "market_sell_profit_fee",
      source: `market:${marketId}:sell:${tradeResult.rows[0]?.id}`,
      eventKey: `trade:${tradeResult.rows[0]?.id}:profit_fee`,
    });

    const positionUpdateResult = await client.query(
      `
        WITH sale_input AS (
          SELECT
            $1::bigint AS position_id,
            $2::numeric AS remaining_shares,
            $3::numeric AS remaining_spent,
            $4::numeric AS remaining_bonus_spent,
            $5::numeric AS proceeds,
            $6::numeric AS realized_pnl,
            $7::text AS next_status
        )
        UPDATE positions
        SET shares = sale_input.remaining_shares,
            spent = sale_input.remaining_spent,
            bonus_spent = sale_input.remaining_bonus_spent,
            avg_price = CASE
              WHEN sale_input.remaining_shares > 0
                THEN sale_input.remaining_spent / sale_input.remaining_shares
              ELSE 0::numeric
            END,
            payout = positions.payout + sale_input.proceeds,
            pnl = positions.pnl + sale_input.realized_pnl,
            status = sale_input.next_status,
            updated_at = now()
        FROM sale_input
        WHERE positions.id = sale_input.position_id
        RETURNING positions.*
      `,
      [
        position.id,
        isFullExit ? 0 : remainingShares,
        isFullExit ? 0 : remainingSpent,
        isFullExit ? 0 : remainingBonusSpent,
        proceeds,
        realizedPnl,
        isFullExit ? "sold" : "open",
      ],
    );

    const nextYesPrice = quote.nextYesPrice;
    const nextNoPrice = quote.nextNoPrice;

    await client.query(
      `
        UPDATE markets
        SET yes_price = $2::numeric,
            no_price = $3::numeric,
            yes_volume = $4::numeric,
            no_volume = $5::numeric
        WHERE id = $1::bigint
      `,
      [
        marketId,
        nextYesPrice,
        nextNoPrice,
        quote.nextYesVolume,
        quote.nextNoVolume,
      ],
    );

    const finalBalance = await getCurrencyBalanceSnapshot(client, user.id, currency);

    return {
      ok: true,
      currency,
      balance: finalBalance.total,
      currency_balance: finalBalance.total,
      currency_cash_balance: finalBalance.cash,
      currency_bonus_balance: finalBalance.bonus,
      position: mapPosition(positionUpdateResult.rows[0]),
      trade: mapTrade(tradeResult.rows[0]),
      market: mapMarket({
        ...market,
        yes_price: nextYesPrice,
        no_price: nextNoPrice,
        yes_volume: quote.nextYesVolume,
        no_volume: quote.nextNoVolume,
      }),
      sale: {
        side,
        price: quote.executionPrice,
        shares: sharesToSell,
        gross,
        fee,
        proceeds,
        pnl: realizedPnl,
      },
    };
  });
}

async function refundMarket(client, market, message) {
  await cancelOpenLimitOrdersForMarket(client, market.id, "market_refund");

  const positions = await client.query(
    `
      SELECT *
      FROM positions
      WHERE market_id = $1
        AND status = 'open'
      FOR UPDATE
    `,
    [market.id],
  );

  for (const position of positions.rows) {
    const currency = normalizeCurrency(position.currency);
    const reasonSuffix = balanceReasonSuffix(currency);
    const refund = toNumber(position.spent);
    if (refund > 0) {
      await creditCurrencyBalance(
        client,
        position.user_id,
        currency,
        refund,
        `market_refund${reasonSuffix}`,
        `market:${market.id}:${message}`,
        getBonusRatioForAmount(position.bonus_spent, position.spent),
      );
    }
  }

  await client.query(
    `
      UPDATE positions
      SET payout = spent,
          pnl = 0,
          status = 'refunded',
          updated_at = now()
      WHERE market_id = $1
        AND status = 'open'
    `,
    [market.id],
  );
}

export async function resolveExpiredMarkets() {
  const expiredResult = await query(
    `
      SELECT *
      FROM markets
      WHERE status = 'open'
        AND symbol = ANY($1)
        AND end_time <= now()
      ORDER BY end_time ASC
      LIMIT 30
    `,
    [BTC_MARKET_SYMBOLS],
  );

  for (const market of expiredResult.rows) {
    let closePrice = null;
    try {
      closePrice = (await getBtcPrice()).price;
    } catch (error) {
      if (!(error instanceof PriceUnavailableError)) {
        throw error;
      }
    }

    await withTransaction(async (client) => {
      const currentResult = await client.query(
        `
          SELECT *
          FROM markets
          WHERE id = $1
          FOR UPDATE
        `,
        [market.id],
      );
      const currentMarket = currentResult.rows[0];
      if (!currentMarket || currentMarket.status !== "open") {
        return;
      }

      if (!closePrice) {
        await refundMarket(client, currentMarket, "price_error");
        await client.query(
          `
            UPDATE markets
            SET status = 'price_error',
                resolved_at = now()
            WHERE id = $1
          `,
          [currentMarket.id],
        );
        return;
      }

      await cancelOpenLimitOrdersForMarket(client, currentMarket.id, "market_closed");

      const winner = closePrice > toNumber(currentMarket.open_price) ? "YES" : "NO";
      await client.query(
        `
          UPDATE markets
          SET close_price = $2,
              current_price = $2,
              status = 'resolved',
              winner = $3,
              resolved_at = now()
          WHERE id = $1
        `,
        [currentMarket.id, closePrice, winner],
      );

      const positions = await client.query(
        `
          SELECT *
          FROM positions
          WHERE market_id = $1
            AND status = 'open'
          FOR UPDATE
        `,
        [currentMarket.id],
      );
      const economySettings = await getEconomySettingsWithClient(client);

      for (const position of positions.rows) {
        const currency = normalizeCurrency(position.currency);
        const reasonSuffix = balanceReasonSuffix(currency);
        const shares = toNumber(position.shares);
        const spent = toNumber(position.spent);
        const grossPayout = position.side === winner ? shares : 0;
        const grossProfit = grossPayout - spent;
        const fee = calculateProfitFeeFromSettings(grossProfit, economySettings);
        const payout = Math.max(0, Math.round((grossPayout - fee) * 100) / 100);
        const pnl = payout - spent;

        await client.query(
          `
            UPDATE positions
            SET payout = $2,
                pnl = $3,
                status = 'resolved',
                updated_at = now()
            WHERE id = $1
          `,
          [position.id, payout, pnl],
        );

        if (payout > 0) {
          await creditCurrencyBalance(
            client,
            position.user_id,
            currency,
            payout,
            `market_payout${reasonSuffix}`,
            `market:${currentMarket.id}`,
            getBonusRatioForAmount(position.bonus_spent, position.spent),
          );
        }

        if (fee > 0) {
          await distributeProfitFee(client, {
            settings: economySettings,
            userId: position.user_id,
            marketId: currentMarket.id,
            positionId: position.id,
            currency,
            grossProfit,
            totalFee: fee,
            reason: "market_settlement_profit_fee",
            source: `market:${currentMarket.id}:settlement`,
            eventKey: `position:${position.id}:settlement_profit_fee`,
          });
        }

        if (currency === "USDT" && pnl < 0) {
          await createUsdtLossRefundOffer(client, position, pnl);
        }

        if (currency === "USDT") {
          await awardClanPoints(
            client,
            position.user_id,
            currentMarket.id,
            position.side === winner ? 3 : -1,
            "market_result",
            currency,
          );
        }
      }
    });
  }

  let btcForCreation = null;
  for (const definition of BTC_MARKET_DEFS) {
    const currentOpen = await getOpenMarket(definition.symbol);
    if (currentOpen) {
      continue;
    }
    try {
      btcForCreation = btcForCreation || await getBtcPrice();
      await createBtcMarket(definition, btcForCreation);
    } catch (error) {
      if (!(error instanceof PriceUnavailableError) && error?.code !== "23505") {
        throw error;
      }
    }
  }
}

export async function getRecentMarkets(limit = 10) {
  const result = await query(
    `
      SELECT *
      FROM markets
      WHERE status IN ('resolved', 'price_error')
      ORDER BY COALESCE(resolved_at, end_time) DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(25, Number(limit) || 10))],
  );

  return result.rows.map(mapMarket);
}

function normalizeLeaderboardMode(modeInput) {
  const mode = String(modeInput || "BEST_24H").trim().toUpperCase();
  if (["BEST_24H", "WINS_24H", "BALANCE", "CLANS"].includes(mode)) {
    return mode;
  }
  return "BEST_24H";
}

function mapLeaderboardPlayer(row, currency, mode = "BALANCE") {
  const settledCount = Number(row.settled_count || 0);
  const winCount = Number(row.win_count || 0);
  return {
    telegram_id: row.telegram_id,
    username: row.username,
    first_name: row.first_name,
    currency,
    mode,
    balance: toNumber(row.balance),
    best_pnl_24h: toNumber(row.best_pnl_24h),
    total_pnl_24h: toNumber(row.total_pnl_24h),
    total_payout_24h: toNumber(row.total_payout_24h),
    wins_24h: Number(row.wins_24h || 0),
    bet_count: Number(row.bet_count || 0),
    settled_count: settledCount,
    win_count: winCount,
    win_rate_pct: settledCount > 0 ? Math.round((winCount / settledCount) * 1000) / 10 : 0,
    market_id: row.market_id === null || row.market_id === undefined ? null : Number(row.market_id),
    market_title: row.market_title || null,
    market_label: row.market_label || null,
    market_type: row.market_type || null,
    side: row.side || null,
    resolved_at: row.resolved_at || null,
  };
}

export async function getLeaderboard(options = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(options.limit) || 30));
  const currency = normalizeCurrency(options.currency);
  const mode = normalizeLeaderboardMode(options.mode);

  if (mode === "CLANS") {
    const result = await query(
      `
        WITH scores AS (
          SELECT clan_id, COALESCE(SUM(points), 0) AS score
          FROM clan_score_events
          GROUP BY clan_id
        ),
        members AS (
          SELECT clan_id, COUNT(*)::int AS members_count
          FROM clan_members
          GROUP BY clan_id
        ),
        clan_totals AS (
          SELECT
            clans.*,
            COALESCE(scores.score, 0) AS score,
            COALESCE(members.members_count, 0) AS members_count,
            0 AS user_is_member,
            0 AS user_contribution_score
          FROM clans
          LEFT JOIN scores ON scores.clan_id = clans.id
          LEFT JOIN members ON members.clan_id = clans.id
        )
        SELECT
          *,
          RANK() OVER (ORDER BY score DESC, members_count DESC, id ASC)::int AS rank
        FROM clan_totals
        ORDER BY score DESC, members_count DESC, id ASC
        LIMIT $1
      `,
      [safeLimit],
    );

    return {
      mode,
      currency,
      players: [],
      clans: result.rows.map(mapClan),
    };
  }

  if (mode === "BEST_24H") {
    const result = await query(
      `
        WITH ranked_positions AS (
          SELECT
            p.user_id,
            p.market_id,
            p.side,
            p.pnl,
            p.payout,
            p.spent,
            p.updated_at,
            CASE
              WHEN m.symbol = 'BTCUSDT' THEN 'BTC 5m'
              WHEN m.symbol LIKE 'BTCUSDT_%' THEN REPLACE(REPLACE(m.symbol, 'BTCUSDT_', 'BTC '), '_', ' ')
              WHEN m.symbol LIKE '${WORLD_CUP_SYMBOL_PREFIX}%' THEN 'World Cup'
              ELSE m.symbol
            END AS market_title,
            CASE
              WHEN m.symbol = 'BTCUSDT' THEN '5m'
              WHEN m.symbol LIKE 'BTCUSDT_%' THEN LOWER(REPLACE(m.symbol, 'BTCUSDT_', ''))
              WHEN m.symbol LIKE '${WORLD_CUP_SYMBOL_PREFIX}%' THEN 'football'
              ELSE m.symbol
            END AS market_label,
            CASE
              WHEN m.symbol LIKE '${WORLD_CUP_SYMBOL_PREFIX}%' THEN 'WORLD_CUP_WINNER'
              WHEN m.symbol LIKE 'BTCUSDT%' THEN 'BTC_UPDOWN'
              ELSE m.symbol
            END AS market_type,
            COALESCE(m.resolved_at, p.updated_at) AS resolved_at,
            ROW_NUMBER() OVER (
              PARTITION BY p.user_id
              ORDER BY p.pnl DESC, COALESCE(m.resolved_at, p.updated_at) DESC, p.id DESC
            ) AS row_rank
          FROM positions p
          JOIN markets m ON m.id = p.market_id
          WHERE p.currency = $2
            AND p.status = 'resolved'
            AND p.pnl > 0
            AND COALESCE(m.resolved_at, p.updated_at) >= now() - interval '24 hours'
        ),
        daily_totals AS (
          SELECT
            user_id,
            COUNT(*) AS wins_24h,
            SUM(pnl) AS total_pnl_24h,
            SUM(payout) AS total_payout_24h,
            MAX(pnl) AS best_pnl_24h
          FROM ranked_positions
          GROUP BY user_id
        ),
        trade_stats AS (
          SELECT user_id, COUNT(*) FILTER (WHERE action = 'BUY') AS bet_count
          FROM trades
          WHERE currency = $2
          GROUP BY user_id
        ),
        position_stats AS (
          SELECT
            user_id,
            COUNT(*) FILTER (WHERE status <> 'open') AS settled_count,
            COUNT(*) FILTER (WHERE status <> 'open' AND pnl > 0) AS win_count
          FROM positions
          WHERE currency = $2
          GROUP BY user_id
        )
        SELECT
          users.telegram_id,
          users.username,
          users.first_name,
          0 AS balance,
          daily_totals.best_pnl_24h,
          daily_totals.total_pnl_24h,
          daily_totals.total_payout_24h,
          daily_totals.wins_24h,
          COALESCE(trade_stats.bet_count, 0) AS bet_count,
          COALESCE(position_stats.settled_count, 0) AS settled_count,
          COALESCE(position_stats.win_count, 0) AS win_count,
          ranked_positions.market_id,
          ranked_positions.market_title,
          ranked_positions.market_label,
          ranked_positions.market_type,
          ranked_positions.side,
          ranked_positions.resolved_at
        FROM ranked_positions
        JOIN daily_totals ON daily_totals.user_id = ranked_positions.user_id
        JOIN users ON users.id = ranked_positions.user_id
        LEFT JOIN trade_stats ON trade_stats.user_id = users.id
        LEFT JOIN position_stats ON position_stats.user_id = users.id
        WHERE ranked_positions.row_rank = 1
        ORDER BY daily_totals.best_pnl_24h DESC, daily_totals.total_pnl_24h DESC, ranked_positions.resolved_at DESC
        LIMIT $1
      `,
      [safeLimit, currency],
    );

    return {
      mode,
      currency,
      players: result.rows.map((row) => mapLeaderboardPlayer(row, currency, mode)),
      clans: [],
    };
  }

  if (mode === "WINS_24H") {
    const result = await query(
      `
        WITH daily_positions AS (
          SELECT p.*
          FROM positions p
          JOIN markets m ON m.id = p.market_id
          WHERE p.currency = $2
            AND p.status = 'resolved'
            AND p.pnl > 0
            AND COALESCE(m.resolved_at, p.updated_at) >= now() - interval '24 hours'
        ),
        trade_stats AS (
          SELECT user_id, COUNT(*) FILTER (WHERE action = 'BUY') AS bet_count
          FROM trades
          WHERE currency = $2
          GROUP BY user_id
        ),
        position_stats AS (
          SELECT
            user_id,
            COUNT(*) FILTER (WHERE status <> 'open') AS settled_count,
            COUNT(*) FILTER (WHERE status <> 'open' AND pnl > 0) AS win_count
          FROM positions
          WHERE currency = $2
          GROUP BY user_id
        )
        SELECT
          users.telegram_id,
          users.username,
          users.first_name,
          0 AS balance,
          MAX(daily_positions.pnl) AS best_pnl_24h,
          SUM(daily_positions.pnl) AS total_pnl_24h,
          SUM(daily_positions.payout) AS total_payout_24h,
          COUNT(*) AS wins_24h,
          COALESCE(trade_stats.bet_count, 0) AS bet_count,
          COALESCE(position_stats.settled_count, 0) AS settled_count,
          COALESCE(position_stats.win_count, 0) AS win_count,
          NULL AS market_id,
          NULL AS market_title,
          NULL AS market_label,
          NULL AS market_type,
          NULL AS side,
          MAX(daily_positions.updated_at) AS resolved_at
        FROM daily_positions
        JOIN users ON users.id = daily_positions.user_id
        LEFT JOIN trade_stats ON trade_stats.user_id = users.id
        LEFT JOIN position_stats ON position_stats.user_id = users.id
        GROUP BY
          users.telegram_id,
          users.username,
          users.first_name,
          trade_stats.bet_count,
          position_stats.settled_count,
          position_stats.win_count
        ORDER BY SUM(daily_positions.pnl) DESC, COUNT(*) DESC, MAX(daily_positions.pnl) DESC
        LIMIT $1
      `,
      [safeLimit, currency],
    );

    return {
      mode,
      currency,
      players: result.rows.map((row) => mapLeaderboardPlayer(row, currency, mode)),
      clans: [],
    };
  }

  if (currency === "USDT") {
    const result = await query(
      `
        WITH trade_stats AS (
          SELECT
            user_id,
            COUNT(*) FILTER (WHERE action = 'BUY') AS bet_count
          FROM trades
          WHERE currency = $2
          GROUP BY user_id
        ),
        position_stats AS (
          SELECT
            user_id,
            COUNT(*) FILTER (WHERE status <> 'open') AS settled_count,
            COUNT(*) FILTER (WHERE status <> 'open' AND pnl > 0) AS win_count
          FROM positions
          WHERE currency = $2
          GROUP BY user_id
        )
        SELECT
          users.telegram_id,
          users.username,
          users.first_name,
          COALESCE(cash.balance, 0) + COALESCE(bonus.balance, 0) AS balance,
          COALESCE(trade_stats.bet_count, 0) AS bet_count,
          COALESCE(position_stats.settled_count, 0) AS settled_count,
          COALESCE(position_stats.win_count, 0) AS win_count
        FROM users
        LEFT JOIN usdt_balances cash ON cash.user_id = users.id
        LEFT JOIN usdt_bonus_balances bonus ON bonus.user_id = users.id
        LEFT JOIN trade_stats ON trade_stats.user_id = users.id
        LEFT JOIN position_stats ON position_stats.user_id = users.id
        ORDER BY (COALESCE(cash.balance, 0) + COALESCE(bonus.balance, 0)) DESC,
          COALESCE(trade_stats.bet_count, 0) DESC,
          users.updated_at DESC
        LIMIT $1
      `,
      [safeLimit, currency],
    );

    return {
      mode,
      currency,
      players: result.rows.map((row) => mapLeaderboardPlayer(row, currency, mode)),
      clans: [],
    };
  }

  const balanceTable = balanceTableForCurrency(currency);
  const result = await query(
    `
      WITH trade_stats AS (
        SELECT
          user_id,
          COUNT(*) FILTER (WHERE action = 'BUY') AS bet_count
        FROM trades
        WHERE currency = $2
        GROUP BY user_id
      ),
      position_stats AS (
        SELECT
          user_id,
          COUNT(*) FILTER (WHERE status <> 'open') AS settled_count,
          COUNT(*) FILTER (WHERE status <> 'open' AND pnl > 0) AS win_count
        FROM positions
        WHERE currency = $2
        GROUP BY user_id
      )
      SELECT
        users.telegram_id,
        users.username,
        users.first_name,
        balances.balance,
        COALESCE(trade_stats.bet_count, 0) AS bet_count,
        COALESCE(position_stats.settled_count, 0) AS settled_count,
        COALESCE(position_stats.win_count, 0) AS win_count
      FROM users
      JOIN ${balanceTable} balances ON balances.user_id = users.id
      LEFT JOIN trade_stats ON trade_stats.user_id = users.id
      LEFT JOIN position_stats ON position_stats.user_id = users.id
      ORDER BY balances.balance DESC, COALESCE(trade_stats.bet_count, 0) DESC, users.updated_at DESC
      LIMIT $1
    `,
    [safeLimit, currency],
  );

  return {
    mode,
    currency,
    players: result.rows.map((row) => mapLeaderboardPlayer(row, currency, mode)),
    clans: [],
  };
}

export async function getUserPositions(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  if (!user) {
    return [];
  }

  const result = await query(
    `
      SELECT p.*, m.question, m.winner
      FROM positions p
      JOIN markets m ON m.id = p.market_id
      WHERE p.user_id = $1
      ORDER BY p.updated_at DESC
    `,
    [user.id],
  );

  return result.rows.map(mapPosition);
}
