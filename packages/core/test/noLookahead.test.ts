import { describe, expect, it } from "vitest";
import { analyzeChanlun, replayCandidateSignals } from "../src/chanlun/engine.js";
import { candlesFromValues } from "./fixtures.js";

describe("point-in-time behavior", () => {
  const values = [
    100, 104, 108, 112, 116, 111, 106, 101, 96, 100, 105, 110, 118, 113, 108, 102, 94, 99, 105, 111,
    120, 115, 109, 103, 92, 98, 104, 110, 119,
  ];
  const candles = candlesFromValues(values);

  it("cutoff analysis is identical to analyzing the same candle prefix", () => {
    for (let length = 1; length <= candles.length; length += 1) {
      const prefix = candles.slice(0, length);
      const cutoff = prefix.at(-1)?.closeTime ?? 0;
      expect(analyzeChanlun(candles, cutoff)).toEqual(analyzeChanlun(prefix));
    }
  });

  it("never emits a recorded signal before its confirmation time", () => {
    const recorded = replayCandidateSignals(candles);
    expect(recorded.every((item) => item.emittedAt >= item.signal.confirmedAt)).toBe(true);
  });

  it("never analyzes the current open candle", () => {
    const open = { ...candles.at(-1)!, closed: false, high: 10_000, close: 10_000 };
    const withOpen = analyzeChanlun([...candles.slice(0, -1), open]);
    const withoutOpen = analyzeChanlun(candles.slice(0, -1));
    expect(withOpen).toEqual(withoutOpen);
  });
});
