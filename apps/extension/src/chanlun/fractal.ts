import type { Fractal, IncludedCandle } from "./types";

function strength(mid: IncludedCandle, prev: IncludedCandle, next: IncludedCandle) {
  const span = Math.max(mid.high - mid.low, Number.EPSILON);
  const highDelta = Math.abs(mid.high - Math.max(prev.high, next.high));
  const lowDelta = Math.abs(mid.low - Math.min(prev.low, next.low));
  return Math.min(100, Math.round(((highDelta + lowDelta) / span) * 50 + 35));
}

export function detectFractals(candles: IncludedCandle[]): Fractal[] {
  const fractals: Fractal[] = [];

  for (let index = 1; index < candles.length - 1; index += 1) {
    const prev = candles[index - 1]!;
    const mid = candles[index]!;
    const next = candles[index + 1]!;

    const isTop =
      mid.high > prev.high && mid.high > next.high && mid.low > prev.low && mid.low > next.low;
    const isBottom =
      mid.low < prev.low && mid.low < next.low && mid.high < prev.high && mid.high < next.high;

    if (isTop) {
      fractals.push({
        id: `fx-top-${mid.ts}`,
        type: "top",
        index,
        ts: mid.ts,
        price: mid.high,
        strength: strength(mid, prev, next),
      });
    }

    if (isBottom) {
      fractals.push({
        id: `fx-bottom-${mid.ts}`,
        type: "bottom",
        index,
        ts: mid.ts,
        price: mid.low,
        strength: strength(mid, prev, next),
      });
    }
  }

  return normalizeAlternation(fractals);
}

function normalizeAlternation(fractals: Fractal[]) {
  const normalized: Fractal[] = [];
  for (const fractal of fractals) {
    const last = normalized.at(-1);
    if (!last) {
      normalized.push(fractal);
      continue;
    }

    if (last.type === fractal.type) {
      const replace =
        fractal.type === "top" ? fractal.price > last.price : fractal.price < last.price;
      if (replace) normalized[normalized.length - 1] = fractal;
    } else {
      normalized.push(fractal);
    }
  }
  return normalized;
}
