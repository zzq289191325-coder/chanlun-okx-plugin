import { describe, expect, it } from "vitest";
import { analyzeChanlun } from "../src/chanlun/engine.js";
import {
  aggregateCandles,
  BTC_HISTORY_SOURCE,
  historicalBtc15m,
} from "./historicalFixture.js";

function signature(candles: ReturnType<typeof historicalBtc15m>) {
  const result = analyzeChanlun(candles);
  return {
    candles: result.candles.length,
    includedBars: result.includedBars.length,
    fractals: result.fractals.length,
    strokes: result.strokes.length,
    segments: result.segments.length,
    zones: result.zones.length,
    divergences: result.divergences.length,
    signals: result.signals.map((item) => item.label),
    direction: result.direction,
  };
}

describe("offline historical market regression benchmark", () => {
  it("keeps a deterministic golden signature for the captured BTC 15m sample", () => {
    const candles = historicalBtc15m();
    expect(BTC_HISTORY_SOURCE.source).toContain("OKX public");
    expect(signature(candles)).toEqual({
      candles: 72,
      includedBars: 47,
      fractals: 23,
      strokes: 4,
      segments: 0,
      zones: 1,
      divergences: 0,
      signals: [],
      direction: "up",
    });
  });

  it("also runs the same captured history as an aggregated 30m regression sample", () => {
    const candles = aggregateCandles(historicalBtc15m(), "30m", 2);
    const first = signature(candles);
    expect(first).toEqual(signature(candles.map((item) => ({ ...item }))));
    expect(first.candles).toBe(36);
  });
});
