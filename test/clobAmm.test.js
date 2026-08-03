import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAmmInventoryFill,
  buildAmmQuoteLadder,
  calculateAmmNav,
  calculateAmmRiskState,
  calculateBinaryFairProbability,
  calculateExecutionFee,
  calculateNextAmmAllocation,
} from "../src/services/ammMath.js";

function buildBook(overrides = {}) {
  return buildAmmQuoteLadder({
    fairYes: 0.5,
    spreadBps: 200,
    levels: 5,
    riskCapital: 1_000,
    riskMultiplier: 1,
    yesInventory: 1_000,
    noInventory: 1_000,
    ...overrides,
  });
}

test("BTC fair probability starts close to 50/50 and follows the external price", () => {
  const flat = calculateBinaryFairProbability({
    openPrice: 70_000,
    currentPrice: 70_000,
    secondsLeft: 300,
    sigmaPerSqrtSecond: 0.000065,
  });
  const up = calculateBinaryFairProbability({
    openPrice: 70_000,
    currentPrice: 70_140,
    secondsLeft: 120,
    sigmaPerSqrtSecond: 0.000065,
  });
  const down = calculateBinaryFairProbability({
    openPrice: 70_000,
    currentPrice: 69_860,
    secondsLeft: 120,
    sigmaPerSqrtSecond: 0.000065,
  });

  assert.ok(flat > 0.49 && flat < 0.51);
  assert.ok(up > flat);
  assert.ok(down < flat);
});

test("AMM never quotes a complete YES+NO pair below collateral", () => {
  for (const fairYes of [0.001, 0.01, 0.1, 0.5, 0.9, 0.99, 0.999]) {
    const book = buildBook({ fairYes });
    const bestYesAsk = book.yes.asks[0].price;
    const bestNoAsk = book.no.asks[0].price;
    const bestYesBid = book.yes.bids[0].price;
    const bestNoBid = book.no.bids[0].price;
    assert.ok(bestYesAsk + bestNoAsk >= 1.001 - 1e-9, `crossed asks at ${fairYes}`);
    assert.ok(bestYesBid + bestNoBid <= 0.999 + 1e-9, `crossed bids at ${fairYes}`);
  }
});

test("instant buy/sell farming loses to spread and execution fees", () => {
  const book = buildBook({ fairYes: 0.63 });
  const ask = book.yes.asks[0].price;
  const bid = book.yes.bids[0].price;
  const shares = 100;
  const buyGross = shares * ask;
  const sellGross = shares * bid;
  const buyFee = calculateExecutionFee(buyGross, 100);
  const sellFee = calculateExecutionFee(sellGross, 100);
  const userPnl = sellGross - sellFee - buyGross - buyFee;

  assert.ok(ask > bid);
  assert.ok(userPnl < 0);
});

test("sweeping and immediately returning AMM inventory is negative across fair-price tails", () => {
  for (const fairYes of [0.001, 0.01, 0.05, 0.1, 0.5, 0.9, 0.99, 0.999]) {
    let account = { cashBalance: 0, yesInventory: 1_000, noInventory: 1_000 };
    const entryBook = buildBook({ fairYes, ...account });
    let boughtShares = 0;
    let entryCost = 0;
    for (const level of entryBook.yes.asks) {
      account = applyAmmInventoryFill({
        action: "BUY",
        side: "YES",
        price: level.price,
        shares: level.shares,
        ...account,
      });
      boughtShares += level.shares;
      entryCost += level.amount + calculateExecutionFee(level.amount, 100);
    }

    const exitBook = buildBook({ fairYes, ...account });
    let sharesLeft = boughtShares;
    let exitProceeds = 0;
    for (const level of exitBook.yes.bids) {
      const shares = Math.min(sharesLeft, level.shares);
      if (shares <= 0) continue;
      const gross = shares * level.price;
      account = applyAmmInventoryFill({
        action: "SELL",
        side: "YES",
        price: level.price,
        shares,
        ...account,
      });
      sharesLeft -= shares;
      exitProceeds += gross - calculateExecutionFee(gross, 100);
    }

    const markedRemainder = sharesLeft * fairYes;
    assert.ok(
      exitProceeds + markedRemainder < entryCost,
      `round-trip farm became profitable at fair=${fairYes}`,
    );
  }
});

