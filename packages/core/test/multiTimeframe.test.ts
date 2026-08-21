import { describe, expect, it } from "vitest";
import { classifyDaily, classifyH4, classifyOpportunity, analyzeMultiTimeframe } from "../src/multiTimeframe/engine.js";
import type { ChanlunSnapshot, Segment } from "../src/chanlun/types.js";
import { candlesFromValues } from "./fixtures.js";

function segment(id: string, direction: "up" | "down", high: number, low: number): Segment {
  return {
    id,
    direction,
    startTime: 0,
    endTime: 10,
    confirmedAt: 11,
    high,
    low,
    strokeIds: [],
    ruleVersion: "confirmed-three-stroke-v1",
  };
}

function snapshot(overrides: Partial<ChanlunSnapshot> = {}): ChanlunSnapshot {
  const candles = candlesFromValues([100], "1H");
  return {
    symbol: "TEST-USDT-SWAP",
    timeframe: "1H",
    dataCutoff: candles[0]!.closeTime,
    candles,
    includedBars: [],
    fractals: [],
    strokes: [],
    segments: [],
    zones: [],
    macd: [],
    divergences: [],
    signals: [],
    direction: "range",
    ...overrides,
  };
}

describe("multi-timeframe engine", () => {
  it("classifies daily strength from confirmed same-direction segment extension", () => {
    const daily = snapshot({
      direction: "up",
      segments: [segment("old", "up", 110, 90), segment("new", "up", 120, 95)],
    });
    expect(classifyDaily(daily)).toBe("STRONG_BULL");
    expect(classifyH4("STRONG_BULL", snapshot({ direction: "down" }))).toBe("BULLISH_PULLBACK");
  });

  it("requires the 1H price to be near a confirmed zone", () => {
    const h1 = snapshot({
      direction: "range",
      zones: [
        {
          id: "z",
          level: "stroke",
          startTime: 0,
          endTime: 1,
          confirmedAt: 2,
          coreLow: 98,
          coreHigh: 102,
          rangeLow: 95,
          rangeHigh: 105,
          legIds: [],
          state: "extended",
        },
      ],
    });
    expect(classifyOpportunity("BULL", "BULLISH_PULLBACK", h1)).toBe("LONG_WATCH_ZONE");
    expect(classifyOpportunity("BEAR", "WITH_DAILY_BEAR", h1)).toBe("NO_OPPORTUNITY_ZONE");
  });

  it("analyzes exactly the five configured timeframes", () => {
    const values = Array.from({ length: 60 }, (_, index) => 100 + index);
    const input: Parameters<typeof analyzeMultiTimeframe>[0] = {
      "1D": candlesFromValues(values, "1D"),
      "4H": candlesFromValues(values, "4H"),
      "1H": candlesFromValues(values, "1H"),
      "30m": candlesFromValues(values, "30m"),
      "15m": candlesFromValues(values, "15m"),
    };
    const result = analyzeMultiTimeframe(input);
    expect(Object.keys(result.snapshots)).toEqual(["1D", "4H", "1H", "30m", "15m"]);
    expect(result.symbol).toBe("TEST-USDT-SWAP");
    expect(result.waitingFor.length).toBeGreaterThan(0);
  });
});
