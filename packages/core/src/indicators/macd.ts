import type { Candle } from "../../../contracts/src/index.js";
import type { MacdPoint } from "../chanlun/types.js";

function ema(previous: number | undefined, value: number, period: number): number {
  if (previous === undefined) return value;
  const alpha = 2 / (period + 1);
  return value * alpha + previous * (1 - alpha);
}

export function calculateMacd(candles: readonly Candle[]): MacdPoint[] {
  let fast: number | undefined;
  let slow: number | undefined;
  let signal: number | undefined;

  return candles.map((candle) => {
    fast = ema(fast, candle.close, 12);
    slow = ema(slow, candle.close, 26);
    const dif = fast - slow;
    signal = ema(signal, dif, 9);
    return {
      time: candle.closeTime,
      dif,
      dea: signal,
      histogram: (dif - signal) * 2,
    };
  });
}
