import { query } from "../db.js";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(toNumber(value) * factor) / factor;
}

// One picture of what the house is holding and what it owes. Real money and the
// two soft currencies are kept apart on purpose: a star and a bonus dollar are
// liabilities of very different weight, and adding them up would hide that.
export async function getTreasurySnapshot() {
  const result = await query(`
    WITH deposits AS (
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM usdt_ledger
      WHERE reason = 'usdt_onchain_deposit' AND amount > 0
    ), withdrawals AS (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed'), 0) AS paid,
        COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
        COALESCE(SUM(COALESCE(fee_amount, 0)) FILTER (WHERE status = 'confirmed'), 0) AS fees
      FROM usdt_withdrawal_requests
    ), balances AS (
      SELECT
        COALESCE(SUM(cash.balance), 0) AS cash,
        COALESCE(SUM(bonus.balance), 0) AS bonus,
        COALESCE(SUM(fire.balance), 0) AS stars,
        COUNT(*) FILTER (WHERE COALESCE(cash.balance, 0) > 0)::int AS cash_holders,
        COUNT(*) FILTER (WHERE COALESCE(fire.balance, 0) > 0)::int AS star_holders
      FROM users
      LEFT JOIN usdt_balances cash ON cash.user_id = users.id
      LEFT JOIN usdt_bonus_balances bonus ON bonus.user_id = users.id
      LEFT JOIN fire_balances fire ON fire.user_id = users.id
    ), fees AS (
      SELECT
        COALESCE(SUM(project_fee) FILTER (WHERE currency = 'USDT'), 0) AS project_usdt,
        COALESCE(SUM(project_fee) FILTER (WHERE currency <> 'USDT'), 0) AS project_star,
        COALESCE(SUM(total_fee) FILTER (WHERE currency = 'USDT'), 0) AS total_usdt,
        COALESCE(SUM(referral_fee) FILTER (WHERE currency = 'USDT'), 0) AS referral_usdt,
        COALESCE(SUM(clan_fee) FILTER (WHERE currency = 'USDT'), 0) AS clan_usdt
      FROM profit_fee_distributions
    ), trade_fees AS (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE currency = 'USDT'), 0) AS usdt,
        COALESCE(SUM(amount) FILTER (WHERE currency <> 'USDT'), 0) AS star
      FROM market_trade_fees
    ), reserve AS (
      SELECT
        COALESCE(balance, 0) AS balance,
        COALESCE(funded_total, 0) AS funded,
        COALESCE(released_total, 0) AS released
      FROM bonus_unlock_reserve
      WHERE currency = 'USDT'
    ), clan_bank AS (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE currency = 'USDT'), 0) AS usdt,
        COALESCE(SUM(amount) FILTER (WHERE currency <> 'USDT'), 0) AS star
      FROM clan_reward_fund_ledger
      WHERE month_key = to_char(now(), 'YYYY-MM')
    ), maker AS (
      SELECT
        book_type,
        COALESCE(SUM(realized_pnl) FILTER (WHERE status = 'SETTLED'), 0) AS realized,
        COALESCE(SUM(current_nav) FILTER (WHERE status NOT IN ('SETTLED', 'REFUNDED')), 0) AS open_nav,
        COALESCE(SUM(initial_collateral) FILTER (WHERE status NOT IN ('SETTLED', 'REFUNDED')), 0) AS open_collateral
      FROM market_maker_accounts
      GROUP BY book_type
    ), star_flow AS (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE reason LIKE 'task_%' AND amount > 0), 0) AS tasks,
        COALESCE(SUM(amount) FILTER (WHERE reason LIKE 'referral%' AND amount > 0), 0) AS referrals,
        COALESCE(SUM(amount) FILTER (WHERE reason IN ('market_payout', 'sell_yes', 'sell_no') AND amount > 0), 0) AS payouts,
        COALESCE(-SUM(amount) FILTER (WHERE reason IN ('buy_yes', 'buy_no') AND amount < 0), 0) AS stakes
      FROM fire_ledger
    )
    SELECT
      (SELECT total FROM deposits) AS deposits,
      (SELECT paid FROM withdrawals) AS withdrawn,
      (SELECT pending FROM withdrawals) AS withdrawal_pending,
      (SELECT pending_count FROM withdrawals) AS withdrawal_pending_count,
      (SELECT fees FROM withdrawals) AS withdrawal_fees,
      (SELECT cash FROM balances) AS user_cash,
      (SELECT bonus FROM balances) AS user_bonus,
      (SELECT stars FROM balances) AS user_stars,
      (SELECT cash_holders FROM balances) AS cash_holders,
      (SELECT star_holders FROM balances) AS star_holders,
      (SELECT project_usdt FROM fees) AS fee_project_usdt,
      (SELECT project_star FROM fees) AS fee_project_star,
      (SELECT total_usdt FROM fees) AS fee_total_usdt,
      (SELECT referral_usdt FROM fees) AS fee_referral_usdt,
      (SELECT clan_usdt FROM fees) AS fee_clan_usdt,
      (SELECT usdt FROM trade_fees) AS trade_fee_usdt,
      (SELECT star FROM trade_fees) AS trade_fee_star,
      (SELECT balance FROM reserve) AS reserve_balance,
      (SELECT funded FROM reserve) AS reserve_funded,
      (SELECT released FROM reserve) AS reserve_released,
      (SELECT usdt FROM clan_bank) AS clan_bank_usdt,
      (SELECT star FROM clan_bank) AS clan_bank_star,
      (SELECT tasks FROM star_flow) AS star_tasks,
      (SELECT referrals FROM star_flow) AS star_referrals,
      (SELECT payouts FROM star_flow) AS star_payouts,
      (SELECT stakes FROM star_flow) AS star_stakes
  `);
  const row = result.rows[0] || {};

  const makerResult = await query(`
    SELECT
      book_type,
      COALESCE(SUM(realized_pnl) FILTER (WHERE status = 'SETTLED'), 0) AS realized,
      COALESCE(SUM(current_nav) FILTER (WHERE status NOT IN ('SETTLED', 'REFUNDED')), 0) AS open_nav,
      COALESCE(SUM(initial_collateral) FILTER (WHERE status NOT IN ('SETTLED', 'REFUNDED')), 0) AS open_collateral
    FROM market_maker_accounts
    GROUP BY book_type
    ORDER BY book_type
  `);

  const deposits = toNumber(row.deposits);
  const withdrawn = toNumber(row.withdrawn);
  const userCash = toNumber(row.user_cash);

  return {
    cash: {
      deposits: round(deposits),
      withdrawn: round(withdrawn),
      withdrawal_fees: round(row.withdrawal_fees),
      // What actually came in and stayed in.
      net_inflow: round(deposits - withdrawn),
      pending_withdrawals: round(row.withdrawal_pending),
      pending_withdrawal_count: Number(row.withdrawal_pending_count || 0),
      user_balances: round(userCash),
      holders: Number(row.cash_holders || 0),
      // Positive means players hold more than ever came in through deposits.
      uncovered: round(userCash - (deposits - withdrawn)),
    },
    fees: {
      project_usdt: round(row.fee_project_usdt),
      project_star: round(row.fee_project_star),
      total_usdt: round(row.fee_total_usdt),
      referral_usdt: round(row.fee_referral_usdt),
      clan_usdt: round(row.fee_clan_usdt),
      execution_usdt: round(row.trade_fee_usdt),
      execution_star: round(row.trade_fee_star),
    },
    liabilities: {
      bonus_usdt: round(row.user_bonus),
      bonus_reserve: round(row.reserve_balance),
      bonus_reserve_funded: round(row.reserve_funded),
      bonus_reserve_released: round(row.reserve_released),
      stars: round(row.user_stars, 0),
      star_holders: Number(row.star_holders || 0),
      clan_bank_usdt: round(row.clan_bank_usdt),
      clan_bank_star: round(row.clan_bank_star, 0),
    },
    star_flow: {
      printed_tasks: round(row.star_tasks, 0),
      printed_referrals: round(row.star_referrals, 0),
      staked: round(row.star_stakes, 0),
      paid_out: round(row.star_payouts, 0),
      // Markets are a sink only while they pay out less than they take in.
      market_net: round(toNumber(row.star_payouts) - toNumber(row.star_stakes), 0),
    },
    market_maker: makerResult.rows.map((book) => ({
      book_type: book.book_type,
      realized_pnl: round(book.realized),
      open_collateral: round(book.open_collateral),
      open_nav: round(book.open_nav),
    })),
  };
}
