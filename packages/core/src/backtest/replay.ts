import type { Candle, MarketRegime, Timeframe, TradeSide } from "../../../contracts/src/index.js";
import { analyzeMultiTimeframe, type MultiTimeframeInput } from "../multiTimeframe/engine.js";
import { detectMarketRegime } from "../regime/marketRegime.js";
import { buildRiskPlan, type RiskConfig } from "../risk/riskEngine.js";
import { generateSignalDocument } from "../signal/signalEngine.js";
import type { CandidateKind } from "../chanlun/types.js";

export const RESEARCH_STRATEGY_VERSION = "chanlun-mtf-paper-v1.1";
export const CHANLUN_ALGORITHM_VERSION = "chanlun-core-confirmed-v1.1";

const TIMEFRAMES = ["1D", "4H", "1H", "30m", "15m"] as const satisfies readonly Timeframe[];
const ALL_CANDIDATE_KINDS: readonly CandidateKind[] = [
  "candidate_1_buy",
  "candidate_2_buy",
  "candidate_3_buy",
  "candidate_1_sell",
  "candidate_2_sell",
  "candidate_3_sell",
];

export interface ResearchStrategyConfig extends RiskConfig {
  maPeriod: number;
  atrPeriod: number;
  minimumAtrPercent: number;
  minimumExecutionBars: number;
  allowedCandidateKinds: readonly CandidateKind[];
}

export const DEFAULT_RESEARCH_STRATEGY_CONFIG: ResearchStrategyConfig = {
  minimumRiskReward: 2,
  stopAtrBuffer: 0.15,
  entryAtrWidth: 0.1,
  maPeriod: 40,
  atrPeriod: 14,
  minimumAtrPercent: 0.15,
  minimumExecutionBars: 60,
  allowedCandidateKinds: ALL_CANDIDATE_KINDS,
};

export interface ExecutionFilterState {
  movingAverage: number | null;
  atr: number | null;
  atrPercent: number | null;
  maAligned: boolean;
  atrAligned: boolean;
}

export interface ResearchOpportunity {
  opportunityId: string;
  symbol: string;
  side: TradeSide;
  candidateKind: CandidateKind;
  candidateLabel: string;
  candidatePrice: number;
  locationTime: number;
  confirmedAt: number;
  dataCutoff: number;
  entryMin: number;
  entryMax: number;
  stop: number;
  target: number;
  target2: number;
  plannedRiskReward: number;
  marketRegime: MarketRegime;
  ma40: number;
  atr: number;
  atrPercent: number;
  m30CandidateLabel: string;
  m15CandidateLabel: string;
  evidence: readonly string[];
}

export interface ResearchReplayResult {
  algorithmVersion: typeof CHANLUN_ALGORITHM_VERSION;
  strategyVersion: typeof RESEARCH_STRATEGY_VERSION;
  opportunities: readonly ResearchOpportunity[];
  decisions: readonly BarDecisionAudit[];
  observedCandidates: readonly ObservedCandidateAudit[];
  intervalNestingChecks: readonly IntervalNestingAudit[];
  rejectionCounts: Readonly<Record<string, number>>;
  diagnostics: {
    executionBars: number;
    evaluatedBars: number;
    readySignals: number;
    rejectedByMa: number;
    rejectedByAtr: number;
    rejectedByCandidateKind: number;
  };
}

export interface BarDecisionAudit {
  symbol: string;
  candleOpenTime: number;
  candleCloseTime: number;
  dataCutoff: number;
  visibleCutoffs: Readonly<Record<Timeframe, number | null>>;
  dailyState: string;
  h4State: string;
  h1State: string;
  intervalNestingState: string;
  marketRegime: MarketRegime;
  preferredSide: TradeSide | null;
  signalState: string;
  score: number;
  rejectionStage: string | null;
  rejectionReason: string | null;
}

export interface ObservedCandidateAudit {
  sourceCandidateId: string;
  symbol: string;
  timeframe: "30m" | "15m";
  candidateKind: CandidateKind;
  candidateLabel: string;
  side: TradeSide;
  locationTime: number;
  confirmedAt: number;
  firstVisibleCutoff: number;
  price: number;
  score: number;
  accepted: boolean;
  rejectionReason: string | null;
}

