import { describe, expect, it } from "vitest";
import { detectCandleGaps, normalizeClosedCandles } from "../src/market/candles.js";
import { candlesFromValues } from "./fixtures.js";

describe("candle normalization", () => {
  it("sorts, deduplicates, and excludes open candles", () => {
    const candles = candlesFromValues([10, 11, 12]);
    const replacement = { ...candles[1]!, close: 11.5 };
    const open = { ...candles[2]!, closed: false };
    const normalized = normalizeClosedCandles([candles[1]!, candles[0]!, replacement, open]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]?.openTime).toBe(0);
    expect(normalized[1]?.close).toBe(11.5);
  });

  it("reports missing bars without inventing data", () => {
    const candles = candlesFromValues([10, 11, 12]);
    const gaps = detectCandleGaps([candles[0]!, candles[2]!]);
    expect(gaps).toEqual([{ afterOpenTime: 0, beforeOpenTime: 1_800_000, missingBars: 1 }]);
  });
});
