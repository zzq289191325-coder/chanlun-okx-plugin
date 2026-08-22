import { app, BrowserWindow, ipcMain, Menu, net } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PaperBroker, type PaperBrokerState } from "../../../../packages/broker/src/paperBroker.js";
import type { BrokerOrder, ExecutionPermit, OrderIntent, OrderPreview } from "../../../../packages/broker-contracts/src/index.js";
import { modeRequest } from "../shared/modePolicy.js";
import { fetchPublicMarkPrice } from "./okxPublicMark.js";
import { AGGRESSIVE_ENTRY_INTERVAL_MS, PAPER_ACCOUNT_IDS, PAPER_ACCOUNT_POLICIES, aggressiveDirection, aggressiveEntryDue } from "../shared/paperAccountPolicy.js";
import { DEFAULT_DESKTOP_SETTINGS, normalizeDesktopSettings, paperOrderSafetyChecks } from "../shared/researchPolicy.js";
import type {
  BacktestRunRow,
  AdaptiveDecisionRow,
  AdaptiveModelRow,
  AdaptivePredictionRow,
  AdaptivePromotionRow,
  AdaptiveRuntimeRow,
  CandidateSignalRow,
  DataSeriesRow,
  DesktopActionResult,
  DesktopMode,
  DesktopPaperAccount,
  DesktopSettings,
  DesktopSnapshot,
  ImportRow,
  NewsRow,
  OptimizerRunRow,
  PaperOrderPreviewDto,
  PaperOrderRequest,
  PaperOrderRow,
  PaperAccountId,
  ResearchWorkspace,
  ReviewNoteRow,
  ReviewTradeRow,
  StrategyRow,
  TimeframeSummary,
} from "../shared/types.js";

const LEGACY_PAPER_ACCOUNT_ID = "paper-local-default";
const TIMEFRAMES = ["1D", "4H", "1H", "30m", "15m"] as const;
let paperBrokers = new Map<PaperAccountId, PaperBroker>(PAPER_ACCOUNT_IDS.map((accountId) => [accountId, new PaperBroker({ initialCapital: 1_000 })]));
const pendingPreviews = new Map<string, { accountId: PaperAccountId; intent: OrderIntent; preview: OrderPreview }>();
let marketStatus: DesktopSnapshot["market"] = { source: "OKX_PUBLIC_MARK_PRICE", connected: false, updatedAt: null, staleSymbols: [] };
let aggressiveSchedulerRunning = false;
let aggressiveSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let learningSchedulerRunning = false;
let learningSchedulerTimer: ReturnType<typeof setInterval> | null = null;

function bundledDatabasePath(): string {
  return app.isPackaged ? join(process.resourcesPath, "data/chanlun_research.sqlite3") : join(__dirname, "../../../data/chanlun_research.sqlite3");
}

function migrationDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, "migrations") : join(__dirname, "../../research-service/migrations");
}

function researchServiceDirectory(): string {
  return app.isPackaged ? join(process.resourcesPath, "research-service") : join(__dirname, "../../research-service");
}

function writableDatabasePath(): string {
  const directory = app.getPath("userData");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, "chanlun_research.sqlite3");
  if (!existsSync(target)) copyFileSync(bundledDatabasePath(), target);
  return target;
}

function backupDirectory(): string {
  const target = join(app.getPath("userData"), "backups");
  mkdirSync(target, { recursive: true });
  return target;
}