export interface IntervalNestingAudit {
  symbol: string;
  dataCutoff: number;
  state: string;
  side: TradeSide | null;
  m30CandidateId: string | null;
  m15CandidateId: string | null;
  m30ConfirmedAt: number | null;
  m15ConfirmedAt: number | null;
  structureLow: number | null;
  structureHigh: number | null;
  m15Price: number | null;
  sameDirection: boolean | null;
  confirmationOrderValid: boolean | null;
  insideStructure: boolean | null;
  reasons: readonly string[];
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverage(candles: readonly Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null;
  return average(candles.slice(-period).map((candle) => candle.close));
}

function averageTrueRange(candles: readonly Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period + 1) return null;
  let total = 0;
  for (let index = candles.length - period; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    if (!candle || !previous) return null;
    total += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  }
  return total / period;
}

export function evaluateExecutionFilters(
  candles: readonly Candle[],
  side: TradeSide,
  config: ResearchStrategyConfig = DEFAULT_RESEARCH_STRATEGY_CONFIG,
): ExecutionFilterState {
  const close = candles.at(-1)?.close;
  const ma = movingAverage(candles, config.maPeriod);
  const atr = averageTrueRange(candles, config.atrPeriod);
  const atrPercent = close && atr !== null ? (atr / close) * 100 : null;
  return {
    movingAverage: ma,
    atr,
    atrPercent,
    maAligned: close !== undefined && ma !== null && (side === "long" ? close > ma : close < ma),
    atrAligned: atrPercent !== null && atrPercent >= config.minimumAtrPercent,
  };
}

function closedPrefix(input: readonly Candle[], cutoff: number): Candle[] {
  return input
    .filter((candle) => candle.closed && candle.closeTime <= cutoff)
    .sort((left, right) => left.openTime - right.openTime);
}

function validateConfig(config: ResearchStrategyConfig): void {
  if (config.maPeriod < 2 || config.atrPeriod < 2 || config.minimumExecutionBars < config.maPeriod) {
    throw new Error("Invalid MA/ATR execution configuration");
  }
  if (config.minimumRiskReward < 1 || config.minimumAtrPercent < 0) {
    throw new Error("Invalid risk or ATR threshold");
  }
}

