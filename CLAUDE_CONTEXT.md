# Claude Context For EasyMarket UI/Motion Work

Use this file as the first context block when asking Claude to work on EasyMarket UI or motion.

## What This Project Is

EasyMarket is a standalone Telegram Mini App prediction-market game deployed on Render.

Repository:

```text
easymarket
```

Public URL:

```text
https://easymarket-rcuj.onrender.com
```

The app is separate from the local AV Telegram bot and the old local Spread App. Do not edit files outside this repository.

## Core Product

Users make YES/NO predictions with two in-app currencies:

- `STAR`: internal stars synced with the AV Telegram bot.
- `USDT`: virtual in-app dollars, with cash and bonus balances.

Markets:

- BTC up/down: 5m, 15m, 1h, 12h, 24h, 7d.
- World Cup winner markets.

This is a game/Mini App experience. It is not real exchange trading. Do not add real trading, leverage, futures, liquidation, cashout automation, or automatic on-chain withdrawals.

## Tech Stack

- Node.js 20.
- Express.
- Postgres through `pg`.
- Plain frontend: `public/index.html`, `public/app.js`, `public/styles.css`.
- Custom motion layer: `public/lightning-motion.js`, `public/lightning-motion.css`.
- No React, no Vite, no bundler.
- Docker deployment on Render.

Run locally:

```bash
npm install
PORT=3107 npm start
```

Basic checks:

```bash
node --check public/app.js
git diff --check
curl -fsS http://localhost:3107/health
```

## Most Important Files

```text
src/server.js
```

Express app, routes, static serving, market engine intervals.

```text
src/db.js
```

Postgres schema/migrations.

```text
src/services/marketService.js
```

Core market logic: users, balances, market maker, buy/sell, resolution, payouts, tasks, clans, comments, referrals, bridge ledger.

```text
src/services/usdtDepositService.js
```

Virtual USDT deposit intents and EVM scan matching.

```text
src/services/usdtWithdrawalService.js
```

Virtual USDT withdrawal requests and admin confirmation flow.

```text
src/services/databaseCleanupService.js
```

Database cleanup for Render's small Postgres plan.

```text
public/app.js
```

Main Mini App controller and chart code.

```text
public/styles.css
```

Main visual UI.

```text
public/lightning-motion.js
public/lightning-motion.css
```

Reusable lightning, button, burst, sound, and motion effects.

## UI Direction

The UI should feel like:

- mobile-first Telegram WebApp,
- premium dark fintech/game app,
- Polymarket-inspired prediction market,
- fast, compact, tactile,
- energetic lightning motion,
- no Bootstrap/admin dashboard,
- no huge empty marketing sections,
- no childish random animations.

Design accents:

- dark background,
- clean rounded cards,
- green YES/up,
- red NO/down,
- cyan/lime/purple lightning accents,
- smooth haptics/sound/motion,
- no visible layout jumps.

## Motion Rules

Use the existing motion system, do not create another parallel system unless asked.

Main hooks already exist in `public/lightning-motion.js`:

- global button tap lightning,
- global card tap glow,
- `showSuccessLightningBurst(label, { tier, epic })`,
- `triggerBalancePulse(element)`,
- WebAudio sound toggle,
- loader and energy background.

Stake tiers:

- tier 1: lime/cyan.
- tier 2: cyan.
- tier 3: gold.
- tier 4: purple/chameleon/epic.

Very important:

- Do not add direct external `box-shadow` to stake buttons during tap. A previous `data-lm-active-tier` shadow caused square sticky shadows.
- Use masked overlays (`.lm-button-flash`) and `.lm-spark` for colored energy.
- Respect `prefers-reduced-motion`.
- Keep animations short and 60fps-friendly.
- Avoid fixed overlays that block Telegram gestures unless they are explicit sheets/modals.

## Current Chart Nuances

The main chart is custom canvas in `public/app.js`, not TradingView.

