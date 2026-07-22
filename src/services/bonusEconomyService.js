import { query, toNumber } from "../db.js";

const BONUS_UNLOCK_LIFETIME_CAP_BPS = 2_500;
const BONUS_UNLOCK_TIERS = [
  { minDeposit: 500, rateBps: 100 },
  { minDeposit: 200, rateBps: 75 },
  { minDeposit: 50, rateBps: 50 },
  { minDeposit: 15, rateBps: 25 },
];

export function getLightningStreakMultiplier(streakDays) {
  const days = Math.max(0, Math.floor(Number(streakDays || 0)));
  if (days > 21) return 2;
  if (days > 7) return 1.5;
  return 1;
}

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

function getActiveStreak(row = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const checkedToday = String(row.last_day_key || "") === today;
  const days = checkedToday ? Math.max(0, Number(row.current_streak || 0)) : 0;
  return {
    days,
    checked_today: checkedToday,
    multiplier: getLightningStreakMultiplier(days),
  };
}

function buildUnlockStatus({ depositTotal, unlockedTotal = 0, bonusBalance = 0, streak = {} }) {
  const safeDepositTotal = roundAmount(depositTotal);
  const safeUnlockedTotal = roundAmount(unlockedTotal);
  const tier = getBonusUnlockTier(safeDepositTotal);
  const activeStreak = getActiveStreak(streak);
  const effectiveRateBps = Math.round(tier.rate_bps * activeStreak.multiplier);
  const lifetimeCap = roundAmount(safeDepositTotal * (BONUS_UNLOCK_LIFETIME_CAP_BPS / 10_000));

  return {
    eligible: tier.rate_bps > 0,
    deposit_total: safeDepositTotal,
    base_rate_bps: tier.rate_bps,
    base_rate_pct: tier.rate_bps / 100,
    rate_bps: effectiveRateBps,
    rate_pct: effectiveRateBps / 100,
    streak_days: activeStreak.days,
    streak_checked_today: activeStreak.checked_today,
    streak_multiplier: activeStreak.multiplier,
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
        ), 0) AS bonus_balance,
        COALESCE((
          SELECT current_streak
          FROM user_streaks
          WHERE user_id = $1
        ), 0) AS current_streak,
        (
          SELECT last_day_key
          FROM user_streaks
          WHERE user_id = $1
        ) AS last_day_key
    `,
    [userId],
  );
  return buildUnlockStatus({
    depositTotal: result.rows[0]?.deposit_total,
    unlockedTotal: result.rows[0]?.unlocked_total,
    bonusBalance: result.rows[0]?.bonus_balance,
    streak: result.rows[0],
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
      , COALESCE((
        SELECT current_streak
        FROM user_streaks
        WHERE user_id = $1
      ), 0) AS current_streak
      , (
        SELECT last_day_key
        FROM user_streaks
        WHERE user_id = $1
      ) AS last_day_key
    `,
    [userId],
  );
  const depositTotal = roundAmount(depositResult.rows[0]?.total);
  const tier = getBonusUnlockTier(depositTotal);
  if (tier.rate_bps <= 0) {
    return null;
  }
  const activeStreak = getActiveStreak(depositResult.rows[0]);
  const effectiveRateBps = Math.round(tier.rate_bps * activeStreak.multiplier);

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
  const activityUnlock = roundAmount(realNetPnl * (effectiveRateBps / 10_000));
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
        base_unlock_rate_bps,
        unlock_rate_bps,
        streak_days,
        streak_multiplier_bps,
        real_net_pnl,
        amount
      )
      VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9::numeric, $10::numeric)
      ON CONFLICT (event_key) DO NOTHING
      RETURNING *
    `,
    [
      eventKey,
      userId,
      marketId,
      depositTotal,
      tier.rate_bps,
      effectiveRateBps,
      activeStreak.days,
      Math.round(activeStreak.multiplier * 10_000),
      realNetPnl,
      amount,
    ],
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
    base_rate_bps: tier.rate_bps,
    rate_bps: effectiveRateBps,
    streak_days: activeStreak.days,
    streak_multiplier: activeStreak.multiplier,
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

export async function getEconomyIntegrityAudit(database = { query }) {
  const result = await database.query(`
    WITH epoch AS (
      SELECT COALESCE((
        SELECT applied_at
        FROM app_migrations
        WHERE key = 'reset_clan_reward_fund_backed_v1'
      ), now()) AS started_at
    ), fees AS (
      SELECT
        COALESCE(SUM(total_fee), 0) AS total_fee,
        COALESCE(SUM(distributable_fee), 0) AS distributable_fee,
        COALESCE(SUM(bonus_fee), 0) AS bonus_fee,
        COALESCE(SUM(project_fee), 0) AS project_fee,
        COALESCE(SUM(referral_fee), 0) AS referral_fee,
        COALESCE(SUM(clan_fee), 0) AS clan_fee,
        COALESCE(SUM(bonus_unlock_fee), 0) AS bonus_unlock_fee,
        COUNT(*)::int AS distribution_count
      FROM profit_fee_distributions, epoch
      WHERE currency = 'USDT'
        AND created_at >= epoch.started_at
    ), referral_ledger AS (
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM usdt_ledger, epoch
      WHERE reason = 'profit_fee_referral_usdt'
        AND amount > 0
        AND created_at >= epoch.started_at
    ), invalid_referrals AS (
      SELECT COUNT(*)::int AS count
      FROM profit_fee_distributions distributions
      JOIN users referred ON referred.id = distributions.user_id
      JOIN users referrer ON referrer.id = distributions.referrer_user_id
      CROSS JOIN epoch
      WHERE distributions.currency = 'USDT'
        AND distributions.referral_fee > 0
        AND distributions.created_at >= epoch.started_at
        AND referred.referred_by_telegram_id IS DISTINCT FROM referrer.telegram_id
    ), referral_graph AS (
      SELECT
        COUNT(*) FILTER (
          WHERE referred.referred_by_telegram_id = referred.telegram_id
        )::int AS self_links,
        COUNT(*) FILTER (
          WHERE referred.referred_by_telegram_id IS NOT NULL
            AND referrer.id IS NULL
        )::int AS missing_referrers
      FROM users referred
      LEFT JOIN users referrer
        ON referrer.telegram_id = referred.referred_by_telegram_id
    ), clan_contributions AS (
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM clan_reward_fund_ledger, epoch
      WHERE currency = 'USDT'
        AND amount > 0
        AND source <> 'economy_reset:reset_clan_reward_fund_backed_v1'
        AND created_at >= epoch.started_at
    ), clan_bank AS (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE currency = 'USDT'), 0) AS usdt,
        COALESCE(SUM(amount) FILTER (WHERE currency <> 'USDT'), 0) AS star
      FROM clan_reward_fund_ledger
      WHERE month_key = to_char(now(), 'YYYY-MM')
    ), clan_resets AS (
      SELECT
        COALESCE(-SUM(amount) FILTER (WHERE currency = 'USDT'), 0) AS usdt,
        COALESCE(-SUM(amount) FILTER (WHERE currency <> 'USDT'), 0) AS star
      FROM clan_reward_fund_ledger
      WHERE source = 'economy_reset:reset_clan_reward_fund_backed_v1'
    ), clan_payout_rows AS (
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM clan_reward_payouts, epoch
      WHERE currency = 'USDT'
        AND created_at >= epoch.started_at
    ), clan_payout_ledger AS (
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM usdt_ledger, epoch
      WHERE reason = 'clan_monthly_reward_usdt'
        AND amount > 0
        AND created_at >= epoch.started_at
    ), reserve_funding AS (
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM bonus_unlock_reserve_ledger, epoch
      WHERE amount > 0
        AND created_at >= epoch.started_at
    ), promo_referrals AS (
      SELECT COALESCE(SUM(amount), 0) AS amount
      FROM usdt_bonus_ledger, epoch
      WHERE reason IN ('referral_signup_bonus_usdt', 'referral_bet_bonus_usdt')
        AND amount > 0
        AND created_at >= epoch.started_at
    )
    SELECT
      epoch.started_at,
      fees.*,
      referral_ledger.amount AS referral_ledger_amount,
      invalid_referrals.count AS invalid_referral_links,
      referral_graph.self_links AS referral_self_links,
      referral_graph.missing_referrers AS referral_missing_referrers,
      clan_contributions.amount AS clan_contribution_amount,
      clan_bank.usdt AS clan_bank_usdt,
      clan_bank.star AS clan_bank_star,
      clan_resets.usdt AS clan_reset_usdt,
      clan_resets.star AS clan_reset_star,
      clan_payout_rows.amount AS clan_payout_rows_amount,
      clan_payout_ledger.amount AS clan_payout_ledger_amount,
      reserve_funding.amount AS reserve_funding_amount,
      promo_referrals.amount AS promo_referral_bonus_amount,
      COALESCE((SELECT balance FROM bonus_unlock_reserve WHERE currency = 'USDT'), 0) AS reserve_balance
    FROM epoch, fees, referral_ledger, invalid_referrals, referral_graph, clan_contributions,
      clan_bank, clan_resets, clan_payout_rows, clan_payout_ledger,
      reserve_funding, promo_referrals
  `);
  const row = result.rows[0] || {};
  const distributableFee = toNumber(row.distributable_fee);
  const feeBackingDelta = roundAmount(Math.abs(
    toNumber(row.total_fee) - distributableFee - toNumber(row.bonus_fee),
  ));
  const allocatedFee = roundAmount(
    toNumber(row.project_fee)
      + toNumber(row.referral_fee)
      + toNumber(row.clan_fee)
      + toNumber(row.bonus_unlock_fee),
  );
  const feeComponentsDelta = roundAmount(Math.abs(distributableFee - allocatedFee));
  const referralDelta = roundAmount(Math.abs(
    toNumber(row.referral_fee) - toNumber(row.referral_ledger_amount),
  ));
  const clanContributionDelta = roundAmount(Math.abs(
    toNumber(row.clan_fee) - toNumber(row.clan_contribution_amount),
  ));
  const clanPayoutDelta = roundAmount(Math.abs(
    toNumber(row.clan_payout_rows_amount) - toNumber(row.clan_payout_ledger_amount),
  ));
  const reserveFundingDelta = roundAmount(Math.abs(
    toNumber(row.bonus_unlock_fee) - toNumber(row.reserve_funding_amount),
  ));
  const tolerance = 0.011;

  return {
    started_at: row.started_at,
    balanced: feeBackingDelta < tolerance
      && feeComponentsDelta < tolerance
      && referralDelta < tolerance
      && clanContributionDelta < tolerance
      && clanPayoutDelta < tolerance
      && reserveFundingDelta < tolerance
      && Number(row.invalid_referral_links || 0) === 0
      && Number(row.referral_self_links || 0) === 0
      && Number(row.referral_missing_referrers || 0) === 0,
    fees: {
      distributions: Number(row.distribution_count || 0),
      total: toNumber(row.total_fee),
      distributable: distributableFee,
      bonus_burned: toNumber(row.bonus_fee),
      project: toNumber(row.project_fee),
      referral: toNumber(row.referral_fee),
      clan: toNumber(row.clan_fee),
      bonus_unlock: toNumber(row.bonus_unlock_fee),
      backing_delta: feeBackingDelta,
      components_delta: feeComponentsDelta,
    },
    referrals: {
      cash_distributed: toNumber(row.referral_fee),
      cash_ledger: toNumber(row.referral_ledger_amount),
      cash_delta: referralDelta,
      invalid_links: Number(row.invalid_referral_links || 0),
      self_links: Number(row.referral_self_links || 0),
      missing_referrers: Number(row.referral_missing_referrers || 0),
      promotional_bonus: toNumber(row.promo_referral_bonus_amount),
    },
    clans: {
      contributed: toNumber(row.clan_contribution_amount),
      contribution_delta: clanContributionDelta,
      bank_usdt: toNumber(row.clan_bank_usdt),
      bank_star: toNumber(row.clan_bank_star),
      reset_usdt: toNumber(row.clan_reset_usdt),
      reset_star: toNumber(row.clan_reset_star),
      payouts: toNumber(row.clan_payout_rows_amount),
      payout_ledger: toNumber(row.clan_payout_ledger_amount),
      payout_delta: clanPayoutDelta,
    },
    bonus_unlock: {
      funded: toNumber(row.reserve_funding_amount),
      expected_funding: toNumber(row.bonus_unlock_fee),
      funding_delta: reserveFundingDelta,
      reserve_balance: toNumber(row.reserve_balance),
    },
  };
}