test("buying both outcomes cannot lock guaranteed profit", () => {
  const book = buildBook({ fairYes: 0.71 });
  const yesAsk = book.yes.asks[0].price;
  const noAsk = book.no.asks[0].price;
  const pairCost = yesAsk + noAsk
    + calculateExecutionFee(yesAsk, 100)
    + calculateExecutionFee(noAsk, 100);

  assert.ok(pairCost > 1);
  assert.ok(1 - pairCost < 0);
});

test("sequential inventory skew cannot turn a complete-set round trip into arbitrage", () => {
  for (const fairYes of [0.001, 0.01, 0.05, 0.5, 0.95, 0.99, 0.999]) {
    let sellerAccount = { cashBalance: 0, yesInventory: 1_000, noInventory: 1_000 };
    let book = buildBook({ fairYes, ...sellerAccount });
    const yesBid = book.yes.bids[0].price;
    sellerAccount = applyAmmInventoryFill({
      action: "SELL", side: "YES", price: yesBid, shares: 1, ...sellerAccount,
    });
    book = buildBook({ fairYes, ...sellerAccount });
    const noBid = book.no.bids[0].price;
    const pairProceeds = yesBid + noBid
      - calculateExecutionFee(yesBid, 100)
      - calculateExecutionFee(noBid, 100);
    assert.ok(pairProceeds < 1, `sequential pair sale crossed collateral at fair=${fairYes}`);

    let buyerAccount = { cashBalance: 0, yesInventory: 1_000, noInventory: 1_000 };
    book = buildBook({ fairYes, ...buyerAccount });
    const yesAsk = book.yes.asks[0].price;
    buyerAccount = applyAmmInventoryFill({
      action: "BUY", side: "YES", price: yesAsk, shares: 1, ...buyerAccount,
    });
    book = buildBook({ fairYes, ...buyerAccount });
    const noAsk = book.no.asks[0].price;
    const pairCost = yesAsk + noAsk
      + calculateExecutionFee(yesAsk, 100)
      + calculateExecutionFee(noAsk, 100);
    assert.ok(pairCost > 1, `sequential pair buy crossed collateral at fair=${fairYes}`);
  }
});

test("tail quotes are finite and cannot mint shares beyond inventory", () => {
  const book = buildBook({ fairYes: 0.001 });
  const quotedYes = book.yes.asks.reduce((sum, level) => sum + level.shares, 0);
  const quotedNo = book.no.asks.reduce((sum, level) => sum + level.shares, 0);
  assert.ok(quotedYes <= 1_000 + 1e-8);
  assert.ok(quotedNo <= 1_000 + 1e-8);
  assert.ok(book.yes.asks.every((level) => Number.isFinite(level.shares)));
});

test("AMM never publishes bids without cash or mergeable complete pairs", () => {
  const stranded = buildBook({
    cashBalance: 0,
    yesInventory: 0,
    noInventory: 2_000,
  });
  assert.equal(stranded.yes.bids.length, 0);
  assert.equal(stranded.no.bids.length, 0);

  const funded = buildBook({
    cashBalance: 80,
    yesInventory: 0,
    noInventory: 2_000,
  });
  const totalBidNotional = [...funded.yes.bids, ...funded.no.bids]
    .reduce((sum, level) => sum + level.amount, 0);
  assert.ok(totalBidNotional <= 80 + 1e-8);
});

test("inventory skew makes accumulated inventory cheaper to sell", () => {
  const balanced = buildBook();
  const longYes = buildBook({ yesInventory: 1_600, noInventory: 400 });
  assert.ok(longYes.yes.asks[0].price < balanced.yes.asks[0].price);
  assert.ok(longYes.no.bids[0].price > balanced.no.bids[0].price);
});

test("risk controller cuts size quickly and halts at maximum drawdown", () => {
  const healthy = calculateAmmRiskState({
    initialCollateral: 1_000,
    currentNav: 1_000,
    peakNav: 1_000,
    rapidLossBps: 500,
    maxDrawdownBps: 1_500,
    minimumQuoteCapital: 20,
  });
  const damaged = calculateAmmRiskState({
    initialCollateral: 1_000,
    currentNav: 900,
    peakNav: 1_000,
    rapidLossBps: 500,
    maxDrawdownBps: 1_500,
    minimumQuoteCapital: 20,
  });
  const halted = calculateAmmRiskState({
    initialCollateral: 1_000,
    currentNav: 840,
    peakNav: 1_000,
    rapidLossBps: 500,
    maxDrawdownBps: 1_500,
    minimumQuoteCapital: 20,
  });

  assert.equal(healthy.riskMultiplier, 1);
  assert.ok(damaged.riskMultiplier < 0.3);
  assert.equal(halted.status, "HALTED");
  assert.equal(halted.riskMultiplier, 0);
});

