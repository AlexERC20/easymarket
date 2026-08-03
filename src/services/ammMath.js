const PRICE_TICK = 0.001;
const MIN_OUTCOME_PRICE = 0.001;
const MAX_OUTCOME_PRICE = 0.999;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, precision = 8) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function roundPrice(value) {
  return clamp(
    Math.round(Number(value) / PRICE_TICK) * PRICE_TICK,
    MIN_OUTCOME_PRICE,
    MAX_OUTCOME_PRICE,
  );
}

// Abramowitz-Stegun approximation. Accuracy is ample for a short-lived binary
// market and avoids bringing a numerical package into the request hot path.
export function normalCdf(value) {
  const x = Number(value);
  if (!Number.isFinite(x)) {
    return x > 0 ? 1 : 0;
  }
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function calculateBinaryFairProbability(input) {
  const openPrice = Number(input?.openPrice);
  const currentPrice = Number(input?.currentPrice);
  const secondsLeft = Math.max(0.05, Number(input?.secondsLeft || 0));
  const sigmaPerSqrtSecond = clamp(
    Number(input?.sigmaPerSqrtSecond || 0.000065),
    0.000035,
    0.001,
  );

  if (!(openPrice > 0) || !(currentPrice > 0)) {
    return 0.5;
  }

  const sigmaT = sigmaPerSqrtSecond * Math.sqrt(secondsLeft);
  const logMove = Math.log(currentPrice / openPrice);
  const zScore = (logMove - 0.5 * sigmaPerSqrtSecond ** 2 * secondsLeft)
    / Math.max(sigmaT, 1e-9);

  return roundTo(clamp(normalCdf(zScore), MIN_OUTCOME_PRICE, MAX_OUTCOME_PRICE), 6);
}

export function calculateAmmRiskState(input) {
  const initialCollateral = Math.max(0, Number(input?.initialCollateral || 0));
  const currentNav = Math.max(0, Number(input?.currentNav || 0));
  const peakNav = Math.max(initialCollateral, Number(input?.peakNav || 0), currentNav);
  const maxDrawdownBps = clamp(Number(input?.maxDrawdownBps || 1500), 100, 9900);
  const rapidLossBps = clamp(Number(input?.rapidLossBps || 500), 10, maxDrawdownBps);
  const minimumQuoteCapital = Math.max(0, Number(input?.minimumQuoteCapital || 20));
  const autoRiskEnabled = input?.autoRiskEnabled !== false;
  const drawdownBps = peakNav > 0 ? ((peakNav - currentNav) / peakNav) * 10_000 : 0;
  const lossFromStartBps = initialCollateral > 0
    ? ((initialCollateral - currentNav) / initialCollateral) * 10_000
    : 0;

  if (!autoRiskEnabled) {
    // Automatic throttling is off, so the book quotes its full collateral. The
    // solvency stop stays: an account with no net asset value has nothing left
    // to back a quote.
    return {
      status: currentNav > 0 ? "ACTIVE" : "HALTED",
      riskMultiplier: currentNav > 0 ? 1 : 0,
      riskCapital: roundTo(currentNav),
      drawdownBps: roundTo(drawdownBps, 2),
      lossFromStartBps: roundTo(lossFromStartBps, 2),
      peakNav: roundTo(peakNav),
      stopReason: currentNav > 0 ? null : "insolvent",
    };
  }

  if (currentNav < minimumQuoteCapital || drawdownBps >= maxDrawdownBps) {
    return {
      status: "HALTED",
      riskMultiplier: 0,
      riskCapital: roundTo(currentNav),
      drawdownBps: roundTo(drawdownBps, 2),
      lossFromStartBps: roundTo(lossFromStartBps, 2),
      peakNav: roundTo(peakNav),
      stopReason: currentNav < minimumQuoteCapital ? "capital_floor" : "max_drawdown",
    };
  }

  let riskMultiplier = 1;
  if (drawdownBps > rapidLossBps) {
    const range = Math.max(1, maxDrawdownBps - rapidLossBps);
    const progress = (drawdownBps - rapidLossBps) / range;
    riskMultiplier = clamp((1 - progress) ** 2, 0.02, 1);
  } else if (lossFromStartBps > rapidLossBps) {
    riskMultiplier = clamp(rapidLossBps / Math.max(lossFromStartBps, 1), 0.05, 1);
  }

  const riskCapital = Math.min(
    currentNav,
    Math.max(minimumQuoteCapital, initialCollateral * riskMultiplier),
  );

  return {
    status: "ACTIVE",
    riskMultiplier: roundTo(riskMultiplier, 6),
    riskCapital: roundTo(riskCapital),
    drawdownBps: roundTo(drawdownBps, 2),
    lossFromStartBps: roundTo(lossFromStartBps, 2),
    peakNav: roundTo(peakNav),
    stopReason: null,
  };
}

export function calculateNextAmmAllocation(input) {
  const currentMultiplier = clamp(Number(input?.currentMultiplier ?? 1), 0, 1);
  const initialCollateral = Math.max(0, Number(input?.initialCollateral || 0));
  const realizedPnl = Number(input?.realizedPnl || 0);
  const previousLossStreak = Math.max(0, Math.floor(Number(input?.lossStreak || 0)));
  const minimumMultiplier = clamp(Number(input?.minimumMultiplier || 0.02), 0, 1);
  const autoRiskEnabled = input?.autoRiskEnabled !== false;

  if (!autoRiskEnabled) {
    return {
      allocationMultiplier: 1,
      lossStreak: 0,
      lossRatio: initialCollateral > 0 && realizedPnl < 0
        ? roundTo(Math.abs(realizedPnl) / initialCollateral, 6)
        : 0,
      status: "ACTIVE",
    };
  }

  if (realizedPnl >= 0 || initialCollateral <= 0) {
    return {
      allocationMultiplier: roundTo(Math.max(minimumMultiplier, currentMultiplier), 6),
      lossStreak: 0,
      lossRatio: 0,
      status: currentMultiplier < 0.999999 ? "REDUCED" : "ACTIVE",
    };
  }

  const lossRatio = Math.abs(realizedPnl) / initialCollateral;
  let reductionFactor = 0.75;
  if (lossRatio >= 0.25) {
    reductionFactor = 0;
  } else if (lossRatio >= 0.15) {
    reductionFactor = 0.1;
  } else if (lossRatio >= 0.08) {
    reductionFactor = 0.25;
  } else if (lossRatio >= 0.03) {
    reductionFactor = 0.5;
  }
  if (previousLossStreak > 0) {
    reductionFactor *= 0.5;
  }

  const allocationMultiplier = clamp(
    currentMultiplier * reductionFactor,
    minimumMultiplier,
    1,
  );
  return {
    allocationMultiplier: roundTo(allocationMultiplier, 6),
    lossStreak: previousLossStreak + 1,
    lossRatio: roundTo(lossRatio, 6),
    status: allocationMultiplier < 0.999999 ? "REDUCED" : "ACTIVE",
  };
}

// A binary's quoted probability gets more sensitive to the underlying as the
// clock runs out: the same dollar of BTC is worth about four times more
// probability one minute before settlement than fifteen minutes before. A fixed
// spread is therefore wide early and far too narrow late, which is exactly when
// it is picked off. This returns the half-spread needed to cover a one-sigma
// move over the reaction window, so the spread widens on its own as the market
// approaches settlement.
export function calculateGammaHalfSpread(input) {
  const guardSeconds = Math.max(0, Number(input?.gammaGuardSeconds || 0));
  const secondsLeft = Number(input?.secondsLeft || 0);
  const currentPrice = Number(input?.currentPrice || 0);
  const openPrice = Number(input?.openPrice || 0);
  const sigmaPerSqrtSecond = Number(input?.sigmaPerSqrtSecond || 0);
  if (
    guardSeconds <= 0
    || !(secondsLeft > 0)
    || !(currentPrice > 0)
    || !(openPrice > 0)
    || !(sigmaPerSqrtSecond > 0)
  ) {
    return 0;
  }

  const fair = calculateBinaryFairProbability({
    openPrice, currentPrice, secondsLeft, sigmaPerSqrtSecond,
  });
  const move = currentPrice * sigmaPerSqrtSecond * Math.sqrt(guardSeconds);
  const shocked = calculateBinaryFairProbability({
    openPrice,
    currentPrice: currentPrice + move,
    secondsLeft,
    sigmaPerSqrtSecond,
  });
  // Capped so the ladder stays inside the tradable price range instead of
  // collapsing onto the clamps; at that width the AMM is effectively out of the
  // market, which is the intended outcome close to settlement.
  return clamp(Math.abs(shocked - fair), 0, 0.45);
}

function buildSideLevels({
  center,
  halfSpread,
  levels,
  quoteCapital,
  bidCapital,
  riskMultiplier,
  inventoryAvailable,
  maxLevelLoss,
}) {
  const tailDistance = Math.min(center, 1 - center);
  const tailDepth = clamp(tailDistance * 4, 0.035, 1);
  const asks = [];
  const bids = [];
  let askInventoryLeft = Math.max(0, inventoryAvailable);
  let bidCapitalLeft = Math.max(0, bidCapital);

  for (let index = 0; index < levels; index += 1) {
    const distance = halfSpread * (1 + index * 0.8) + PRICE_TICK * index;
    const askPrice = roundPrice(center + distance);
    const bidPrice = roundPrice(center - distance);
    const levelWeight = 1 / (1 + index * 0.55);
    const levelNotional = quoteCapital * 0.12 * tailDepth * riskMultiplier * levelWeight;
    // Notional alone does not bound risk: a cheap tail turns a few units of
    // capital into a large share count, and every share pays out one unit if
    // the outcome lands. Cap each level by what it loses when it does land -
    // the ask loses (1 - price) per share sold, the bid loses its own price.
    const levelLossBudget = maxLevelLoss > 0
      ? maxLevelLoss * levelWeight * riskMultiplier
      : Infinity;
    const askShares = roundTo(Math.min(
      askInventoryLeft,
      levelNotional / Math.max(askPrice, MIN_OUTCOME_PRICE),
      levelLossBudget / Math.max(1 - askPrice, MIN_OUTCOME_PRICE),
    ));
    const bidShares = roundTo(Math.min(
      bidCapitalLeft / Math.max(bidPrice, MIN_OUTCOME_PRICE),
      levelNotional / Math.max(bidPrice, MIN_OUTCOME_PRICE),
      levelLossBudget / Math.max(bidPrice, MIN_OUTCOME_PRICE),
    ));

    if (askShares > 0.00000001) {
      asks.push({ price: askPrice, shares: askShares, amount: roundTo(askShares * askPrice) });
      askInventoryLeft -= askShares;
    }
    if (bidShares > 0.00000001) {
      bids.push({ price: bidPrice, shares: bidShares, amount: roundTo(bidShares * bidPrice) });
      bidCapitalLeft -= bidShares * bidPrice;
    }
  }

  return { bids, asks };
}

export function buildAmmQuoteLadder(input) {
  const fairYes = clamp(Number(input?.fairYes || 0.5), MIN_OUTCOME_PRICE, MAX_OUTCOME_PRICE);
  const fairNo = 1 - fairYes;
  const spreadBps = clamp(Number(input?.spreadBps || 200), 10, 5000);
  const levels = Math.max(1, Math.min(12, Math.floor(Number(input?.levels || 5))));
  const riskCapital = Math.max(0, Number(input?.riskCapital || 0));
  const riskMultiplier = clamp(Number(input?.riskMultiplier ?? 1), 0, 1);
  const yesInventory = Math.max(0, Number(input?.yesInventory || 0));
  const noInventory = Math.max(0, Number(input?.noInventory || 0));
  const cashBalance = Math.max(0, Number(input?.cashBalance || 0));
  const totalBidCapital = Math.min(
    riskCapital,
    cashBalance + Math.min(yesInventory, noInventory),
  );
  const totalInventory = Math.max(1, yesInventory + noInventory);
  const inventorySkew = clamp((yesInventory - noInventory) / totalInventory, -0.8, 0.8);
  const skewShift = inventorySkew * Math.min(0.06, spreadBps / 10_000);
  const yesCenter = clamp(fairYes - skewShift, 0.002, 0.998);
  const noCenter = clamp(fairNo + skewShift, 0.002, 0.998);
  const maxLevelLoss = Math.max(0, Number(input?.maxLevelLoss || 0));
  const gammaHalfSpread = calculateGammaHalfSpread(input);
  const halfSpread = Math.max(PRICE_TICK, spreadBps / 20_000, gammaHalfSpread);

  const yes = buildSideLevels({
    center: yesCenter,
    halfSpread,
    levels,
    maxLevelLoss,
    quoteCapital: riskCapital,
    bidCapital: totalBidCapital * 0.5,
    riskMultiplier,
    inventoryAvailable: yesInventory,
  });
  const no = buildSideLevels({
    center: noCenter,
    halfSpread,
    levels,
    maxLevelLoss,
    quoteCapital: riskCapital,
    bidCapital: totalBidCapital * 0.5,
    riskMultiplier,
    inventoryAvailable: noInventory,
  });

  // Complementary tokens must never expose a crossed synthetic pair. A trader
  // cannot buy both outcomes below 1 or sell both outcomes above 1 to the AMM.
  for (let index = 0; index < Math.max(yes.asks.length, no.asks.length); index += 1) {
    const yesAsk = yes.asks[index];
    const noAsk = no.asks[index];
    if (yesAsk && noAsk && yesAsk.price + noAsk.price < 1 + PRICE_TICK) {
      noAsk.price = roundPrice(1 + PRICE_TICK - yesAsk.price);
      noAsk.amount = roundTo(noAsk.price * noAsk.shares);
    }
  }
  for (let index = 0; index < Math.max(yes.bids.length, no.bids.length); index += 1) {
    const yesBid = yes.bids[index];
    const noBid = no.bids[index];
    if (yesBid && noBid && yesBid.price + noBid.price > 1 - PRICE_TICK) {
      noBid.price = roundPrice(1 - PRICE_TICK - yesBid.price);
      noBid.amount = roundTo(noBid.price * noBid.shares);
    }
  }

  return {
    fairYes: roundTo(fairYes, 6),
    fairNo: roundTo(fairNo, 6),
    inventorySkew: roundTo(inventorySkew, 6),
    halfSpread: roundTo(halfSpread, 6),
    gammaHalfSpread: roundTo(gammaHalfSpread, 6),
    yes,
    no,
  };
}

export function calculateExecutionFee(notional, feeBps) {
  const safeNotional = Math.max(0, Number(notional || 0));
  const safeFeeBps = clamp(Number(feeBps || 0), 0, 5000);
  return roundTo(safeNotional * safeFeeBps / 10_000);
}

export function applyAmmInventoryFill(input) {
  const action = String(input?.action || "").toUpperCase();
  const side = String(input?.side || "").toUpperCase();
  const price = Number(input?.price);
  const shares = Math.max(0, Number(input?.shares || 0));
  if (!["BUY", "SELL"].includes(action) || !["YES", "NO"].includes(side) || !(price > 0) || shares <= 0) {
    throw new Error("invalid_amm_fill");
  }

  let cashBalance = Math.max(0, Number(input?.cashBalance || 0));
  let yesInventory = Math.max(0, Number(input?.yesInventory || 0));
  let noInventory = Math.max(0, Number(input?.noInventory || 0));
  const gross = shares * price;
  const tolerance = 0.00000001;

  if (action === "BUY") {
    const availableInventory = side === "YES" ? yesInventory : noInventory;
    const shortfall = Math.max(0, shares - availableInventory);
    if (shortfall > 0) {
      const split = Math.min(shortfall, cashBalance);
      cashBalance -= split;
      yesInventory += split;
      noInventory += split;
    }
    if ((side === "YES" ? yesInventory : noInventory) + tolerance < shares) {
      throw new Error("insufficient_market_liquidity");
    }
    if (side === "YES") {
      yesInventory -= shares;
    } else {
      noInventory -= shares;
    }
    cashBalance += gross;
  } else {
    if (cashBalance + tolerance < gross) {
      const merge = Math.min(Math.min(yesInventory, noInventory), gross - cashBalance);
      yesInventory -= merge;
      noInventory -= merge;
      cashBalance += merge;
    }
    if (cashBalance + tolerance < gross) {
      throw new Error("insufficient_market_liquidity");
    }
    cashBalance -= gross;
    if (side === "YES") {
      yesInventory += shares;
    } else {
      noInventory += shares;
    }
  }

  return {
    cashBalance: roundTo(Math.max(0, cashBalance)),
    yesInventory: roundTo(Math.max(0, yesInventory)),
    noInventory: roundTo(Math.max(0, noInventory)),
    gross: roundTo(gross),
  };
}

export function calculateAmmNav(account, fairYes) {
  const yes = clamp(Number(fairYes || 0.5), 0, 1);
  const no = 1 - yes;
  return roundTo(
    Math.max(0, Number(account?.cash_balance || account?.cashBalance || 0))
      + Math.max(0, Number(account?.yes_inventory || account?.yesInventory || 0)) * yes
      + Math.max(0, Number(account?.no_inventory || account?.noInventory || 0)) * no,
  );
}

export const AMM_PRICE_TICK = PRICE_TICK;
