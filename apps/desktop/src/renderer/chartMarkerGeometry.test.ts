import { describe, expect, it } from "vitest";
import { markerGlyph, markerHorizontalOffset, markerPriceOnCandle } from "./chartMarkerGeometry.js";

describe("K-line B/S marker geometry", () => {
  it("uses B for buy and S for sell directly at the price point", () => {
    expect(markerGlyph("buy")).toBe("B");
    expect(markerGlyph("sell")).toBe("S");
    expect(markerHorizontalOffset(0)).toBe(0);
  });

  it("moves only overlapping markers sideways around the exact price", () => {
    expect(markerHorizontalOffset(1)).toBe(15);
    expect(markerHorizontalOffset(2)).toBe(-15);
    expect(markerHorizontalOffset(3)).toBe(30);
  });

  it("keeps valid prices exact and anchors legacy outliers to the candle", () => {
    expect(markerPriceOnCandle(105, "buy", { low: 100, high: 110 })).toEqual({ displayPrice: 105, adjusted: false });
    expect(markerPriceOnCandle(90, "buy", { low: 100, high: 110 })).toEqual({ displayPrice: 100, adjusted: true });
    expect(markerPriceOnCandle(120, "sell", { low: 100, high: 110 })).toEqual({ displayPrice: 110, adjusted: true });
  });
});
