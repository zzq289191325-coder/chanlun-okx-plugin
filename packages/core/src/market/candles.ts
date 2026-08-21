import type { Candle, Timeframe } from "../../../contracts/src/index.js";

const TIMEFRAME_MS: Readonly<Record<Timeframe, number>> = {
  "1D": 86_400_000,
  "4H": 14_400_000,
  "1H": 3_600_000,
  "30m": 1_800_000,
  "15m": 900_000,
};

export function timeframeMilliseconds(timeframe: Timeframe): number {
  return TIMEFRAME_MS[timeframe];
}

export function assertValidCandle(candle: Candle): void {
  const prices = [candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (prices.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid non-finite candle at ${candle.openTime}`);
  }
  if (candle.openTime >= candle.closeTime) {
    throw new Error(`Invalid candle time range at ${candle.openTime}`);
  }
  if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) {
    throw new Error(`Invalid OHLC range at ${candle.openTime}`);
  }
  if (candle.high < candle.low || candle.volume < 0) {
    throw new Error(`Invalid candle high/low/volume at ${candle.openTime}`);
  }
}

export function normalizeClosedCandles(input: readonly Candle[], cutoff = Number.POSITIVE_INFINITY): Candle[] {
  const byOpenTime = new Map<number, Candle>();
  for (const candle of input) {
    assertValidCandle(candle);
    if (!candle.closed || candle.closeTime > cutoff) continue;
    byOpenTime.set(candle.openTime, { ...candle });
  }

  const candles = [...byOpenTime.values()].sort((left, right) => left.openTime - right.openTime);
  const first = candles[0];
  for (const candle of candles) {
    if (first && (candle.symbol !== first.symbol || candle.timeframe !== first.timeframe)) {
      throw new Error("A candle series must contain one symbol and one timeframe");
    }
  }
  return candles;
}

export interface CandleGap {
  afterOpenTime: number;
  beforeOpenTime: number;
  missingBars: number;
}

export function detectCandleGaps(candles: readonly Candle[]): CandleGap[] {
  const gaps: CandleGap[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (!previous || !current) continue;
    const duration = timeframeMilliseconds(current.timeframe);
    const distance = current.openTime - previous.openTime;
    if (distance > duration) {
      gaps.push({
        afterOpenTime: previous.openTime,
        beforeOpenTime: current.openTime,
        missingBars: Math.max(0, Math.round(distance / duration) - 1),
      });
    }
  }
  return gaps;
}
