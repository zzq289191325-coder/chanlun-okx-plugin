export type AccountMode = "PAPER" | "DEMO" | "LIVE";
export type OrderSide = "buy" | "sell";
export type PositionSide = "long" | "short" | "net";
export type MarginMode = "cash" | "cross" | "isolated";

export interface BrokerHealth {
  connected: boolean;
  accountMode: AccountMode;
  readOnly: boolean;
  websocketConnected: boolean;
  dataAgeMs: number;
  databaseHealthy: boolean;
  strategyVersionMatches: boolean;
  dataHashMatches: boolean;
  message: string;
}

export interface AccountSummary {
  equity: string;
  available: string;
  currency: string;
  updatedAt: number;
}

export interface Balance {
  currency: string;
  available: string;
  frozen: string;
  equity: string;
}

export interface BrokerPosition {
  symbol: string;
  strategyId: string;
  side: PositionSide;
  quantity: string;
  averagePrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
}

export interface BrokerOrder {
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  quantity: string;
  filledQuantity: string;
  averagePrice: string | null;
  status: "preview" | "pending" | "partially_filled" | "filled" | "cancelled" | "rejected" | "uncertain";
  accountMode: AccountMode;
  strategyId: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrokerFill {
  fillId: string;
  clientOrderId: string;
  symbol: string;
  price: string;
  quantity: string;
  fee: string;
  slippageCost: string;
  fundingCost: string;
  filledAt: number;
}

export interface OrderIntent {
  clientOrderId: string;
  accountMode: AccountMode;
  strategyId: string;
  strategyVersion: string;
  signalId: string | null;
  symbol: string;
  side: OrderSide;
  positionSide: PositionSide;
  orderType: "market" | "limit";
  quantity: string;
  referencePrice: string;
  limitPrice: string | null;
  reduceOnly: boolean;
  candidateLabel: string | null;
  locationTime: number | null;
  confirmedAt: number | null;
  dataCutoff: number;
  createdAt: number;
}

export interface RiskCheck {
  rule: string;
  allowed: boolean;
  message: string;
  actual?: string;
  limit?: string;
}

export interface OrderPreview {
  previewId: string;
  intent: OrderIntent;
  estimatedNotional: string;
  estimatedFee: string;
  estimatedSlippage: string;
  allowed: boolean;
  checks: readonly RiskCheck[];
  expiresAt: number;
}

export interface ExecutionPermit {
  previewId: string;
  accountMode: AccountMode;
  approvedAt: number;
  expiresAt: number;
  humanConfirmed: boolean;
  nonce: string;
}

export interface ReconciliationReport {
  status: "consistent" | "discrepancy" | "unavailable";
  localOpenOrders: number;
  remoteOpenOrders: number;
  discrepancies: readonly string[];
  checkedAt: number;
}

export interface BrokerAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getMode(): AccountMode;
  getAccountSummary(): Promise<AccountSummary>;
  getBalances(): Promise<readonly Balance[]>;
  getPositions(): Promise<readonly BrokerPosition[]>;
  getOpenOrders(): Promise<readonly BrokerOrder[]>;
  previewOrder(intent: OrderIntent): Promise<OrderPreview>;
  placeOrder(preview: OrderPreview, permit: ExecutionPermit): Promise<BrokerOrder>;
  cancelOrder(clientOrderId: string): Promise<BrokerOrder>;
  cancelAllOrders(symbol?: string): Promise<readonly BrokerOrder[]>;
  closePosition(symbol: string, strategyId: string): Promise<BrokerOrder>;
  setLeverage(symbol: string, leverage: string, marginMode: MarginMode): Promise<void>;
  setMarginMode(symbol: string, marginMode: MarginMode): Promise<void>;
  healthCheck(): Promise<BrokerHealth>;
  reconcile(): Promise<ReconciliationReport>;
}
