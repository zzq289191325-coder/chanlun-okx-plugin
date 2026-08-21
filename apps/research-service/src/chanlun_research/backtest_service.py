from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

from .backtest_config import BacktestConfig
from .backtest_models import SimulationResult
from .backtest_report import write_backtest_report
from .backtest_repository import (
    create_backtest_run,
    fail_backtest_run,
    persist_backtest_result,
)
from .bridge import canonical_data_hash, load_candle_bundle, run_strategy_bridge
from .paths import PROJECT_ROOT
from .simulator import simulate_symbol

BridgeRunner = Callable[[dict[str, list[dict[str, object]]], dict[str, object]], dict[str, Any]]


@dataclass(frozen=True, slots=True)
class BacktestRunOutput:
    run_id: str
    symbol: str
    report_path: str
    data_hash: str
    result_signature: str
    metrics: dict[str, Any]
    warnings: tuple[str, ...]
    bridge_diagnostics: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def current_git_commit() -> str:
    git_path = PROJECT_ROOT / ".git"
    if git_path.is_file():
        marker = git_path.read_text(encoding="utf-8").strip()
        if marker.startswith("gitdir:"):
            git_path = (PROJECT_ROOT / marker.split(":", 1)[1].strip()).resolve()
    head_path = git_path / "HEAD"
    if not head_path.is_file():
        return "unknown"
    head = head_path.read_text(encoding="utf-8").strip()
    if not head.startswith("ref:"):
        return head
    reference = head.split(" ", 1)[1]
    loose_ref = git_path / reference
    if loose_ref.is_file():
        return loose_ref.read_text(encoding="utf-8").strip()
    packed_refs = git_path / "packed-refs"
    if packed_refs.is_file():
        for line in packed_refs.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith(("#", "^")):
                commit, name = line.split(" ", 1)
                if name == reference:
                    return commit
    return "unknown"


def _signature(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _sensitivity_warning(
    base_metrics: dict[str, Any],
    sensitivity: dict[str, dict[str, Any]],
) -> str | None:
    trade_counts = [int(item["trade_count"]) for item in sensitivity.values()]
    returns = [float(item["total_return_percent"]) for item in sensitivity.values()]
    base_count = int(base_metrics["trade_count"])
    if trade_counts and max(trade_counts) - min(trade_counts) > max(2, base_count * 0.5):
        return "参数上下浮动导致交易次数大幅变化，策略对阈值敏感，当前结果可能过拟合。"
    nonzero = [value for value in returns if abs(value) > 1e-9]
    if nonzero and min(nonzero) < 0 < max(nonzero):
        return "参数小幅变化使收益方向反转，策略稳定性不足。"
    return None


def run_single_backtest(
    connection: sqlite3.Connection,
    *,
    symbol: str,
    config: BacktestConfig,
    name: str,
    data_start: int | None = None,
    data_end: int | None = None,
    report_dir: Path | None = None,
    bridge_runner: BridgeRunner = run_strategy_bridge,
) -> BacktestRunOutput:
    config.validate()
    bundle = load_candle_bundle(connection, symbol, data_end=data_end)
    missing = [timeframe for timeframe, candles in bundle.items() if not candles]
    if missing:
        raise ValueError(f"Missing closed candles for {symbol}: {', '.join(missing)}")
    m15 = bundle["15m"]
    effective_start = data_start if data_start is not None else int(m15[0]["closeTime"])
    effective_end = data_end if data_end is not None else int(m15[-1]["closeTime"])
    if effective_start >= effective_end:
        raise ValueError("Backtest data_start must be before data_end")
    data_hash = canonical_data_hash(bundle)
    git_commit = current_git_commit()

    base_bridge = bridge_runner(bundle, config.strategy_config())
    algorithm_version = str(base_bridge["algorithmVersion"])
    strategy_version = str(base_bridge["strategyVersion"])
    base_opportunities = [
        item
        for item in base_bridge["opportunities"]
        if effective_start <= int(item["dataCutoff"]) <= effective_end
    ]
    simulation_candles = [
        item
        for item in m15
        if effective_start <= int(item["closeTime"]) <= effective_end
    ]
    result = simulate_symbol(symbol, simulation_candles, base_opportunities, config)

    sensitivity: dict[str, dict[str, Any]] = {}
    for variant_name, variant in config.sensitivity_variants().items():
        if variant_name == "base":
            variant_result = result
            opportunity_count = len(base_opportunities)
        else:
            replay = bridge_runner(bundle, variant.strategy_config())
            opportunities = [
                item
                for item in replay["opportunities"]
                if effective_start <= int(item["dataCutoff"]) <= effective_end
            ]
            variant_result = simulate_symbol(symbol, simulation_candles, opportunities, variant)
            opportunity_count = len(opportunities)
        sensitivity[variant_name] = {
            "minimum_atr_percent": variant.minimum_atr_percent,
            "minimum_risk_reward": variant.minimum_risk_reward,
            "opportunities": opportunity_count,
            "trade_count": variant_result.metrics["trade_count"],
            "total_return_percent": variant_result.metrics["total_return_percent"],
            "max_drawdown_percent": variant_result.metrics["max_drawdown_percent"],
        }

    warnings = list(result.warnings)
    warning = _sensitivity_warning(result.metrics, sensitivity)
    if warning:
        warnings.append(warning)
    metrics = {
        **result.metrics,
        "sensitivity": sensitivity,
        "bridge_diagnostics": base_bridge["diagnostics"],
        "group_summary": {
            "by_side": result.metrics["by_side"],
            "by_symbol": result.metrics["by_symbol"],
            "by_execution_timeframe": result.metrics["by_execution_timeframe"],
            "by_market_regime": result.metrics["by_market_regime"],
        },
    }
    result_signature = _signature(
        {
            "data_hash": data_hash,
            "config": config.to_dict(),
            "result": result.deterministic_payload(),
            "sensitivity": sensitivity,
        }
    )
    with connection:
        run_id = create_backtest_run(
            connection,
            name=name,
            symbol=symbol,
            config=config,
            strategy_version=strategy_version,
            git_commit=git_commit,
            data_hash=data_hash,
            data_start=effective_start,
            data_end=effective_end,
        )
    try:
        with connection:
            persist_backtest_result(
                connection,
                run_id=run_id,
                symbol=symbol,
                algorithm_version=algorithm_version,
                config=config,
                opportunities=base_opportunities,
                result=result,
                metrics=metrics,
                warnings=warnings,
                result_signature=result_signature,
            )
        reports = report_dir or PROJECT_ROOT / "data" / "reports"
        report_path = write_backtest_report(
            reports / f"backtest_{symbol}_{run_id}.md",
            run_id=run_id,
            symbol=symbol,
            git_commit=git_commit,
            data_hash=data_hash,
            algorithm_version=algorithm_version,
            strategy_version=strategy_version,
            data_start=effective_start,
            data_end=effective_end,
            result=result,
            metrics=metrics,
            warnings=warnings,
        )
    except Exception as error:
        with connection:
            fail_backtest_run(connection, run_id, str(error))
        raise
    return BacktestRunOutput(
        run_id=run_id,
        symbol=symbol,
        report_path=str(report_path),
        data_hash=data_hash,
        result_signature=result_signature,
        metrics=metrics,
        warnings=tuple(warnings),
        bridge_diagnostics=dict(base_bridge["diagnostics"]),
    )
