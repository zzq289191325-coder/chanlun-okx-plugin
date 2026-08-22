import type { AccountMode, BrokerHealth, BrokerPosition, OrderIntent, RiskCheck } from "../../broker-contracts/src/index.js";

export interface RiskLimits {
  symbols: readonly string[];
  maximumOrderNotional: number;
  maximumRiskPerOrderPercent: number;
  maximumDailyLossPercent: number;
  maximumTotalNotional: number;
  maximumOpenPositions: number;
  maximumLeverage: number;
  maximumOrdersPerHour: number;
  maximumSlippageBps: number;
  maximumSpreadBps: number;
  maximumDataAgeMs: number;
  maximumConsecutiveLosses: number;
  allowHedging: boolean;
}

export const PAPER_RISK_LIMITS: RiskLimits = {
  symbols: ["BTC-USDT-SWAP", "GOOGL-USDT-SWAP", "INTC-USDT-SWAP", "MU-USDT-SWAP"],
  maximumOrderNotional: 250,
  maximumRiskPerOrderPercent: 1,
  maximumDailyLossPercent: 3,
  maximumTotalNotional: 700,
  maximumOpenPositions: 4,
  maximumLeverage: 1,
  maximumOrdersPerHour: 12,
  maximumSlippageBps: 20,
  maximumSpreadBps: 30,
  maximumDataAgeMs: 120_000,
  maximumConsecutiveLosses: 3,
  allowHedging: false,
};

export const LIVE_RISK_LIMITS: RiskLimits = {
  ...PAPER_RISK_LIMITS,
  maximumOrderNotional: 50,
  maximumRiskPerOrderPercent: 0.25,
  maximumDailyLossPercent: 1,
  maximumTotalNotional: 100,
  maximumOpenPositions: 2,
  maximumOrdersPerHour: 4,
  maximumSlippageBps: 10,
  maximumSpreadBps: 15,
  maximumConsecutiveLosses: 3,
};

export interface RiskContext {
  mode: AccountMode;
  accountEquity: number;
  dailyPnl: number;
  consecutiveLosses: number;
  ordersLastHour: number;
  leverage: number;
  estimatedSlippageBps: number;
  spreadBps: number;
  stopPrice: number | null;
  positions: readonly BrokerPosition[];
  health: BrokerHealth;
  killSwitchActive: boolean;
  modeUnlocked: boolean;
  now: number;
}

export interface RiskDecision {
  allowed: boolean;
  checks: readonly RiskCheck[];
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function evaluateOrderRisk(intent: OrderIntent, context: RiskContext, limits: RiskLimits): RiskDecision {
  const price = numeric(intent.limitPrice ?? intent.referencePrice);
  const quantity = numeric(intent.quantity);
  const notional = price * quantity;
  const stopRisk = context.stopPrice === null ? Number.POSITIVE_INFINITY : Math.abs(price - context.stopPrice) * quantity;
  const totalNotional = context.positions.reduce((sum, position) => sum + Math.abs(numeric(position.quantity) * numeric(position.markPrice)), 0);
  const opposite = context.positions.some((position) => position.symbol === intent.symbol && position.strategyId !== intent.strategyId && ((position.side === "long" && intent.positionSide === "short") || (position.side === "short" && intent.positionSide === "long")));
  const checks: RiskCheck[] = [
    { rule: "mode_match", allowed: intent.accountMode === context.mode, message: "订单模式必须与账户模式一致" },
    { rule: "mode_unlock", allowed: context.mode === "PAPER" || context.modeUnlocked, message: "DEMO/LIVE 必须在本次启动中人工解锁" },
    { rule: "kill_switch", allowed: !context.killSwitchActive, message: "紧急停止已开启时禁止新订单" },
    { rule: "health", allowed: context.health.connected && context.health.databaseHealthy && context.health.strategyVersionMatches && context.health.dataHashMatches, message: "连接、数据库、策略版本和数据哈希必须健康" },
    { rule: "websocket", allowed: context.mode === "PAPER" || context.health.websocketConnected, message: "账户 WebSocket 断线时禁止开新仓" },
    { rule: "data_age", allowed: context.health.dataAgeMs <= limits.maximumDataAgeMs, message: "行情数据不能过期", actual: String(context.health.dataAgeMs), limit: String(limits.maximumDataAgeMs) },
    { rule: "symbol_allowlist", allowed: limits.symbols.includes(intent.symbol), message: "标的必须在白名单" },
    { rule: "numeric_order", allowed: Number.isFinite(notional) && price > 0 && quantity > 0, message: "价格和数量必须为正数" },
    { rule: "order_notional", allowed: notional <= limits.maximumOrderNotional, message: "单笔名义金额限制", actual: String(notional), limit: String(limits.maximumOrderNotional) },
    { rule: "risk_per_order", allowed: intent.reduceOnly || stopRisk <= context.accountEquity * limits.maximumRiskPerOrderPercent / 100, message: "单笔止损风险限制", actual: String(stopRisk), limit: String(context.accountEquity * limits.maximumRiskPerOrderPercent / 100) },
    { rule: "daily_loss", allowed: context.dailyPnl > -(context.accountEquity * limits.maximumDailyLossPercent / 100), message: "达到单日亏损线后停止开仓" },
    { rule: "total_notional", allowed: intent.reduceOnly || totalNotional + notional <= limits.maximumTotalNotional, message: "总仓位限制" },
    { rule: "position_count", allowed: intent.reduceOnly || context.positions.length < limits.maximumOpenPositions, message: "同时持仓数量限制" },
    { rule: "leverage", allowed: context.leverage <= limits.maximumLeverage, message: "杠杆限制" },
    { rule: "order_rate", allowed: context.ordersLastHour < limits.maximumOrdersPerHour, message: "每小时订单数限制" },
    { rule: "consecutive_losses", allowed: context.consecutiveLosses < limits.maximumConsecutiveLosses, message: "连续亏损后暂停" },
    { rule: "slippage", allowed: context.estimatedSlippageBps <= limits.maximumSlippageBps, message: "滑点限制" },
    { rule: "spread", allowed: context.spreadBps <= limits.maximumSpreadBps, message: "价差限制" },
    { rule: "strategy_isolation", allowed: limits.allowHedging || !opposite, message: "默认禁止双策略对同一标的互相对冲" },
  ];
  return { allowed: checks.every((check) => check.allowed), checks };
}
