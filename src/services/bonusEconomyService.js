import { query, toNumber } from "../db.js";

const BONUS_UNLOCK_LIFETIME_CAP_BPS = 2_500;
const BONUS_UNLOCK_TIERS = [
  { minDeposit: 500, rateBps: 100 },
  { minDeposit: 200, rateBps: 75 },
  { minDeposit: 50, rateBps: 50 },
  { minDeposit: 15, rateBps: 25 },
];

function roundAmount(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100_000_000) / 100_000_000);
}

export function getBonusUnlockTier(depositTotal) {
  const total = roundAmount(depositTotal);
  const tier = BONUS_UNLOCK_TIERS.find((candidate) => total >= candidate.minDeposit);
  return tier
    ? { min_deposit: tier.minDeposit, rate_bps: tier.rateBps }
    : { min_deposit: 15, rate_bps: 0 };
}

function buildUnlockStatus({ depositTotal, unlockedTotal = 0, bonusBalance = 0 }) {
  const safeDepositTotal = roundAmount(depositTotal);
  const safeUnlockedTotal = roundAmount(unlockedTotal);
  const tier = getBonusUnlockTier(safeDepositTotal);
  const lifetimeCap = roundAmount(safeDepositTotal * (BONUS_UNLOCK_LIFETIME_CAP_BPS / 10_000));

  return {
    eligible: tier.rate_bps > 0,
    deposit_total: safeDepositTotal,
    rate_bps: tier.rate_bps,
    rate_pct: tier.rate_bps / 100,
    next_deposit: BONUS_UNLOCK_TIERS
      .map((candidate) => candidate.minDeposit)
      .sort((a, b) => a - b)
      .find((amount) => amount > safeDepositTotal) ?? null,
    lifetime_cap: lifetimeCap,
    unlocked_total: safeUnlockedTotal,
    remaining_cap: roundAmount(Math.max(0, lifetimeCap - safeUnlockedTotal)),
    bonus_balance: roundAmount(bonusBalance),
  };
}

export async function getBonusUnlockStatusForUser(userId) {
  const result = await query(
    `
      SELECT
        COALESCE(NULLIF((
          SELECT SUM(credited_amount)
          FROM usdt_deposit_intents
          WHERE user_id = $1
            AND status = 'credited'
            AND COALESCE(credited_amount, 0) > 0
        ), 0), (
          SELECT SUM(amount)
          FROM usdt_ledger
          WHERE user_id = $1
            AND reason = 'usdt_onchain_deposit'
            AND amount > 0
        ), 0) AS deposit_total,
        COALESCE((
          SELECT SUM(amount)
          FROM bonus_unlock_events
          WHERE user_id = $1
        ), 0) AS unlocked_total,
        COALESCE((
          SELECT balance
          FROM usdt_bonus_balances
          WHERE user_id = $1
        ), 0) AS bonus_balance
    `,
    [userId],
  );
  return buildUnlockStatus({
    depositTotal: result.rows[0]?.deposit_total,
    unlockedTotal: result.rows[0]?.unlocked_total,
    bonusBalance: result.rows[0]?.bonus_balance,
  });
}

export async function fundBonusUnlockReserve(client, input) {
  const amount = roundAmount(input.amount);
  if (amount <= 0) {
    return 0;
  }

  const ledgerResult = await client.query(
    `
      INSERT INTO bonus_unlock_reserve_ledger (
        event_key,
        profit_fee_distribution_id,
        amount,
        source
      )
      VALUES ($1, $2, $3::numeric, $4)
      ON CONFLICT (event_key) DO NOTHING
      RETURNING amount
    `,
    [
      String(input.eventKey),
      input.profitFeeDistributionId || null,
      amount,
      input.source || "profit_fee",
    ],
  );
  if (!ledgerResult.rows[0]) {
    return 0;
  }

  await client.query(
    `
      UPDATE bonus_unlock_reserve
      SET balance = balance + $1::numeric,
          funded_total = funded_total + $1::numeric,
          updated_at = now()
      WHERE currency = 'USDT'
    `,
    [amount],
  );
  return amount;
}

