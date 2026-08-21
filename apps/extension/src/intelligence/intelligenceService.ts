import type { Candle, Interval } from "@/chanlun/types";
import { fetchOkxCandles } from "@/okx/okxRest";
import {
  buildIntelligenceResult,
  INTELLIGENCE_TIMEFRAMES,
  type IntelligenceCandles,
  type IntelligenceResult,
} from "./signalAdapter";

export interface IntelligenceLoadResult {
  candles: IntelligenceCandles;
  analysis: IntelligenceResult;
  loadedAt: number;
}

export async function loadIntelligence(
  instId: string,
  currentInterval?: Interval,
  currentCandles?: Promise<Candle[]>,
): Promise<IntelligenceLoadResult> {
  const entries = await Promise.all(
    INTELLIGENCE_TIMEFRAMES.map(async (timeframe) => {
      const candles = timeframe === currentInterval && currentCandles
        ? await currentCandles
        : await fetchOkxCandles(instId, timeframe, 300);
      return [timeframe, candles] as const;
    }),
  );
  const candles = Object.fromEntries(entries) as IntelligenceCandles;
  return {
    candles,
    analysis: buildIntelligenceResult(instId, candles),
    loadedAt: Date.now(),
  };
}
