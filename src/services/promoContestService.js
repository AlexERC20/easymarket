import { query, toNumber, withTransaction } from "../db.js";

export const PROMO_USDT_HOLD_LEVELS = Object.freeze([
  { target: 100, points: 30 },
  { target: 250, points: 70 },
  { target: 500, points: 130 },
  { target: 1_000, points: 220 },
  { target: 2_500, points: 400 },
  { target: 5_000, points: 650 },
  { target: 10_000, points: 1_000 },
  { target: 25_000, points: 1_600 },
  { target: 50_000, points: 2_400 },
  { target: 100_000, points: 3_500 },
]);

export const PROMO_STAR_HOLD_LEVELS = Object.freeze([
  { target: 1_000, points: 1 },
  { target: 5_000, points: 3 },
  { target: 10_000, points: 5 },
  { target: 25_000, points: 9 },
  { target: 50_000, points: 15 },
  { target: 100_000, points: 25 },
  { target: 250_000, points: 45 },
  { target: 500_000, points: 70 },
  { target: 1_000_000, points: 100 },
  { target: 5_000_000, points: 150 },
]);

export const PROMO_USDT_DEPOSIT_LEVELS = Object.freeze([
  { target: 5, points: 250 },
  { target: 10, points: 400 },
  { target: 20, points: 700 },
  { target: 35, points: 1_100 },
  { target: 50, points: 1_700 },
  { target: 75, points: 2_600 },
  { target: 100, points: 4_000 },
]);

export const PROMO_STAR_DEPOSIT_LEVELS = Object.freeze([
  { target: 5, points: 40 },
  { target: 10, points: 70 },
  { target: 20, points: 120 },
  { target: 35, points: 200 },
  { target: 50, points: 300 },
  { target: 75, points: 450 },
  { target: 100, points: 700 },
]);

export const PROMO_POINT_PACKAGES = Object.freeze([
  { stars: 250, points: 250 },
  { stars: 500, points: 600 },
  { stars: 1_000, points: 1_500 },
]);

function getDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function buildPromoLevelProgress(value, levels, kind, dayKey = getDayKey()) {
  const normalizedValue = Math.max(0, toNumber(value));
  const achievedCount = levels.filter((level) => normalizedValue >= level.target).length;
  const complete = achievedCount >= levels.length;
  const nextIndex = complete ? levels.length - 1 : achievedCount;
  const currentIndex = Math.max(0, achievedCount - 1);
  const next = levels[nextIndex];
  const current = achievedCount > 0 ? levels[currentIndex] : null;

  return {
    kind,
    value: normalizedValue,
    target: next.target,
    unit: kind === "daily_hold_usdt" ? "USDT" : kind === "daily_hold_stars" ? "STAR" : "COUNT",
    level: complete ? levels.length : achievedCount + 1,
    achieved_level: achievedCount,
    levels: levels.length,
    points: current?.points ?? 0,
    next_points: complete ? current?.points ?? 0 : next.points,
    complete,
    day_key: dayKey,
    achieved_levels: levels.slice(0, achievedCount).map((level, index) => ({
      level: index + 1,
      target: level.target,
      points: level.points,
    })),
  };
}

function mapPointPurchase(row, dayKey) {
  return {
    day_key: dayKey,
    purchased: Boolean(row),
    stars_spent: row ? toNumber(row.stars_spent) : 0,
    points: row ? Math.max(0, Number(row.points || 0)) : 0,
    payment_source: row?.payment_source || null,
    options: PROMO_POINT_PACKAGES.map((option) => ({ ...option })),
  };
}

function buildPromoContestState(row, startedAt, dayKey) {
  const stars = Math.max(0, toNumber(row.star_balance));
  const usdtCash = Math.max(0, toNumber(row.usdt_cash_balance));
  const usdtDepositCount = Math.max(0, Number(row.usdt_deposit_count || 0));
  const starDepositCount = Math.max(0, Number(row.star_deposit_count || 0));

  return {
    started_at: startedAt,
    day_key: dayKey,
    balances: {
      stars,
      usdt_cash: usdtCash,
    },
    tasks: {
      promo_hold_usdt: buildPromoLevelProgress(usdtCash, PROMO_USDT_HOLD_LEVELS, "daily_hold_usdt", dayKey),
      promo_hold_stars: buildPromoLevelProgress(stars, PROMO_STAR_HOLD_LEVELS, "daily_hold_stars", dayKey),
      promo_deposit_count_usdt: buildPromoLevelProgress(
        usdtDepositCount,
        PROMO_USDT_DEPOSIT_LEVELS,
        "milestone_usdt_deposits",
        dayKey,
      ),
      promo_deposit_count_stars: buildPromoLevelProgress(
        starDepositCount,
        PROMO_STAR_DEPOSIT_LEVELS,
        "milestone_star_deposits",
        dayKey,
      ),
    },
    point_purchase: mapPointPurchase(row.purchase_id ? row : null, dayKey),
  };
}

async function getContestStartedAt(client = { query }) {
  const result = await client.query(
    "SELECT started_at FROM promo_contest_config WHERE singleton = TRUE LIMIT 1",
  );
  return result.rows[0]?.started_at ?? new Date().toISOString();
}

