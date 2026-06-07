const BINANCE_BTC_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
const COINBASE_BTC_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";
const COINGECKO_BTC_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";

export class PriceUnavailableError extends Error {
  constructor(message = "BTC price is unavailable.") {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

export async function getBtcPrice() {
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
      return await getBtcPriceFromSource(source);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof PriceUnavailableError) {
    throw lastError;
  }

  throw new PriceUnavailableError("BTC price request failed.");
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
