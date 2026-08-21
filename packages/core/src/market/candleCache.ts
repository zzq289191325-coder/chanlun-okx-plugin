import type { Candle, Timeframe } from "../../../contracts/src/index.js";
import { detectCandleGaps, normalizeClosedCandles, type CandleGap } from "./candles.js";

export interface CachedSeries {
  symbol: string;
  timeframe: Timeframe;
  candles: readonly Candle[];
  gaps: readonly CandleGap[];
  updatedAt: number;
}

function cacheKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol}:${timeframe}`;
}

export class CandleCache {
  private readonly series = new Map<string, CachedSeries>();

  put(symbol: string, timeframe: Timeframe, incoming: readonly Candle[], updatedAt = Date.now()): CachedSeries {
    const current = this.series.get(cacheKey(symbol, timeframe));
    const candles = normalizeClosedCandles([...(current?.candles ?? []), ...incoming]);
    const next: CachedSeries = {
      symbol,
      timeframe,
      candles,
      gaps: detectCandleGaps(candles),
      updatedAt,
    };
    this.series.set(cacheKey(symbol, timeframe), next);
    return next;
  }

  get(symbol: string, timeframe: Timeframe): CachedSeries | null {
    return this.series.get(cacheKey(symbol, timeframe)) ?? null;
  }

  isFresh(symbol: string, timeframe: Timeframe, maxAgeMilliseconds: number, now = Date.now()): boolean {
    const cached = this.get(symbol, timeframe);
    return cached !== null && now - cached.updatedAt <= maxAgeMilliseconds && cached.gaps.length === 0;
  }

  clear(): void {
    this.series.clear();
  }
}
