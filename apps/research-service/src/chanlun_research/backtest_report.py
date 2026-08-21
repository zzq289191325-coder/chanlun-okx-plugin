from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

from .backtest_models import SimulationResult


def _number(value: object, digits: int = 4) -> str:
    if value is None:
        return "—"
    if isinstance(value, (int, float)):
        return f"{value:.{digits}f}"
    return str(value)


def _utc(milliseconds: int) -> str:
    return datetime.fromtimestamp(milliseconds / 1000, tz=UTC).isoformat()


def write_backtest_report(
    path: Path,
    *,
    run_id: str,
    symbol: str,
    git_commit: str,
    data_hash: str,
    algorithm_version: str,
    strategy_version: str,
    data_start: int,
    data_end: int,
    result: SimulationResult,
    metrics: dict[str, Any],
    warnings: list[str],
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# V1.1 本地缠论回测报告 — {symbol}",
        "",
        "> 仅用于离线行情研究和本地 paper trading，不构成投资建议，不连接任何真实或 OKX 模拟盘订单接口。",
        "",
        "## 可重复性信息",
        "",
        f"- Run ID：`{run_id}`",
        f"- Git commit：`{git_commit}`",
        f"- 数据 SHA-256：`{data_hash}`",
        f"- 算法版本：`{algorithm_version}`",
        f"- 策略版本：`{strategy_version}`",
        f"- 数据范围：{_utc(data_start)} 至 {_utc(data_end)}",
        "- 成交规则：信号确认后的下一根 15M K线开盘价，加不利滑点",
        f"- 同K线止盈止损优先级：{metrics['intrabar_priority']}",
        "- 新闻：未使用外部或未来新闻",
        "- 资金费率：使用配置中的固定估算，不读取未来实际费率",
        "",
        "## 核心指标",
        "",
        f"- 初始资金：{_number(metrics['initial_capital'])} U",
        f"- 最终权益：{_number(metrics['final_equity'])} U",
        f"- 总收益率：{_number(metrics['total_return_percent'])}%",
        f"- 最大回撤：{_number(metrics['max_drawdown_percent'])}%",
        f"- 交易次数：{metrics['trade_count']}",
        f"- 胜率：{_number(metrics['win_rate_percent'])}%",
        f"- 平均盈亏比：{_number(metrics['average_win_loss_ratio'])}",
        f"- Profit Factor：{_number(metrics['profit_factor'])}",
        f"- 单笔期望：{_number(metrics['expectancy'])} U",
        f"- 最大连续盈利：{metrics['maximum_consecutive_wins']}",
        f"- 最大连续亏损：{metrics['maximum_consecutive_losses']}",
        f"- 手续费：{_number(metrics['fees'])} U",
        f"- 滑点影响：{_number(metrics['slippage_cost'])} U",
        f"- 资金费率估算：{_number(metrics['funding_estimate'])} U",
        "",
        "## 可靠性提示",
        "",
    ]
    lines.extend([f"- {warning}" for warning in warnings] or ["- 当前样本未触发额外可靠性警告。"])
    lines.extend(
        [
            "",
            "## 模拟交易明细",
            "",
            "| 方向 | 候选结构 | 确认时间 | 数据截止 | 入场时间 | 入场价 | 出场时间 | 出场价 | 净盈亏 | 原因 |",
            "|---|---|---|---|---|---:|---|---:|---:|---|",
        ]
    )
    for trade in result.trades:
        lines.append(
            "| "
            + " | ".join(
                [
                    trade.side,
                    trade.candidate_label,
                    _utc(trade.signal_confirmed_at),
                    _utc(trade.data_cutoff),
                    _utc(trade.entry_time),
                    _number(trade.entry_price, 6),
                    _utc(trade.exit_time),
                    _number(trade.exit_price, 6),
                    _number(trade.realized_pnl),
                    trade.exit_reason,
                ]
            )
            + " |"
        )
    if not result.trades:
        lines.append("| — | — | — | — | — | — | — | — | — | 当前样本没有满足全部条件的交易 |")
    lines.extend(
        [
            "",
            "## 分组统计与参数敏感性",
            "",
            "```json",
            json.dumps(
                {
                    "group_summary": metrics.get("group_summary", {}),
                    "sensitivity": metrics.get("sensitivity", {}),
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            "```",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
