export type DesktopMode = "PAPER" | "DEMO" | "LIVE";
export type NavigationPage = "overview" | "structure" | "opportunities" | "paper" | "backtests" | "laboratory" | "learning" | "review" | "data" | "settings";
export type PaperAccountId = "paper-aggressive" | "paper-fundamental";

export interface PaperAccountPolicy {
  accountId: PaperAccountId;
  strategyId: string;
  strategyVersionId: string;
  name: string;
  style: string;
  initialCapital: number;
  maximumOrderNotional: number;
  maximumExposure: number;
  minimumRiskReward: number;
  allowedSides: readonly ("long" | "short")[];
  autoEntryTargetPerHour: number;
  automaticPaperEntry: boolean;
}

export interface DesktopPosition {
  symbol: string;
  strategyId: string;
  side: string;
  quantity: string;
  averagePrice: string;
  markPrice: string;
  unrealizedPnl: string;
}

export interface DesktopSnapshot {
  mode: DesktopMode;
  equity: string;
  available: string;
  positionCount: number;
  positions: readonly DesktopPosition[];
  paperAccounts: readonly DesktopPaperAccount[];
  database: { version: number; integrity: string; candleCount: number; latestBacktestTrades: number };
  execution: { paperEnabled: boolean; demoEnabled: boolean; liveEnabled: boolean; externalOrdersDisabled: boolean };
  market: { source: "OKX_PUBLIC_MARK_PRICE"; connected: boolean; updatedAt: number | null; staleSymbols: readonly string[] };
  updatedAt: number;
}

export interface DesktopPaperAccount extends PaperAccountPolicy {
  equity: string;
  available: string;
  positionCount: number;
  positions: readonly DesktopPosition[];
  tradesLastHour: number;
  lastOpenedAt: number | null;
  nextEntryDueAt: number | null;
  frequencyStatus: "on_target" | "due" | "not_applicable";
}

