import { describe, expect, it, vi } from "vitest";
import { CandleCache } from "../src/market/candleCache.js";
import { MultiTimeframeLoader } from "../src/market/multiTimeframeLoader.js";
import { OkxPublicMarketClient } from "../src/okx/publicMarketClient.js";
import type { OkxCandleRow, OkxEnvelope } from "../src/okx/candles.js";

const closedRow: OkxCandleRow = ["0", "100", "110", "90", "105", "12", "0", "0", "1"];
const openRow: OkxCandleRow = ["900000", "105", "115", "100", "112", "8", "0", "0", "0"];

function response(
  data: OkxEnvelope<OkxCandleRow[]>,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("OKX public market adapter", () => {
  it("uses only the public candle endpoint and parses confirm state", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input));
      return response({ code: "0", msg: "", data: [openRow, closedRow] });
    });
    const client = new OkxPublicMarketClient({
      fetch: fetcher as typeof fetch,
      retries: 0,
      minimumRequestIntervalMilliseconds: 0,
    });

    const candles = await client.getCandles({ symbol: "BTC-USDT-SWAP", timeframe: "15m" });
    expect(candles.map((item) => item.closed)).toEqual([true, false]);
    expect(requested[0]).toContain("/api/v5/market/candles");
    expect(requested[0]).not.toContain("/trade/");
    expect(requested[0]).not.toContain("apiKey");
  });

  it("retries a retryable server failure", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return response({ code: "500", msg: "temporary", data: [] }, 500);
      return response({ code: "0", msg: "", data: [closedRow] });
    });
    const client = new OkxPublicMarketClient({
      fetch: fetcher as typeof fetch,
      retries: 1,
      minimumRequestIntervalMilliseconds: 0,
    });

    await expect(client.getCandles({ symbol: "BTC-USDT-SWAP", timeframe: "15m" })).resolves.toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("loads all five analysis timeframes once and reuses fresh cache", async () => {
    const fetcher = vi.fn(async () => response({ code: "0", msg: "", data: [closedRow] }));
    const client = new OkxPublicMarketClient({
      fetch: fetcher as typeof fetch,
      retries: 0,
      minimumRequestIntervalMilliseconds: 0,
    });
    const cache = new CandleCache();
    const loader = new MultiTimeframeLoader(client, cache, { maximumCacheAgeMilliseconds: 60_000 });

    const first = await loader.load("BTC-USDT-SWAP", 1_000);
    const second = await loader.load("BTC-USDT-SWAP", 2_000);
    expect(Object.keys(first)).toEqual(["1D", "4H", "1H", "30m", "15m"]);
    expect(second["1D"].candles).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