Current behavior:

- BTC 5m chart shows only the latest 50% of the 5m market history so it is less crowded.
- BTC 15m/1h/12h/24h/7d and World Cup can use fuller history.
- Trade dots are stored in `state.chartTradesByMarket`, separate from the live activity list.
- Trade dots stay visible while their timestamp is inside the visible chart window.
- Floating live trade bubbles are separate from chart dots.

If changing chart UX:

- Do not make the app jump vertically.
- Keep labels inside canvas boundaries.
- Do not make the graph refresh blink.
- If shortening history, keep trade dots consistent with the visible window.

## Backend / Data Rules

Do not delete or cleanup:

- `users`
- `fire_balances`, `fire_ledger`
- `usdt_balances`, `usdt_ledger`
- `usdt_bonus_balances`, `usdt_bonus_ledger`
- `positions`
- `trades`
- open or unresolved `markets`
- deposit and withdrawal requests

Disposable/cleanup-safe:

- old `price_ticks`
- closed market comments after configured time
- old deposit scan events
- expired deposit intents
- old daily task claims
- old empty technical markets

Important:

- Bets on sports/long BTC markets must not disappear before the market resolves.
- Winning shares resolve at 1 per share, not at current sell quote.
- Selling before resolution uses internal market maker quote.
- Last-second sell freeze is controlled by `MARKET_SELL_FREEZE_SECONDS`.

## Market Maker Nuances

The project does not have a real CLOB/orderbook yet. It uses an internal market maker.

Goals:

- avoid cheap-tail farming,
- avoid instant buy/sell self-pump profit,
- make liquidity thinner near 0/100 tails,
- keep final payout simple: winner shares pay 1.

Be careful when changing buy/sell math in `marketService.js`; it can create farming exploits.

## Telegram Mini App Nuances

- The app should normally open inside Telegram.
- Browser dev auth is only for local/dev or when `ALLOW_DEV_AUTH=true`.
- Telegram WebView caches aggressively. When changing frontend assets, bump query versions in `public/index.html`.
- Also bump the `lightning-motion.js` import inside `public/app.js` when changing motion JS.
- Respect safe areas at the top; Telegram system buttons can cover the header.

## Asset Cache Busting

When changing:

- `public/app.js`
- `public/styles.css`
- `public/lightning-motion.js`
- `public/lightning-motion.css`

Update query strings in `public/index.html`, for example:

```html
<link rel="stylesheet" href="/styles.css?v=20260629-09" />
<link rel="stylesheet" href="/lightning-motion.css?v=20260629-09" />
<script src="/app.js?v=20260629-09" type="module"></script>
```

And if `public/app.js` imports motion JS:

```js
} from "./lightning-motion.js?v=20260629-09";
```

## Security Rules

- Never commit real secrets.
- Never print `DATABASE_URL`.
- Never print bot tokens.
- Never expose API keys in frontend.
- `BOT_BRIDGE_SECRET` protects bridge APIs.
- `TELEGRAM_BOT_TOKEN` may exist in Render env for Stars invoices/admin messages, but it must not be committed.

## Before Finishing Any Change

Run at least:

```bash
node --check public/app.js
git diff --check
```

If server behavior changed:

```bash
PORT=3107 npm start
curl -fsS http://localhost:3107/health
```

If frontend changed:

```bash
curl -fsS http://localhost:3107/ | rg "app.js|styles.css|lightning-motion"
```

After push, Render deploy can be checked with:

```bash
curl -fsS https://easymarket-rcuj.onrender.com/health
curl -fsS https://easymarket-rcuj.onrender.com/ | rg "app.js\\?v="
```

## Preferred Working Style

- Make small, targeted changes.
- Keep UI motion in the existing motion files.
- Keep backend market math changes extra cautious.
- Do not rewrite the app into a new framework.
- Do not change database cleanup without checking what data must survive.
- Do not touch the local AV bot from this repo.

