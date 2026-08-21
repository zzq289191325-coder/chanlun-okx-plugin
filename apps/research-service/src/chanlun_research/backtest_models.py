from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class PaperTrade:
    opportunity_id: str
    signal_id: str | None
    symbol: str
    side: str
    candidate_label: str
    signal_confirmed_at: int
    data_cutoff: int
    entry_time: int
    entry_price: float
    exit_time: int
    exit_price: float
    quantity: float
    stop_price: float
    target_price: float
    reserved_capital: float
    gross_pnl: float
    fee: float
    funding_estimate: float
    slippage_cost: float
    realized_pnl: float
    exit_reason: str
    market_regime: str
    entry_basis: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class EquityPoint:
    timestamp: int
    equity: float
    cash: float
    unrealized_pnl: float
    drawdown: float

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class SimulationResult:
    symbol: str
    trades: tuple[PaperTrade, ...]
    equity_curve: tuple[EquityPoint, ...]
    metrics: dict[str, Any]
    warnings: tuple[str, ...]

    def deterministic_payload(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "trades": [item.to_dict() for item in self.trades],
            "equity_curve": [item.to_dict() for item in self.equity_curve],
            "metrics": self.metrics,
            "warnings": list(self.warnings),
        }
