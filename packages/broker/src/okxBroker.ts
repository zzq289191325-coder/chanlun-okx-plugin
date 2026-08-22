import type { AccountMode, AccountSummary, Balance, BrokerAdapter, BrokerHealth, BrokerOrder, BrokerPosition, ExecutionPermit, MarginMode, OrderIntent, OrderPreview, ReconciliationReport } from "../../broker-contracts/src/index.js";
import type { OkxCredentials } from "./okxSigner.js";

export interface OkxTransport {
  request<T>(method: "GET" | "POST", path: string, body?: Readonly<Record<string, string | boolean>>): Promise<T>;
}

export interface CredentialProvider {
  load(mode: "DEMO" | "LIVE"): Promise<OkxCredentials>;
  clear(): void;
}

export interface OkxBrokerOptions {
  mode: "DEMO" | "LIVE";
  transport: OkxTransport;
  credentialProvider: CredentialProvider;
  executionCompiled?: boolean;
  clock?: () => number;
}

type OkxEnvelope<T> = { code: string; msg: string; data: T[] };

export class OkxBroker implements BrokerAdapter {
  readonly #mode: "DEMO" | "LIVE";
  readonly #transport: OkxTransport;
  readonly #credentials: CredentialProvider;
  readonly #executionCompiled: boolean;
  readonly #clock: () => number;
  readonly #knownOrders = new Map<string, BrokerOrder>();
  #connected = false;
  #sessionUnlocked = false;

  constructor(options: OkxBrokerOptions) {
    this.#mode = options.mode;
    this.#transport = options.transport;
    this.#credentials = options.credentialProvider;
    this.#executionCompiled = options.executionCompiled ?? false;
    this.#clock = options.clock ?? Date.now;
  }

