import type { Candle, Direction } from "../../../contracts/src/index.js";
import { calculateMacd } from "../indicators/macd.js";
import { normalizeClosedCandles } from "../market/candles.js";
import { detectDivergences } from "./divergence.js";
import { detectConfirmedFractals } from "./fractals.js";
import { mergeInclusions } from "./inclusion.js";
import { buildConfirmedSegments } from "./segments.js";
import { detectCandidateSignals } from "./signals.js";
import { buildConfirmedStrokes } from "./strokes.js";
import type { CandidateSignal, ChanlunSnapshot } from "./types.js";
import { buildCentralZones } from "./zones.js";

function determineDirection(snapshot: Pick<ChanlunSnapshot, "candles" | "strokes" | "segments" | "zones">): Direction {
  const price = snapshot.candles.at(-1)?.close;
  const zone = snapshot.zones.at(-1);
  if (price !== undefined && zone && price >= zone.coreLow && price <= zone.coreHigh) return "range";
  return snapshot.segments.at(-1)?.direction ?? snapshot.strokes.at(-1)?.direction ?? "range";
}

export function analyzeChanlun(input: readonly Candle[], cutoff = Number.POSITIVE_INFINITY): ChanlunSnapshot {
  const candles = normalizeClosedCandles(input, cutoff);
  const first = candles[0];
  if (!first) throw new Error("ChanLun analysis requires at least one closed candle");

  const includedBars = mergeInclusions(candles);
  const fractals = detectConfirmedFractals(includedBars);
  const strokes = buildConfirmedStrokes(fractals);
  const segments = buildConfirmedSegments(strokes);
  const strokeZones = buildCentralZones(strokes, "stroke");
  const segmentZones = buildCentralZones(segments, "segment");
  const zones = [...strokeZones, ...segmentZones].sort(
    (left, right) => left.startTime - right.startTime || left.confirmedAt - right.confirmedAt,
  );
  const macd = calculateMacd(candles);
  const divergences = [
    ...detectDivergences(strokes, "stroke", candles, macd),
    ...detectDivergences(segments, "segment", candles, macd),
  ].sort((left, right) => left.confirmedAt - right.confirmedAt);
  const signals = detectCandidateSignals(strokes, zones, divergences).filter(
    (signal) => signal.confirmedAt <= (candles.at(-1)?.closeTime ?? 0),
  );
  const base = {
    symbol: first.symbol,
    timeframe: first.timeframe,
    dataCutoff: candles.at(-1)?.closeTime ?? first.closeTime,
    candles,
    includedBars,
    fractals,
    strokes,
    segments,
    zones,
    macd,
    divergences,
    signals,
  };
  return { ...base, direction: determineDirection(base) };
}

export interface RecordedCandidateSignal {
  signal: CandidateSignal;
  emittedAt: number;
}

export function replayCandidateSignals(input: readonly Candle[]): RecordedCandidateSignal[] {
  const candles = normalizeClosedCandles(input);
  const recorded = new Map<string, RecordedCandidateSignal>();
  for (let length = 1; length <= candles.length; length += 1) {
    const prefix = candles.slice(0, length);
    const snapshot = analyzeChanlun(prefix);
    for (const signal of snapshot.signals) {
      if (!recorded.has(signal.id)) {
        recorded.set(signal.id, { signal: { ...signal }, emittedAt: snapshot.dataCutoff });
      }
    }
  }
  return [...recorded.values()].sort((left, right) => left.emittedAt - right.emittedAt);
}