async function loadPromoRows(client, whereSql, params) {
  return client.query(
    `
      SELECT
        users.id AS user_id,
        users.telegram_id,
        users.username,
        users.first_name,
        COALESCE(fire.balance, 0) AS star_balance,
        COALESCE(cash.balance, 0) AS usdt_cash_balance,
        COALESCE((
          SELECT COUNT(*)
          FROM usdt_deposit_intents deposits
          WHERE deposits.user_id = users.id
            AND deposits.status = 'credited'
            AND deposits.credited_at >= $1::timestamptz
        ), 0) AS usdt_deposit_count,
        COALESCE((
          SELECT COUNT(*)
          FROM fire_ledger ledger
          WHERE ledger.user_id = users.id
            AND ledger.reason = 'stars_fire_topup'
            AND ledger.amount >= 500
            AND ledger.created_at >= $1::timestamptz
        ), 0) AS star_deposit_count,
        purchases.id AS purchase_id,
        purchases.stars_spent,
        purchases.points
      FROM users
      LEFT JOIN fire_balances fire ON fire.user_id = users.id
      LEFT JOIN usdt_balances cash ON cash.user_id = users.id
      LEFT JOIN promo_point_purchases purchases
        ON purchases.user_id = users.id
       AND purchases.day_key = $2
      WHERE ${whereSql}
    `,
    [params.startedAt, params.dayKey, ...params.whereParams],
  );
}

export async function getPromoContestStateForUser(userId, client = { query }) {
  const dayKey = getDayKey();
  const startedAt = await getContestStartedAt(client);
  const result = await loadPromoRows(client, "users.id = $3::bigint", {
    startedAt,
    dayKey,
    whereParams: [userId],
  });
  const row = result.rows[0];
  return row ? buildPromoContestState(row, startedAt, dayKey) : null;
}

export async function creditPromoPointsFromTelegramStars(client, input) {
  const stars = Math.round(toNumber(input.stars));
  const selected = PROMO_POINT_PACKAGES.find((option) => option.stars === stars);
  if (!selected) {
    throw new Error("invalid_promo_point_package");
  }

  const paymentChargeId = String(input.telegramPaymentChargeId || "").trim();
  if (!paymentChargeId || paymentChargeId.length > 255) {
    throw new Error("invalid_telegram_payment");
  }

  const dayKey = input.dayKey || getDayKey();
  const existingPayment = await client.query(
    `
      SELECT *
      FROM promo_point_purchases
      WHERE telegram_payment_charge_id = $1
      LIMIT 1
    `,
    [paymentChargeId],
  );
  if (existingPayment.rows[0]) {
    return { ...existingPayment.rows[0], already_credited: true };
  }

  const existing = await client.query(
    "SELECT * FROM promo_point_purchases WHERE user_id = $1::bigint AND day_key = $2 LIMIT 1",
    [input.userId, dayKey],
  );
  if (existing.rows[0]) {
    throw new Error("promo_points_already_purchased_today");
  }

  const purchaseResult = await client.query(
    `
      INSERT INTO promo_point_purchases (
        user_id,
        day_key,
        stars_spent,
        points,
        payment_source,
        telegram_payment_charge_id
      )
      VALUES ($1::bigint, $2, $3::numeric, $4::integer, 'telegram_stars', $5)
      ON CONFLICT DO NOTHING
      RETURNING *
    `,
    [input.userId, dayKey, selected.stars, selected.points, paymentChargeId],
  );
  if (purchaseResult.rows[0]) {
    return { ...purchaseResult.rows[0], already_credited: false };
  }

  const racedPayment = await client.query(
    `
      SELECT *
      FROM promo_point_purchases
      WHERE telegram_payment_charge_id = $1
      LIMIT 1
    `,
    [paymentChargeId],
  );
  if (racedPayment.rows[0]) {
    return { ...racedPayment.rows[0], already_credited: true };
  }
  throw new Error("promo_points_already_purchased_today");
}

export async function creditTelegramStarsPromoPointPurchase(input) {
  return withTransaction((client) => creditPromoPointsFromTelegramStars(client, input));
}

export async function resetPromoPointPurchaseDayForUser(client, input) {
  const telegramId = String(input.telegramId || "").trim();
  if (!/^\d{1,24}$/.test(telegramId)) {
    throw new Error("invalid_telegram_id");
  }

  const dayKey = String(input.dayKey || getDayKey()).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new Error("invalid_day_key");
  }

  const result = await client.query(
    `
      UPDATE promo_point_purchases purchases
      SET day_key = purchases.day_key || ':reset:' || purchases.id::text
      FROM users
      WHERE purchases.user_id = users.id
        AND users.telegram_id = $1
        AND purchases.day_key = $2
      RETURNING
        purchases.id,
        purchases.stars_spent,
        purchases.points,
        purchases.payment_source
    `,
    [telegramId, dayKey],
  );
  const purchase = result.rows[0] || null;
  return {
    ok: true,
    telegram_id: telegramId,
    day_key: dayKey,
    reset: Boolean(purchase),
    purchase: purchase
      ? {
          stars_spent: Number(purchase.stars_spent),
          points: Number(purchase.points),
          payment_source: purchase.payment_source,
        }
      : null,
  };
}

export async function resetTelegramPromoPointPurchaseDay(input) {
  return withTransaction((client) => resetPromoPointPurchaseDayForUser(client, input));
}
