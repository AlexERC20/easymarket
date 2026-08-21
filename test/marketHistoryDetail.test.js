import assert from "node:assert/strict";
import test from "node:test";

import { buildUserMarketHistoryDetail } from "../src/services/marketService.js";

test("market history detail reconciles a hedged market from actual cash flows and fees", () => {
  const detail = buildUserMarketHistoryDetail({
    market: {
      id: 42,
      symbol: "BTCUSDT_5M",
      question: "BTC выше?",
      question_en: "Will BTC close higher?",
      status: "resolved",
      winner: "YES",
      open_price: 100,
      close_price: 101,
      resolved_at: "2026-08-22T10:05:00.000Z",
    },
    currency: "USDT",
    positions: [
      { id: 1, side: "YES", shares: 10, spent: 5, payout: 9.5, pnl: 4.5, status: "resolved" },
      { id: 2, side: "NO", shares: 12, spent: 5, payout: 0, pnl: -5, status: "resolved" },
    ],
    trades: [
      {
        id: 10,
        action: "BUY",
        side: "YES",
        amount: 10,
        fee: 0.1,
        trade_fee: 0.1,
        gross_amount: 9.9,
        price: 0.495,
        shares: 20,
        currency: "USDT",
        book_type: "USDT_CASH",
        liquidity_role: "TAKER",
        created_at: "2026-08-22T10:00:10.000Z",
      },
      {
        id: 11,
        action: "BUY",
        side: "NO",
        amount: 5,
        fee: 0,
        trade_fee: 0,
        gross_amount: 5,
        price: 5 / 12,
        shares: 12,
        currency: "USDT",
        book_type: "USDT_CASH",
        liquidity_role: "MAKER",
        created_at: "2026-08-22T10:01:00.000Z",
      },
      {
        id: 12,
        action: "SELL",
        side: "YES",
        amount: 5.74,
        fee: 0.26,
        trade_fee: 0.06,
        gross_amount: 6,
        price: 0.6,
        shares: 10,
        currency: "USDT",
        book_type: "USDT_CASH",
        liquidity_role: "TAKER",
        created_at: "2026-08-22T10:03:00.000Z",
      },
    ],
    orders: [
      {
        id: 99,
        side: "NO",
        order_side: "BUY",
        limit_price: 5 / 12,
        shares: 12,
        filled_shares: 12,
        remaining_shares: 0,
        reserved_amount: 5,
        fee_paid: 0,
        status: "filled",
        book_type: "USDT_CASH",
        created_at: "2026-08-22T10:00:50.000Z",
        filled_at: "2026-08-22T10:01:00.000Z",
      },
    ],
    tradeFees: [
      { trade_id: 10, order_id: null, amount: 0.1 },
      { trade_id: 12, order_id: 99, amount: 0.06 },
    ],
    profitFees: [
      {
        trade_id: 12,
        position_id: 1,
        reason: "clob_sell_profit_fee",
        total_fee: 0.2,
        project_fee: 0.14,
        referral_fee: 0.03,
        clan_fee: 0.03,
        bonus_unlock_fee: 0,
        bonus_fee: 0,
      },
      {
        trade_id: null,
        position_id: 1,
        reason: "market_settlement_profit_fee",
        total_fee: 0.5,
        project_fee: 0.35,
        referral_fee: 0.05,
        clan_fee: 0.05,
        bonus_unlock_fee: 0.05,
        bonus_fee: 0,
      },
      {
        event_key: "limit_order:99:profit_fee",
        trade_id: null,
        position_id: 1,
        reason: "limit_sell_profit_fee",
        total_fee: 0.2,
        project_fee: 0.14,
        referral_fee: 0.03,
        clan_fee: 0.03,
        bonus_unlock_fee: 0,
        bonus_fee: 0,
      },
    ],
    settlementCredits: [
      { account: "CASH", amount: 9.5, reason: "market_payout_usdt" },
    ],
  });

  assert.equal(detail.is_hedged, true);
  assert.equal(detail.summary.total_buy_cost, 15);
  assert.equal(detail.summary.total_sell_proceeds, 5.74);
  assert.equal(detail.summary.settlement_payout, 9.5);
  assert.equal(detail.summary.total_return, 15.24);
  assert.equal(detail.summary.net_pnl, 0.24);
  assert.equal(detail.summary.execution_fee, 0.16);
  assert.equal(detail.summary.exit_profit_fee, 0.2);
  assert.equal(detail.summary.settlement_profit_fee, 0.5);
  assert.equal(detail.summary.service_fee, 0.86);
  assert.equal(detail.fee_distribution.referral_fee, 0.08);
  assert.equal(detail.fee_distribution.clan_fee, 0.08);
  assert.equal(detail.executions[2].gross_amount, 6);
  assert.equal(detail.executions[2].net_amount, 5.74);
  assert.equal(detail.orders[0].filled_shares, 12);
  assert.equal(detail.sides.find((side) => side.side === "YES").settlement_price, 1);
  assert.equal(detail.sides.find((side) => side.side === "NO").settlement_price, 0);
});

test("market history detail falls back to recorded trade fees for legacy exits", () => {
  const detail = buildUserMarketHistoryDetail({
    market: { id: 7, symbol: "BTCUSDT", status: "resolved", winner: "NO" },
    currency: "STAR",
    trades: [
      { id: 1, action: "BUY", side: "NO", amount: 100, price: 0.5, shares: 200, fee: 0 },
      { id: 2, action: "SELL", side: "NO", amount: 118, price: 0.6, shares: 200, fee: 2, trade_fee: 0 },
    ],
    settlementCredits: [],
  });

  assert.equal(detail.executions[1].profit_fee, 2);
  assert.equal(detail.executions[1].gross_amount, 120);
  assert.equal(detail.summary.service_fee, 2);
  assert.equal(detail.summary.net_pnl, 18);
});
