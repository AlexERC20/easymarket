import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromoUsdtPlayProgress,
  calculateResolvedPositionSettlement,
  getBuyExecutionQuote,
  getCollateralizedExecutionFloor,
  getLuckySpentForBuy,
  getMarketMakerPayoutMultiplier,
  getPricingWeight,
  getRefundableMarketLoss,
  getTimeAdjustedPayoutMultiplier,
  splitUsdtSpend,
} from "../src/services/marketService.js";
import {
  buildStarConversionStatus,
  buildUnlockStatus,
  getStarConversionDepositRequirement,
} from "../src/services/bonusEconomyService.js";
import { normalizeUsdtDepositAmount } from "../src/services/usdtDepositService.js";
import { calculateUsdtWithdrawalAmounts } from "../src/services/usdtWithdrawalService.js";
import { isAccountSnapshotCurrent } from "../public/account-state.js";

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

test("star bets use a thinner dedicated pricing book", () => {
  // Ровный рынок: иначе цену задаёт нижняя граница книги, а не размер ставки.
  const market = buildMarket({ yes_price: 0.5, no_price: 0.5, yes_volume: 100, no_volume: 100 });
  const usdtQuote = getBuyExecutionQuote(market, "YES", 500, { pricingWeight: 1 });
  const starQuote = getBuyExecutionQuote(market, "YES", 500, {
    pricingWeight: getPricingWeight("STAR"),
  });

  // 500 STAR не должны двигать рынок как $500, но отдельная глубина книги
  // делает их влияние сильнее старого курса конвертации 1000:1.
  assert.ok(
    starQuote.nextYesPrice < usdtQuote.nextYesPrice,
    "a star bet must move the price less than the same number of dollars",
  );
  assert.ok(
    starQuote.nextYesPrice - market.yes_price < 0.005,
    "500 stars must barely move the price",
  );
  assert.ok(
    usdtQuote.nextYesPrice - market.yes_price > 0.05,
    "the dollar bet must still move the price",
  );
  assert.equal(getPricingWeight("USDT"), 1);
  assert.equal(getPricingWeight("STAR"), 1 / 250);
});

test("STAR market-maker buys cannot exceed a 15x gross payout", () => {
  const tailMarket = buildMarket({
    symbol: "BTCUSDT",
    yes_price: 0.002,
    no_price: 0.998,
    current_price: 99,
    open_price: 100,
    yes_volume: 0,
    no_volume: 100,
  });
  const amount = 50;
  const quote = getBuyExecutionQuote(tailMarket, "YES", amount, {
    pricingWeight: getPricingWeight("STAR"),
    maxPayoutMultiplier: getMarketMakerPayoutMultiplier("STAR"),
  });
  const shares = amount / quote.executionPrice;

  assert.ok(quote.executionPrice >= 1 / 15);
  assert.ok(shares <= amount * 15);
  assert.equal(getMarketMakerPayoutMultiplier("STAR"), 15);
  assert.equal(getMarketMakerPayoutMultiplier("USDT"), 25);
});

test("a capped STAR tail buy reprices the book before the next buy", () => {
  const market = buildMarket({
    symbol: "BTCUSDT",
    yes_price: 0.002,
    no_price: 0.998,
    current_price: 99,
    open_price: 100,
    yes_volume: 0,
    no_volume: 100,
  });
  const options = {
    pricingWeight: getPricingWeight("STAR"),
    maxPayoutMultiplier: getMarketMakerPayoutMultiplier("STAR"),
  };
  const first = getBuyExecutionQuote(market, "YES", 50, options);
  const second = getBuyExecutionQuote({
    ...market,
    yes_price: first.nextYesPrice,
    no_price: first.nextNoPrice,
    yes_volume: market.yes_volume + 50 * getPricingWeight("STAR"),
  }, "YES", 50, options);

  assert.ok(first.nextYesPrice >= 1 / 15);
  assert.ok(second.executionPrice > first.executionPrice);
});

test("split STAR tail buys cannot mint beyond the market risk budget", () => {
  const riskBudget = 500;
  const amount = 50;
  let pool = 0;
  let liability = 0;
  let market = buildMarket({
    symbol: "BTCUSDT",
    yes_price: 0.002,
    no_price: 0.998,
    current_price: 99,
    open_price: 100,
    yes_volume: 0,
    no_volume: 100,
  });

  for (let index = 0; index < 20; index += 1) {
    const executionFloor = getCollateralizedExecutionFloor({
      amount,
      pool,
      liability,
      riskBudget,
      minPrice: 0.001,
    });
    const quote = getBuyExecutionQuote(market, "YES", amount, {
      pricingWeight: getPricingWeight("STAR"),
      maxPayoutMultiplier: getMarketMakerPayoutMultiplier("STAR"),
      executionFloor,
    });
    const shares = amount / quote.executionPrice;
    pool += amount;
    liability += shares;
    market = {
      ...market,
      yes_price: quote.nextYesPrice,
      no_price: quote.nextNoPrice,
      yes_volume: market.yes_volume + amount * getPricingWeight("STAR"),
    };
  }

  assert.ok(
    liability - pool <= riskBudget + 1,
    "repeating a small click must not reset the AMM risk allowance",
  );
  assert.ok(market.yes_price > 0.95, "an exhausted tail must reprice instead of rejecting the bet");
});

