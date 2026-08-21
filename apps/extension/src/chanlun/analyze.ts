import { buildBi } from "./bi";
import { detectFractals } from "./fractal";
import { processIncludes } from "./includeProcessor";
import { calculateMacd } from "./macd";
import { buildSegments } from "./segment";
import { detectSignals } from "./signals";
import { detectZhongshu } from "./zhongshu";
import type { Candle, ChanlunAnalysis } from "./types";

function inferDirection(
  bis: ChanlunAnalysis["bis"],
  recentZone: ChanlunAnalysis["recentZhongshu"] | undefined,
  latestClose: number,
) {
  if (recentZone && latestClose >= recentZone.low && latestClose <= recentZone.high) return "range";
  const latestBi = bis.at(-1);
  return latestBi?.direction ?? "range";
}

export function analyzeChanlun(candles: Candle[]): ChanlunAnalysis {
  const included = processIncludes(candles);
  const fractals = detectFractals(included);
  const bis = buildBi(included, fractals);
  const segments = buildSegments(bis);
  const zhongshu = detectZhongshu(bis, segments);
  const macd = calculateMacd(included);
  const signals = detectSignals({ bis, segments, zhongshu, macd });
  const recentZhongshu = zhongshu.at(-1);
  const latestClose = included.at(-1)?.close ?? candles.at(-1)?.close ?? 0;
  const direction = inferDirection(bis, recentZhongshu, latestClose);
  const recentSignal = signals.at(-1);

  return {
    included,
    fractals,
    bis,
    segments,
    zhongshu,
    macd,
    signals,
    direction,
    updatedAt: Date.now(),
    ...(recentZhongshu ? { recentZhongshu } : {}),
    ...(recentSignal ? { recentSignal } : {}),
  };
}
