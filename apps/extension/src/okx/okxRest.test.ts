import { describe, expect, it } from "vitest";
import { normalizeOkxCandle } from "./okxRest";

describe("okx REST normalization", () => {
  it("normalizes OKX candle rows into typed candle objects", () => {
    const candle = normalizeOkxCandle([
      "1783005300000",
      "61554.6",
      "61773.2",
      "61460",
      "61764.5",
      "105197.56",
      "1051.9756",
      "64815159.29213",
      "0",
    ]);

    expect(candle).toEqual({
      ts: 1_783_005_300_000,
      open: 61554.6,
      high: 61773.2,
      low: 61460,
      close: 61764.5,
      volume: 105197.56,
      closed: false,
    });
  });
});
