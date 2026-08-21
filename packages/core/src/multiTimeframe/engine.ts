import type {
  Candle,
  Timeframe,
  TradeSide,
} from "../../../contracts/src/index.js";
import { analyzeChanlun } from "../chanlun/engine.js";
import type { CandidateSignal, ChanlunSnapshot } from "../chanlun/types.js";
import {
  analyzeIntervalNesting,
  type IntervalNestingResult,
} from "./nesting.js";

export type DailyState =
  "STRONG_BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG_BEAR";
export type H4State =
  | "WITH_DAILY_BULL"
  | "BULLISH_PULLBACK"
  | "WITH_DAILY_BEAR"
  | "BEARISH_REBOUND"
  | "CONSOLIDATING";
export type OpportunityState =
  "LONG_WATCH_ZONE" | "SHORT_WATCH_ZONE" | "NO_OPPORTUNITY_ZONE";

export interface MultiTimeframeInput {
  "1D": readonly Candle[];
  "4H": readonly Candle[];
  "1H": readonly Candle[];
  "30m": readonly Candle[];
  "15m": readonly Candle[];
}

export interface MultiTimeframeAnalysis {
  symbol: string;
  dataCutoff: number;
  snapshots: Readonly<Record<Timeframe, ChanlunSnapshot>>;
  daily: DailyState;
  h4: H4State;
  h1: OpportunityState;
  m30: string;
  m15: string;
  intervalNesting: IntervalNestingResult;
  preferredSide: TradeSide | null;
  alignmentScore: number;
  waitingFor: readonly string[];
}

function priorSameDirection(snapshot: ChanlunSnapshot): boolean {
  const latest = snapshot.segments.at(-1);
  if (!latest) return false;
  const previous = snapshot.segments
    .slice(0, -1)
    .reverse()
    .find((item) => item.direction === latest.direction);
  if (!previous) return false;
  return latest.direction === "up"
    ? latest.high > previous.high
    : latest.low < previous.low;
}

export function classifyDaily(snapshot: ChanlunSnapshot): DailyState {
  if (snapshot.direction === "range") return "NEUTRAL";
  if (snapshot.direction === "up")
    return priorSameDirection(snapshot) ? "STRONG_BULL" : "BULL";
  return priorSameDirection(snapshot) ? "STRONG_BEAR" : "BEAR";
}

export function classifyH4(
  daily: DailyState,
  snapshot: ChanlunSnapshot,
): H4State {
  if (daily === "BULL" || daily === "STRONG_BULL") {
    if (snapshot.direction === "up") return "WITH_DAILY_BULL";
    if (snapshot.direction === "down") return "BULLISH_PULLBACK";
  }
  if (daily === "BEAR" || daily === "STRONG_BEAR") {
    if (snapshot.direction === "down") return "WITH_DAILY_BEAR";
    if (snapshot.direction === "up") return "BEARISH_REBOUND";
  }
  return "CONSOLIDATING";
}

function nearLatestZone(snapshot: ChanlunSnapshot): boolean {
  const zone = snapshot.zones.filter((item) => item.level === "stroke").at(-1);
  const price = snapshot.candles.at(-1)?.close;
  if (!zone || price === undefined) return false;
  const tolerance = Math.max(
    (zone.coreHigh - zone.coreLow) * 0.35,
    price * 0.005,
  );
  return (
    price >= zone.coreLow - tolerance && price <= zone.coreHigh + tolerance
  );
}

export function classifyOpportunity(
  daily: DailyState,
  h4: H4State,
  h1: ChanlunSnapshot,
): OpportunityState {
  if (
    (daily === "BULL" || daily === "STRONG_BULL") &&
    h4 === "BULLISH_PULLBACK" &&
    nearLatestZone(h1)
  ) {
    return "LONG_WATCH_ZONE";
  }
  if (
    (daily === "BEAR" || daily === "STRONG_BEAR") &&
    h4 === "BEARISH_REBOUND" &&
    nearLatestZone(h1)
  ) {
    return "SHORT_WATCH_ZONE";
  }
  return "NO_OPPORTUNITY_ZONE";
}

function latestCandidate(snapshot: ChanlunSnapshot): CandidateSignal | null {
  return snapshot.signals.at(-1) ?? null;
}

