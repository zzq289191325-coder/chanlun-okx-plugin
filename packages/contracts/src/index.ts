export const SIGNAL_SCHEMA_VERSION = 2 as const;

export type Timeframe = "1D" | "4H" | "1H" | "30m" | "15m";
export type Direction = "up" | "down" | "range";
export type TradeSide = "long" | "short";

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export type SignalState =
  | "PASS"
  | "WAIT"
  | "WATCH_LONG"
  | "WATCH_SHORT"
  | "LONG_READY"
  | "SHORT_READY"
  | "LONG_ACTIVE"
  | "SHORT_ACTIVE"
  | "INVALIDATED";

export type MarketRegime =
  | "STRONG_TREND_UP"
  | "TREND_UP"
  | "RANGE_WIDE"
  | "RANGE_NARROW"
  | "TREND_DOWN"
  | "STRONG_TREND_DOWN"
  | "HIGH_VOLATILITY"
  | "NEWS_EVENT";

export interface SignalEvidence {
  rule: string;
  timeframe: Timeframe;
  observedAt: number;
  detail: string;
  score: number;
}

export interface IntervalCandidateDocument {
  label: string;
  side: TradeSide;
  locationTime: number;
  confirmedAt: number;
  price: number;
  score: number;
  ageBars: number;
}

export interface IntervalNestingDocument {
  state:
    | "WAIT_30M_SETUP"
    | "WAIT_15M_CONFIRMATION"
    | "ALIGNED"
    | "PARTIAL"
    | "CONFLICT"
    | "STALE";
  side: TradeSide | null;
  score: number;
  m30Candidate: IntervalCandidateDocument | null;
  m15Candidate: IntervalCandidateDocument | null;
  structureLow: number | null;
  structureHigh: number | null;
  reasons: readonly string[];
  waitingFor: readonly string[];
}

export interface NewsImpactDocument {
  bias: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  score: number;
  highImpactEventSoon: boolean;
  itemsAnalyzed: number;
  matchedKeywords: readonly string[];
  summary: string;
  dataCutoff: number;
}

export interface SignalDocument {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  signalId: string;
  symbol: string;
  generatedAt: number;
  dataCutoff: number;
  marketRegime: MarketRegime;
  daily: string;
  h4: string;
  h1: string;
  m30: string;
  m15: string;
  signal: SignalState;
  score: number;
  entryMin: number | null;
  entryMax: number | null;
  stop: number | null;
  tp1: number | null;
  tp2: number | null;
  rr1: number | null;
  rr2: number | null;
  newsBias: string;
  intervalNesting: IntervalNestingDocument;
  newsImpact: NewsImpactDocument;
  reasons: readonly SignalEvidence[];
  waitingFor: readonly string[];
  invalidation: string;
}
