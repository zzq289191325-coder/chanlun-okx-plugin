import { describe, expect, it } from "vitest";
import {
  analyzeChanlun,
  replayCandidateSignals,
} from "../src/chanlun/engine.js";
import { candlesFromValues } from "./fixtures.js";
import { aggregateCandles, historicalBtc15m } from "./historicalFixture.js";

describe("point-in-time behavior", () => {
  const values = [
    100, 104, 108, 112, 116, 111, 106, 101, 96, 100, 105, 110, 118, 113, 108,
    102, 94, 99, 105, 111, 120, 115, 109, 103, 92, 98, 104, 110, 119,
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
    expect(
      recorded.every((item) => item.emittedAt >= item.signal.confirmedAt),
    ).toBe(true);
  });

  it("never analyzes the current open candle", () => {
    const open = {
      ...candles.at(-1)!,
      closed: false,
      high: 10_000,
      close: 10_000,
    };
    const withOpen = analyzeChanlun([...candles.slice(0, -1), open]);
    const withoutOpen = analyzeChanlun(candles.slice(0, -1));
    expect(withOpen).toEqual(withoutOpen);
  });

  it.each([
    ["15m", historicalBtc15m()],
    ["30m", aggregateCandles(historicalBtc15m(), "30m", 2)],
  ])(
    "is unchanged when future %s candles are mutated after a cutoff",
    (_timeframe, history) => {
      const prefixLength = Math.floor(history.length * 0.7);
      const cutoff = history[prefixLength - 1]!.closeTime;
      const mutatedFuture = history.map((candle, index) =>
        index < prefixLength
          ? candle
          : {
              ...candle,
              high: candle.high * 10,
              low: candle.low * 0.1,
              close: candle.close * 8,
            },
      );
      expect(analyzeChanlun(mutatedFuture, cutoff)).toEqual(
        analyzeChanlun(history.slice(0, prefixLength)),
      );
    },
  );

  it("keeps every historical structure confirmation at or before the data cutoff", () => {
    for (let length = 20; length <= historicalBtc15m().length; length += 4) {
      const result = analyzeChanlun(historicalBtc15m().slice(0, length));
      const confirmedAt = [
        ...result.fractals,
        ...result.strokes,
        ...result.segments,
        ...result.zones,
        ...result.divergences,
        ...result.signals,
      ].map((item) => item.confirmedAt);
      expect(confirmedAt.every((time) => time <= result.dataCutoff)).toBe(true);
    }
  });
});
