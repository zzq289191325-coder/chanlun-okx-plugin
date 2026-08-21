import type { Candle, Interval } from "@/chanlun/types";
import { uniqueByTs } from "@/utils/format";

interface OkxCandlesResponse {
  code: string;
  msg: string;
  data: string[][];
}

export function normalizeOkxCandle(row: string[]): Candle {
  const [ts, open, high, low, close, volume, , , closed] = row;
  return {
    ts: Number(ts),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    closed: closed === "1",
  };
}

export async function fetchOkxCandles(instId: string, interval: Interval, limit = 300) {
  const url = new URL("https://www.okx.com/api/v5/market/candles");
  url.searchParams.set("instId", instId);
  url.searchParams.set("bar", interval);
  url.searchParams.set("limit", String(Math.min(limit, 300)));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OKX REST failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as OkxCandlesResponse;
  if (payload.code !== "0") {
    throw new Error(`OKX REST failed: ${payload.msg || payload.code}`);
  }

  return uniqueByTs(payload.data.map(normalizeOkxCandle)).slice(-limit);
}
