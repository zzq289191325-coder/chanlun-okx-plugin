import type { Candle, MacdPoint } from "./types";

function ema(prev: number | undefined, value: number, period: number) {
  const k = 2 / (period + 1);
  return prev === undefined ? value : value * k + prev * (1 - k);
}

export function calculateMacd(candles: Candle[]): MacdPoint[] {
  let ema12: number | undefined;
  let ema26: number | undefined;
  let dea: number | undefined;

  return candles.map((candle) => {
    ema12 = ema(ema12, candle.close, 12);
    ema26 = ema(ema26, candle.close, 26);
    const dif = ema12 - ema26;
    dea = ema(dea, dif, 9);
    return {
      ts: candle.ts,
      close: candle.close,
      dif,
      dea,
      histogram: (dif - dea) * 2,
    };
  });
}