export async function unlockBonusAfterResolvedMarket(client, input) {
  const userId = Number(input.userId);
  const marketId = Number(input.marketId);
  const realNetPnl = Number(input.realNetPnl || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(marketId) || marketId <= 0) {
    return null;
  }
  // Only profitable real-money play unlocks bonus. The reserve is funded from
  // the same profit fee, so every withdrawable dollar created here is backed.
  if (!Number.isFinite(realNetPnl) || realNetPnl <= 0) {
    return null;
  }

  const existingResult = await client.query(
    "SELECT * FROM bonus_unlock_events WHERE event_key = $1 LIMIT 1",
    [`market:${marketId}:user:${userId}`],
  );
  if (existingResult.rows[0]) {
    return {
      amount: toNumber(existingResult.rows[0].amount),
      already_processed: true,
    };
  }

  const depositResult = await client.query(
    `
      SELECT COALESCE(NULLIF((
        SELECT SUM(credited_amount)
        FROM usdt_deposit_intents
        WHERE user_id = $1
          AND status = 'credited'
          AND COALESCE(credited_amount, 0) > 0
      ), 0), (
        SELECT SUM(amount)
        FROM usdt_ledger
        WHERE user_id = $1
          AND reason = 'usdt_onchain_deposit'
          AND amount > 0
      ), 0) AS total
    `,
    [userId],
  );
  const depositTotal = roundAmount(depositResult.rows[0]?.total);
  const tier = getBonusUnlockTier(depositTotal);
  if (tier.rate_bps <= 0) {
    return null;
  }

  // Always lock the shared reserve before the user balance. This fixed order
  // prevents two markets resolving in parallel from deadlocking each other.
  const reserveResult = await client.query(
    "SELECT balance FROM bonus_unlock_reserve WHERE currency = 'USDT' FOR UPDATE",
  );
  const bonusResult = await client.query(
    "SELECT balance FROM usdt_bonus_balances WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  const unlockedResult = await client.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM bonus_unlock_events WHERE user_id = $1",
    [userId],
  );
  const bonusBalance = roundAmount(bonusResult.rows[0]?.balance);
  const reserveBalance = roundAmount(reserveResult.rows[0]?.balance);
  const unlockedTotal = roundAmount(unlockedResult.rows[0]?.total);
  const lifetimeCap = roundAmount(depositTotal * (BONUS_UNLOCK_LIFETIME_CAP_BPS / 10_000));
  const remainingCap = roundAmount(Math.max(0, lifetimeCap - unlockedTotal));
  const activityUnlock = roundAmount(realNetPnl * (tier.rate_bps / 10_000));
  const amount = roundAmount(Math.min(bonusBalance, reserveBalance, remainingCap, activityUnlock));
  if (amount <= 0) {
    return null;
  }

  const eventKey = `market:${marketId}:user:${userId}`;
  const eventResult = await client.query(
    `
      INSERT INTO bonus_unlock_events (
        event_key,
        user_id,
        market_id,
        deposit_total,
        unlock_rate_bps,
        real_net_pnl,
        amount
      )
      VALUES ($1, $2, $3, $4::numeric, $5, $6::numeric, $7::numeric)
      ON CONFLICT (event_key) DO NOTHING
      RETURNING *
    `,
    [eventKey, userId, marketId, depositTotal, tier.rate_bps, realNetPnl, amount],
  );
  if (!eventResult.rows[0]) {
    return null;
  }

  await client.query(
    `
      UPDATE usdt_bonus_balances
      SET balance = balance - $2::numeric,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, amount],
  );
  await client.query(
    `
      UPDATE usdt_balances
      SET balance = balance + $2::numeric,
          updated_at = now()
      WHERE user_id = $1
    `,
    [userId, amount],
  );
  await client.query(
    `
      INSERT INTO usdt_bonus_ledger (user_id, amount, reason, source)
      VALUES ($1, -$2::numeric, 'bonus_unlock', $3)
    `,
    [userId, amount, eventKey],
  );
  await client.query(
    `
      INSERT INTO usdt_ledger (user_id, amount, reason, source)
      VALUES ($1, $2::numeric, 'bonus_unlock', $3)
    `,
    [userId, amount, eventKey],
  );
  await client.query(
    `
      INSERT INTO bonus_unlock_reserve_ledger (event_key, amount, source)
      VALUES ($1, -$2::numeric, $3)
    `,
    [`unlock:${eventKey}`, amount, eventKey],
  );
  await client.query(
    `
      UPDATE bonus_unlock_reserve
      SET balance = balance - $1::numeric,
          released_total = released_total + $1::numeric,
          updated_at = now()
      WHERE currency = 'USDT'
    `,
    [amount],
  );

  return {
    amount,
    rate_bps: tier.rate_bps,
    real_net_pnl: realNetPnl,
    remaining_cap: roundAmount(remainingCap - amount),
  };
}

export async function getBonusEconomyAudit() {
  const result = await query(`
    WITH depositors AS (
      SELECT DISTINCT user_id
      FROM usdt_deposit_intents
      WHERE status = 'credited'
        AND COALESCE(credited_amount, 0) > 0
      UNION
      SELECT DISTINCT user_id
      FROM usdt_ledger
      WHERE reason = 'usdt_onchain_deposit'
        AND amount > 0
    ), account_totals AS (
      SELECT
        COUNT(*) FILTER (WHERE depositors.user_id IS NOT NULL) AS deposited_users,
        COUNT(*) FILTER (
          WHERE depositors.user_id IS NULL AND COALESCE(cash.balance, 0) > 0
        ) AS no_deposit_users_with_cash,
        COALESCE(SUM(cash.balance), 0) AS cash_balance_total,
        COALESCE(SUM(bonus.balance), 0) AS bonus_balance_total
      FROM users
      LEFT JOIN depositors ON depositors.user_id = users.id
      LEFT JOIN usdt_balances cash ON cash.user_id = users.id
      LEFT JOIN usdt_bonus_balances bonus ON bonus.user_id = users.id
    )
    SELECT
      account_totals.*,
      COALESCE((SELECT balance FROM bonus_unlock_reserve WHERE currency = 'USDT'), 0) AS reserve_balance,
      COALESCE((SELECT funded_total FROM bonus_unlock_reserve WHERE currency = 'USDT'), 0) AS reserve_funded_total,
      COALESCE((SELECT released_total FROM bonus_unlock_reserve WHERE currency = 'USDT'), 0) AS reserve_released_total,
      COALESCE((SELECT SUM(cash_amount + pending_withdrawal_amount) FROM usdt_balance_reclassifications), 0) AS reclassified_total,
      COALESCE((SELECT COUNT(*) FROM usdt_balance_reclassifications), 0) AS reclassified_users,
      COALESCE((SELECT COUNT(*) FROM usdt_withdrawal_requests WHERE status = 'pending'), 0) AS pending_withdrawals
    FROM account_totals
  `);
  const row = result.rows[0] || {};
  return {
    deposited_users: Number(row.deposited_users || 0),
    no_deposit_users_with_cash: Number(row.no_deposit_users_with_cash || 0),
    cash_balance_total: toNumber(row.cash_balance_total),
    bonus_balance_total: toNumber(row.bonus_balance_total),
    reserve_balance: toNumber(row.reserve_balance),
    reserve_funded_total: toNumber(row.reserve_funded_total),
    reserve_released_total: toNumber(row.reserve_released_total),
    reclassified_total: toNumber(row.reclassified_total),
    reclassified_users: Number(row.reclassified_users || 0),
    pending_withdrawals: Number(row.pending_withdrawals || 0),
  };
}
