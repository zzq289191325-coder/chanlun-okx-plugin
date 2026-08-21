import { describe, expect, it } from "vitest";
import type { Timeframe, TradeSide } from "../../contracts/src/index.js";
import { analyzeIntervalNesting } from "../src/multiTimeframe/nesting.js";
import type { CandidateSignal, ChanlunSnapshot } from "../src/chanlun/types.js";
import { candlesFromValues } from "./fixtures.js";

function candidate(
  side: TradeSide,
  locationTime: number,
  confirmedAt: number,
  price = 100,
): CandidateSignal {
  return {
    id: `${side}:${locationTime}`,
    kind: side === "long" ? "candidate_2_buy" : "candidate_2_sell",
    label: side === "long" ? "候选2买" : "候选2卖",
    side,
    locationTime,
    confirmedAt,
    price,
    score: 80,
    evidenceIds: [],
    reason: "fixture",
  };
}

function snapshot(
  timeframe: Timeframe,
  signal: CandidateSignal | null,
): ChanlunSnapshot {
  const candles = candlesFromValues(
    Array.from({ length: 30 }, () => 100),
    timeframe,
  );
  return {
    symbol: "TEST-USDT-SWAP",
    timeframe,
    dataCutoff: candles.at(-1)!.closeTime,
    candles,
    includedBars: [],
    fractals: [],
    strokes: [],
    segments: [],
    zones: [],
    macd: [],
    divergences: [],
    signals: signal ? [signal] : [],
    direction: "range",
  };
}

describe("15m/30m interval nesting", () => {
  it("requires a 15m candidate to confirm after the 30m setup", () => {
    const m30 = snapshot(
      "30m",
      candidate("long", 20 * 900_000, 21 * 900_000, 100),
    );
    const earlyM15 = snapshot(
      "15m",
      candidate("long", 18 * 900_000, 19 * 900_000, 100.2),
    );
    const result = analyzeIntervalNesting(m30, earlyM15);
    expect(result.state).toBe("WAIT_15M_CONFIRMATION");
  });

  it("marks same-direction, in-range confirmation as aligned", () => {
    const m30 = snapshot(
      "30m",
      candidate("long", 20 * 900_000, 21 * 900_000, 100),
    );
    const m15 = snapshot(
      "15m",
      candidate("long", 22 * 900_000, 23 * 900_000, 100.4),
    );
    const result = analyzeIntervalNesting(m30, m15);
    expect(result.state).toBe("ALIGNED");
    expect(result.side).toBe("long");
    expect(result.waitingFor).toEqual([]);
  });

  it("does not align opposing 15m and 30m candidates", () => {
    const m30 = snapshot("30m", candidate("long", 20 * 900_000, 21 * 900_000));
    const m15 = snapshot("15m", candidate("short", 22 * 900_000, 23 * 900_000));
    expect(analyzeIntervalNesting(m30, m15).state).toBe("CONFLICT");
  });
});
