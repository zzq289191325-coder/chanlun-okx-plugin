import { describe, expect, it } from "vitest";
import { visibleFundamentalObservations } from "../src/fundamentalStructural.js";

describe("point-in-time fundamental data", () => {
  it("does not expose a future publication, future recording or future revision", () => {
    const observations = [
      { observationId: "visible", symbol: "GOOGL-USDT-SWAP", metric: "revenue_growth", numericValue: 0.4, effectiveAt: 1, publishedAt: 2, recordedAt: 3, revisionAt: null, dataVersion: "v1" },
      { observationId: "future-record", symbol: "GOOGL-USDT-SWAP", metric: "profit_growth", numericValue: 0.5, effectiveAt: 1, publishedAt: 2, recordedAt: 20, revisionAt: null, dataVersion: "v1" },
      { observationId: "future-revision", symbol: "GOOGL-USDT-SWAP", metric: "gross_margin", numericValue: 0.6, effectiveAt: 1, publishedAt: 2, recordedAt: 3, revisionAt: 30, dataVersion: "v2" },
    ];
    expect(visibleFundamentalObservations(observations, 10).map((item) => item.observationId)).toEqual(["visible"]);
  });
});
