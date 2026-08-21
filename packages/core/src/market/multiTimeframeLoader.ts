import type { Timeframe } from "../../../contracts/src/index.js";
import type { OkxPublicMarketClient } from "../okx/publicMarketClient.js";
import { CandleCache, type CachedSeries } from "./candleCache.js";

export const ANALYSIS_TIMEFRAMES = ["1D", "4H", "1H", "30m", "15m"] as const satisfies readonly Timeframe[];

export type MultiTimeframeSeries = Readonly<Record<Timeframe, CachedSeries>>;

export interface MultiTimeframeLoaderOptions {
  limit?: number;
  maximumCacheAgeMilliseconds?: number;
}

export class MultiTimeframeLoader {
  private readonly limit: number;
  private readonly maximumCacheAgeMilliseconds: number;

  constructor(
    private readonly client: OkxPublicMarketClient,
    private readonly cache: CandleCache,
    options: MultiTimeframeLoaderOptions = {},
  ) {
    this.limit = options.limit ?? 300;
    this.maximumCacheAgeMilliseconds = options.maximumCacheAgeMilliseconds ?? 30_000;
  }

  async load(symbol: string, now = Date.now()): Promise<MultiTimeframeSeries> {
    const entries = await Promise.all(
      ANALYSIS_TIMEFRAMES.map(async (timeframe) => {
        if (!this.cache.isFresh(symbol, timeframe, this.maximumCacheAgeMilliseconds, now)) {
          const candles = await this.client.getCandles({ symbol, timeframe, limit: this.limit });
          this.cache.put(symbol, timeframe, candles, now);
        }
        const series = this.cache.get(symbol, timeframe);
        if (!series) throw new Error(`Missing cached series for ${symbol} ${timeframe}`);
        return [timeframe, series] as const;
      }),
    );
    return Object.fromEntries(entries) as MultiTimeframeSeries;
  }
}