test("BTC payout multiplier decays sharply near settlement", () => {
  const now = Date.now();
  const market = buildMarket({
    symbol: "BTCUSDT",
    start_time: new Date(now - 240_000).toISOString(),
    end_time: new Date(now + 60_000).toISOString(),
  });
  const base = 15;
  const atWindowStart = getTimeAdjustedPayoutMultiplier(market, base, now);
  const atThirtySeconds = getTimeAdjustedPayoutMultiplier(
    { ...market, end_time: new Date(now + 30_000).toISOString() },
    base,
    now,
  );
  const atTenSeconds = getTimeAdjustedPayoutMultiplier(
    { ...market, end_time: new Date(now + 10_000).toISOString() },
    base,
    now,
  );
  const atFreeze = getTimeAdjustedPayoutMultiplier(
    { ...market, end_time: new Date(now + 5_000).toISOString() },
    base,
    now,
  );
  const nonBtc = getTimeAdjustedPayoutMultiplier(
    { ...market, symbol: "SPORT:test-market" },
    base,
    now,
  );

  assert.equal(atWindowStart, base);
  assert.ok(atThirtySeconds < 5);
  assert.ok(atTenSeconds < 1.2);
  assert.equal(atFreeze, 1);
  assert.equal(nonBtc, base);
});

test("a stale collateral floor cannot lock a new market buy", () => {
  const market = buildMarket({
    symbol: "BTCUSDT",
    yes_price: 0.5,
    no_price: 0.5,
    yes_ask_floor: 0.999,
    no_ask_floor: 0.999,
    yes_volume: 0,
    no_volume: 0,
  });
  const quote = getBuyExecutionQuote(market, "YES", 5, {
    maxPayoutMultiplier: getMarketMakerPayoutMultiplier("USDT"),
  });

  assert.ok(quote.executionPrice > 0.5);
  assert.ok(quote.executionPrice < 0.6);
});

test("USDT MM risk stays bounded during repeated one-sided buys", () => {
  const riskBudget = 100;
  const amount = 5;
  let pool = 0;
  let liability = 0;
  let accepted = 0;

  for (let index = 0; index < 50; index += 1) {
    const floor = getCollateralizedExecutionFloor({
      amount,
      pool,
      liability,
      riskBudget,
      minPrice: 0.001,
    });
    if (floor >= 0.999) {
      break;
    }
    const executionPrice = Math.max(0.1, floor);
    pool += amount;
    liability += amount / executionPrice;
    accepted += 1;
    assert.ok(
      liability - pool <= riskBudget + 0.0001,
      "one-sided winning liability must stay inside the explicit MM budget",
    );
  }

  assert.ok(accepted > 1);
  assert.ok(accepted < 50, "the MM must stop minting an unbacked tail indefinitely");
});

test("opposite USDT stakes restore collateral capacity", () => {
  const riskBudget = 100;
  const exhaustedYes = getCollateralizedExecutionFloor({
    amount: 5,
    pool: 10,
    liability: 110,
    riskBudget,
    minPrice: 0.001,
  });
  const backedYes = getCollateralizedExecutionFloor({
    amount: 5,
    pool: 110,
    liability: 110,
    riskBudget,
    minPrice: 0.001,
  });

  assert.equal(exhaustedYes, 0.999);
  assert.ok(backedYes < 0.05);
});

test("a large first USDT tail bet cannot expose more than the starter risk budget", () => {
  const floor = getCollateralizedExecutionFloor({
    amount: 100,
    pool: 0,
    liability: 0,
    riskBudget: 25,
    minPrice: 0.001,
  });

  assert.equal(floor, 0.8);
});

test("an account snapshot started before a balance mutation is rejected", () => {
  assert.equal(isAccountSnapshotCurrent(4, 4), true);
  assert.equal(isAccountSnapshotCurrent(4, 5), false);
});

test("lucky x2 is disabled for every market buy", () => {
  const luckyMarket = buildMarket({
    lucky_until: new Date(Date.now() + 30_000).toISOString(),
  });
  assert.equal(getLuckySpentForBuy(luckyMarket, false, 100), 0);
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

test("star conversion deposit follows 10% of frozen value with an 18 USDT floor", () => {
  assert.equal(getStarConversionDepositRequirement(100_000), 18);
  assert.equal(getStarConversionDepositRequirement(180_000), 18);
  assert.equal(getStarConversionDepositRequirement(180_001), 18.01);
  assert.equal(getStarConversionDepositRequirement(1_000_000), 100);

  const belowDynamicThreshold = buildStarConversionStatus({
    depositTotal: 50,
    starBalance: 1_000_000,
    cashPlayQualified: true,
  });
  assert.equal(belowDynamicThreshold.deposit_required, 100);
  assert.equal(belowDynamicThreshold.deposit_shortfall, 50);
  assert.equal(belowDynamicThreshold.deposit_topup_required, 50);
  assert.equal(belowDynamicThreshold.deposit_qualified, false);
  assert.equal(belowDynamicThreshold.eligible, false);

  const minimumTopup = buildStarConversionStatus({
    depositTotal: 10,
    starBalance: 100_000,
    cashPlayQualified: true,
  });
  assert.equal(minimumTopup.deposit_required, 18);
  assert.equal(minimumTopup.deposit_shortfall, 8);
  assert.equal(minimumTopup.deposit_topup_required, 18);

  const qualified = buildStarConversionStatus({
    depositTotal: 100,
    starBalance: 1_000_000,
    cashPlayQualified: true,
  });
  assert.equal(qualified.deposit_qualified, true);
  assert.equal(qualified.deposit_shortfall, 0);
  assert.equal(qualified.eligible, true);
});

test("promo USDT ladder advances by distinct cash-backed markets", () => {
  assert.deepEqual(buildPromoUsdtPlayProgress(0).claimed_levels, []);
  const progress = buildPromoUsdtPlayProgress(5, 125, "2026-07-27");
  assert.deepEqual(progress.claimed_levels, [1, 2, 3]);
  assert.equal(progress.level, 4);
  assert.equal(progress.target, 10);
  assert.equal(progress.cash_staked, 125);
});
