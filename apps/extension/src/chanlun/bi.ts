import type { Bi, Fractal, IncludedCandle } from "./types";

const MIN_BI_GAP = 4;

function isMoreExtreme(next: Fractal, current: Fractal) {
  return next.type === "top" ? next.price > current.price : next.price < current.price;
}

export function buildBi(_candles: IncludedCandle[], fractals: Fractal[]): Bi[] {
  const pivots: Fractal[] = [];

  for (const fractal of fractals) {
    const last = pivots.at(-1);
    if (!last) {
      pivots.push(fractal);
      continue;
    }

    if (last.type === fractal.type) {
      if (isMoreExtreme(fractal, last)) pivots[pivots.length - 1] = fractal;
      continue;
    }

    if (fractal.index - last.index < MIN_BI_GAP) {
      if (isMoreExtreme(fractal, last)) pivots[pivots.length - 1] = fractal;
      continue;
    }

    pivots.push(fractal);
  }

  const bis: Bi[] = [];
  for (let index = 1; index < pivots.length; index += 1) {
    const start = pivots[index - 1]!;
    const end = pivots[index]!;
    const direction = start.type === "bottom" && end.type === "top" ? "up" : "down";
    bis.push({
      id: `bi-${start.ts}-${end.ts}`,
      direction,
      start,
      end,
      high: Math.max(start.price, end.price),
      low: Math.min(start.price, end.price),
      startTs: start.ts,
      endTs: end.ts,
    });
  }

  return bis;
}
