# EasyMarket Project Map

Last updated: 2026-06-29

EasyMarket is a standalone Render service for a Telegram Mini App prediction-market game. It is separate from the local AV Telegram bot and the older local Spread App. The local bot talks to EasyMarket through bridge APIs, but this repository must remain deployable on its own.

## Product Shape

- Telegram Mini App / Web App with Polymarket-style YES/NO markets.
- Main currencies:
  - `STAR`: internal stars synced with the AV bot.
  - `USDT`: virtual in-app dollars, split into cash and bonus balances.
- Main market families:
  - BTC up/down markets: 5m, 15m, 1h, 12h, 24h, 7d.
  - World Cup winner team markets.
- Users can buy YES/NO shares, sell positions before the last seconds, comment on markets, complete tasks, join/create clans, deposit virtual USDT, and request withdrawals.
- This is not real exchange trading. There are no futures, leverage, liquidations, order placement, or cashout automation in this repo.

## Repository Layout

```text
.
├── Dockerfile
├── README.md
├── PROJECT_MAP.md
├── CLAUDE_CONTEXT.md
├── .env.example
├── docs/
│   ├── CONNECTION_REPORT.md
│   └── EMERGENCY_DB_CLEANUP.md
├── public/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── lightning-motion.css
│   └── lightning-motion.js
└── src/
    ├── config.js
    ├── db.js
    ├── server.js
    └── services/
        ├── marketService.js
        ├── priceService.js
        ├── usdtDepositService.js
        ├── usdtWithdrawalService.js
        └── databaseCleanupService.js
```

## Runtime

- Node.js 20+, ES modules.
- Express serves both API and static frontend.
- Render runtime uses Docker.
- Postgres is Render Postgres `polik-db`.
- Server listens on `process.env.PORT || 3000`.
- Important scripts:
  - `npm start` -> `node src/server.js`
  - `npm run dev` -> `node --watch src/server.js`

## Backend Map

### `src/server.js`

Express entrypoint.

Responsibilities:

- Serves `public/`.
- Defines all API endpoints.
- Runs database migrations through `runMigrations()`.
- Runs startup database rescue before migrations.
- Starts market engine intervals:
  - active BTC market creation/resolution,
  - live BTC price updates,
  - USDT deposit scans,
  - cleanup ticks.
- Protects bridge endpoints with `x-bridge-secret`.
- Protects dev endpoints with `ALLOW_DEV_TOOLS=true`.

High-traffic/public endpoints:

```text
GET  /health
GET  /api/status
GET  /api/public/config
POST /api/stars/invoice
POST /api/usdt/deposits/intents
GET  /api/usdt/deposits/intents
GET  /api/usdt/deposits/intents/:intentId
POST /api/usdt/deposits/intents/:intentId/cancel
POST /api/usdt/deposits/intents/:intentId/check
POST /api/usdt/withdrawals
GET  /api/usdt/withdrawals
GET  /api/wallet/history
POST /api/me/upsert
GET  /api/me
GET  /api/market/active
GET  /api/market/:marketId/activity
GET  /api/activity/recent
GET  /api/world-cup/markets
GET  /api/btc/markets
GET  /api/clans
POST /api/clans/join
POST /api/clans/create
GET  /api/market/:marketId/comments
POST /api/market/:marketId/comments
POST /api/market/:marketId/buy
POST /api/market/:marketId/sell
GET  /api/markets/recent
GET  /api/leaderboard
POST /api/tasks/share
POST /api/tasks/daily
POST /api/tasks/claim
POST /api/loss-refund/:offerId/claim-stars
```

Bridge/dev endpoints:

```text
POST /api/bridge/withdrawals/:requestId/confirm
POST /api/dev/fire/add
POST /api/dev/usdt/add
POST /api/dev/usdt/deposits/scan
POST /api/dev/market/create
POST /api/bridge/cleanup/run
POST /api/bridge/users/upsert
POST /api/bridge/fire/add
POST /api/bridge/usdt/add
POST /api/bridge/fire/sync
POST /api/bridge/fire/sync-username
POST /api/bridge/users/reset-market-state
GET  /api/bridge/clans
POST /api/bridge/clans/:clanId/delete
GET  /api/bridge/fire/balance
GET  /api/bridge/fire/ledger
GET  /api/bridge/usdt/ledger
POST /api/bridge/tasks/complete
```

### `src/config.js`

Central env parsing. Do not read raw env directly elsewhere unless there is a clear reason.

Important knobs:

