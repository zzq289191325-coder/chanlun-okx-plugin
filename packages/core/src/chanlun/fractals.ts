import type { Fractal, IncludedBar } from "./types.js";

function strength(center: IncludedBar, left: IncludedBar, right: IncludedBar, type: Fractal["type"]): number {
  const span = Math.max(center.high - center.low, Number.EPSILON);
  const extension =
    type === "top"
      ? center.high - Math.max(left.high, right.high)
      : Math.min(left.low, right.low) - center.low;
  return Math.max(0, Math.min(100, Math.round(45 + (extension / span) * 55)));
}

function moreExtreme(candidate: Fractal, current: Fractal): boolean {
  return candidate.type === "top" ? candidate.price > current.price : candidate.price < current.price;
}

export function detectConfirmedFractals(bars: readonly IncludedBar[]): Fractal[] {
  const raw: Fractal[] = [];
  for (let index = 1; index < bars.length - 1; index += 1) {
    const left = bars[index - 1];
    const center = bars[index];
    const right = bars[index + 1];
    if (!left || !center || !right) continue;

    const isTop =
      center.high > left.high && center.high > right.high && center.low > left.low && center.low > right.low;
    const isBottom =
      center.low < left.low && center.low < right.low && center.high < left.high && center.high < right.high;

    if (isTop) {
      raw.push({
        id: `fractal:top:${center.openTime}`,
        type: "top",
        index,
        locationTime: center.openTime,
        confirmedAt: right.closeTime,
        price: center.high,
        strength: strength(center, left, right, "top"),
      });
    } else if (isBottom) {
      raw.push({
        id: `fractal:bottom:${center.openTime}`,
        type: "bottom",
        index,
        locationTime: center.openTime,
        confirmedAt: right.closeTime,
        price: center.low,
        strength: strength(center, left, right, "bottom"),
      });
    }
  }

  const alternating: Fractal[] = [];
  for (const fractal of raw) {
    const last = alternating.at(-1);
    if (!last || last.type !== fractal.type) {
      alternating.push(fractal);
    } else if (moreExtreme(fractal, last)) {
      alternating[alternating.length - 1] = fractal;
    }
  }
  return alternating;
}
