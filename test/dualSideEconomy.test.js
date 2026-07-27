import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromoUsdtPlayProgress,
  calculateResolvedPositionSettlement,
  getBuyExecutionQuote,
  getLuckySpentForBuy,
  getRefundableMarketLoss,
  splitUsdtSpend,
} from "../src/services/marketService.js";
import { buildUnlockStatus } from "../src/services/bonusEconomyService.js";
import { normalizeUsdtDepositAmount } from "../src/services/usdtDepositService.js";
import { calculateUsdtWithdrawalAmounts } from "../src/services/usdtWithdrawalService.js";

const economySettings = {
  profit_fee_bps: 700,
  star_profit_fee_bps: 1500,
};

function buildMarket(overrides = {}) {
  return {
    id: 1,
    symbol: "SPORT:test-market",
    open_price: 1,
    current_price: 1,
    yes_price: 0.54148438,
    no_price: 0.23518574,
    yes_volume: 100,
    no_volume: 50,
    liquidity: 10_000,
    start_time: new Date(Date.now() - 60_000).toISOString(),
    end_time: new Date(Date.now() + 60_000).toISOString(),
    is_lucky: false,
    ...overrides,
  };
}

function executeSequentialBuys(sequence) {
  let market = buildMarket();
  const shares = { YES: 0, NO: 0 };
  let totalSpent = 0;

  for (const { side, amount } of sequence) {
    const oppositePrice = Number(side === "YES" ? market.no_price : market.yes_price);
    const quote = getBuyExecutionQuote(market, side, amount);
    assert.ok(
      quote.executionPrice + oppositePrice >= 1 - 1e-8,
      `${side} ask must not create a cross-book price below 1`,
    );

    shares[side] += amount / quote.executionPrice;
    totalSpent += amount;
    market = {
      ...market,
      yes_price: quote.nextYesPrice,
      no_price: quote.nextNoPrice,
      yes_volume: market.yes_volume + (side === "YES" ? amount : 0),
      no_volume: market.no_volume + (side === "NO" ? amount : 0),
    };
  }

  return { shares, totalSpent };
}

test("opposite market buys cannot lock guaranteed profit", () => {
  for (const sequence of [
    [{ side: "YES", amount: 100 }, { side: "NO", amount: 50 }],
    [{ side: "NO", amount: 50 }, { side: "YES", amount: 100 }],
  ]) {
    const { shares, totalSpent } = executeSequentialBuys(sequence);
    assert.ok(
      Math.min(shares.YES, shares.NO) <= totalSpent + 1e-8,
      "the minimum resolved payout must not exceed the combined stake",
    );
  }
});

test("losing side pays zero in both STAR and USDT settlements", () => {
  const expectedByCurrency = {
    STAR: { fee: 15, payout: 185, pnl: 85 },
    USDT: { fee: 7, payout: 193, pnl: 93 },
  };
  for (const currency of ["STAR", "USDT"]) {
    const loser = calculateResolvedPositionSettlement(
      {
        side: "NO",
        shares: 200,
        spent: 100,
        lucky_spent: 0,
        currency,
      },
      buildMarket(),
      "YES",
      economySettings,
    );
    assert.equal(loser.grossPayout, 0);
    assert.equal(loser.payout, 0);
    assert.equal(loser.pnl, -100);

    const winner = calculateResolvedPositionSettlement(
      {
        side: "YES",
        shares: 200,
        spent: 100,
        lucky_spent: 0,
        currency,
      },
      buildMarket(),
      "YES",
      economySettings,
    );
    const expected = expectedByCurrency[currency];
    assert.equal(winner.fee, expected.fee);
    assert.equal(winner.payout, expected.payout);
    assert.equal(winner.pnl, expected.pnl);
  }
});

test("lucky x2 is revoked when the user holds the opposite side", () => {
  const luckyMarket = buildMarket({
    lucky_until: new Date(Date.now() + 30_000).toISOString(),
  });
  assert.equal(getLuckySpentForBuy(luckyMarket, false, 100), 100);
  assert.equal(getLuckySpentForBuy(luckyMarket, true, 100), 0);
  assert.equal(
    getLuckySpentForBuy(
      { ...luckyMarket, lucky_until: new Date(Date.now() - 1_000).toISOString() },
      false,
      100,
    ),
    0,
  );
});

test("USDT loss refund uses aggregate market loss, not the losing leg", () => {
  assert.equal(getRefundableMarketLoss(25, 100), 0);
  assert.equal(getRefundableMarketLoss(0, 100), 0);
  assert.equal(getRefundableMarketLoss(-12.346, 100), 12.35);
  assert.equal(getRefundableMarketLoss(-80, 30), 30);
});

test("USDT withdrawal deducts a fixed fee from the requested amount", () => {
  assert.deepEqual(calculateUsdtWithdrawalAmounts(18, 3, 18), {
    amount: 18,
    fee: 3,
    payout: 15,
  });
  assert.throws(
    () => calculateUsdtWithdrawalAmounts(17.99, 3, 18),
    /withdrawal_amount_below_minimum/,
  );
});

test("USDT deposits start at 18", () => {
  assert.equal(normalizeUsdtDepositAmount(18, 18), 18);
  assert.throws(
    () => normalizeUsdtDepositAmount(17.99, 18),
    /invalid_deposit_amount/,
  );
});

test("a USDT bet uses exactly one balance source", () => {
  assert.deepEqual(splitUsdtSpend(5, { cash: 5, bonus: 100 }), {
    cash: 5,
    bonus: 0,
  });
  assert.deepEqual(splitUsdtSpend(5, { cash: 4.99, bonus: 100 }), {
    cash: 0,
    bonus: 5,
  });
  assert.deepEqual(splitUsdtSpend(5, { cash: 4.9999, bonus: 100 }), {
    cash: 0,
    bonus: 5,
  });
  assert.equal(splitUsdtSpend(5, { cash: 3, bonus: 2 }), null);
  assert.equal(splitUsdtSpend(5, { cash: 4, bonus: 4 }), null);
});

test("bonus conversion needs both a deposit and real USDT play", () => {
  const depositedOnly = buildUnlockStatus({
    depositTotal: 100,
    bonusBalance: 50,
    cashPlayQualified: false,
  });
  assert.equal(depositedOnly.deposit_qualified, true);
  assert.equal(depositedOnly.cash_play_qualified, false);
  assert.equal(depositedOnly.eligible, false);

  const qualified = buildUnlockStatus({
    depositTotal: 100,
    bonusBalance: 50,
    cashPlayQualified: true,
  });
  assert.equal(qualified.eligible, true);
  assert.equal(qualified.rate_bps, 50);
});

test("promo USDT ladder advances by distinct cash-backed markets", () => {
  assert.deepEqual(buildPromoUsdtPlayProgress(0).claimed_levels, []);
  const progress = buildPromoUsdtPlayProgress(5, 125, "2026-07-27");
  assert.deepEqual(progress.claimed_levels, [1, 2, 3]);
  assert.equal(progress.level, 4);
  assert.equal(progress.target, 10);
  assert.equal(progress.cash_staked, 125);
});
