import express from "express";
import pg from "pg";

const { Pool } = pg;

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");

function buildDatabasePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  const sslMode = process.env.PGSSLMODE?.toLowerCase();
  const ssl = sslMode === "require"
    ? { rejectUnauthorized: false }
    : undefined;

  return new Pool({
    connectionString,
    ssl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });
}

const pool = buildDatabasePool();

function safeDatabaseErrorMessage(error) {
  if (!process.env.DATABASE_URL) {
    return "DATABASE_URL is not configured.";
  }

  if (error instanceof Error && error.message) {
    return "PostgreSQL connection failed.";
  }

  return "Database status check failed.";
}

app.get("/", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send("<!doctype html><html><body><h1>Easymarket is running</h1></body></html>");
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "easymarket",
  });
});

app.get("/api/status", async (_req, res) => {
  if (!pool) {
    res.status(500).json({
      ok: false,
      database: "error",
      message: "DATABASE_URL is not configured.",
    });
    return;
  }

  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      ok: true,
      database: "connected",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: "error",
      message: safeDatabaseErrorMessage(error),
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Easymarket listening on port ${port}`);
});
