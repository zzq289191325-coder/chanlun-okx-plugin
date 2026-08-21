from __future__ import annotations

import bisect
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from .backtest_config import BacktestConfig
from .backtest_models import EquityPoint, PaperTrade, SimulationResult

EIGHT_HOURS_MS = 8 * 60 * 60 * 1000


@dataclass(slots=True)
class _OpenPosition:
    opportunity: dict[str, Any]
    entry_time: int
    entry_raw_price: float
    entry_price: float
    quantity: float
    reserved_capital: float
    entry_fee: float
    funding: float = 0.0


def _entry_price(raw_price: float, side: str, slippage_rate: float) -> float:
    return raw_price * (1 + slippage_rate if side == "long" else 1 - slippage_rate)


def _exit_price(raw_price: float, side: str, slippage_rate: float) -> float:
    return raw_price * (1 - slippage_rate if side == "long" else 1 + slippage_rate)


def _gross_pnl(side: str, entry: float, exit_price: float, quantity: float) -> float:
    move = exit_price - entry
    return move * quantity if side == "long" else -move * quantity


def _exit_trigger(
    candle: dict[str, object],
    position: _OpenPosition,
    priority: str,
) -> tuple[float, str] | None:
    side = str(position.opportunity["side"])
    stop = float(position.opportunity["stop"])
    target = float(position.opportunity["target"])
    open_price = float(candle["open"])
    high = float(candle["high"])
    low = float(candle["low"])
    if side == "long":
        if open_price <= stop:
            return open_price, "stop_gap"
        if open_price >= target:
            return open_price, "target_gap"
        stop_hit = low <= stop
        target_hit = high >= target
    else:
        if open_price >= stop:
            return open_price, "stop_gap"
        if open_price <= target:
            return open_price, "target_gap"
        stop_hit = high >= stop
        target_hit = low <= target
    if stop_hit and target_hit:
        return (stop, "stop_same_bar") if priority == "stop_first" else (target, "target_same_bar")
    if stop_hit:
        return stop, "stop"
    if target_hit:
        return target, "target"
    return None