export function replayResearchOpportunities(
  input: MultiTimeframeInput,
  partialConfig: Partial<ResearchStrategyConfig> = {},
): ResearchReplayResult {
  const config: ResearchStrategyConfig = {
    ...DEFAULT_RESEARCH_STRATEGY_CONFIG,
    ...partialConfig,
    allowedCandidateKinds: partialConfig.allowedCandidateKinds ?? ALL_CANDIDATE_KINDS,
  };
  validateConfig(config);
  const execution = closedPrefix(input["15m"], Number.POSITIVE_INFINITY);
  const seen = new Set<string>();
  const opportunities: ResearchOpportunity[] = [];
  const decisions: BarDecisionAudit[] = [];
  const candidateMap = new Map<string, ObservedCandidateAudit>();
  const acceptedCandidateIds = new Set<string>();
  const intervalNestingChecks: IntervalNestingAudit[] = [];
  const rejectionCounts: Record<string, number> = {};
  let evaluatedBars = 0;
  let readySignals = 0;
  let rejectedByMa = 0;
  let rejectedByAtr = 0;
  let rejectedByCandidateKind = 0;

  for (let index = config.minimumExecutionBars - 1; index < execution.length; index += 1) {
    const executionCandle = execution[index];
    if (!executionCandle) continue;
    const cutoff = executionCandle.closeTime;
    const prefix = Object.fromEntries(
      TIMEFRAMES.map((timeframe) => [timeframe, closedPrefix(input[timeframe], cutoff)]),
    ) as unknown as MultiTimeframeInput;
    if (TIMEFRAMES.some((timeframe) => prefix[timeframe].length === 0)) continue;
    evaluatedBars += 1;
    const multiTimeframe = analyzeMultiTimeframe(prefix);
    const side = multiTimeframe.preferredSide;
    const regime = detectMarketRegime(prefix["1H"]);
    const nesting = multiTimeframe.intervalNesting;
    for (const [timeframe, snapshot] of [["30m", multiTimeframe.snapshots["30m"]], ["15m", multiTimeframe.snapshots["15m"]]] as const) {
      for (const candidate of snapshot.signals.filter((item) => item.confirmedAt <= cutoff)) {
        const key = `${timeframe}:${candidate.id}`;
        if (!candidateMap.has(key)) candidateMap.set(key, {
          sourceCandidateId: candidate.id,
          symbol: executionCandle.symbol,
          timeframe,
          candidateKind: candidate.kind,
          candidateLabel: candidate.label,
          side: candidate.side,
          locationTime: candidate.locationTime,
          confirmedAt: candidate.confirmedAt,
          firstVisibleCutoff: cutoff,
          price: candidate.price,
          score: candidate.score,
          accepted: false,
          rejectionReason: null,
        });
      }
    }
    const m30Source = nesting.m30Candidate
      ? multiTimeframe.snapshots["30m"].signals.find((item) => item.locationTime === nesting.m30Candidate?.locationTime && item.confirmedAt === nesting.m30Candidate.confirmedAt)
      : null;
    const m15Source = nesting.m15Candidate
      ? multiTimeframe.snapshots["15m"].signals.find((item) => item.locationTime === nesting.m15Candidate?.locationTime && item.confirmedAt === nesting.m15Candidate.confirmedAt)
      : null;
    intervalNestingChecks.push({
      symbol: executionCandle.symbol,
      dataCutoff: cutoff,
      state: nesting.state,
      side: nesting.side,
      m30CandidateId: m30Source?.id ?? null,
      m15CandidateId: m15Source?.id ?? null,
      m30ConfirmedAt: nesting.m30Candidate?.confirmedAt ?? null,
      m15ConfirmedAt: nesting.m15Candidate?.confirmedAt ?? null,
      structureLow: nesting.structureLow,
      structureHigh: nesting.structureHigh,
      m15Price: nesting.m15Candidate?.price ?? null,
      sameDirection: nesting.m30Candidate && nesting.m15Candidate ? nesting.m30Candidate.side === nesting.m15Candidate.side : null,
      confirmationOrderValid: nesting.m30Candidate && nesting.m15Candidate ? nesting.m15Candidate.confirmedAt >= nesting.m30Candidate.confirmedAt : null,
      insideStructure: nesting.m15Candidate && nesting.structureLow !== null && nesting.structureHigh !== null ? nesting.m15Candidate.price >= nesting.structureLow && nesting.m15Candidate.price <= nesting.structureHigh : null,
      reasons: nesting.reasons,
    });
    const recordDecision = (stage: string | null, reason: string | null, signalState = "WAIT", score = multiTimeframe.alignmentScore): void => {
      if (stage) rejectionCounts[stage] = (rejectionCounts[stage] ?? 0) + 1;
      decisions.push({
        symbol: executionCandle.symbol,
        candleOpenTime: executionCandle.openTime,
        candleCloseTime: executionCandle.closeTime,
        dataCutoff: cutoff,
        visibleCutoffs: Object.fromEntries(TIMEFRAMES.map((timeframe) => [timeframe, prefix[timeframe].at(-1)?.closeTime ?? null])) as Readonly<Record<Timeframe, number | null>>,
        dailyState: multiTimeframe.daily,
        h4State: multiTimeframe.h4,
        h1State: multiTimeframe.h1,
        intervalNestingState: nesting.state,
        marketRegime: regime.regime,
        preferredSide: side,
        signalState,
        score,
        rejectionStage: stage,
        rejectionReason: reason,
      });
    };
    if (!side) { recordDecision("daily_direction", "1D structure has no directional preference"); continue; }
    if (nesting.state !== "ALIGNED") { recordDecision("interval_nesting", `30M/15M nesting state is ${nesting.state}`); continue; }
    const risk = buildRiskPlan(side, multiTimeframe.snapshots["15m"], [
      multiTimeframe.snapshots["30m"],
      multiTimeframe.snapshots["1H"],
      multiTimeframe.snapshots["4H"],
      multiTimeframe.snapshots["1D"],
    ], config);
    const document = generateSignalDocument({
      multiTimeframe,
      regime,
      risk,
      generatedAt: cutoff,
    });
    const ready = document.signal === "LONG_READY" || document.signal === "SHORT_READY";
    if (!ready || risk.status !== "VALID" || !risk.candidate) { recordDecision("signal_readiness", risk.status, document.signal, document.score); continue; }
    readySignals += 1;
    if (!config.allowedCandidateKinds.includes(risk.candidate.kind)) {
      rejectedByCandidateKind += 1;
      recordDecision("candidate_kind", `${risk.candidate.kind} is disabled`, document.signal, document.score);
      continue;
    }
    const filters = evaluateExecutionFilters(prefix["15m"], side, config);
    if (!filters.maAligned) {
      rejectedByMa += 1;
      recordDecision("ma_filter", `MA${config.maPeriod} direction filter failed`, document.signal, document.score);
      continue;
    }
    if (!filters.atrAligned) {
      rejectedByAtr += 1;
      recordDecision("atr_filter", `ATR${config.atrPeriod} volatility filter failed`, document.signal, document.score);
      continue;
    }
    const m30Candidate = multiTimeframe.intervalNesting.m30Candidate;
    const m15Candidate = multiTimeframe.intervalNesting.m15Candidate;
    if (
      !m30Candidate
      || !m15Candidate
      || risk.entryMin === null
      || risk.entryMax === null
      || risk.stop === null
      || risk.tp1 === null
      || risk.tp2 === null
      || risk.rr1 === null
      || filters.movingAverage === null
      || filters.atr === null
      || filters.atrPercent === null
    ) { recordDecision("risk_plan", "Risk plan or interval candidate is incomplete", document.signal, document.score); continue; }
    const confirmation = Math.max(m30Candidate.confirmedAt, m15Candidate.confirmedAt, risk.candidate.confirmedAt);
    if (confirmation > cutoff) { recordDecision("future_confirmation", "Candidate confirmation is later than the visible cutoff", document.signal, document.score); continue; }
    const opportunityId = `${executionCandle.symbol}:${m30Candidate.label}:${m30Candidate.confirmedAt}:${m15Candidate.label}:${m15Candidate.confirmedAt}`;
    if (seen.has(opportunityId)) { recordDecision("duplicate_opportunity", opportunityId, document.signal, document.score); continue; }
    seen.add(opportunityId);
    acceptedCandidateIds.add(`15m:${risk.candidate.id}`);
    if (m30Source) acceptedCandidateIds.add(`30m:${m30Source.id}`);
    recordDecision(null, null, document.signal, document.score);
    opportunities.push({
      opportunityId,
      symbol: executionCandle.symbol,
      side,
      candidateKind: risk.candidate.kind,
      candidateLabel: risk.candidate.label,
      candidatePrice: risk.candidate.price,
      locationTime: risk.candidate.locationTime,
      confirmedAt: confirmation,
      dataCutoff: cutoff,
      entryMin: risk.entryMin,
      entryMax: risk.entryMax,
      stop: risk.stop,
      target: risk.tp1,
      target2: risk.tp2,
      plannedRiskReward: risk.rr1,
      marketRegime: regime.regime,
      ma40: filters.movingAverage,
      atr: filters.atr,
      atrPercent: filters.atrPercent,
      m30CandidateLabel: m30Candidate.label,
      m15CandidateLabel: m15Candidate.label,
      evidence: [
        ...risk.evidence,
        `MA${config.maPeriod} ${filters.movingAverage.toFixed(6)}`,
        `ATR${config.atrPeriod} ${filters.atr.toFixed(6)} (${filters.atrPercent.toFixed(4)}%)`,
        `point-in-time cutoff ${cutoff}`,
      ],
    });
  }

  return {
    algorithmVersion: CHANLUN_ALGORITHM_VERSION,
    strategyVersion: RESEARCH_STRATEGY_VERSION,
    opportunities,
    decisions,
    observedCandidates: [...candidateMap.entries()].map(([key, candidate]) => ({
      ...candidate,
      accepted: acceptedCandidateIds.has(key),
      rejectionReason: acceptedCandidateIds.has(key) ? null : "Not selected by a complete accepted opportunity",
    })),
    intervalNestingChecks,
    rejectionCounts,
    diagnostics: {
      executionBars: execution.length,
      evaluatedBars,
      readySignals,
      rejectedByMa,
      rejectedByAtr,
      rejectedByCandidateKind,
    },
  };
}