function m30State(snapshot: ChanlunSnapshot): string {
  const candidate = latestCandidate(snapshot);
  if (candidate) return candidate.kind.toUpperCase();
  const divergence = snapshot.divergences.at(-1);
  if (divergence)
    return divergence.side === "bottom"
      ? "BOTTOM_DIVERGENCE"
      : "TOP_DIVERGENCE";
  return snapshot.direction === "range"
    ? "RANGE_STRUCTURE"
    : `${snapshot.direction.toUpperCase()}_STRUCTURE`;
}

function m15State(snapshot: ChanlunSnapshot): string {
  const candidate = latestCandidate(snapshot);
  return candidate
    ? `${candidate.kind.toUpperCase()}_CONFIRMED`
    : "WAIT_STRUCTURE_CONFIRMATION";
}

function alignment(
  daily: DailyState,
  h4: H4State,
  h1: OpportunityState,
  intervalNesting: IntervalNestingResult,
): { side: TradeSide | null; score: number; waitingFor: string[] } {
  const bullishDaily = daily === "BULL" || daily === "STRONG_BULL";
  const bearishDaily = daily === "BEAR" || daily === "STRONG_BEAR";
  const side: TradeSide | null = bullishDaily
    ? "long"
    : bearishDaily
      ? "short"
      : null;
  if (!side) return { side: null, score: 0, waitingFor: ["等待日线方向明确"] };

  let score = 20;
  const waitingFor: string[] = [];
  const h4Aligned =
    side === "long" ? h4 === "BULLISH_PULLBACK" : h4 === "BEARISH_REBOUND";
  if (h4Aligned) score += 15;
  else waitingFor.push("等待4H进入顺日线方向的回调/反弹阶段");

  const h1Aligned =
    side === "long" ? h1 === "LONG_WATCH_ZONE" : h1 === "SHORT_WATCH_ZONE";
  if (h1Aligned) score += 15;
  else waitingFor.push("等待1H进入机会区域");

  const m30Candidate = intervalNesting.m30Candidate;
  const m30Aligned =
    m30Candidate?.side === side && intervalNesting.state !== "STALE";
  if (m30Aligned) score += 15;
  else waitingFor.push(`等待30M候选${side === "long" ? "买" : "卖"}结构`);

  const m15Candidate = intervalNesting.m15Candidate;
  const m15Aligned =
    m15Candidate?.side === side &&
    (intervalNesting.state === "ALIGNED" ||
      intervalNesting.state === "PARTIAL");
  if (m15Aligned) score += 15;
  else waitingFor.push(`等待15M确认候选${side === "long" ? "买" : "卖"}结构`);

  waitingFor.push(
    ...intervalNesting.waitingFor.filter((item) => !waitingFor.includes(item)),
  );
  return { side, score, waitingFor };
}

export function analyzeMultiTimeframe(
  input: MultiTimeframeInput,
): MultiTimeframeAnalysis {
  const snapshots = {
    "1D": analyzeChanlun(input["1D"]),
    "4H": analyzeChanlun(input["4H"]),
    "1H": analyzeChanlun(input["1H"]),
    "30m": analyzeChanlun(input["30m"]),
    "15m": analyzeChanlun(input["15m"]),
  } satisfies Record<Timeframe, ChanlunSnapshot>;
  const symbol = snapshots["1D"].symbol;
  for (const snapshot of Object.values(snapshots)) {
    if (snapshot.symbol !== symbol)
      throw new Error("Multi-timeframe input must use one symbol");
  }

  const daily = classifyDaily(snapshots["1D"]);
  const h4 = classifyH4(daily, snapshots["4H"]);
  const h1 = classifyOpportunity(daily, h4, snapshots["1H"]);
  const intervalNesting = analyzeIntervalNesting(
    snapshots["30m"],
    snapshots["15m"],
  );
  const result = alignment(daily, h4, h1, intervalNesting);
  return {
    symbol,
    dataCutoff: Math.min(
      ...Object.values(snapshots).map((snapshot) => snapshot.dataCutoff),
    ),
    snapshots,
    daily,
    h4,
    h1,
    m30: m30State(snapshots["30m"]),
    m15: m15State(snapshots["15m"]),
    intervalNesting,
    preferredSide: result.side,
    alignmentScore: result.score,
    waitingFor: result.waitingFor,
  };
}
