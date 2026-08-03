# EasyMarket collateralized CLOB

## Scope

The collateralized order book is enabled only for BTC markets. Sports, top and
special markets remain readable but trading is paused until they get an
independent pricing and resolution audit.

Every BTC market has three isolated books:

- `USDT_CASH`
- `USDT_BONUS`
- `STAR`

Orders and AMM inventory never cross between books. A STAR or bonus trade cannot
move the real-USDT quote.

## Collateral invariant

At market creation, each AMM book locks its configured collateral and splits it
into equal complete-set inventory. A collateral amount of 1,000 creates:

- 1,000 YES shares
- 1,000 NO shares

At resolution, the winning share redeems for one unit and the losing share for
zero. An owned YES+NO pair can always be merged back into one collateral unit.
The AMM may split or merge only against cash already held by the same account;
it cannot mint an unbacked balance.

## Matching

- Price-time priority applies to user limit orders.
- A user order at an equal or better price executes before the AMM.
- Market buys consume asks; market sells consume bids.
- Limit orders cross immediately and are checked again after BTC price ticks.
- Self-matching by the same user id is rejected by the matcher.
- Fees are charged only on executed volume, never on an unfilled order.
- Trading and AMM matching stop before the BTC settlement window.

The BTC fair probability comes from the Binance WebSocket price, strike, time to
expiry and observed short-term volatility. Internal EasyMarket order flow does
not change fair value. Inventory skew only changes the AMM's own bid/ask around
that fair value.

## Risk controls

- stale external quote rejection;
- finite quote inventory at every level;
- complementary quote guards (`YES ask + NO ask > 1`, `YES bid + NO bid < 1`);
- configurable spread and quote levels;
- automatic quadratic size reduction after the rapid-loss threshold;
- a persistent risk multiplier per balance book: settled losses reduce every
  open BTC book and the collateral allocated to following markets, down to the
  configured 20-unit floor;
- hard halt at maximum drawdown or minimum capital;
- explicit admin restart;
- settlement PnL and an immutable AMM ledger.

The quadratic size reduction, the persistent per-book multiplier and the
drawdown halt are all governed by one switch, `auto_risk_enabled`. With the
switch off the AMM always quotes its full configured collateral and a settled
loss never shrinks the following market. The only stop that remains is
solvency: a book with zero net asset value has nothing left to quote against.
Turn the switch off only while an operator is watching the books.

No market maker can be guaranteed to make money. These controls make ordinary
round-trip farming negative and cap loss to posted collateral, but they do not
remove market or gap risk.

## Attack audit

Adversarial simulation of the quoting and fill layer, run at the current live
settings (1,000 collateral per book, 200 bps spread, 100 bps execution fee):

- 4,000 random fill sequences of 60 steps each. The AMM never reached negative
  cash or negative inventory, and its loss never exceeded the collateral it had
  locked, under either settlement outcome.
- 270 fair prices × 5 spreads × 5 inventory skews. The cheapest YES ask plus the
  cheapest NO ask always exceeds 1, and the richest YES bid plus the richest NO
  bid always falls below 1, across every level pair rather than only equal
  indexes. Both ladders stay monotonic, the AMM never crosses its own book, and
  an immediate round trip is always negative.
- With the fair price held constant, no sequence extracts a risk-free profit.
  Every profitable sequence found required the fair price to move first.

The execution paths hold up as well: a limit order crosses AMM liquidity only at
the AMM's own quoted price, never at the taker's limit price; every AMM fill
re-checks quote freshness against the 2-second window; the matcher refuses to
fill an order against its own owner; and the three books settle into separate
balance tables, so a star or bonus trade cannot reach real USDT.

### The exposure that remains

The complementary guard is an instantaneous one. It cannot stop a trader who
buys the cheap side now and the opposite side after the price swings, ending
with a complete set bought for less than the 1 unit it redeems for. The
break-even swing is roughly the spread plus the fee, about 3 probability points
at current settings, and BTC crosses that routinely:

| time to expiry | +$5 on BTC | +$10 | +$20 |
|---|---|---|---|
| 15 min | 2.9 pp | 5.8 pp | 11.5 pp |
| 5 min | 5.0 pp | 10.0 pp | 19.3 pp |
| 1 min | 11.1 pp | 21.4 pp | 37.1 pp |

The same dollar move is four times more probability-sensitive one minute before
expiry than fifteen minutes before, while trading is frozen only for the last
five seconds. This is ordinary market-maker adverse selection rather than a
defect, but it is what the settled star and bonus books actually lost money to,
and with `auto_risk_enabled` off the loss per market is capped only by the
posted collateral.

Worth considering: a spread of 600-1,000 bps, a spread or quote size that scales
with time to expiry, a longer pre-settlement freeze, and turning the automatic
risk reduction back on once the bot controls have been exercised.

## Polymarket reference model

The implementation follows the public Polymarket model where it matters for
solvency and execution:

- [conditional-token split, merge and redemption](https://docs.polymarket.com/concepts/positions-tokens);
- [CLOB prices and price-time matching](https://docs.polymarket.com/concepts/prices-orderbook);
- [market-making guidance](https://docs.polymarket.com/trading/market-making).

EasyMarket intentionally differs in two places. It keeps three off-chain,
isolated balance books instead of blockchain conditional tokens, and charges a
flat configurable execution fee to every executed user side. Polymarket's
current fee schedule is market-dependent and taker-oriented; see its
[fee documentation](https://docs.polymarket.com/trading/fees). The AMM, user
balances and project fee ledger remain separate accounting entities here.

## AV bot bridge

All endpoints require the existing `x-bridge-secret` header.

### Read settings and statistics

```http
GET /api/bridge/amm
```

### Change settings

```http
POST /api/bridge/amm/settings
Content-Type: application/json

{
  "collateral_usdt": 1000,
  "collateral_bonus": 1000,
  "collateral_star": 1000,
  "spread_bps": 200,
  "user_trade_fee_bps": 100,
  "rapid_loss_bps": 500,
  "max_drawdown_bps": 1500,
  "minimum_quote_capital": 20,
  "quote_levels": 5,
  "enabled": true,
  "auto_risk_enabled": false,
  "admin_telegram_id": "..."
}
```

Collateral changes apply to newly created AMM accounts. Spread, execution fee
and risk settings apply to subsequent quotes immediately. `GET /api/bridge/amm`
also returns `performance` (won, lost and net by book) and `global_risk`.

### Apply collateral to open markets

```http
POST /api/bridge/amm/collateral
Content-Type: application/json

{
  "book_types": ["USDT_CASH", "USDT_BONUS", "STAR"],
  "admin_telegram_id": "..."
}
```

Tops every open account up to the collateral configured for its book, so a
setting change reaches long-running markets without waiting for the next one.
Each added unit is split into one YES and one NO share, exactly like the initial
split. Collateral is never taken back out of a live account, and an account
already at or above its target is skipped. Omit `book_types` for all three.

### Restart stopped accounts

```http
POST /api/bridge/amm/restart
Content-Type: application/json

{
  "market_id": 123,
  "admin_telegram_id": "..."
}
```

Omit `market_id` to restart every eligible open account. Restart clears the
persistent loss streak for the affected books, but never refills collateral
already lost by an open account; that account can quote only within its current
NAV.