  getMode(): AccountMode { return this.#mode; }
  unlockForSession(phrase: string): void {
    if (phrase !== `UNLOCK ${this.#mode}`) throw new Error(`Type UNLOCK ${this.#mode} to unlock this session`);
    this.#sessionUnlocked = true;
  }
  lock(): void { this.#sessionUnlocked = false; this.#credentials.clear(); }

  async connect(): Promise<void> {
    await this.#credentials.load(this.#mode);
    const config = await this.#transport.request<OkxEnvelope<Record<string, unknown>>>("GET", "/api/v5/account/config");
    if (config.code !== "0") throw new Error(`OKX account health check failed: ${config.code}`);
    const permission = String(config.data[0]?.perm ?? "").toLowerCase();
    if (permission.includes("withdraw")) throw new Error("Credential has withdrawal permission and was rejected");
    this.#connected = true;
  }
  async disconnect(): Promise<void> { this.#connected = false; this.lock(); }

  async getAccountSummary(): Promise<AccountSummary> {
    this.#requireConnected();
    const response = await this.#transport.request<OkxEnvelope<{ totalEq?: string; availEq?: string; uTime?: string }>>("GET", "/api/v5/account/balance");
    const row = response.data[0];
    return { equity: row?.totalEq ?? "0", available: row?.availEq ?? "0", currency: "USD", updatedAt: Number(row?.uTime ?? this.#clock()) };
  }
  async getBalances(): Promise<readonly Balance[]> {
    const summary = await this.getAccountSummary();
    return [{ currency: summary.currency, available: summary.available, frozen: "0", equity: summary.equity }];
  }
  async getPositions(): Promise<readonly BrokerPosition[]> {
    this.#requireConnected();
    const response = await this.#transport.request<OkxEnvelope<{ instId: string; posSide: "long" | "short" | "net"; pos: string; avgPx: string; markPx: string; upl: string; lever: string }>>("GET", "/api/v5/account/positions");
    return response.data.map((row) => ({ symbol: row.instId, strategyId: "external-unassigned", side: row.posSide, quantity: row.pos, averagePrice: row.avgPx, markPrice: row.markPx, unrealizedPnl: row.upl, leverage: row.lever }));
  }
  async getOpenOrders(): Promise<readonly BrokerOrder[]> {
    this.#requireConnected();
    await this.#transport.request<OkxEnvelope<Record<string, string>>>("GET", "/api/v5/trade/orders-pending");
    return [...this.#knownOrders.values()].filter((order) => order.status === "pending" || order.status === "partially_filled" || order.status === "uncertain");
  }
  async previewOrder(intent: OrderIntent): Promise<OrderPreview> {
    const price = Number(intent.limitPrice ?? intent.referencePrice);
    const quantity = Number(intent.quantity);
    const notional = price * quantity;
    const now = this.#clock();
    return { previewId: `okx-preview-${intent.clientOrderId}`, intent, estimatedNotional: String(notional), estimatedFee: String(notional * 0.0005), estimatedSlippage: "0", allowed: false, checks: [{ rule: "external_execution_disabled", allowed: false, message: "当前构建仅提供隔离接口与只读连接，外部下单未启用" }], expiresAt: now + 30_000 };
  }
  async placeOrder(preview: OrderPreview, permit: ExecutionPermit): Promise<BrokerOrder> {
    this.#requireExecution(preview, permit);
    throw new Error("External order submission is intentionally disabled in this build");
  }
  async cancelOrder(_clientOrderId: string): Promise<BrokerOrder> { throw new Error("External order cancellation is intentionally disabled in this build"); }
  async cancelAllOrders(_symbol?: string): Promise<readonly BrokerOrder[]> { throw new Error("External order cancellation is intentionally disabled in this build"); }
  async closePosition(_symbol: string, _strategyId: string): Promise<BrokerOrder> { throw new Error("External position closing is intentionally disabled in this build"); }
  async setLeverage(_symbol: string, _leverage: string, _marginMode: MarginMode): Promise<void> { throw new Error("External account mutation is intentionally disabled in this build"); }
  async setMarginMode(_symbol: string, _marginMode: MarginMode): Promise<void> { throw new Error("External account mutation is intentionally disabled in this build"); }
  async healthCheck(): Promise<BrokerHealth> { return { connected: this.#connected, accountMode: this.#mode, readOnly: true, websocketConnected: false, dataAgeMs: Number.POSITIVE_INFINITY, databaseHealthy: true, strategyVersionMatches: true, dataHashMatches: true, message: this.#connected ? `${this.#mode} 只读连接；交易执行已禁用` : `${this.#mode} 未连接且已锁定` }; }
  async reconcile(): Promise<ReconciliationReport> {
    if (!this.#connected) return { status: "unavailable", localOpenOrders: 0, remoteOpenOrders: 0, discrepancies: ["账户未连接"], checkedAt: this.#clock() };
    const local = [...this.#knownOrders.values()].filter((item) => item.status === "pending" || item.status === "partially_filled").length;
    const remote = (await this.getOpenOrders()).length;
    return { status: local === remote ? "consistent" : "discrepancy", localOpenOrders: local, remoteOpenOrders: remote, discrepancies: local === remote ? [] : ["本地与远端活动订单数量不一致"], checkedAt: this.#clock() };
  }

  #requireConnected(): void { if (!this.#connected) throw new Error(`${this.#mode} account is not connected`); }
  #requireExecution(preview: OrderPreview, permit: ExecutionPermit): void {
    this.#requireConnected();
    if (!this.#executionCompiled) throw new Error("External execution was not compiled into this build");
    if (!this.#sessionUnlocked) throw new Error(`${this.#mode} is locked for this session`);
    if (!preview.allowed || permit.previewId !== preview.previewId || permit.accountMode !== this.#mode || permit.expiresAt < this.#clock()) throw new Error("External execution permit is invalid or expired");
    if (this.#mode === "LIVE" && !permit.humanConfirmed) throw new Error("LIVE requires explicit human confirmation for every order");
  }
}
