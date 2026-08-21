import {
  SIGNAL_SCHEMA_VERSION,
  type MarketRegime,
  type SignalDocument,
  type SignalEvidence,
  type SignalState,
  type Timeframe,
} from "../../../contracts/src/index.js";
import type { MultiTimeframeAnalysis } from "../multiTimeframe/engine.js";
import type { MarketRegimeResult } from "../regime/marketRegime.js";
import type { RiskPlan } from "../risk/riskEngine.js";
import {
  analyzeNewsImpact,
  type NewsImpactResult,
} from "../news/newsImpact.js";

export interface SignalEngineInput {
  multiTimeframe: MultiTimeframeAnalysis;
  regime: MarketRegimeResult;
  risk: RiskPlan;
  generatedAt?: number;
  newsBias?: string;
  highImpactEventSoon?: boolean;
  newsImpact?: NewsImpactResult;
}

function evidence(
  rule: string,
  timeframe: Timeframe,
  observedAt: number,
  detail: string,
  score: number,
): SignalEvidence {
  return { rule, timeframe, observedAt, detail, score };
}

function decideState(input: SignalEngineInput, score: number): SignalState {
  const { multiTimeframe, regime, risk } = input;
  if (
    input.highImpactEventSoon ||
    input.newsImpact?.highImpactEventSoon ||
    regime.regime === "NEWS_EVENT" ||
    regime.regime === "HIGH_VOLATILITY"
  )
    return "WAIT";
  if (risk.status === "PASS" && risk.reason.includes("2.0R")) return "PASS";
  if (risk.status === "PASS" && risk.reason.includes("风险收益比"))
    return "PASS";
  if (!multiTimeframe.preferredSide) return "WAIT";
  if (
    risk.status !== "VALID" ||
    multiTimeframe.waitingFor.length > 0 ||
    score < 75
  ) {
    return multiTimeframe.preferredSide === "long"
      ? "WATCH_LONG"
      : "WATCH_SHORT";
  }
  return multiTimeframe.preferredSide === "long" ? "LONG_READY" : "SHORT_READY";
}

export function generateSignalDocument(
  input: SignalEngineInput,
): SignalDocument {
  const { multiTimeframe: mtf, regime, risk } = input;
  const generatedAt = input.generatedAt ?? Date.now();
  const reasons: SignalEvidence[] = [];
  const dailyScore = mtf.daily === "NEUTRAL" ? 0 : 20;
  reasons.push(
    evidence(
      "daily_direction",
      "1D",
      mtf.snapshots["1D"].dataCutoff,
      mtf.daily,
      dailyScore,
    ),
  );

  const h4Score =
    mtf.h4 === "BULLISH_PULLBACK" || mtf.h4 === "BEARISH_REBOUND" ? 15 : 0;
  reasons.push(
    evidence("h4_phase", "4H", mtf.snapshots["4H"].dataCutoff, mtf.h4, h4Score),
  );
  const h1Score = mtf.h1 === "NO_OPPORTUNITY_ZONE" ? 0 : 15;
  reasons.push(
    evidence(
      "h1_opportunity_zone",
      "1H",
      mtf.snapshots["1H"].dataCutoff,
      mtf.h1,
      h1Score,
    ),
  );

  const m30Score =
    mtf.intervalNesting.m30Candidate?.side === mtf.preferredSide &&
    mtf.intervalNesting.state !== "STALE"
      ? 15
      : 0;
  reasons.push(
    evidence(
      "m30_structure",
      "30m",
      mtf.snapshots["30m"].dataCutoff,
      mtf.m30,
      m30Score,
    ),
  );
  const m15Score =
    mtf.intervalNesting.m15Candidate?.side === mtf.preferredSide &&
    (mtf.intervalNesting.state === "ALIGNED" ||
      mtf.intervalNesting.state === "PARTIAL")
      ? 15
      : 0;
  reasons.push(
    evidence(
      "m15_trigger",
      "15m",
      mtf.snapshots["15m"].dataCutoff,
      mtf.m15,
      m15Score,
    ),
  );

  const rrScore = risk.status === "VALID" ? 10 : 0;
  reasons.push(
    evidence("risk_reward", "15m", mtf.dataCutoff, risk.reason, rrScore),
  );
  const newsImpact = input.newsImpact ?? analyzeNewsImpact([], generatedAt);
  const highImpactEventSoon = Boolean(
    input.highImpactEventSoon || newsImpact.highImpactEventSoon,
  );
  const newsScore = highImpactEventSoon ? 0 : 2;
  reasons.push(
    evidence(
      "news_risk",
      "15m",
      mtf.dataCutoff,
      input.newsBias ?? newsImpact.bias,
      newsScore,
    ),
  );
  const volatilityScore = regime.regime === "HIGH_VOLATILITY" ? 0 : 5;
  reasons.push(
    evidence(
      "market_regime",
      "1H",
      mtf.dataCutoff,
      regime.regime,
      volatilityScore,
    ),
  );

  const score = Math.max(
    0,
    Math.min(
      100,
      reasons.reduce((sum, item) => sum + item.score, 0),
    ),
  );
  const state = decideState(input, score);
  const waitingFor = [
    ...mtf.waitingFor,
    ...(highImpactEventSoon ? ["等待重大事件公布及波动稳定"] : []),
    ...(risk.status === "PASS" ? [risk.reason] : []),
  ];
  const signalId = `signal:${mtf.symbol}:${mtf.dataCutoff}:${state}`;

  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    signalId,
    symbol: mtf.symbol,
    generatedAt,
    dataCutoff: mtf.dataCutoff,
    marketRegime: regime.regime as MarketRegime,
    daily: mtf.daily,
    h4: mtf.h4,
    h1: mtf.h1,
    m30: mtf.m30,
    m15: mtf.m15,
    signal: state,
    score,
    entryMin: risk.entryMin,
    entryMax: risk.entryMax,
    stop: risk.stop,
    tp1: risk.tp1,
    tp2: risk.tp2,
    rr1: risk.rr1,
    rr2: risk.rr2,
    newsBias: input.newsBias ?? newsImpact.bias,
    intervalNesting: mtf.intervalNesting,
    newsImpact,
    reasons,
    waitingFor,
    invalidation: risk.invalidation,
  };
}
