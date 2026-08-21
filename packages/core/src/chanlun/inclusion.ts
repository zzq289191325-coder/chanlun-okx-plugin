import type { Candle } from "../../../contracts/src/index.js";
import type { IncludedBar } from "./types.js";

function contains(left: Pick<IncludedBar, "high" | "low">, right: Pick<IncludedBar, "high" | "low">): boolean {
  return left.high >= right.high && left.low <= right.low;
}

function inferDirection(bars: readonly IncludedBar[], candle: Candle): "up" | "down" {
  const last = bars.at(-1);
  const previous = bars.at(-2);
  if (!last) return candle.close >= candle.open ? "up" : "down";
  if (previous) {
    if (last.high > previous.high && last.low > previous.low) return "up";
    if (last.high < previous.high && last.low < previous.low) return "down";
  }
  if (candle.high > last.high || candle.low > last.low) return "up";
  if (candle.low < last.low || candle.high < last.high) return "down";
  return candle.close >= last.close ? "up" : "down";
}

function fromCandle(candle: Candle, index: number, direction: "up" | "down"): IncludedBar {
  return {
    id: `included:${candle.symbol}:${candle.timeframe}:${candle.openTime}:${candle.closeTime}`,
    index,
    symbol: candle.symbol,
    timeframe: candle.timeframe,
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    mergeDirection: direction,
    sourceCount: 1,
  };
}

function mergeIncluded(last: IncludedBar, candle: Candle, direction: "up" | "down"): IncludedBar {
  const high = direction === "up" ? Math.max(last.high, candle.high) : Math.min(last.high, candle.high);
  const low = direction === "up" ? Math.max(last.low, candle.low) : Math.min(last.low, candle.low);
  if (low > high) {
    throw new Error(`Inclusion merge produced an invalid range at ${candle.openTime}`);
  }
  return {
    ...last,
    id: `included:${last.symbol}:${last.timeframe}:${last.openTime}:${candle.closeTime}`,
    closeTime: candle.closeTime,
    high,
    low,
    close: candle.close,
    volume: last.volume + candle.volume,
    mergeDirection: direction,
    sourceCount: last.sourceCount + 1,
  };
}

export function mergeInclusions(candles: readonly Candle[]): IncludedBar[] {
  const bars: IncludedBar[] = [];
  for (const candle of candles) {
    const direction = inferDirection(bars, candle);
    const last = bars.at(-1);
    if (!last) {
      bars.push(fromCandle(candle, 0, direction));
      continue;
    }

    const incoming = fromCandle(candle, bars.length, direction);
    if (contains(last, incoming) || contains(incoming, last)) {
      bars[bars.length - 1] = mergeIncluded(last, candle, direction);
      continue;
    }
    bars.push(incoming);
  }
  return bars.map((bar, index) => ({ ...bar, index }));
}
