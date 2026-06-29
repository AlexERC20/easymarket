# EasyMarket

Telegram Mini App / Web App MVP with a ⭐-based YES/NO prediction market.

Project orientation docs:

- [PROJECT_MAP.md](./PROJECT_MAP.md) — repository map, backend/frontend/data overview, API and safety notes.
- [CLAUDE_CONTEXT.md](./CLAUDE_CONTEXT.md) — compact context file for Claude/UI-motion development sessions.

The first market type is BTC 5M:

```text
BTC будет выше цены открытия через 5 минут?
```

This is not a real-money market and does not include cashout, leverage, futures, or real-money trading.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Open:

```text
http://localhost:3000/
http://localhost:3000/health
http://localhost:3000/api/status
http://localhost:3000/api/market/active
```

For browser dev auth outside Telegram:

```text
http://localhost:3000/?telegram_id=123&username=alex&first_name=Alex
```

## Environment Variables

Required for database status checks:

```text
DATABASE_URL
```

Optional:

```text
PORT=3000
NODE_ENV=production
PGSSLMODE=require
BOT_BRIDGE_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_USER_IDS=
ALLOW_DEV_AUTH=false
ALLOW_DEV_TOOLS=false
MARKET_INTERVAL_SECONDS=10
MARKET_DURATION_MINUTES=5
MARKET_LIQUIDITY=10000
MARKET_FEE_BPS=200
MARKET_PROFIT_FEE_BPS=500
MARKET_MAKER_SPREAD_BPS=300
PRICE_POLL_MS=1000
PRICE_TICKS_DISABLED=false
STARTUP_DATABASE_RESCUE_ENABLED=true
STARTUP_PRICE_TICKS_DROP_ABOVE_MB=64
DATABASE_CLEANUP_ENABLED=true
DATABASE_CLEANUP_RUN_ON_START=false
DATABASE_CLEANUP_INTERVAL_MS=86400000
DATABASE_CLEANUP_VACUUM=false
DATABASE_CLEANUP_BATCH_SIZE=25000
DATABASE_CLEANUP_MAX_BATCHES=80
CLEANUP_PRICE_TICKS_HOURS=24
CLEANUP_BTC_PRICE_TICKS_DAYS=7
CLEANUP_OTHER_PRICE_TICKS_HOURS=24
CLEANUP_PRICE_TICKS_TRUNCATE_ABOVE_MB=250
CLEANUP_MARKET_COMMENTS_DAYS=3
CLEANUP_CLOSED_MARKET_COMMENTS_MINUTES=15
CLEANUP_DEPOSIT_EVENTS_DAYS=30
CLEANUP_EXPIRED_DEPOSIT_INTENTS_DAYS=30
CLEANUP_TASK_CLAIMS_DAYS=60
CLEANUP_EMPTY_MARKETS_DAYS=14
MARKET_SELL_FREEZE_SECONDS=7
PUBLIC_WEB_URL=https://easymarket-rcuj.onrender.com
PUBLIC_AV_BOT_URL=https://t.me/voit_help_bot?start=buy_stars
PUBLIC_MINI_APP_URL=https://t.me/voit_help_bot?startapp=easymarket
REFERRAL_BET_BONUS_FIRE=500
TASK_SHARE_FIRE=100
TASK_SUBSCRIBE_FIRE=500
TASK_PRIVATE_CHAT_FIRE=15000
TASK_DAILY_PRESENCE_FIRE=50
TASK_DAILY_BET_FIRE=50
TASK_DAILY_CAP_FIRE=10000
PUBLIC_AV_CHANNEL_URL=https://t.me/erc20coin
PUBLIC_AV_CHAT_URL=https://t.me/thedaomaker
PUBLIC_PRIVATE_CHAT_URL=https://t.me/tribute/app?startapp=stKL
```

`TELEGRAM_BOT_TOKEN` is optional and is used only for creating Telegram Stars invoice links inside the Mini App. Do not commit real tokens.

