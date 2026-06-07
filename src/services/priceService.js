const BINANCE_BTC_URL = "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";

export class PriceUnavailableError extends Error {
  constructor(message = "BTC price is unavailable.") {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

export async function getBtcPrice() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(BINANCE_BTC_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "easymarket-price-service/0.1",
      },
    });

    if (!response.ok) {
      throw new PriceUnavailableError("Binance price endpoint returned an error.");
    }

    const data = await response.json();
    const price = Number(data?.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new PriceUnavailableError("Binance price response is invalid.");
    }

    return {
      symbol: "BTCUSDT",
      price,
      source: "binance",
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