export interface CandlePoint {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TimeframeSummary {
  timeframe: string;
  candleCount: number;
  firstOpenTime: number | null;
  lastCloseTime: number | null;
  lastClose: number | null;
  changePercent: number | null;
  ma40: number | null;
  direction: "up" | "down" | "range" | "insufficient";
  candidateCount: number;
  openCandleCount: number;
  candles: readonly CandlePoint[];
}

export interface CandidateSignalRow {
  signalId: string;
  symbol: string;
  timeframe: string;
  label: string;
  side: "long" | "short";
  locationTime: number;
  confirmedAt: number;
  price: number;
  score: number;
  marketRegime: string | null;
  reason: string;
}

export interface BacktestRunRow {
  runId: string;
  name: string;
  status: string;
  strategyVersion: string;
  dataStart: number;
  dataEnd: number;
  tradeCount: number;
  totalReturnPercent: number | null;
  maximumDrawdownPercent: number | null;
  winRatePercent: number | null;
  profitFactor: number | null;
  reliability: readonly string[];
  startedAt: number;
}

export interface PaperOrderRow {
  orderId: string;
  accountId: PaperAccountId;
  strategyId: string;
  symbol: string;
  side: string;
  positionSide: string;
  quantity: string;
  price: string;
  fee: string;
  slippage: string;
  status: string;
  reduceOnly: boolean;
  candidateLabel: string | null;
  createdAt: number;
}

export interface StrategyRow {
  strategyId: string;
  name: string;
  style: string;
  description: string;
  enabled: boolean;
  version: string | null;
  status: string | null;
  config: Readonly<Record<string, unknown>>;
}

export interface OptimizerRunRow {
  runId: string;
  strategyId: string;
  status: string;
  method: string;
  trialCount: number;
  acceptedCount: number;
  startedAt: number;
  completedAt: number | null;
}

export interface ReviewTradeRow {
  tradeId: string;
  runId: string;
  symbol: string;
  side: string;
  candidateLabel: string | null;
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  realizedPnl: number | null;
  fee: number;
  slippageCost: number;
  fundingEstimate: number;
  exitReason: string | null;
  dataCutoff: number | null;
  confirmedAt: number | null;
}

export interface ReviewNoteRow {
  noteId: string;
  runId: string | null;
  tradeId: string | null;
  category: string;
  note: string;
  createdAt: number;
}

export interface DataSeriesRow {
  symbol: string;
  timeframe: string;
  rows: number;
  closedRows: number;
  openRows: number;
  firstOpenTime: number | null;
  lastOpenTime: number | null;
  issueCount: number;
}

export interface ImportRow {
  importId: string;
  symbol: string;
  timeframe: string;
  status: string;
  rowsReceived: number;
  rowsUpserted: number;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface NewsRow {
  eventId: string;
  symbol: string | null;
  headline: string;
  publishedAt: number;
  recordedAt: number;
  impactBias: string;
  riskLevel: string;
}

export interface AdaptiveModelRow {
  modelVersionId: string;
  trainingRunId: string;
  accountId: PaperAccountId;
  symbol: string;
  modelType: string;
  version: string;
  state: "challenger" | "champion" | "retired" | "rejected";
  trainedThrough: number;
  trainingStart: number;
  trainingEnd: number;
  sampleCount: number;
  metrics: Readonly<Record<string, unknown>>;
  createdAt: number;
}

export interface AdaptivePredictionRow {
  predictionId: string;
  modelVersionId: string;
  accountId: PaperAccountId;
  symbol: string;
  timeframe: string;
  featureCutoff: number;
  generatedAt: number;
  longProbability: number;
  shortProbability: number;
  holdProbability: number;
  decision: string;
  confidence: number;
  riskLevel: string;
  explanation: readonly { feature: string; value: number; contribution: number }[];
  dataQuality: Readonly<Record<string, unknown>>;
}

export interface AdaptivePromotionRow {
  promotionRunId: string;
  accountId: PaperAccountId;
  challengerModelId: string;
  championModelId: string | null;
  approved: boolean;
  gates: Readonly<Record<string, boolean>>;
  reason: string;
  createdAt: number;
}

export interface AdaptiveDecisionRow {
  eventId: string;
  accountId: PaperAccountId;
  modelVersionId: string | null;
  symbol: string;
  decision: string;
  allowed: boolean;
  reason: string;
  dataCutoff: number;
  createdAt: number;
}

export interface AdaptiveRuntimeRow {
  accountId: PaperAccountId;
  enabled: boolean;
  lastSchedulerAt: number | null;
}

export interface DesktopSettings {
  selectedSymbol: string;
  timezone: "Asia/Shanghai" | "UTC";
  initialCapital: number;
  maximumOrderNotional: number;
  maximumConsecutiveLosses: number;
  minimumRiskReward: number;
  feeRate: number;
  slippageBps: number;
  autoRefreshSeconds: number;
}

export interface ResearchWorkspace {
  snapshot: DesktopSnapshot;
  symbols: readonly string[];
  selectedSymbol: string;
  timeframes: readonly TimeframeSummary[];
  candidates: readonly CandidateSignalRow[];
  backtests: readonly BacktestRunRow[];
  paperOrders: readonly PaperOrderRow[];
  strategies: readonly StrategyRow[];
  optimizerRuns: readonly OptimizerRunRow[];
  reviewTrades: readonly ReviewTradeRow[];
  reviewNotes: readonly ReviewNoteRow[];
  dataSeries: readonly DataSeriesRow[];
  imports: readonly ImportRow[];
  news: readonly NewsRow[];
  adaptiveModels: readonly AdaptiveModelRow[];
  adaptivePredictions: readonly AdaptivePredictionRow[];
  adaptivePromotions: readonly AdaptivePromotionRow[];
  adaptiveDecisions: readonly AdaptiveDecisionRow[];
  adaptiveRuntime: readonly AdaptiveRuntimeRow[];
  settings: DesktopSettings;
  databasePath: string;
  backupDirectory: string;
}

export interface PaperOrderRequest {
  accountId: PaperAccountId;
  symbol: string;
  positionSide: "long" | "short";
  notional: number;
  candidateSignalId?: string | null;
}

export interface PaperOrderPreviewDto {
  previewId: string;
  accountId: PaperAccountId;
  symbol: string;
  positionSide: "long" | "short";
  quantity: string;
  referencePrice: string;
  estimatedNotional: string;
  estimatedFee: string;
  estimatedSlippage: string;
  allowed: boolean;
  checks: readonly { rule: string; allowed: boolean; message: string }[];
  expiresAt: number;
}

export interface DesktopActionResult {
  ok: boolean;
  message: string;
  path?: string;
}

export interface DesktopApi {
  snapshot(): Promise<DesktopSnapshot>;
  refreshPaperMarket(): Promise<DesktopSnapshot>;
  workspace(symbol?: string): Promise<ResearchWorkspace>;
  resetPaper(accountId: PaperAccountId): Promise<DesktopSnapshot>;
  previewPaperOrder(request: PaperOrderRequest): Promise<PaperOrderPreviewDto>;
  confirmPaperOrder(previewId: string): Promise<DesktopSnapshot>;
  closePaperPosition(accountId: PaperAccountId, symbol: string): Promise<DesktopSnapshot>;
  requestMode(mode: DesktopMode): Promise<{ accepted: boolean; message: string }>;
  runBacktest(symbol: string): Promise<DesktopActionResult>;
  syncPublicData(symbol: string): Promise<DesktopActionResult>;
  runIntegrityCheck(): Promise<DesktopActionResult>;
  createBackup(): Promise<DesktopActionResult>;
  addReviewNote(input: { runId?: string | null; tradeId?: string | null; category: string; note: string }): Promise<DesktopActionResult>;
  saveSettings(settings: DesktopSettings): Promise<DesktopActionResult>;
  trainAdaptiveModel(accountId: PaperAccountId, symbol: string): Promise<DesktopActionResult>;
  runAdaptiveWalkForward(accountId: PaperAccountId, symbol: string): Promise<DesktopActionResult>;
  toggleAdaptiveLearning(accountId: PaperAccountId, enabled: boolean): Promise<DesktopActionResult>;
  auditAdaptiveLearning(): Promise<DesktopActionResult>;
}
