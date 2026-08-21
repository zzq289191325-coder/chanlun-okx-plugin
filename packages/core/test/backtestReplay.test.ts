import { describe, expect, it } from "vitest";
import type { Candle, Timeframe } from "../../contracts/src/index.js";
import {
  DEFAULT_RESEARCH_STRATEGY_CONFIG,
  evaluateExecutionFilters,
  replayResearchOpportunities,
} from "../src/backtest/replay.js";
import type { MultiTimeframeInput } from "../src/multiTimeframe/engine.js";

const STEP = 15 * 60_000;

function baseCandles(count = 180): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.08 + Math.sin(index / 4) * 5 + Math.sin(index / 13) * 2;
    const open = close - Math.sin(index / 3) * 0.7;
    return {
      symbol: "TEST-USDT-SWAP",
      timeframe: "15m" as const,
      openTime: index * STEP,
      closeTime: (index + 1) * STEP,
      open,
      high: Math.max(open, close) + 1.1,
      low: Math.min(open, close) - 1.1,
      close,
      volume: 1_000 + (index % 11) * 30,
      closed: true,
    };
  });
}

function aggregate(input: readonly Candle[], timeframe: Timeframe, groupSize: number): Candle[] {
  const result: Candle[] = [];
  for (let index = 0; index + groupSize <= input.length; index += groupSize) {
    const group = input.slice(index, index + groupSize);
    const first = group[0]!;
    const last = group.at(-1)!;
    result.push({
      symbol: first.symbol,
      timeframe,
      openTime: first.openTime,
      closeTime: last.closeTime,
      open: first.open,
      high: Math.max(...group.map((item) => item.high)),
      low: Math.min(...group.map((item) => item.low)),
      close: last.close,
      volume: group.reduce((sum, item) => sum + item.volume, 0),
      closed: true,
    });
  }
  return result;
}

function fixture(count = 180): MultiTimeframeInput {
  const m15 = baseCandles(count);
  return {
    "15m": m15,
    "30m": aggregate(m15, "30m", 2),
    "1H": aggregate(m15, "1H", 4),
    "4H": aggregate(m15, "4H", 16),
    "1D": aggregate(m15, "1D", 96),
  };
}

function prefix(input: MultiTimeframeInput, cutoff: number): MultiTimeframeInput {
  return Object.fromEntries(
    Object.entries(input).map(([timeframe, candles]) => [
      timeframe,
      candles.filter((candle: Candle) => candle.closed && candle.closeTime <= cutoff),
    ]),
  ) as unknown as MultiTimeframeInput;
}

describe("point-in-time research strategy replay", () => {
  it("applies configurable MA40 and ATR small-movement filters", () => {
    const candles = baseCandles(80);
    const state = evaluateExecutionFilters(candles, "long");
    expect(state.movingAverage).not.toBeNull();
    expect(state.atr).not.toBeNull();
    expect(state.atrPercent).toBeGreaterThan(0);
    expect(
      evaluateExecutionFilters(candles, "long", {
        ...DEFAULT_RESEARCH_STRATEGY_CONFIG,
        minimumAtrPercent: 100,
      }).atrAligned,
    ).toBe(false);
  });

  it("produces the same historical results from a prefix and an equivalent cutoff", () => {
    const input = fixture();
    const cutoff = input["15m"][119]!.closeTime;
    const full = replayResearchOpportunities(input).opportunities.filter((item) => item.dataCutoff <= cutoff);
    const pointInTime = replayResearchOpportunities(prefix(input, cutoff)).opportunities;
    expect(full).toEqual(pointInTime);
  });

  it("is unchanged when all candles after the cutoff are mutated", () => {
    const input = fixture();
    const cutoff = input["15m"][119]!.closeTime;
    const mutated = Object.fromEntries(
      Object.entries(input).map(([timeframe, candles]) => [
        timeframe,
        candles.map((candle: Candle) =>
          candle.closeTime <= cutoff
            ? candle
            : { ...candle, high: candle.high * 8, low: candle.low * 0.1, close: candle.close * 6 },
        ),
      ]),
    ) as unknown as MultiTimeframeInput;
    const expected = replayResearchOpportunities(prefix(input, cutoff)).opportunities;
    const actual = replayResearchOpportunities(mutated).opportunities.filter((item) => item.dataCutoff <= cutoff);
    expect(actual).toEqual(expected);
  });

  it("ignores an unclosed execution candle and remains deterministic", () => {
    const input = fixture();
    const last = input["15m"].at(-1)!;
    const withOpen = { ...input, "15m": [...input["15m"].slice(0, -1), { ...last, closed: false }] };
    const withoutLast = { ...input, "15m": input["15m"].slice(0, -1) };
    expect(replayResearchOpportunities(withOpen)).toEqual(replayResearchOpportunities(withoutLast));
    expect(replayResearchOpportunities(input)).toEqual(replayResearchOpportunities(input));
  });

  it("never emits an opportunity before every candidate confirmation", () => {
    const result = replayResearchOpportunities(fixture());
    expect(result.opportunities.every((item) => item.confirmedAt <= item.dataCutoff)).toBe(true);
  });
});
