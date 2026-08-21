import type { TradeSide } from "../../../contracts/src/index.js";
import type { CandidateSignal, ChanlunSnapshot } from "../chanlun/types.js";

export type IntervalNestingState =
  | "WAIT_30M_SETUP"
  | "WAIT_15M_CONFIRMATION"
  | "ALIGNED"
  | "PARTIAL"
  | "CONFLICT"
  | "STALE";

export interface IntervalCandidateSummary {
  label: string;
  side: TradeSide;
  locationTime: number;
  confirmedAt: number;
  price: number;
  score: number;
  ageBars: number;
}

export interface IntervalNestingResult {
  state: IntervalNestingState;
  side: TradeSide | null;
  score: number;
  m30Candidate: IntervalCandidateSummary | null;
  m15Candidate: IntervalCandidateSummary | null;
  structureLow: number | null;
  structureHigh: number | null;
  reasons: readonly string[];
  waitingFor: readonly string[];
}

const MAX_30M_AGE_BARS = 16;
const MAX_15M_AGE_BARS = 20;

function summarizeCandidate(
  snapshot: ChanlunSnapshot,
  candidate: CandidateSignal,
): IntervalCandidateSummary {
  const locationIndex = snapshot.candles.findLastIndex(
    (candle) => candle.openTime <= candidate.locationTime,
  );
  const ageBars =
    locationIndex < 0
      ? snapshot.candles.length
      : snapshot.candles.length - 1 - locationIndex;
  return {
    label: candidate.label,
    side: candidate.side,
    locationTime: candidate.locationTime,
    confirmedAt: candidate.confirmedAt,
    price: candidate.price,
    score: candidate.score,
    ageBars,
  };
}

function latestConfirmedCandidate(
  snapshot: ChanlunSnapshot,
): IntervalCandidateSummary | null {
  const candidate = snapshot.signals
    .filter((item) => item.confirmedAt <= snapshot.dataCutoff)
    .at(-1);
  return candidate ? summarizeCandidate(snapshot, candidate) : null;
}

function structureWindow(
  snapshot: ChanlunSnapshot,
  candidate: IntervalCandidateSummary,
) {
  const zone = snapshot.zones
    .filter((item) => item.confirmedAt <= candidate.confirmedAt)
    .at(-1);
  if (zone) {
    const padding = Math.max(
      (zone.rangeHigh - zone.rangeLow) * 0.15,
      candidate.price * 0.0025,
    );
    return { low: zone.rangeLow - padding, high: zone.rangeHigh + padding };
  }

  const recent = snapshot.candles
    .filter((item) => item.closeTime <= candidate.confirmedAt)
    .slice(-12);
  const averageRange =
    recent.length > 0
      ? recent.reduce((sum, item) => sum + (item.high - item.low), 0) /
        recent.length
      : candidate.price * 0.004;
  const padding = Math.max(averageRange * 2.5, candidate.price * 0.006);
  return { low: candidate.price - padding, high: candidate.price + padding };
}

export function analyzeIntervalNesting(
  m30: ChanlunSnapshot,
  m15: ChanlunSnapshot,
): IntervalNestingResult {
  const m30Candidate = latestConfirmedCandidate(m30);
  const m15Candidate = latestConfirmedCandidate(m15);
  if (!m30Candidate) {
    return {
      state: "WAIT_30M_SETUP",
      side: null,
      score: 0,
      m30Candidate: null,
      m15Candidate,
      structureLow: null,
      structureHigh: null,
      reasons: [],
      waitingFor: ["等待30M形成已确认候选结构"],
    };
  }

  const window = structureWindow(m30, m30Candidate);
  if (m30Candidate.ageBars > MAX_30M_AGE_BARS) {
    return {
      state: "STALE",
      side: m30Candidate.side,
      score: 10,
      m30Candidate,
      m15Candidate,
      structureLow: window.low,
      structureHigh: window.high,
      reasons: ["30M候选结构已超过有效观察窗口"],
      waitingFor: ["等待新的30M候选结构"],
    };
  }

  if (!m15Candidate || m15Candidate.confirmedAt < m30Candidate.confirmedAt) {
    return {
      state: "WAIT_15M_CONFIRMATION",
      side: m30Candidate.side,
      score: 35,
      m30Candidate,
      m15Candidate,
      structureLow: window.low,
      structureHigh: window.high,
      reasons: [`30M已出现${m30Candidate.label}`],
      waitingFor: ["等待30M候选之后的15M确认结构"],
    };
  }

  if (m15Candidate.ageBars > MAX_15M_AGE_BARS) {
    return {
      state: "STALE",
      side: m30Candidate.side,
      score: 20,
      m30Candidate,
      m15Candidate,
      structureLow: window.low,
      structureHigh: window.high,
      reasons: ["15M确认结构已超过有效观察窗口"],
      waitingFor: ["等待新的15M确认结构"],
    };
  }

  if (m15Candidate.side !== m30Candidate.side) {
    return {
      state: "CONFLICT",
      side: null,
      score: 0,
      m30Candidate,
      m15Candidate,
      structureLow: window.low,
      structureHigh: window.high,
      reasons: [`30M ${m30Candidate.label}与15M ${m15Candidate.label}方向冲突`],
      waitingFor: ["等待15M与30M候选方向重新一致"],
    };
  }

  const nested =
    m15Candidate.price >= window.low && m15Candidate.price <= window.high;
  return {
    state: nested ? "ALIGNED" : "PARTIAL",
    side: m30Candidate.side,
    score: nested ? 30 : 20,
    m30Candidate,
    m15Candidate,
    structureLow: window.low,
    structureHigh: window.high,
    reasons: [
      `30M ${m30Candidate.label}与15M ${m15Candidate.label}同向`,
      nested
        ? "15M确认点位于30M结构观察区间内"
        : "15M确认点在30M结构观察区间外",
    ],
    waitingFor: nested ? [] : ["等待15M回到30M结构观察区间并再次确认"],
  };
}
