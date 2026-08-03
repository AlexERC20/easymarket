import test from "node:test";
import assert from "node:assert/strict";

import { assertSpecialMarketSolvency } from "../src/services/marketService.js";

const MARKET = { symbol: "SPECIAL:KYIVSTONER_8", liquidity: 7_000 };

test("a special market never owes one side more than its collateral", () => {
  // 7000 units of liquidity back 7000 USDT of payout, or 1.75M stars at 250:1.
  assert.doesNotThrow(() => assertSpecialMarketSolvency({
    market: MARKET, side: "NO", shares: 1_000_000, currency: "STAR", outstandingShares: 0,
  }));
  assert.throws(
    () => assertSpecialMarketSolvency({
      market: MARKET, side: "NO", shares: 2_000_000, currency: "STAR", outstandingShares: 0,
    }),
    /market_liability_cap/,
  );

  // The cap counts what the market already owes, not just this trade.
  assert.throws(
    () => assertSpecialMarketSolvency({
      market: MARKET, side: "NO", shares: 800_000, currency: "STAR", outstandingShares: 1_000_000,
    }),
    /market_liability_cap/,
  );
});

test("the liability cap is what the tail exploit would have hit", () => {
  // The farm accumulated roughly 1.8M NO shares for 1800 stars and cashed out
  // 733k. Under the cap that accumulation stops partway.
  assert.throws(
    () => assertSpecialMarketSolvency({
      market: MARKET, side: "NO", shares: 1_800_000, currency: "STAR", outstandingShares: 0,
    }),
    /market_liability_cap/,
  );
});

test("USDT and star books are capped in their own units", () => {
  // 7000 USDT of payout is the cap for a cash position.
  assert.doesNotThrow(() => assertSpecialMarketSolvency({
    market: MARKET, side: "YES", shares: 6_900, currency: "USDT", outstandingShares: 0,
  }));
  assert.throws(
    () => assertSpecialMarketSolvency({
      market: MARKET, side: "YES", shares: 7_100, currency: "USDT", outstandingShares: 0,
    }),
    /market_liability_cap/,
  );
});

test("a market with no configured liquidity still has a floor cap", () => {
  const bare = { symbol: "SPECIAL:KYIVSTONER_8", liquidity: 0 };
  assert.throws(
    () => assertSpecialMarketSolvency({
      market: bare, side: "YES", shares: 500, currency: "USDT", outstandingShares: 0,
    }),
    /market_liability_cap/,
  );
});
