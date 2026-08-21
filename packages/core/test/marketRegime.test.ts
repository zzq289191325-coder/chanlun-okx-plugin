import { describe, expect, it } from "vitest";
import { detectMarketRegime } from "../src/regime/marketRegime.js";
import { candlesFromValues } from "./fixtures.js";

describe("market regime", () => {
  it("stays conservative when the sample is incomplete", () => {
    const result = detectMarketRegime(candlesFromValues([100, 101, 102]));
    expect(result.regime).toBe("RANGE_NARROW");
    expect(result.atrPercent).toBeNull();
  });

  it("detects a confirmed upward moving-average regime", () => {
    const values = Array.from({ length: 80 }, (_, index) => 100 + index * 1.5);
    const result = detectMarketRegime(candlesFromValues(values));
    expect(["TREND_UP", "STRONG_TREND_UP"]).toContain(result.regime);
    expect(result.movingAverageSlopePercent).toBeGreaterThan(0);
  });

  it("downgrades an extreme volatility sample to high volatility", () => {
    const candles = candlesFromValues(Array.from({ length: 80 }, () => 100)).map((candle, index) =>
      index >= 60 ? { ...candle, high: 110, low: 90 } : candle,
    );
    expect(detectMarketRegime(candles).regime).toBe("HIGH_VOLATILITY");
  });
});
