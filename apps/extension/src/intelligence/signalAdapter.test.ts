import { describe, expect, it } from "vitest";
import type { Timeframe } from "@intelligence/contracts";
import type { Candle } from "@/chanlun/types";
import {
  buildIntelligenceResult,
  INTELLIGENCE_TIMEFRAMES,
  toLegacyAnalysis,
  type IntelligenceCandles,
} from "./signalAdapter";

const STEP: Record<Timeframe, number> = {
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1H": 60 * 60_000,
  "4H": 4 * 60 * 60_000,
  "1D": 24 * 60 * 60_000,
};

function candles(timeframe: Timeframe, count = 160): Candle[] {
  const step = STEP[timeframe];
  const end = 1_800_000_000_000;
  return Array.from({ length: count }, (_, index) => {
    const trend = index * 0.12;
    const wave = Math.sin(index / 4) * 7 + Math.sin(index / 11) * 3;
    const close = 100 + trend + wave;
    const open = close - Math.sin(index / 3) * 0.8;
    return {
      ts: end - (count - index) * step,
      open,
      high: Math.max(open, close) + 1.2,
      low: Math.min(open, close) - 1.2,
      close,
      volume: 1_000 + (index % 13) * 70,
      closed: true,
    };
  });
}

function fixture(): IntelligenceCandles {
  return Object.fromEntries(INTELLIGENCE_TIMEFRAMES.map((timeframe) => [timeframe, candles(timeframe)])) as IntelligenceCandles;
}

describe("extension intelligence adapter", () => {
  it("produces one structured, display-only signal for all five timeframes", () => {
    const result = buildIntelligenceResult("BTC-USDT-SWAP", fixture());
    expect(result.signal.symbol).toBe("BTC-USDT-SWAP");
    expect(Object.keys(result.snapshots).sort()).toEqual([...INTELLIGENCE_TIMEFRAMES].sort());
    expect(result.signal.score).toBeGreaterThanOrEqual(0);
    expect(result.signal.score).toBeLessThanOrEqual(100);
    expect(JSON.stringify(result.signal)).not.toMatch(/apiKey|secret|orderId|placeOrder/i);
    if (result.risk.status === "VALID") expect(result.risk.rr1).toBeGreaterThanOrEqual(2);
  });

  it("converts only confirmed V2 structures into the legacy chart drawing contract", () => {
    const result = buildIntelligenceResult("BTC-USDT-SWAP", fixture());
    const snapshot = result.snapshots["30m"];
    const legacy = toLegacyAnalysis(snapshot);
    expect(legacy.fractals).toHaveLength(snapshot.fractals.length);
    expect(legacy.bis).toHaveLength(snapshot.strokes.length);
    expect(legacy.signals).toHaveLength(snapshot.signals.length);
    expect(snapshot.fractals.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
    expect(snapshot.signals.every((item) => item.confirmedAt <= snapshot.dataCutoff)).toBe(true);
  });
});
