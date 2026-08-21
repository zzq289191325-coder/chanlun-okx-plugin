import type { Candle, MarketRegime } from "../../../contracts/src/index.js";

export interface MarketRegimeResult {
  regime: MarketRegime;
  atrPercent: number | null;
  movingAverageSlopePercent: number | null;
  trendStrength: number | null;
  evidence: readonly string[];
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverage(candles: readonly Candle[], period: number, offset = 0): number | null {
  const end = candles.length - offset;
  if (end < period) return null;
  return average(candles.slice(end - period, end).map((candle) => candle.close));
}

function atr(candles: readonly Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const ranges: number[] = [];
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (!candle || !previous) return null;
    ranges.push(
      Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close)),
    );
  }
  return average(ranges);
}

export function detectMarketRegime(candles: readonly Candle[]): MarketRegimeResult {
  const close = candles.at(-1)?.close;
  const atrValue = atr(candles);
  const fast = movingAverage(candles, 20);
  const slow = movingAverage(candles, 50);
  const previousFast = movingAverage(candles, 20, 5);
  if (!close || atrValue === null || fast === null || slow === null || previousFast === null) {
    return {
      regime: "RANGE_NARROW",
      atrPercent: null,
      movingAverageSlopePercent: null,
      trendStrength: null,
      evidence: ["insufficient closed candles for regime confirmation"],
    };
  }

  const atrPercent = (atrValue / close) * 100;
  const slope = ((fast - previousFast) / previousFast) * 100;
  const trendStrength = Math.abs(fast - slow) / Math.max(atrValue, Number.EPSILON);
  let regime: MarketRegime;
  if (atrPercent >= 4) regime = "HIGH_VOLATILITY";
  else if (fast > slow && slope > 0) regime = trendStrength >= 1.5 ? "STRONG_TREND_UP" : "TREND_UP";
  else if (fast < slow && slope < 0) regime = trendStrength >= 1.5 ? "STRONG_TREND_DOWN" : "TREND_DOWN";
  else regime = atrPercent >= 1.5 ? "RANGE_WIDE" : "RANGE_NARROW";

  return {
    regime,
    atrPercent,
    movingAverageSlopePercent: slope,
    trendStrength,
    evidence: [
      `ATR ${atrPercent.toFixed(3)}%`,
      `MA20 slope ${slope.toFixed(3)}% over 5 bars`,
      `MA20/MA50 strength ${trendStrength.toFixed(3)} ATR`,
    ],
  };
}
