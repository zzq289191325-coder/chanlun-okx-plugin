import type { Candle, IncludedCandle } from "./types";

function contains(a: Candle, b: Candle) {
  return a.high >= b.high && a.low <= b.low;
}

function inferDirection(items: IncludedCandle[]) {
  if (items.length < 2) return "up";
  const prev = items.at(-2)!;
  const last = items.at(-1)!;
  if (last.high > prev.high && last.low > prev.low) return "up";
  if (last.high < prev.high && last.low < prev.low) return "down";
  return last.close >= prev.close ? "up" : "down";
}

function mergeIncluded(last: IncludedCandle, next: Candle, direction: "up" | "down"): IncludedCandle {
  const high = direction === "up" ? Math.max(last.high, next.high) : Math.min(last.high, next.high);
  const low = direction === "up" ? Math.max(last.low, next.low) : Math.min(last.low, next.low);
  const merged: IncludedCandle = {
    ...last,
    ts: next.ts,
    high,
    low,
    close: next.close,
    volume: last.volume + next.volume,
    sourceEndTs: next.ts,
  };
  if (next.closed !== undefined) merged.closed = next.closed;
  return merged;
}

export function processIncludes(candles: Candle[]): IncludedCandle[] {
  const sorted = candles.slice().sort((a, b) => a.ts - b.ts);
  const result: IncludedCandle[] = [];

  for (const candle of sorted) {
    if (result.length === 0) {
      result.push({
        ...candle,
        index: 0,
        sourceStartTs: candle.ts,
        sourceEndTs: candle.ts,
      });
      continue;
    }

    const last = result.at(-1)!;
    if (contains(last, candle) || contains(candle, last)) {
      result[result.length - 1] = mergeIncluded(last, candle, inferDirection(result));
    } else {
      result.push({
        ...candle,
        index: result.length,
        sourceStartTs: candle.ts,
        sourceEndTs: candle.ts,
      });
    }
  }

  return result.map((item, index) => ({ ...item, index }));
}