function migrateDesktopDatabase(database: DatabaseSync): void {
  const applied = new Set((database.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => Number(row.version)));
  for (const name of readdirSync(migrationDirectory()).filter((item) => /^\d{3}_.+\.sql$/.test(item)).sort()) {
    const version = Number(name.slice(0, 3));
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationDirectory(), name), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(version, name, hash(sql), Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function withDatabase<T>(operation: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(writableDatabasePath());
  try {
    migrateDesktopDatabase(database);
    return operation(database);
  } finally {
    database.close();
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function getSettings(database: DatabaseSync): DesktopSettings {
  const row = database.prepare("SELECT value_json FROM desktop_settings WHERE setting_key = 'desktop'").get() as { value_json?: string } | undefined;
  return { ...DEFAULT_DESKTOP_SETTINGS, ...parseJson<Partial<DesktopSettings>>(row?.value_json, {}) };
}

function paperBroker(accountId: PaperAccountId): PaperBroker {
  const broker = paperBrokers.get(accountId);
  if (!broker) throw new Error("本地 PAPER 子账户不存在");
  return broker;
}

function initializePaperLedgers(): Partial<Record<PaperAccountId, PaperBrokerState>> {
  return withDatabase((database) => {
    const now = Date.now();
    const aggressiveConfig = JSON.stringify({ maPeriod: 40, atrPeriod: 14, minimumRiskReward: 2, executionTimeframe: "15m", autoEntryTargetPerHour: 1, autoEntryNotional: 25, paperOnly: true });
    const fundamentalConfig = JSON.stringify({ maFastPeriod: 40, maSlowPeriod: 120, minimumRiskReward: 3, dataSource: "local-csv-json-only", allowedSides: ["long"], paperOnly: true });
    database.prepare("INSERT OR IGNORE INTO strategy_definitions(strategy_id,name,style,description,enabled,created_at) VALUES (?,?,?,?,1,?)").run("aggressive-interval-nesting", "Aggressive Interval Nesting", "AGGRESSIVE_INTERVAL", "30M/15M 区间套 PAPER 策略", now);
    database.prepare("INSERT OR IGNORE INTO strategy_definitions(strategy_id,name,style,description,enabled,created_at) VALUES (?,?,?,?,1,?)").run("fundamental-structural-position", "Fundamental Structural Position", "FUNDAMENTAL_POSITION", "点时基本面与大周期结构候选策略", now);
    database.prepare("INSERT OR IGNORE INTO strategy_versions(strategy_version_id,strategy_id,version,status,config_json,config_hash,created_at) VALUES (?,?,?,?,?,?,?)").run(PAPER_ACCOUNT_POLICIES["paper-aggressive"].strategyVersionId, "aggressive-interval-nesting", "1.1.0-paper", "PAPER", aggressiveConfig, hash(aggressiveConfig), now);
    database.prepare("INSERT OR IGNORE INTO strategy_versions(strategy_version_id,strategy_id,version,status,config_json,config_hash,created_at) VALUES (?,?,?,?,?,?,?)").run(PAPER_ACCOUNT_POLICIES["paper-fundamental"].strategyVersionId, "fundamental-structural-position", "1.1.0-paper", "PAPER", fundamentalConfig, hash(fundamentalConfig), now);
    for (const accountId of PAPER_ACCOUNT_IDS) {
      const policy = PAPER_ACCOUNT_POLICIES[accountId];
      database.prepare("INSERT OR IGNORE INTO broker_accounts(broker_account_id,broker,account_mode,display_name,enabled,created_at,updated_at) VALUES (?,?, 'PAPER', ?,1,?,?)").run(accountId, "LOCAL", `${policy.name} PAPER 1000U`, now, now);
    }
    const restored: Partial<Record<PaperAccountId, PaperBrokerState>> = {};
    for (const accountId of PAPER_ACCOUNT_IDS) {
      let row = database.prepare("SELECT state_json FROM paper_account_snapshots WHERE broker_account_id = ? ORDER BY timestamp DESC LIMIT 1").get(accountId) as { state_json?: string } | undefined;
      if (!row && accountId === "paper-aggressive") row = database.prepare("SELECT state_json FROM paper_account_snapshots WHERE broker_account_id = ? ORDER BY timestamp DESC LIMIT 1").get(LEGACY_PAPER_ACCOUNT_ID) as { state_json?: string } | undefined;
      const state = row?.state_json ? parseJson<PaperBrokerState | null>(row.state_json, null) : null;
      if (state) restored[accountId] = state;
    }
    return restored;
  });
}

async function savePaperSnapshot(accountId: PaperAccountId): Promise<void> {
  const policy = PAPER_ACCOUNT_POLICIES[accountId];
  const broker = paperBroker(accountId);
  const state = broker.exportState();
  const account = await broker.getAccountSummary();
  const positions = await broker.getPositions();
  const now = Date.now();
  const stateJson = JSON.stringify(state);
  withDatabase((database) => {
    database.prepare("INSERT INTO paper_account_snapshots(snapshot_id,broker_account_id,timestamp,initial_capital,cash,equity,state_json,state_hash) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), accountId, now, String(state.initialCapital), String(state.cash), account.equity, stateJson, hash(stateJson));
    for (const position of positions) {
      database.prepare("INSERT INTO position_snapshots(broker_account_id,strategy_version_id,symbol,position_side,timestamp,quantity,average_price,mark_price,unrealized_pnl) VALUES (?,?,?,?,?,?,?,?,?)").run(accountId, policy.strategyVersionId, position.symbol, position.side, now, position.quantity, position.averagePrice, position.markPrice, position.unrealizedPnl);
    }
  });
}

function persistPaperOrder(accountId: PaperAccountId, intent: OrderIntent, preview: OrderPreview, order: BrokerOrder): void {
  const policy = PAPER_ACCOUNT_POLICIES[accountId];
  const now = Date.now();
  const intentId = randomUUID();
  const brokerOrderId = randomUUID();
  withDatabase((database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO order_intents(order_intent_id,broker_account_id,strategy_version_id,account_mode,signal_id,symbol,side,position_side,order_type,quantity,limit_price,reduce_only,candidate_label,location_time,confirmed_at,data_cutoff,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(intentId, accountId, policy.strategyVersionId, "PAPER", intent.signalId, intent.symbol, intent.side, intent.positionSide, intent.orderType, intent.quantity, intent.limitPrice, Number(intent.reduceOnly), intent.candidateLabel, intent.locationTime, intent.confirmedAt, intent.dataCutoff, order.status, intent.createdAt);
      database.prepare("INSERT INTO order_previews(order_preview_id,order_intent_id,risk_allowed,estimated_notional,estimated_fee,estimated_slippage,checks_json,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(preview.previewId, intentId, Number(preview.allowed), preview.estimatedNotional, preview.estimatedFee, preview.estimatedSlippage, JSON.stringify(preview.checks), preview.expiresAt, now);
      database.prepare("INSERT INTO broker_orders(broker_order_id,order_intent_id,client_order_id,exchange_order_id,account_mode,status,request_at,response_at,last_exchange_update_at,reconciliation_status) VALUES (?,?,?,?,?,?,?,?,?,'consistent')").run(brokerOrderId, intentId, order.clientOrderId, order.exchangeOrderId, "PAPER", order.status, intent.createdAt, now, now);
      database.prepare("INSERT INTO broker_fills(broker_fill_id,broker_order_id,exchange_fill_id,fill_time,price,quantity,fee,fee_currency,slippage_cost,funding_cost) VALUES (?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), brokerOrderId, `paper-fill-${order.clientOrderId}`, now, order.averagePrice ?? intent.referencePrice, order.filledQuantity, preview.estimatedFee, "USDT", preview.estimatedSlippage, "0");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
}

function databaseSummary(): DesktopSnapshot["database"] {
  return withDatabase((database) => {
    const version = Number((database.prepare("SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations").get() as { value: number }).value);
    const candleCount = Number((database.prepare("SELECT COUNT(*) AS value FROM candles").get() as { value: number }).value);
    const latest = database.prepare("SELECT backtest_run_id FROM backtest_runs ORDER BY started_at DESC LIMIT 1").get() as { backtest_run_id?: string } | undefined;
    const latestBacktestTrades = latest?.backtest_run_id ? Number((database.prepare("SELECT COUNT(*) AS value FROM simulated_trades WHERE backtest_run_id = ?").get(latest.backtest_run_id) as { value: number }).value) : 0;
    const integrity = String((database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check);
    return { version, integrity, candleCount, latestBacktestTrades };
  });
}

async function snapshot(): Promise<DesktopSnapshot> {
  const now = Date.now();
  const paperAccounts: DesktopPaperAccount[] = [];
  for (const accountId of PAPER_ACCOUNT_IDS) {
    const policy = PAPER_ACCOUNT_POLICIES[accountId];
    const broker = paperBroker(accountId);
    const account = await broker.getAccountSummary();
    const positions = await broker.getPositions();
    const activity = withDatabase((database) => {
      const last = database.prepare("SELECT MAX(created_at) AS value FROM order_intents WHERE broker_account_id=? AND reduce_only=0 AND status='filled'").get(accountId) as { value: number | null };
      const count = database.prepare("SELECT COUNT(*) AS value FROM order_intents WHERE broker_account_id=? AND reduce_only=0 AND status='filled' AND created_at>=?").get(accountId, now - 60 * 60 * 1_000) as { value: number };
      return { lastOpenedAt: last.value === null ? null : Number(last.value), tradesLastHour: Number(count.value) };
    });
    const due = policy.automaticPaperEntry && aggressiveEntryDue(activity.lastOpenedAt, now);
    paperAccounts.push({
      ...policy,
      equity: account.equity,
      available: account.available,
      positionCount: positions.length,
      positions,
      tradesLastHour: activity.tradesLastHour,
      lastOpenedAt: activity.lastOpenedAt,
      nextEntryDueAt: policy.automaticPaperEntry ? (activity.lastOpenedAt === null ? now : activity.lastOpenedAt + AGGRESSIVE_ENTRY_INTERVAL_MS) : null,
      frequencyStatus: policy.automaticPaperEntry ? (due ? "due" : "on_target") : "not_applicable",
    });
  }
  const positions = paperAccounts.flatMap((account) => account.positions);
  const equity = paperAccounts.reduce((sum, account) => sum + Number(account.equity), 0);
  const available = paperAccounts.reduce((sum, account) => sum + Number(account.available), 0);
  return {
    mode: "PAPER",
    equity: equity.toFixed(8),
    available: available.toFixed(8),
    positionCount: positions.length,
    positions,
    paperAccounts,
    database: databaseSummary(),
    execution: { paperEnabled: true, demoEnabled: false, liveEnabled: false, externalOrdersDisabled: true },
    market: marketStatus,
    updatedAt: Date.now(),
  };
}

async function refreshPaperMarket(): Promise<DesktopSnapshot> {
  const positions = (await Promise.all(PAPER_ACCOUNT_IDS.map((accountId) => paperBroker(accountId).getPositions()))).flat();
  const symbols = [...new Set(positions.map((position) => position.symbol))];
  if (symbols.length === 0) {
    marketStatus = { source: "OKX_PUBLIC_MARK_PRICE", connected: true, updatedAt: Date.now(), staleSymbols: [] };
    return snapshot();
  }
  const electronFetch = (input: string | URL, init?: RequestInit) => net.fetch(input.toString(), init) as unknown as Promise<Response>;
  const settled = await Promise.allSettled(symbols.map((symbol) => fetchPublicMarkPrice(symbol, electronFetch)));
  const prices: Record<string, number> = {};
  const staleSymbols: string[] = [];
  let latestTimestamp = 0;
  settled.forEach((result, index) => {
    const symbol = symbols[index];
    if (!symbol) return;
    if (result.status === "fulfilled") {
      prices[symbol] = result.value.price;
      latestTimestamp = Math.max(latestTimestamp, result.value.timestamp);
    } else staleSymbols.push(symbol);
  });
  for (const accountId of PAPER_ACCOUNT_IDS) paperBroker(accountId).updateMarkPrices(prices);
  marketStatus = {
    source: "OKX_PUBLIC_MARK_PRICE",
    connected: staleSymbols.length === 0,
    updatedAt: latestTimestamp || marketStatus.updatedAt,
    staleSymbols,
  };
  return snapshot();
}

function timeframeSummaries(database: DatabaseSync, symbol: string): TimeframeSummary[] {
  return TIMEFRAMES.map((timeframe) => {
    const stats = database.prepare("SELECT COUNT(*) AS rows, SUM(CASE WHEN closed = 0 THEN 1 ELSE 0 END) AS open_rows, MIN(open_time) AS first_open, MAX(close_time) AS last_close FROM candles WHERE symbol = ? AND timeframe = ?").get(symbol, timeframe) as { rows: number; open_rows: number; first_open: number | null; last_close: number | null };
    const raw = database.prepare("SELECT open_time, close_time, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? AND closed = 1 ORDER BY open_time DESC LIMIT 120").all(symbol, timeframe) as Record<string, number>[];
    const candles = raw.reverse().map((row) => ({ openTime: Number(row.open_time), closeTime: Number(row.close_time), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume) }));
    const candidateCount = Number((database.prepare("SELECT COUNT(*) AS value FROM candidate_signals WHERE symbol = ? AND timeframe = ?").get(symbol, timeframe) as { value: number }).value);
    const lastClose = candles.at(-1)?.close ?? null;
    const firstClose = candles[0]?.close ?? null;
    const ma40 = candles.length >= 40 ? candles.slice(-40).reduce((sum, candle) => sum + candle.close, 0) / 40 : null;
    const changePercent = lastClose !== null && firstClose ? (lastClose / firstClose - 1) * 100 : null;
    const direction = lastClose === null || ma40 === null ? "insufficient" : lastClose > ma40 * 1.005 ? "up" : lastClose < ma40 * 0.995 ? "down" : "range";
    return { timeframe, candleCount: Number(stats.rows ?? 0), firstOpenTime: stats.first_open === null ? null : Number(stats.first_open), lastCloseTime: stats.last_close === null ? null : Number(stats.last_close), lastClose, changePercent, ma40, direction, candidateCount, openCandleCount: Number(stats.open_rows ?? 0), candles };
  });
}

function candidateRows(database: DatabaseSync, symbol: string): CandidateSignalRow[] {
  return (database.prepare("SELECT signal_id,symbol,timeframe,label,side,location_time,confirmed_at,price,score,market_regime,reason FROM candidate_signals WHERE symbol = ? ORDER BY confirmed_at DESC LIMIT 100").all(symbol) as Record<string, unknown>[]).map((row) => ({
    signalId: String(row.signal_id), symbol: String(row.symbol), timeframe: String(row.timeframe), label: String(row.label), side: row.side as "long" | "short", locationTime: Number(row.location_time), confirmedAt: Number(row.confirmed_at), price: Number(row.price), score: Number(row.score), marketRegime: row.market_regime === null ? null : String(row.market_regime), reason: String(row.reason),
  }));
}

function reliabilityWarnings(value: unknown): string[] {
  const parsed = parseJson<Record<string, unknown>>(value, {});
  for (const key of ["warnings", "reliability_warnings", "reasons"]) {
    const candidate = parsed[key];
    if (Array.isArray(candidate)) return candidate.map(String);
  }
  return [];
}

function backtestRows(database: DatabaseSync): BacktestRunRow[] {
  const rows = database.prepare("SELECT backtest_run_id,name,status,strategy_version,data_start,data_end,metrics_json,reliability_json,started_at FROM backtest_runs ORDER BY started_at DESC LIMIT 30").all() as Record<string, unknown>[];
  return rows.map((row) => {
    const metrics = parseJson<Record<string, unknown>>(row.metrics_json, {});
    return {
      runId: String(row.backtest_run_id), name: String(row.name), status: String(row.status), strategyVersion: String(row.strategy_version), dataStart: Number(row.data_start), dataEnd: Number(row.data_end), tradeCount: Number(metrics.trade_count ?? 0), totalReturnPercent: metrics.total_return_percent == null ? null : Number(metrics.total_return_percent), maximumDrawdownPercent: metrics.max_drawdown_percent == null ? null : Number(metrics.max_drawdown_percent), winRatePercent: metrics.win_rate_percent == null ? null : Number(metrics.win_rate_percent), profitFactor: metrics.profit_factor == null ? null : Number(metrics.profit_factor), reliability: reliabilityWarnings(row.reliability_json), startedAt: Number(row.started_at),
    };
  });
}

function paperOrderRows(database: DatabaseSync): PaperOrderRow[] {
  return (database.prepare("SELECT bo.broker_order_id,oi.broker_account_id,oi.strategy_version_id,oi.symbol,oi.side,oi.position_side,oi.quantity,oi.reduce_only,oi.candidate_label,COALESCE(bf.price,oi.limit_price,'0') AS price,COALESCE(bf.fee,'0') AS fee,COALESCE(bf.slippage_cost,'0') AS slippage,bo.status,oi.created_at FROM broker_orders bo JOIN order_intents oi ON oi.order_intent_id=bo.order_intent_id LEFT JOIN broker_fills bf ON bf.broker_order_id=bo.broker_order_id WHERE bo.account_mode='PAPER' ORDER BY oi.created_at DESC LIMIT 100").all() as Record<string, unknown>[]).map((row) => {
    const accountId: PaperAccountId = String(row.broker_account_id) === "paper-fundamental" ? "paper-fundamental" : "paper-aggressive";
    return {
      orderId: String(row.broker_order_id), accountId, strategyId: PAPER_ACCOUNT_POLICIES[accountId].strategyId, symbol: String(row.symbol), side: String(row.side), positionSide: String(row.position_side), quantity: String(row.quantity), price: String(row.price), fee: String(row.fee), slippage: String(row.slippage), status: String(row.status), reduceOnly: Boolean(row.reduce_only), candidateLabel: row.candidate_label === null ? null : String(row.candidate_label), createdAt: Number(row.created_at),
    };
  });
}

function strategyRows(database: DatabaseSync): StrategyRow[] {
  const definitions = database.prepare("SELECT strategy_id,name,style,description,enabled FROM strategy_definitions ORDER BY style").all() as Record<string, unknown>[];
  return definitions.map((definition) => {
    const version = database.prepare("SELECT version,status,config_json FROM strategy_versions WHERE strategy_id = ? ORDER BY created_at DESC LIMIT 1").get(String(definition.strategy_id)) as Record<string, unknown> | undefined;
    return { strategyId: String(definition.strategy_id), name: String(definition.name), style: String(definition.style), description: String(definition.description), enabled: Boolean(definition.enabled), version: version ? String(version.version) : null, status: version ? String(version.status) : null, config: parseJson<Record<string, unknown>>(version?.config_json, {}) };
  });
}

function optimizerRows(database: DatabaseSync): OptimizerRunRow[] {
  return (database.prepare("SELECT r.optimizer_run_id,r.strategy_id,r.status,r.method,r.started_at,r.completed_at,COUNT(t.optimizer_trial_id) AS trial_count,SUM(CASE WHEN t.accepted=1 THEN 1 ELSE 0 END) AS accepted_count FROM optimizer_runs r LEFT JOIN optimizer_trials t ON t.optimizer_run_id=r.optimizer_run_id GROUP BY r.optimizer_run_id ORDER BY r.started_at DESC LIMIT 30").all() as Record<string, unknown>[]).map((row) => ({
    runId: String(row.optimizer_run_id), strategyId: String(row.strategy_id), status: String(row.status), method: String(row.method), trialCount: Number(row.trial_count ?? 0), acceptedCount: Number(row.accepted_count ?? 0), startedAt: Number(row.started_at), completedAt: row.completed_at === null ? null : Number(row.completed_at),
  }));
}

function reviewTradeRows(database: DatabaseSync): ReviewTradeRow[] {
  return (database.prepare("SELECT trade_id,backtest_run_id,symbol,side,candidate_label,entry_time,exit_time,entry_price,exit_price,realized_pnl,fee,slippage_cost,funding_estimate,exit_reason,data_cutoff,signal_confirmed_at FROM simulated_trades ORDER BY entry_time DESC LIMIT 100").all() as Record<string, unknown>[]).map((row) => ({
    tradeId: String(row.trade_id), runId: String(row.backtest_run_id), symbol: String(row.symbol), side: String(row.side), candidateLabel: row.candidate_label === null ? null : String(row.candidate_label), entryTime: Number(row.entry_time), exitTime: row.exit_time === null ? null : Number(row.exit_time), entryPrice: Number(row.entry_price), exitPrice: row.exit_price === null ? null : Number(row.exit_price), realizedPnl: row.realized_pnl === null ? null : Number(row.realized_pnl), fee: Number(row.fee), slippageCost: Number(row.slippage_cost), fundingEstimate: Number(row.funding_estimate), exitReason: row.exit_reason === null ? null : String(row.exit_reason), dataCutoff: row.data_cutoff === null ? null : Number(row.data_cutoff), confirmedAt: row.signal_confirmed_at === null ? null : Number(row.signal_confirmed_at),
  }));
}

function reviewNoteRows(database: DatabaseSync): ReviewNoteRow[] {
  return (database.prepare("SELECT review_note_id,backtest_run_id,trade_id,category,note,created_at FROM review_notes ORDER BY created_at DESC LIMIT 100").all() as Record<string, unknown>[]).map((row) => ({ noteId: String(row.review_note_id), runId: row.backtest_run_id === null ? null : String(row.backtest_run_id), tradeId: row.trade_id === null ? null : String(row.trade_id), category: String(row.category), note: String(row.note), createdAt: Number(row.created_at) }));
}

function dataSeriesRows(database: DatabaseSync): DataSeriesRow[] {
  return (database.prepare("SELECT c.symbol,c.timeframe,COUNT(*) AS rows,SUM(CASE WHEN c.closed=1 THEN 1 ELSE 0 END) AS closed_rows,SUM(CASE WHEN c.closed=0 THEN 1 ELSE 0 END) AS open_rows,MIN(c.open_time) AS first_open,MAX(c.open_time) AS last_open,(SELECT COUNT(*) FROM data_quality_issues q WHERE q.symbol=c.symbol AND q.timeframe=c.timeframe AND q.resolved_at IS NULL) AS issue_count FROM candles c GROUP BY c.symbol,c.timeframe ORDER BY c.symbol,c.timeframe").all() as Record<string, unknown>[]).map((row) => ({ symbol: String(row.symbol), timeframe: String(row.timeframe), rows: Number(row.rows), closedRows: Number(row.closed_rows), openRows: Number(row.open_rows), firstOpenTime: row.first_open === null ? null : Number(row.first_open), lastOpenTime: row.last_open === null ? null : Number(row.last_open), issueCount: Number(row.issue_count) }));
}

function importRows(database: DatabaseSync): ImportRow[] {
  return (database.prepare("SELECT import_id,symbol,timeframe,status,rows_received,rows_upserted,started_at,completed_at,error FROM data_imports ORDER BY started_at DESC LIMIT 40").all() as Record<string, unknown>[]).map((row) => ({ importId: String(row.import_id), symbol: String(row.symbol), timeframe: String(row.timeframe), status: String(row.status), rowsReceived: Number(row.rows_received), rowsUpserted: Number(row.rows_upserted), startedAt: Number(row.started_at), completedAt: row.completed_at === null ? null : Number(row.completed_at), error: row.error === null ? null : String(row.error) }));
}

function newsRows(database: DatabaseSync): NewsRow[] {
  return (database.prepare("SELECT news_event_id,symbol,headline,published_at,recorded_at,impact_bias,risk_level FROM news_events ORDER BY recorded_at DESC LIMIT 50").all() as Record<string, unknown>[]).map((row) => ({ eventId: String(row.news_event_id), symbol: row.symbol === null ? null : String(row.symbol), headline: String(row.headline), publishedAt: Number(row.published_at), recordedAt: Number(row.recorded_at), impactBias: String(row.impact_bias), riskLevel: String(row.risk_level) }));
}

function adaptiveModelRows(database: DatabaseSync): AdaptiveModelRow[] {
  return (database.prepare("SELECT m.model_version_id,m.training_run_id,m.account_id,m.model_type,m.version,m.state,m.trained_through,m.created_at,r.symbol,r.training_start,r.training_end,r.sample_count,r.metrics_json FROM ml_model_versions m JOIN ml_training_runs r ON r.training_run_id=m.training_run_id ORDER BY m.created_at DESC LIMIT 30").all() as Record<string, unknown>[]).map((row) => ({
    modelVersionId: String(row.model_version_id), trainingRunId: String(row.training_run_id), accountId: row.account_id as PaperAccountId,
    symbol: String(row.symbol), modelType: String(row.model_type), version: String(row.version), state: row.state as AdaptiveModelRow["state"],
    trainedThrough: Number(row.trained_through), trainingStart: Number(row.training_start), trainingEnd: Number(row.training_end), sampleCount: Number(row.sample_count),
    metrics: parseJson<Record<string, unknown>>(row.metrics_json, {}), createdAt: Number(row.created_at),
  }));
}

function adaptivePredictionRows(database: DatabaseSync, symbol: string): AdaptivePredictionRow[] {
  return (database.prepare("SELECT prediction_id,model_version_id,account_id,symbol,timeframe,feature_cutoff,generated_at,long_probability,short_probability,hold_probability,decision,confidence,risk_level,explanation_json,data_quality_json FROM ml_predictions WHERE symbol=? ORDER BY generated_at DESC LIMIT 40").all(symbol) as Record<string, unknown>[]).map((row) => ({
    predictionId: String(row.prediction_id), modelVersionId: String(row.model_version_id), accountId: row.account_id as PaperAccountId, symbol: String(row.symbol), timeframe: String(row.timeframe),
    featureCutoff: Number(row.feature_cutoff), generatedAt: Number(row.generated_at), longProbability: Number(row.long_probability), shortProbability: Number(row.short_probability), holdProbability: Number(row.hold_probability),
    decision: String(row.decision), confidence: Number(row.confidence), riskLevel: String(row.risk_level),
    explanation: parseJson<AdaptivePredictionRow["explanation"]>(row.explanation_json, []), dataQuality: parseJson<Record<string, unknown>>(row.data_quality_json, {}),
  }));
}

function adaptivePromotionRows(database: DatabaseSync): AdaptivePromotionRow[] {
  return (database.prepare("SELECT promotion_run_id,account_id,challenger_model_id,champion_model_id,approved,gates_json,reason,created_at FROM ml_promotion_runs ORDER BY created_at DESC LIMIT 30").all() as Record<string, unknown>[]).map((row) => ({
    promotionRunId: String(row.promotion_run_id), accountId: row.account_id as PaperAccountId, challengerModelId: String(row.challenger_model_id), championModelId: row.champion_model_id === null ? null : String(row.champion_model_id), approved: Boolean(row.approved), gates: parseJson<Record<string, boolean>>(row.gates_json, {}), reason: String(row.reason), createdAt: Number(row.created_at),
  }));
}

function adaptiveDecisionRows(database: DatabaseSync): AdaptiveDecisionRow[] {
  return (database.prepare("SELECT paper_decision_event_id,account_id,model_version_id,symbol,decision,allowed,reason,data_cutoff,created_at FROM paper_decision_events ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[]).map((row) => ({
    eventId: String(row.paper_decision_event_id), accountId: row.account_id as PaperAccountId, modelVersionId: row.model_version_id === null ? null : String(row.model_version_id), symbol: String(row.symbol), decision: String(row.decision), allowed: Boolean(row.allowed), reason: String(row.reason), dataCutoff: Number(row.data_cutoff), createdAt: Number(row.created_at),
  }));
}

function adaptiveRuntimeRows(database: DatabaseSync): AdaptiveRuntimeRow[] {
  return (database.prepare("SELECT account_id,enabled,last_scheduler_at FROM ml_runtime_settings ORDER BY account_id").all() as Record<string, unknown>[]).map((row) => ({ accountId: row.account_id as PaperAccountId, enabled: Boolean(row.enabled), lastSchedulerAt: row.last_scheduler_at === null ? null : Number(row.last_scheduler_at) }));
}

async function workspace(requestedSymbol?: string): Promise<ResearchWorkspace> {
  const currentSnapshot = await snapshot();
  return withDatabase((database) => {
    const symbols = (database.prepare("SELECT symbol FROM instruments WHERE enabled=1 ORDER BY symbol").all() as { symbol: string }[]).map((row) => row.symbol);
    const settings = getSettings(database);
    const selectedSymbol = requestedSymbol && symbols.includes(requestedSymbol) ? requestedSymbol : symbols.includes(settings.selectedSymbol) ? settings.selectedSymbol : symbols[0] ?? "BTC-USDT-SWAP";
    return {
      snapshot: currentSnapshot,
      symbols,
      selectedSymbol,
      timeframes: timeframeSummaries(database, selectedSymbol),
      candidates: candidateRows(database, selectedSymbol),
      backtests: backtestRows(database),
      paperOrders: paperOrderRows(database),
      strategies: strategyRows(database),
      optimizerRuns: optimizerRows(database),
      reviewTrades: reviewTradeRows(database),
      reviewNotes: reviewNoteRows(database),
      dataSeries: dataSeriesRows(database),
      imports: importRows(database),
      news: newsRows(database),
      adaptiveModels: adaptiveModelRows(database),
      adaptivePredictions: adaptivePredictionRows(database, selectedSymbol),
      adaptivePromotions: adaptivePromotionRows(database),
      adaptiveDecisions: adaptiveDecisionRows(database),
      adaptiveRuntime: adaptiveRuntimeRows(database),
      settings: { ...settings, selectedSymbol },
      databasePath: writableDatabasePath(),
      backupDirectory: backupDirectory(),
    };
  });
}

async function resetPaper(accountId: PaperAccountId): Promise<DesktopSnapshot> {
  const policy = PAPER_ACCOUNT_POLICIES[accountId];
  if (!policy) throw new Error("本地 PAPER 子账户不存在");
  const settings = withDatabase(getSettings);
  await paperBroker(accountId).disconnect();
  const replacement = new PaperBroker({ initialCapital: policy.initialCapital, feeRate: settings.feeRate, slippageBps: settings.slippageBps });
  await replacement.connect();
  paperBrokers.set(accountId, replacement);
  for (const [previewId, pending] of pendingPreviews) if (pending.accountId === accountId) pendingPreviews.delete(previewId);
  await savePaperSnapshot(accountId);
  return snapshot();
}

async function previewPaperOrder(request: PaperOrderRequest, automated = false): Promise<PaperOrderPreviewDto> {
  const now = Date.now();
  const policy = PAPER_ACCOUNT_POLICIES[request.accountId];
  if (!policy) throw new Error("本地 PAPER 子账户不存在");
  const result = withDatabase((database) => {
    if (!Number.isFinite(request.notional) || request.notional <= 0) throw new Error("模拟名义金额必须大于 0");
    const candle = database.prepare("SELECT close,close_time FROM candles WHERE symbol=? AND closed=1 ORDER BY close_time DESC LIMIT 1").get(request.symbol) as { close?: number; close_time?: number } | undefined;
    if (!candle?.close) throw new Error("本地数据库没有该标的的已收盘行情");
    const signal = request.candidateSignalId ? database.prepare("SELECT signal_id,label,location_time,confirmed_at FROM candidate_signals WHERE signal_id=? AND symbol=?").get(request.candidateSignalId, request.symbol) as { signal_id: string; label: string; location_time: number; confirmed_at: number } | undefined : undefined;
    if (request.candidateSignalId && !signal) throw new Error("所选候选结构不存在或不属于当前标的");
    if (signal && signal.confirmed_at > now) throw new Error("候选结构尚未确认，不能进入本地模拟");
    return { candle, signal };
  });
  const quantity = Math.floor((request.notional / Number(result.candle.close)) * 1_000_000) / 1_000_000;
  const intent: OrderIntent = {
    clientOrderId: `paper-${randomUUID()}`,
    accountMode: "PAPER",
    strategyId: policy.strategyId,
    strategyVersion: "1.1.0-paper",
    signalId: result.signal?.signal_id ?? null,
    symbol: request.symbol,
    side: request.positionSide === "short" ? "sell" : "buy",
    positionSide: request.positionSide,
    orderType: "market",
    quantity: String(quantity),
    referencePrice: String(result.candle.close),
    limitPrice: null,
    reduceOnly: false,
    candidateLabel: result.signal?.label ?? (automated ? "自动小时频率试错" : request.accountId === "paper-fundamental" ? "基本面长线研究试错" : "手动研究试错"),
    locationTime: result.signal?.location_time ?? null,
    confirmedAt: result.signal?.confirmed_at ?? null,
    dataCutoff: Number(result.candle.close_time),
    createdAt: now,
  };
  const broker = paperBroker(request.accountId);
  const brokerPreview = await broker.previewOrder(intent);
  const policyChecks = paperOrderSafetyChecks(request.notional, policy.maximumOrderNotional, Number(result.candle.close_time) <= now);
  const currentExposure = (await broker.getPositions()).reduce((sum, position) => sum + Number(position.averagePrice) * Number(position.quantity), 0);
  const safetyChecks = [
    ...brokerPreview.checks,
    { ...policyChecks[1], message: `${policy.name}单笔名义金额不超过 ${policy.maximumOrderNotional}U` },
    { ...policyChecks[2], message: "参考价来自已收盘K线" },
    { ...policyChecks[3], message: "仅写入本地 PAPER 账本，不发送 OKX 订单" },
    { rule: "strategy_side", allowed: policy.allowedSides.includes(request.positionSide), message: `${policy.name}允许方向：${policy.allowedSides.map((side) => side === "long" ? "多" : "空").join("/")}` },
    { rule: "maximum_exposure", allowed: currentExposure + request.notional <= policy.maximumExposure, message: `${policy.name}总名义敞口不超过 ${policy.maximumExposure}U` },
  ];
  const preview: OrderPreview = { ...brokerPreview, allowed: safetyChecks.every((item) => item.allowed), checks: safetyChecks };
  pendingPreviews.set(preview.previewId, { accountId: request.accountId, intent, preview });
  return { previewId: preview.previewId, accountId: request.accountId, symbol: request.symbol, positionSide: request.positionSide, quantity: intent.quantity, referencePrice: intent.referencePrice, estimatedNotional: preview.estimatedNotional, estimatedFee: preview.estimatedFee, estimatedSlippage: preview.estimatedSlippage, allowed: preview.allowed, checks: preview.checks, expiresAt: preview.expiresAt };
}

async function confirmPaperOrder(previewId: string, humanConfirmed = true): Promise<DesktopSnapshot> {
  const pending = pendingPreviews.get(previewId);
  if (!pending) throw new Error("模拟订单预览不存在或已经处理");
  const now = Date.now();
  if (pending.preview.expiresAt < now) {
    pendingPreviews.delete(previewId);
    throw new Error("模拟订单预览已过期，请重新预览");
  }
  const permit: ExecutionPermit = { previewId, accountMode: "PAPER", approvedAt: now, expiresAt: pending.preview.expiresAt, humanConfirmed, nonce: randomUUID() };
  const order = await paperBroker(pending.accountId).placeOrder(pending.preview, permit);
  persistPaperOrder(pending.accountId, pending.intent, pending.preview, order);
  pendingPreviews.delete(previewId);
  await savePaperSnapshot(pending.accountId);
  return snapshot();
}

async function closePaperPosition(accountId: PaperAccountId, symbol: string, humanConfirmed = true, reason = "本地手动平仓"): Promise<DesktopSnapshot> {
  const policy = PAPER_ACCOUNT_POLICIES[accountId];
  if (!policy) throw new Error("本地 PAPER 子账户不存在");
  const broker = paperBroker(accountId);
  const position = (await broker.getPositions()).find((item) => item.symbol === symbol && item.strategyId === policy.strategyId);
  if (!position) throw new Error("本地 PAPER 仓位不存在");
  const now = Date.now();
  const intent: OrderIntent = {
    clientOrderId: `paper-close-${randomUUID()}`,
    accountMode: "PAPER",
    strategyId: policy.strategyId,
    strategyVersion: "1.1.0-paper",
    signalId: null,
    symbol,
    side: position.side === "long" ? "sell" : "buy",
    positionSide: position.side === "short" ? "short" : "long",
    orderType: "market",
    quantity: position.quantity,
    referencePrice: position.markPrice,
    limitPrice: null,
    reduceOnly: true,
    candidateLabel: reason,
    locationTime: null,
    confirmedAt: null,
    dataCutoff: now,
    createdAt: now,
  };
  const preview = await broker.previewOrder(intent);
  const permit: ExecutionPermit = { previewId: preview.previewId, accountMode: "PAPER", approvedAt: now, expiresAt: preview.expiresAt, humanConfirmed, nonce: randomUUID() };
  const order = await broker.placeOrder(preview, permit);
  persistPaperOrder(accountId, intent, preview, order);
  await savePaperSnapshot(accountId);
  return snapshot();
}

async function maybeRunAggressivePaperCycle(): Promise<void> {
  if (aggressiveSchedulerRunning || process.env.CHANLUN_DISABLE_AUTO_PAPER === "1") return;
  aggressiveSchedulerRunning = true;
  try {
    const accountId: PaperAccountId = "paper-aggressive";
    const now = Date.now();
    const research = withDatabase((database) => {
      const last = database.prepare("SELECT MAX(created_at) AS value FROM order_intents WHERE broker_account_id=? AND reduce_only=0 AND status='filled'").get(accountId) as { value: number | null };
      if (!aggressiveEntryDue(last.value === null ? null : Number(last.value), now)) return null;
      const settings = getSettings(database);
      const rows = database.prepare("SELECT close,close_time FROM candles WHERE symbol=? AND timeframe='15m' AND closed=1 ORDER BY open_time DESC LIMIT 40").all(settings.selectedSymbol) as { close: number; close_time: number }[];
      const chronological = rows.reverse();
      const direction = aggressiveDirection(chronological.map((row) => Number(row.close)));
      const latest = chronological[chronological.length - 1];
      return direction && latest ? { symbol: settings.selectedSymbol, direction, dataCutoff: Number(latest.close_time) } : null;
    });
    if (!research) return;
    const broker = paperBroker(accountId);
    const policy = PAPER_ACCOUNT_POLICIES[accountId];
    const positions = await broker.getPositions();
    const selected = positions.find((position) => position.symbol === research.symbol);
    const exposure = positions.reduce((sum, position) => sum + Number(position.averagePrice) * Number(position.quantity), 0);
    if (selected && (selected.side !== research.direction || exposure + 25 > policy.maximumExposure)) await closePaperPosition(accountId, research.symbol, false, "自动频率轮换平仓");
    const preview = await previewPaperOrder({ accountId, symbol: research.symbol, positionSide: research.direction, notional: 25, candidateSignalId: null }, true);
    if (!preview.allowed) return;
    await confirmPaperOrder(preview.previewId, false);
  } catch (error) {
    console.error("Aggressive local PAPER scheduler paused", error);
  } finally {
    aggressiveSchedulerRunning = false;
  }
}

function pythonCandidates(): { command: string; prefix: string[] }[] {
  const bundled = join(app.getPath("home"), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
  return [
    process.env.CHANLUN_PYTHON ? { command: process.env.CHANLUN_PYTHON, prefix: [] } : null,
    process.env.PYTHON ? { command: process.env.PYTHON, prefix: [] } : null,
    existsSync(bundled) ? { command: bundled, prefix: [] } : null,
    { command: "python", prefix: [] },
    { command: "python3", prefix: [] },
    { command: "py", prefix: ["-3"] },
  ].filter((item): item is { command: string; prefix: string[] } => item !== null);
}

async function runResearchCommand(args: string[]): Promise<DesktopActionResult> {
  const script = join(researchServiceDirectory(), "research.py");
  if (!existsSync(script)) return { ok: false, message: "本地研究服务文件缺失，请重新安装桌面版" };
  for (const candidate of pythonCandidates()) {
    const result = await new Promise<{ missing: boolean; code: number; output: string }>((resolve) => {
      const child = spawn(candidate.command, [...candidate.prefix, script, "--db", writableDatabasePath(), ...args], { windowsHide: true });
      let output = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      child.on("error", (error: NodeJS.ErrnoException) => resolve({ missing: error.code === "ENOENT", code: 2, output: error.message }));
      child.on("close", (code) => resolve({ missing: false, code: code ?? 2, output }));
    });
    if (result.missing) continue;
    const message = result.output.trim().split(/\r?\n/).slice(-1)[0] ?? "研究任务已结束";
    return { ok: result.code === 0, message: result.code === 0 ? "本地研究任务完成，数据已刷新" : `研究任务失败：${message}` };
  }
  return { ok: false, message: "未找到 Python 3.11+；请安装 Python 或设置 CHANLUN_PYTHON" };
}

async function runBacktest(symbol: string): Promise<DesktopActionResult> {
  return runResearchCommand(["backtest", "--config", join(researchServiceDirectory(), "config", "backtest_default.json"), "--symbol", symbol, "--name", `Desktop V1.1 ${symbol} point-in-time backtest`]);
}

async function syncPublicData(symbol: string): Promise<DesktopActionResult> {
  const candles = await runResearchCommand(["sync", "--config", join(researchServiceDirectory(), "config", "example_sync_tasks.json"), "--mode", "latest", "--pages", "1", "--symbol", symbol]);
  if (!candles.ok) return candles;
  const context = await runResearchCommand(["sync-public-context", "--symbol", symbol]);
  return context.ok ? { ok: true, message: "公共K线、资金费率与持仓量观察已更新" } : context;
}

function modelDirectory(): string {
  const target = join(app.getPath("userData"), "models");
  mkdirSync(target, { recursive: true });
  return target;
}

async function trainAdaptiveModel(accountId: PaperAccountId, symbol: string, autoPromote = false): Promise<DesktopActionResult> {
  return runResearchCommand(["ml-train", "--account", accountId, "--symbol", symbol, "--model-dir", modelDirectory(), ...(autoPromote ? ["--auto-promote"] : [])]);
}

async function runAdaptiveWalkForward(accountId: PaperAccountId, symbol: string): Promise<DesktopActionResult> {
  return runResearchCommand(["ml-walk-forward", "--account", accountId, "--symbol", symbol, "--folds", "3"]);
}

async function toggleAdaptiveLearning(accountId: PaperAccountId, enabled: boolean): Promise<DesktopActionResult> {
  return runResearchCommand(["ml-toggle", "--account", accountId, "--enabled", enabled ? "true" : "false"]);
}

async function auditAdaptiveLearning(): Promise<DesktopActionResult> {
  return runResearchCommand(["ml-audit"]);
}

async function maybeRunLearningCycle(): Promise<void> {
  if (learningSchedulerRunning || process.env.CHANLUN_DISABLE_ML_SCHEDULER === "1") return;
  learningSchedulerRunning = true;
  try {
    const due = withDatabase((database) => {
      const settings = getSettings(database);
      const now = Date.now();
      const rows = database.prepare("SELECT account_id,last_scheduler_at FROM ml_runtime_settings WHERE enabled=1").all() as { account_id: PaperAccountId; last_scheduler_at: number | null }[];
      return { symbol: settings.selectedSymbol, accounts: rows.filter((row) => row.last_scheduler_at === null || now - Number(row.last_scheduler_at) >= 4 * 60 * 60 * 1_000).map((row) => row.account_id) };
    });
    if (due.accounts.length) {
      const synced = await syncPublicData(due.symbol);
      if (!synced.ok) return;
    }
    for (const accountId of due.accounts) {
      await trainAdaptiveModel(accountId, due.symbol, true);
      withDatabase((database) => database.prepare("UPDATE ml_runtime_settings SET last_scheduler_at=?,updated_at=? WHERE account_id=?").run(Date.now(), Date.now(), accountId));
    }
  } finally {
    learningSchedulerRunning = false;
  }
}

async function runIntegrityCheck(): Promise<DesktopActionResult> {
  const integrity = withDatabase((database) => String((database.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check));
  return { ok: integrity === "ok", message: integrity === "ok" ? "SQLite 完整性检查通过" : `数据库完整性异常：${integrity}` };
}

async function createBackup(): Promise<DesktopActionResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(backupDirectory(), `chanlun_research_${stamp}.sqlite3`);
  withDatabase((database) => {
    const escaped = target.replaceAll("'", "''");
    database.exec(`VACUUM INTO '${escaped}'`);
  });
  return { ok: true, message: "数据库备份完成", path: target };
}

async function addReviewNote(input: { runId?: string | null; tradeId?: string | null; category: string; note: string }): Promise<DesktopActionResult> {
  const note = input.note.trim();
  if (!note) return { ok: false, message: "复盘内容不能为空" };
  if (note.length > 2_000) return { ok: false, message: "复盘内容不能超过 2000 字" };
  withDatabase((database) => database.prepare("INSERT INTO review_notes(review_note_id,backtest_run_id,trade_id,category,note,created_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), input.runId ?? null, input.tradeId ?? null, input.category.trim() || "一般复盘", note, Date.now()));
  return { ok: true, message: "复盘记录已保存在本地数据库" };
}

async function saveSettings(settings: DesktopSettings): Promise<DesktopActionResult> {
  const normalized = normalizeDesktopSettings(settings);
  withDatabase((database) => database.prepare("INSERT INTO desktop_settings(setting_key,value_json,updated_at) VALUES ('desktop',?,?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(normalized), Date.now()));
  return { ok: true, message: "本地研究设置已保存；重置模拟账户后资金与成本设置生效" };
}

function createWindow(): void {
  const window = new BrowserWindow({ width: 1480, height: 920, minWidth: 1180, minHeight: 720, backgroundColor: "#07100f", title: "Chanlun Quant Trading Desktop", webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, "../dist/index.html"));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  ipcMain.handle("desktop:snapshot", snapshot);
  ipcMain.handle("paper:refresh-market", refreshPaperMarket);
  ipcMain.handle("desktop:workspace", (_event, symbol?: string) => workspace(symbol));
  ipcMain.handle("paper:reset", (_event, accountId: PaperAccountId) => resetPaper(accountId));
  ipcMain.handle("paper:preview", (_event, request: PaperOrderRequest) => previewPaperOrder(request));
  ipcMain.handle("paper:confirm", (_event, previewId: string) => confirmPaperOrder(previewId));
  ipcMain.handle("paper:close-position", (_event, accountId: PaperAccountId, symbol: string) => closePaperPosition(accountId, symbol));
  ipcMain.handle("mode:request", (_event, mode: DesktopMode) => modeRequest(mode));
  ipcMain.handle("research:backtest", (_event, symbol: string) => runBacktest(symbol));
  ipcMain.handle("research:sync-public", (_event, symbol: string) => syncPublicData(symbol));
  ipcMain.handle("database:integrity", runIntegrityCheck);
  ipcMain.handle("database:backup", createBackup);
  ipcMain.handle("review:add-note", (_event, input) => addReviewNote(input));
  ipcMain.handle("settings:save", (_event, settings: DesktopSettings) => saveSettings(settings));
  ipcMain.handle("learning:train", (_event, accountId: PaperAccountId, symbol: string) => trainAdaptiveModel(accountId, symbol));
  ipcMain.handle("learning:walk-forward", (_event, accountId: PaperAccountId, symbol: string) => runAdaptiveWalkForward(accountId, symbol));
  ipcMain.handle("learning:toggle", (_event, accountId: PaperAccountId, enabled: boolean) => toggleAdaptiveLearning(accountId, enabled));
  ipcMain.handle("learning:audit", auditAdaptiveLearning);
  try {
    const restored = initializePaperLedgers();
    const settings = withDatabase(getSettings);
    paperBrokers = new Map(PAPER_ACCOUNT_IDS.map((accountId) => {
      const state = restored[accountId];
      return [accountId, new PaperBroker({ ...(state ? { state } : {}), initialCapital: PAPER_ACCOUNT_POLICIES[accountId].initialCapital, feeRate: settings.feeRate, slippageBps: settings.slippageBps })];
    }));
    for (const accountId of PAPER_ACCOUNT_IDS) {
      await paperBroker(accountId).connect();
      await savePaperSnapshot(accountId);
    }
    void maybeRunAggressivePaperCycle();
    aggressiveSchedulerTimer = setInterval(() => { void maybeRunAggressivePaperCycle(); }, 30_000);
    void maybeRunLearningCycle();
    learningSchedulerTimer = setInterval(() => { void maybeRunLearningCycle(); }, 60_000);
  } catch (error) {
    console.error("Desktop local service initialization failed", error);
  }
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (aggressiveSchedulerTimer) clearInterval(aggressiveSchedulerTimer); if (learningSchedulerTimer) clearInterval(learningSchedulerTimer); if (process.platform !== "darwin") app.quit(); });