- market maker: `MARKET_LIQUIDITY`, `MARKET_FEE_BPS`, `MARKET_PROFIT_FEE_BPS`, `MARKET_MAKER_SPREAD_BPS`, `MARKET_SELL_FREEZE_SECONDS`
- BTC data: `PRICE_POLL_MS`, `PRICE_TICKS_DISABLED`
- cleanup: `DATABASE_CLEANUP_*`, `CLEANUP_*`, `STARTUP_DATABASE_RESCUE_*`
- Telegram and bridge: `BOT_BRIDGE_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_USER_IDS`
- public links: `PUBLIC_WEB_URL`, `PUBLIC_AV_BOT_URL`, `PUBLIC_MINI_APP_URL`
- tasks/referrals: `TASK_*`, `REFERRAL_*`
- USDT scan: `PUBLIC_USDT_EVM_ADDRESS`, `EVM_SCAN_API_KEY`, BSC/ETH chain IDs and token addresses

### `src/db.js`

Postgres pool, safe error helper, migrations.

Important tables:

- users and balances:
  - `users`
  - `fire_balances`, `fire_ledger`
  - `usdt_balances`, `usdt_ledger`
  - `usdt_bonus_balances`, `usdt_bonus_ledger`
- USDT/referrals/loss refunds:
  - `usdt_bonus_claims`
  - `usdt_referral_bonuses`
  - `usdt_loss_refund_offers`
  - `usdt_deposit_intents`
  - `usdt_deposit_events`
  - `usdt_deposit_scanner_state`
  - `usdt_withdrawal_requests`
- markets:
  - `markets`
  - `positions`
  - `trades`
  - `market_comments`
  - `price_ticks`
  - `world_cup_market_meta`
- gamification:
  - `fire_referral_bonuses`
  - `fire_task_claims`
  - `clans`
  - `clan_members`
  - `clan_score_events`

Important DB rule: do not add destructive cleanup for `positions`, `trades`, balances, ledgers, deposit/withdrawal requests, or open/long-running markets. Old raw ticks and closed-market comments are disposable. Bets on active or unresolved markets are not disposable.

### `src/services/marketService.js`

Core product service. Large file; be careful.

Responsibilities:

- user upsert and snapshots,
- STAR and USDT balance mutations,
- BTC market definitions and creation,
- BTC price updates,
- internal YES/NO market maker pricing,
- buy/sell execution and position accounting,
- market resolution and payouts,
- activity/recent markets/leaderboard,
- World Cup market metadata and chart data,
- comments with latest-bet context,
- referrals, daily tasks, loss refunds,
- clans and clan score events,
- bridge ledger feeds for the AV bot.

BTC market definitions currently include:

```text
BTCUSDT       -> 5m
BTCUSDT_15M   -> 15m
BTCUSDT_1H    -> 1h
BTCUSDT_12H   -> 12h
BTCUSDT_24H   -> 24h
BTCUSDT_7D    -> 7d
```

Market maker nuance:

- There is no real CLOB yet.
- Pricing combines BTC movement and internal inventory/flow.
- Liquidity is intentionally thinner near tails to prevent cheap-tail farming.
- Last-second selling is frozen with `MARKET_SELL_FREEZE_SECONDS`.
- Winning positions resolve at 1 per share; do not use the exit orderbook for final payouts.

### `src/services/priceService.js`

BTC spot price provider with fallbacks:

- Binance,
- Coinbase,
- CoinGecko.

Throws `PriceUnavailableError` instead of crashing the server when all sources fail.

### `src/services/usdtDepositService.js`

Virtual USDT deposit intent and scan service.

Current model:

- user creates an intent with exact amount,
- app shows the configured EVM USDT address,
- scanner watches Etherscan v2 API for BSC and Ethereum USDT transfers,
- matching transfer credits virtual USDT cash balance.

Nuances:

- No private keys are used here.
- Do not log API keys.
- Deposit matching depends on exact amount, network, address, time window, and confirmation settings.
- User can manually check a pending intent.

### `src/services/usdtWithdrawalService.js`

Virtual USDT withdrawal request workflow.

Current model:

- user creates withdrawal request,
- cash balance is reserved/deducted,
- AV bot/admin receives confirmation message,
- bridge endpoint or admin URL confirms request,
- no automatic on-chain payout exists in this repo.

Do not shorten withdrawal wallet addresses in admin-critical backend payloads.

### `src/services/databaseCleanupService.js`

Protects the small Render Postgres plan from filling up.

Disposable/trimmed data:

- old `price_ticks`,
- closed-market comments after configured minutes,
- old deposit events,
- expired deposit intents,
- old task claims,
- old empty technical markets.

Protected data:

- users,
- balances,
- ledgers,
- positions,
- trades,
- deposit/withdrawal requests,
- open or unresolved markets.

## Frontend Map

Frontend is intentionally plain HTML/CSS/JS. There is no React, Vite, bundler, or frontend build step.

### `public/index.html`

Single-page Mini App markup.

Important areas:

- Telegram-only auth fallback card.
- top bar with EasyMarket title, currency switch, balance, wallet/tasks/ranking/clans/icons.
- active market card and chart canvas.
- amount buttons.
- market chat/orderbook panel.
- feed tabs: positions, live activity, recent markets.
- sheets: tasks, topup/withdraw/history, BTC markets, World Cup markets, clans, leaderboard, bet sheet.
- script/style cache-bust query strings must be bumped after frontend changes.

### `public/app.js`

Main frontend controller.

Responsibilities:

- Telegram Mini App init/dev auth,
- API calls,
- local state,
- market rendering and chart canvas drawing,
- buy/sell flow and optimistic UI,
- wallet topup/withdraw history,
- tasks/referrals,
- clans,
- chat/orderbook,
- haptic/audio triggers,
- sheet interactions and swipe interactions.

Current chart nuances:

- BTC 5m chart uses only the latest 50% of the 5m market history to avoid a crowded line.
- Trade dots on the chart are stored separately in `chartTradesByMarket`, so they do not disappear when the live activity list refreshes.
- Trade dots remain visible while their timestamp is inside the visible chart window.
- The chart is custom canvas, not TradingView/lightweight-charts.

### `public/styles.css`

Main app visual system.

Style direction:

- dark mobile-first Telegram WebApp,
- Polymarket-inspired trading UI,
- compact high-contrast cards,
- no Bootstrap/admin dashboard feel,
- avoid layout jumps,
- preserve safe-area spacing for Telegram system buttons.

### `public/lightning-motion.js`

Reusable motion runtime.

Responsibilities:

- global button/card pointer triggers,
- sound toggle and WebAudio effects,
- haptic-friendly motion hooks,
- lightning loader,
- button lightning flashes,
- card glow/tap,
- success/win bursts,
- balance pulse,
- dynamic target observer.

Important nuance:

- Button stake tiers are read from `data-stake-tier`.
- Do not reintroduce `data-lm-active-tier` with direct button `box-shadow`; it caused square sticky shadows on stake buttons.
- Prefer masked internal overlays (`.lm-button-flash`) and sparks rather than external shadows on buttons.

### `public/lightning-motion.css`

Motion CSS and keyframes.

Stake tier colors:

- tier 1: lime/cyan,
- tier 2: cyan,
- tier 3: gold,
- tier 4: purple/chameleon/epic.

Must respect `prefers-reduced-motion`.

## Frontend Cache Busting

Because Telegram WebView is sticky with cached assets, bump query strings in `public/index.html` whenever changing frontend JS/CSS:

```html
<link rel="stylesheet" href="/styles.css?v=YYYYMMDD-NN" />
<link rel="stylesheet" href="/lightning-motion.css?v=YYYYMMDD-NN" />
<script src="/app.js?v=YYYYMMDD-NN" type="module"></script>
```

If `app.js` imports `lightning-motion.js`, bump that import too.

## Critical Product Rules

- Do not touch the local AV Telegram bot repo from this repo.
- Do not expose or log secrets: `DATABASE_URL`, bot tokens, scan API keys.
- Do not add real trading, futures, leverage, liquidation, or automatic on-chain withdrawals.
- Do not remove bridge APIs; the local AV bot depends on them.
- Do not clean `trades` or `positions` for active/unresolved markets.
- Do not make task rewards only frontend state; rewards must persist and sync to backend/AV bot flows.
- Do not break Telegram Mini App auth. Production should not trust arbitrary browser query params unless `ALLOW_DEV_AUTH=true`.
- Do not use big external frontend frameworks unless explicitly requested.
- Do not make UI cards wildly different heights if they sit in the same swipe/tab area.
- Do not add square or unmasked glow layers on rounded buttons/cards.

## Usual Verification

Local:

```bash
node --check public/app.js
git diff --check
PORT=3107 npm start
curl -fsS http://localhost:3107/health
curl -fsS http://localhost:3107/ | rg "app.js|styles.css|lightning-motion"
```

Public after push/Render deploy:

```bash
curl -fsS https://easymarket-rcuj.onrender.com/health
curl -fsS https://easymarket-rcuj.onrender.com/api/status
curl -fsS https://easymarket-rcuj.onrender.com/ | rg "app.js\\?v="
```