test("settled AMM losses cut following market allocations down to the capital floor", () => {
  const firstLoss = calculateNextAmmAllocation({
    currentMultiplier: 1,
    initialCollateral: 1_000,
    realizedPnl: -100,
    lossStreak: 0,
    minimumMultiplier: 0.02,
  });
  const secondLoss = calculateNextAmmAllocation({
    currentMultiplier: firstLoss.allocationMultiplier,
    initialCollateral: 250,
    realizedPnl: -25,
    lossStreak: firstLoss.lossStreak,
    minimumMultiplier: 0.02,
  });

  assert.equal(firstLoss.allocationMultiplier, 0.25);
  assert.equal(secondLoss.allocationMultiplier, 0.03125);
  assert.equal(secondLoss.lossStreak, 2);

  const catastrophicLoss = calculateNextAmmAllocation({
    currentMultiplier: 1,
    initialCollateral: 1_000,
    realizedPnl: -260,
    lossStreak: 0,
    minimumMultiplier: 0.02,
  });
  assert.equal(catastrophicLoss.allocationMultiplier, 0.02);
});

test("AMM NAV is conserved by a fair complete set", () => {
  const account = { cash_balance: 0, yes_inventory: 1_000, no_inventory: 1_000 };
  assert.equal(calculateAmmNav(account, 0.01), 1_000);
  assert.equal(calculateAmmNav(account, 0.5), 1_000);
  assert.equal(calculateAmmNav(account, 0.99), 1_000);
});

test("disabled auto risk keeps full size but still stops an insolvent book", () => {
  const drawdownThatWouldHalt = calculateAmmRiskState({
    initialCollateral: 1_000,
    currentNav: 840,
    peakNav: 1_000,
    rapidLossBps: 500,
    maxDrawdownBps: 1_500,
    minimumQuoteCapital: 20,
    autoRiskEnabled: false,
  });
  assert.equal(drawdownThatWouldHalt.status, "ACTIVE");
  assert.equal(drawdownThatWouldHalt.riskMultiplier, 1);
  assert.equal(drawdownThatWouldHalt.riskCapital, 840);

  const belowFloor = calculateAmmRiskState({
    initialCollateral: 1_000,
    currentNav: 5,
    peakNav: 1_000,
    rapidLossBps: 500,
    maxDrawdownBps: 1_500,
    minimumQuoteCapital: 20,
    autoRiskEnabled: false,
  });
  assert.equal(belowFloor.status, "ACTIVE");
  assert.equal(belowFloor.riskCapital, 5);

  const insolvent = calculateAmmRiskState({
    initialCollateral: 1_000,
    currentNav: 0,
    peakNav: 1_000,
    rapidLossBps: 500,
    maxDrawdownBps: 1_500,
    minimumQuoteCapital: 20,
    autoRiskEnabled: false,
  });
  assert.equal(insolvent.status, "HALTED");
  assert.equal(insolvent.riskMultiplier, 0);
  assert.equal(insolvent.stopReason, "insolvent");
});

test("disabled auto risk never carries a loss into the next market allocation", () => {
  const afterLoss = calculateNextAmmAllocation({
    currentMultiplier: 0.25,
    initialCollateral: 1_000,
    realizedPnl: -300,
    lossStreak: 4,
    minimumMultiplier: 0.02,
    autoRiskEnabled: false,
  });
  assert.equal(afterLoss.allocationMultiplier, 1);
  assert.equal(afterLoss.lossStreak, 0);
  assert.equal(afterLoss.status, "ACTIVE");
});

test("a collateral top-up mints one YES and one NO per added unit", () => {
  const before = { cash_balance: 120, yes_inventory: 400, no_inventory: 700 };
  const delta = 250;
  const after = {
    cash_balance: before.cash_balance,
    yes_inventory: before.yes_inventory + delta,
    no_inventory: before.no_inventory + delta,
  };
  for (const price of [0.02, 0.37, 0.5, 0.91]) {
    assert.equal(
      Math.round((calculateAmmNav(after, price) - calculateAmmNav(before, price)) * 1e6) / 1e6,
      delta,
    );
  }
});