`DATABASE_URL` must be set in the Render environment. Do not commit real database credentials.
`BOT_BRIDGE_SECRET` protects future local Telegram bot bridge endpoints through the `x-bridge-secret` header.
`TELEGRAM_ADMIN_USER_IDS` is a comma-separated list of admin Telegram IDs that receive USDT withdrawal requests.
`PUBLIC_WEB_URL` is the public Render URL used in admin confirmation buttons.
`PUBLIC_MINI_APP_URL` should point to the Telegram Mini App deep link, so referral shares open inside Telegram instead of the plain website.
`TASK_PRIVATE_CHAT_FIRE` is a one-time private chat subscriber bonus completed through `/api/bridge/tasks/complete` with `task_key=private_chat`; it is not counted against the ordinary daily task cap.
`DATABASE_CLEANUP_*` controls the daily Postgres cleanup job. The defaults keep balances, ledgers, deposits, withdrawals, positions, and trades, while pruning old chart ticks, comments, scanner events, expired deposit requests, old daily task claims, and empty technical markets. Cleanup deletes in batches to avoid long locks on a busy database. A startup safety cleanup also runs after deploy when cleanup is enabled.
`PRICE_TICKS_DISABLED=false` keeps chart tick persistence on. Old raw ticks are pruned automatically: `BTCUSDT` is kept for `CLEANUP_BTC_PRICE_TICKS_DAYS` days, while all other raw tick symbols are kept for `CLEANUP_OTHER_PRICE_TICKS_HOURS` hours. If `price_ticks` grows above `CLEANUP_PRICE_TICKS_TRUNCATE_ABOVE_MB`, startup/daily cleanup truncates only that disposable table to protect the 1 GB Postgres plan.
`STARTUP_DATABASE_RESCUE_ENABLED=true` runs before migrations and can drop only the disposable `price_ticks` table when it is above `STARTUP_PRICE_TICKS_DROP_ABOVE_MB`; this protects startup on a nearly full Postgres disk.
`CLEANUP_CLOSED_MARKET_COMMENTS_MINUTES` removes chat comments shortly after a market closes; balances, ledgers, withdrawals, deposits, trades, and user positions are kept.
`MARKET_SELL_FREEZE_SECONDS` blocks only last-second exits before market resolution. Instant buy/sell pricing is handled by the internal market maker curve: liquidity is deepest near 50/50 and gets much thinner near the 0/100 tails, so large tail buys or exits reprice sharply instead of staying cheap.

## Render

Render service name: `easymarket`

Render public URL:

```text
https://easymarket-rcuj.onrender.com
```

Render runtime: Docker

Dockerfile path:

```text
./Dockerfile
```

Render Postgres DB: `polik-db`

Render injects `DATABASE_URL` through environment variables, so the app reads it from `process.env.DATABASE_URL`.

## Test

After deploy:

```bash
curl https://easymarket-rcuj.onrender.com/health
curl https://easymarket-rcuj.onrender.com/api/status
curl https://easymarket-rcuj.onrender.com/api/public/config
curl https://easymarket-rcuj.onrender.com/api/market/active
curl https://easymarket-rcuj.onrender.com/api/markets/recent
```

Expected `/health` response:

```json
{
  "ok": true,
  "service": "easymarket"
}
```

Expected `/api/status` response when the database is connected:

```json
{
  "ok": true,
  "database": "connected"
}
```

## API

Public frontend API:

```text
GET  /api/public/config
GET  /api/market/active
GET  /api/market/:marketId/activity
POST /api/market/:marketId/buy
POST /api/market/:marketId/sell
GET  /api/me?telegram_id=123
POST /api/me/upsert
GET  /api/markets/recent
```

`/api/market/active` returns the active market plus recent market `activity` and BTC `chart` points for the Mini App UI.

Dev tools, only when `ALLOW_DEV_TOOLS=true`:

```text
POST /api/dev/fire/add
POST /api/dev/market/create
```

Bridge API for the local Telegram bot, protected by `x-bridge-secret`:

```text
POST /api/bridge/users/upsert
POST /api/bridge/fire/add
POST /api/bridge/fire/sync
GET  /api/bridge/fire/balance?telegram_id=123
GET  /api/bridge/fire/ledger?after_id=0&limit=100
```

Use `/api/bridge/fire/sync` when the local bot is the source of truth and EasyMarket must mirror the exact bot balance:

```bash
curl -X POST https://easymarket-rcuj.onrender.com/api/bridge/fire/sync \
  -H "Content-Type: application/json" \
  -H "x-bridge-secret: $BOT_BRIDGE_SECRET" \
  -d '{
    "telegram_id": "123",
    "username": "alex",
    "first_name": "Alex",
    "amount": 1000,
    "reason": "bot_balance_sync"
  }'
```

Use `/api/bridge/fire/ledger` when the local bot needs to pull EasyMarket-side ⭐ balance changes such as prediction-market buys and payouts.
