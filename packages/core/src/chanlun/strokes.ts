import type { Fractal, Stroke } from "./types.js";

export interface StrokeOptions {
  minimumIncludedBarSeparation: number;
}

const DEFAULT_OPTIONS: StrokeOptions = {
  minimumIncludedBarSeparation: 4,
};

function validPriceMove(start: Fractal, end: Fractal): boolean {
  if (start.type === "bottom" && end.type === "top") return end.price > start.price;
  if (start.type === "top" && end.type === "bottom") return end.price < start.price;
  return false;
}

export function buildConfirmedStrokes(
  fractals: readonly Fractal[],
  options: StrokeOptions = DEFAULT_OPTIONS,
): Stroke[] {
  const accepted: Fractal[] = [];
  for (const fractal of fractals) {
    const last = accepted.at(-1);
    if (!last) {
      accepted.push(fractal);
      continue;
    }
    if (last.type === fractal.type) {
      const replace = fractal.type === "top" ? fractal.price > last.price : fractal.price < last.price;
      if (replace) accepted[accepted.length - 1] = fractal;
      continue;
    }
    if (fractal.index - last.index < options.minimumIncludedBarSeparation || !validPriceMove(last, fractal)) {
      continue;
    }
    accepted.push(fractal);
  }

  const strokes: Stroke[] = [];
  for (let index = 1; index < accepted.length; index += 1) {
    const start = accepted[index - 1];
    const end = accepted[index];
    if (!start || !end) continue;
    const direction = start.type === "bottom" ? "up" : "down";
    strokes.push({
      id: `stroke:${direction}:${start.locationTime}:${end.locationTime}`,
      direction,
      start,
      end,
      startTime: start.locationTime,
      endTime: end.locationTime,
      confirmedAt: Math.max(start.confirmedAt, end.confirmedAt),
      high: Math.max(start.price, end.price),
      low: Math.min(start.price, end.price),
      includedBars: end.index - start.index + 1,
    });
  }
  return strokes;
}