def _close_position(
    position: _OpenPosition,
    *,
    raw_exit_price: float,
    exit_time: int,
    exit_reason: str,
    config: BacktestConfig,
) -> tuple[PaperTrade, float]:
    side = str(position.opportunity["side"])
    slippage_rate = config.slippage_bps / 10_000
    exit_price = _exit_price(raw_exit_price, side, slippage_rate)
    gross = _gross_pnl(side, position.entry_price, exit_price, position.quantity)
    exit_fee = abs(exit_price * position.quantity) * config.fee_rate
    fee = position.entry_fee + exit_fee
    realized = gross - fee - position.funding
    slippage_cost = (
        abs(position.entry_price - position.entry_raw_price)
        + abs(exit_price - raw_exit_price)
    ) * position.quantity
    trade = PaperTrade(
        opportunity_id=str(position.opportunity["opportunityId"]),
        signal_id=None,
        symbol=str(position.opportunity["symbol"]),
        side=side,
        candidate_label=str(position.opportunity["candidateLabel"]),
        signal_confirmed_at=int(position.opportunity["confirmedAt"]),
        data_cutoff=int(position.opportunity["dataCutoff"]),
        entry_time=position.entry_time,
        entry_price=position.entry_price,
        exit_time=exit_time,
        exit_price=exit_price,
        quantity=position.quantity,
        stop_price=float(position.opportunity["stop"]),
        target_price=float(position.opportunity["target"]),
        reserved_capital=position.reserved_capital,
        gross_pnl=gross,
        fee=fee,
        funding_estimate=position.funding,
        slippage_cost=slippage_cost,
        realized_pnl=realized,
        exit_reason=exit_reason,
        market_regime=str(position.opportunity["marketRegime"]),
        entry_basis=json.dumps(
            {
                "candidate": position.opportunity["candidateLabel"],
                "m30": position.opportunity["m30CandidateLabel"],
                "m15": position.opportunity["m15CandidateLabel"],
                "plannedRiskReward": position.opportunity["plannedRiskReward"],
                "ma40": position.opportunity["ma40"],
                "atrPercent": position.opportunity["atrPercent"],
                "evidence": position.opportunity["evidence"],
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ),
    )
    cash_released = position.reserved_capital + gross - exit_fee - position.funding
    return trade, cash_released


def _streaks(trades: list[PaperTrade]) -> tuple[int, int]:
    max_wins = max_losses = wins = losses = 0
    for trade in trades:
        if trade.realized_pnl > 0:
            wins += 1
            losses = 0
        elif trade.realized_pnl < 0:
            losses += 1
            wins = 0
        else:
            wins = losses = 0
        max_wins = max(max_wins, wins)
        max_losses = max(max_losses, losses)
    return max_wins, max_losses


def _group_stats(trades: list[PaperTrade], key: str) -> dict[str, dict[str, float | int | None]]:
    grouped: dict[str, list[PaperTrade]] = defaultdict(list)
    for trade in trades:
        grouped[str(getattr(trade, key))].append(trade)
    result: dict[str, dict[str, float | int | None]] = {}
    for name, items in sorted(grouped.items()):
        wins = [item for item in items if item.realized_pnl > 0]
        result[name] = {
            "trades": len(items),
            "wins": len(wins),
            "win_rate_percent": len(wins) / len(items) * 100 if items else None,
            "net_pnl": sum(item.realized_pnl for item in items),
        }
    return result


def _metrics(
    symbol: str,
    trades: list[PaperTrade],
    curve: list[EquityPoint],
    config: BacktestConfig,
    ignored_signals: int,
) -> tuple[dict[str, Any], tuple[str, ...]]:
    final_equity = curve[-1].equity if curve else config.initial_capital
    wins = [item.realized_pnl for item in trades if item.realized_pnl > 0]
    losses = [item.realized_pnl for item in trades if item.realized_pnl < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    average_win = sum(wins) / len(wins) if wins else 0.0
    average_loss = abs(sum(losses) / len(losses)) if losses else 0.0
    max_wins, max_losses = _streaks(trades)
    metrics: dict[str, Any] = {
        "initial_capital": config.initial_capital,
        "final_equity": final_equity,
        "total_return_percent": (final_equity / config.initial_capital - 1) * 100,
        "max_drawdown_percent": max((item.drawdown for item in curve), default=0.0) * 100,
        "trade_count": len(trades),
        "win_rate_percent": len(wins) / len(trades) * 100 if trades else None,
        "average_win_loss_ratio": average_win / average_loss if average_loss > 0 else None,
        "profit_factor": gross_profit / gross_loss if gross_loss > 0 else None,
        "expectancy": sum(item.realized_pnl for item in trades) / len(trades) if trades else None,
        "maximum_consecutive_wins": max_wins,
        "maximum_consecutive_losses": max_losses,
        "gross_pnl": sum(item.gross_pnl for item in trades),
        "net_pnl": sum(item.realized_pnl for item in trades),
        "fees": sum(item.fee for item in trades),
        "funding_estimate": sum(item.funding_estimate for item in trades),
        "slippage_cost": sum(item.slippage_cost for item in trades),
        "signals_ignored_while_position_open": ignored_signals,
        "by_side": _group_stats(trades, "side"),
        "by_symbol": _group_stats(trades, "symbol") or {symbol: {"trades": 0, "wins": 0, "win_rate_percent": None, "net_pnl": 0.0}},
        "by_execution_timeframe": {"15m": {"trades": len(trades), "net_pnl": sum(item.realized_pnl for item in trades)}},
        "by_market_regime": _group_stats(trades, "market_regime"),
        "intrabar_priority": config.intrabar_priority,
        "news_policy": "not_consumed; no future or external news data used",
        "funding_policy": "fixed configurable estimate; no future realized funding data used",
    }
    warnings: list[str] = []
    if len(trades) == 0:
        warnings.append("没有产生满足全部结构、MA40、ATR和风险收益条件的模拟交易，无法评价策略收益。")
    elif len(trades) < config.minimum_reliable_trades:
        warnings.append(
            f"样本仅 {len(trades)} 笔，低于可靠性阈值 {config.minimum_reliable_trades} 笔，统计结果不可靠。"
        )
    if metrics["max_drawdown_percent"] > config.maximum_reliable_drawdown_percent:
        warnings.append(
            f"最大回撤 {metrics['max_drawdown_percent']:.2f}% 超过 {config.maximum_reliable_drawdown_percent:.2f}% 风险阈值。"
        )
    return metrics, tuple(warnings)


def simulate_symbol(
    symbol: str,
    candles: list[dict[str, object]],
    opportunities: list[dict[str, Any]],
    config: BacktestConfig,
) -> SimulationResult:
    config.validate()
    closed = sorted(
        (item for item in candles if bool(item["closed"])),
        key=lambda item: int(item["openTime"]),
    )
    open_times = [int(item["openTime"]) for item in closed]
    entries: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for opportunity in opportunities:
        if int(opportunity["confirmedAt"]) > int(opportunity["dataCutoff"]):
            raise ValueError("Opportunity was emitted before candidate confirmation")
        entry_index = bisect.bisect_left(open_times, int(opportunity["dataCutoff"]))
        if entry_index < len(closed):
            entries[entry_index].append(opportunity)
    for values in entries.values():
        values.sort(key=lambda item: (-float(item["plannedRiskReward"]), str(item["opportunityId"])))

    cash = config.initial_capital
    peak_equity = config.initial_capital
    position: _OpenPosition | None = None
    trades: list[PaperTrade] = []
    curve: list[EquityPoint] = []
    ignored_signals = 0
    slippage_rate = config.slippage_bps / 10_000

    for index, candle in enumerate(closed):
        if entries.get(index):
            if position is None:
                opportunity = entries[index][0]
                raw_price = float(candle["open"])
                side = str(opportunity["side"])
                price = _entry_price(raw_price, side, slippage_rate)
                allocated = cash * config.position_fraction
                quantity = allocated / (price * (1 + config.fee_rate))
                reserved = price * quantity
                entry_fee = reserved * config.fee_rate
                if reserved + entry_fee > cash + 1e-9:
                    raise RuntimeError("Virtual position exceeds available local paper capital")
                cash -= reserved + entry_fee
                position = _OpenPosition(
                    opportunity=opportunity,
                    entry_time=int(candle["openTime"]),
                    entry_raw_price=raw_price,
                    entry_price=price,
                    quantity=quantity,
                    reserved_capital=reserved,
                    entry_fee=entry_fee,
                )
                ignored_signals += max(0, len(entries[index]) - 1)
            else:
                ignored_signals += len(entries[index])

        if position is not None:
            duration = max(0, int(candle["closeTime"]) - max(int(candle["openTime"]), position.entry_time))
            position.funding += (
                position.reserved_capital
                * config.funding_rate_per_8h
                * duration
                / EIGHT_HOURS_MS
            )
            trigger = _exit_trigger(candle, position, config.intrabar_priority)
            if trigger is None and index == len(closed) - 1:
                trigger = (float(candle["close"]), "end_of_data")
            if trigger is not None:
                trade, released = _close_position(
                    position,
                    raw_exit_price=trigger[0],
                    exit_time=int(candle["closeTime"]),
                    exit_reason=trigger[1],
                    config=config,
                )
                cash += released
                trades.append(trade)
                position = None

        if position is None:
            equity = cash
            unrealized = 0.0
        else:
            mark = float(candle["close"])
            unrealized = _gross_pnl(
                str(position.opportunity["side"]),
                position.entry_price,
                mark,
                position.quantity,
            )
            estimated_exit_fee = abs(mark * position.quantity) * config.fee_rate
            equity = cash + position.reserved_capital + unrealized - position.funding - estimated_exit_fee
        if not math.isfinite(equity):
            raise RuntimeError("Non-finite paper equity")
        peak_equity = max(peak_equity, equity)
        drawdown = (peak_equity - equity) / peak_equity if peak_equity > 0 else 0.0
        curve.append(
            EquityPoint(
                timestamp=int(candle["closeTime"]),
                equity=equity,
                cash=cash,
                unrealized_pnl=unrealized,
                drawdown=drawdown,
            )
        )

    metrics, warnings = _metrics(symbol, trades, curve, config, ignored_signals)
    return SimulationResult(
        symbol=symbol,
        trades=tuple(trades),
        equity_curve=tuple(curve),
        metrics=metrics,
        warnings=warnings,
    )
