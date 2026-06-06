# Easymarket

Minimal connection-check skeleton for the Easymarket service.

This project verifies the chain:

Local Codex workspace -> GitHub -> Render service -> Render Postgres -> public web/API.

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
```

## Environment Variables

Required for database status checks:

```text
DATABASE_URL
```

Optional:

```text
PORT=3000
PGSSLMODE=require
```

`DATABASE_URL` must be set in the Render environment. Do not commit real database credentials.

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
