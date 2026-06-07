# EasyMarket

Telegram Mini App / Web App MVP with a FIRE-based YES/NO prediction market.

The first market type is BTC 5M:

```text
BTC будет выше цены открытия через 5 минут?
```

This is not a real-money market and does not include payments, cashout, leverage, futures, or Telegram Stars.

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
ALLOW_DEV_AUTH=false
ALLOW_DEV_TOOLS=false
MARKET_INTERVAL_SECONDS=10
MARKET_DURATION_MINUTES=5
MARKET_LIQUIDITY=10000
MARKET_FEE_BPS=200
PRICE_POLL_MS=1000
```

`DATABASE_URL` must be set in the Render environment. Do not commit real database credentials.
`BOT_BRIDGE_SECRET` protects future local Telegram bot bridge endpoints through the `x-bridge-secret` header.

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

Use `/api/bridge/fire/ledger` when the local bot needs to pull EasyMarket-side FIRE changes such as prediction-market buys and payouts.
