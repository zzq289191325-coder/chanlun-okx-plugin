from __future__ import annotations

from dataclasses import asdict, dataclass, replace


@dataclass(frozen=True, slots=True)
class BacktestConfig:
    initial_capital: float = 1_000.0
    position_fraction: float = 1.0
    fee_rate: float = 0.0005
    slippage_bps: float = 2.0
    funding_rate_per_8h: float = 0.0001
    intrabar_priority: str = "stop_first"
    minimum_risk_reward: float = 2.0
    stop_atr_buffer: float = 0.15
    entry_atr_width: float = 0.1
    ma_period: int = 40
    atr_period: int = 14
    minimum_atr_percent: float = 0.15
    minimum_execution_bars: int = 60
    sensitivity_percent: float = 0.10
    minimum_reliable_trades: int = 30
    maximum_reliable_drawdown_percent: float = 20.0

    def validate(self) -> None:
        if self.initial_capital <= 0:
            raise ValueError("initial_capital must be positive")
        if not 0 < self.position_fraction <= 1:
            raise ValueError("position_fraction must be within (0, 1]")
        if self.fee_rate < 0 or self.slippage_bps < 0 or self.funding_rate_per_8h < 0:
            raise ValueError("fees, slippage and funding estimates cannot be negative")
        if self.intrabar_priority not in {"stop_first", "target_first"}:
            raise ValueError("intrabar_priority must be stop_first or target_first")
        if self.minimum_risk_reward < 1 or self.minimum_atr_percent < 0:
            raise ValueError("risk/reward and ATR thresholds are invalid")
        if self.ma_period < 2 or self.atr_period < 2 or self.minimum_execution_bars < self.ma_period:
            raise ValueError("MA/ATR lookback configuration is invalid")
        if not 0 <= self.sensitivity_percent <= 0.5:
            raise ValueError("sensitivity_percent must be within [0, 0.5]")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)

    def strategy_config(self) -> dict[str, object]:
        return {
            "minimumRiskReward": self.minimum_risk_reward,
            "stopAtrBuffer": self.stop_atr_buffer,
            "entryAtrWidth": self.entry_atr_width,
            "maPeriod": self.ma_period,
            "atrPeriod": self.atr_period,
            "minimumAtrPercent": self.minimum_atr_percent,
            "minimumExecutionBars": self.minimum_execution_bars,
        }

    def sensitivity_variants(self) -> dict[str, "BacktestConfig"]:
        delta = self.sensitivity_percent
        if delta == 0:
            return {"base": self}
        return {
            "base": self,
            "atr_lower": replace(self, minimum_atr_percent=self.minimum_atr_percent * (1 - delta)),
            "atr_higher": replace(self, minimum_atr_percent=self.minimum_atr_percent * (1 + delta)),
            "rr_lower": replace(self, minimum_risk_reward=max(1, self.minimum_risk_reward * (1 - delta))),
            "rr_higher": replace(self, minimum_risk_reward=self.minimum_risk_reward * (1 + delta)),
        }
