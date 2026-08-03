import WebSocket from "ws";

const BINANCE_BTC_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
const COINBASE_BTC_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const COINGECKO_BTC_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const BINANCE_BTC_STREAM_URL = "wss://stream.binance.com:9443/ws/btcusdt@aggTrade";
const STREAM_FRESH_MS = 3_000;
const SAMPLE_INTERVAL_MS = 1_000;
const MAX_PRICE_SAMPLES = 3_600;

let latestBtcPrice = null;
let btcSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let streamStarted = false;
let streamStopped = false;
let lastSampleAt = 0;
const priceSamples = [];
const quoteListeners = new Set();

export class PriceUnavailableError extends Error {
  constructor(message = "BTC price is unavailable.") {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

function saveBtcQuote(price, source, at = new Date()) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return null;
  }

  const quote = {
    symbol: "BTCUSDT",
    price: numericPrice,
    source,
    at: at instanceof Date ? at : new Date(at),
  };
  latestBtcPrice = quote;

  const quoteTime = quote.at.getTime();
  if (!lastSampleAt || quoteTime - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    priceSamples.push({ price: numericPrice, at: quoteTime });
    if (priceSamples.length > MAX_PRICE_SAMPLES) {
      priceSamples.splice(0, priceSamples.length - MAX_PRICE_SAMPLES);
    }
    lastSampleAt = quoteTime;
  }

  for (const listener of quoteListeners) {
    try {
      listener({ ...quote });
    } catch {
      // A display/update listener must never take down the price stream.
    }
  }
  return quote;
}

function scheduleReconnect() {
  if (streamStopped || reconnectTimer) {
    return;
  }
  const delay = Math.min(30_000, 750 * (2 ** Math.min(reconnectAttempts, 5)))
    + Math.floor(Math.random() * 500);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBtcStream();
  }, delay);
  reconnectTimer.unref?.();
}

function connectBtcStream() {
  if (streamStopped || btcSocket?.readyState === WebSocket.OPEN || btcSocket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const socket = new WebSocket(BINANCE_BTC_STREAM_URL, {
    handshakeTimeout: 8_000,
    perMessageDeflate: false,
  });
  btcSocket = socket;

  socket.on("open", () => {
    reconnectAttempts = 0;
  });

  socket.on("message", (payload) => {
    try {
      const event = JSON.parse(payload.toString());
      const eventAt = Number(event?.T || event?.E || Date.now());
      saveBtcQuote(event?.p, "binance_ws", new Date(eventAt));
    } catch {
      // Ignore malformed frames and keep the socket alive.
    }
  });

  socket.on("error", () => {
    socket.terminate();
  });

  socket.on("close", () => {
    if (btcSocket === socket) {
      btcSocket = null;
    }
    scheduleReconnect();
  });
}

export function startBtcPriceStream() {
  if (streamStarted && !streamStopped) {
    return;
  }
  streamStarted = true;
  streamStopped = false;
  connectBtcStream();
}

export function stopBtcPriceStream() {
  streamStopped = true;
  streamStarted = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (btcSocket) {
    const socket = btcSocket;
    btcSocket = null;
    socket.removeAllListeners();
    socket.terminate();
  }
}

export function onBtcPrice(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  quoteListeners.add(listener);
  return () => quoteListeners.delete(listener);
}

export async function getBtcPrice() {
  const cached = getCachedBtcPrice();
  if (cached && Date.now() - cached.at.getTime() <= STREAM_FRESH_MS) {
    return cached;
  }

  const sources = [
    {
      name: "binance",
      url: BINANCE_BTC_URL,
      parse: (data) => Number(data?.price),
    },
    {
      name: "coinbase",
      url: COINBASE_BTC_URL,
      parse: (data) => Number(data?.data?.amount),
    },
    {
      name: "coingecko",
      url: COINGECKO_BTC_URL,
      parse: (data) => Number(data?.bitcoin?.usd),
    },
  ];

  let lastError = null;
  for (const source of sources) {
    try {
      const quote = await getBtcPriceFromSource(source);
      return saveBtcQuote(quote.price, quote.source, quote.at);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof PriceUnavailableError) {
    throw lastError;
  }

  throw new PriceUnavailableError("BTC price request failed.");
}

export function getCachedBtcPrice() {
  if (!latestBtcPrice) {
    return null;
  }
  return {
    ...latestBtcPrice,
    at: new Date(latestBtcPrice.at),
  };
}

// Signed price move over a short window. Volatility says how far BTC travels;
// this says which way it has been going, which is what tells the market maker
// whose side of its own quote is about to be the wrong one.
export function getBtcDrift(windowSeconds = 20) {
  const window = Math.max(1, Number(windowSeconds || 20));
  const cutoff = Date.now() - window * 1_000;
  const samples = priceSamples.filter((sample) => sample.at >= cutoff);
  if (samples.length < 2) {
    return { ratio: 0, from: null, to: null, samples: samples.length, seconds: window };
  }

  const from = samples[0];
  const to = samples[samples.length - 1];
  if (!(from.price > 0) || !(to.price > 0)) {
    return { ratio: 0, from: null, to: null, samples: samples.length, seconds: window };
  }

  return {
    ratio: (to.price - from.price) / from.price,
    from: from.price,
    to: to.price,
    samples: samples.length,
    seconds: Math.max(0.25, (to.at - from.at) / 1_000),
  };
}

export function getBtcVolatility(windowSeconds = 300) {
  const cutoff = Date.now() - Math.max(30, Number(windowSeconds || 300)) * 1_000;
  const samples = priceSamples.filter((sample) => sample.at >= cutoff);
  if (samples.length < 10) {
    return 0.000065;
  }

  const returns = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const elapsedSeconds = Math.max(0.25, (current.at - previous.at) / 1_000);
    returns.push(Math.log(current.price / previous.price) / Math.sqrt(elapsedSeconds));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / Math.max(1, returns.length - 1);
  return Math.min(0.001, Math.max(0.000035, Math.sqrt(variance)));
}

export function getBtcStreamStatus() {
  const cached = getCachedBtcPrice();
  return {
    connected: btcSocket?.readyState === WebSocket.OPEN,
    source: cached?.source || null,
    age_ms: cached ? Math.max(0, Date.now() - cached.at.getTime()) : null,
    samples: priceSamples.length,
    volatility_per_sqrt_second: getBtcVolatility(),
  };
}

async function getBtcPriceFromSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "easymarket-price-service/0.1",
      },
    });

    if (!response.ok) {
      throw new PriceUnavailableError("BTC price endpoint returned an error.");
    }

    const data = await response.json();
    const price = source.parse(data);
    if (!Number.isFinite(price) || price <= 0) {
      throw new PriceUnavailableError("BTC price response is invalid.");
    }

    return {
      symbol: "BTCUSDT",
      price,
      source: source.name,
      at: new Date(),
    };
  } catch (error) {
    if (error instanceof PriceUnavailableError) {
      throw error;
    }

    throw new PriceUnavailableError("BTC price request failed.");
  } finally {
    clearTimeout(timeout);
  }
}
