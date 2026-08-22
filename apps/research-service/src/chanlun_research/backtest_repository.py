from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from typing import Any

from .backtest_config import BacktestConfig
from .backtest_models import SimulationResult
from .repository import utc_milliseconds


def create_backtest_run(
    connection: sqlite3.Connection,
    *,
    name: str,
    symbol: str,
    config: BacktestConfig,
    strategy_version: str,
    git_commit: str,
    data_hash: str,
    data_start: int,
    data_end: int,
) -> str:
    run_id = str(uuid.uuid4())
    payload = {"symbol": symbol, **config.to_dict()}
    connection.execute(
        """
        INSERT INTO backtest_runs(
            backtest_run_id, name, status, initial_capital, strategy_version,
            git_commit, data_hash, random_seed, data_start, data_end, config_json, started_at
        ) VALUES (?, ?, 'running', ?, ?, ?, ?, 0, ?, ?, ?, ?)
        """,
        (
            run_id,
            name,
            config.initial_capital,
            strategy_version,
            git_commit,
            data_hash,
            data_start,
            data_end,
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            utc_milliseconds(),
        ),
    )
    return run_id


def fail_backtest_run(connection: sqlite3.Connection, run_id: str, error: str) -> None:
    connection.execute(
        "UPDATE backtest_runs SET status = 'failed', completed_at = ?, error = ? WHERE backtest_run_id = ?",
        (utc_milliseconds(), error, run_id),
    )


def persist_backtest_result(
    connection: sqlite3.Connection,
    *,
    run_id: str,
    symbol: str,
    algorithm_version: str,
    config: BacktestConfig,
    opportunities: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    observed_candidates: list[dict[str, Any]],
    interval_nesting_checks: list[dict[str, Any]],
    rejection_counts: dict[str, int],
    data_snapshots: list[dict[str, Any]],
    result: SimulationResult,
    metrics: dict[str, Any],
    warnings: list[str],
    result_signature: str,
) -> None:
    analysis_run_id = str(uuid.uuid4())
    now = utc_milliseconds()
    connection.execute(
        """
        INSERT INTO analysis_runs(
            analysis_run_id, symbol, data_cutoff, algorithm_version, config_json,
            status, started_at, completed_at, backtest_run_id
        ) VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?)
        """,
        (
            analysis_run_id,
            symbol,
            max(
                (int(item["dataCutoff"]) for item in decisions),
                default=max((int(item["dataCutoff"]) for item in opportunities), default=0),
            ),
            algorithm_version,
            json.dumps(config.strategy_config(), sort_keys=True, separators=(",", ":")),
            now,
            now,
            run_id,
        ),
    )
    signal_ids: dict[str, str] = {}

    for item in decisions:
        decision_id = hashlib.sha256(
            f"{run_id}:decision:{item['symbol']}:{item['dataCutoff']}".encode("utf-8")
        ).hexdigest()
        visible = item.get("visibleCutoffs", {})
        connection.execute(
            """
            INSERT INTO bar_decisions(
                decision_id, analysis_run_id, backtest_run_id, symbol,
                execution_timeframe, candle_open_time, candle_close_time, data_cutoff,
                visible_1d_cutoff, visible_4h_cutoff, visible_1h_cutoff,
                visible_30m_cutoff, visible_15m_cutoff, daily_state, h4_state,
                h1_state, interval_nesting_state, market_regime, preferred_side,
                signal_state, score, rejection_stage, rejection_reason, algorithm_version
            ) VALUES (?, ?, ?, ?, '15m', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                decision_id, analysis_run_id, run_id, symbol,
                item["candleOpenTime"], item["candleCloseTime"], item["dataCutoff"],
                visible.get("1D"), visible.get("4H"), visible.get("1H"),
                visible.get("30m"), visible.get("15m"), item["dailyState"],
                item["h4State"], item["h1State"], item["intervalNestingState"],
                item["marketRegime"], item.get("preferredSide"), item["signalState"],
                item["score"], item.get("rejectionStage"), item.get("rejectionReason"),
                algorithm_version,
            ),
        )

    for item in observed_candidates:
        observed_id = hashlib.sha256(
            f"{run_id}:{item['timeframe']}:{item['sourceCandidateId']}".encode("utf-8")
        ).hexdigest()
        connection.execute(
            """
            INSERT INTO observed_candidates(
                observed_candidate_id, analysis_run_id, backtest_run_id, symbol,
                timeframe, source_candidate_id, candidate_kind, candidate_label,
                side, location_time, confirmed_at, first_visible_cutoff, price,
                score, accepted, rejection_reason
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                observed_id, analysis_run_id, run_id, symbol, item["timeframe"],
                item["sourceCandidateId"], item["candidateKind"], item["candidateLabel"],
                item["side"], item["locationTime"], item["confirmedAt"],
                item["firstVisibleCutoff"], item["price"], item["score"],
                int(bool(item["accepted"])), item.get("rejectionReason"),
            ),
        )

    for item in interval_nesting_checks:
        nesting_id = hashlib.sha256(
            f"{run_id}:nesting:{item['dataCutoff']}".encode("utf-8")
        ).hexdigest()
        connection.execute(
            """
            INSERT INTO interval_nesting_checks(
                nesting_check_id, analysis_run_id, backtest_run_id, symbol,
                data_cutoff, state, side, m30_candidate_id, m15_candidate_id,
                m30_confirmed_at, m15_confirmed_at, structure_low, structure_high,
                m15_price, same_direction, confirmation_order_valid, inside_structure,
                reason_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                nesting_id, analysis_run_id, run_id, symbol, item["dataCutoff"],
                item["state"], item.get("side"), item.get("m30CandidateId"),
                item.get("m15CandidateId"), item.get("m30ConfirmedAt"),
                item.get("m15ConfirmedAt"), item.get("structureLow"),
                item.get("structureHigh"), item.get("m15Price"),
                None if item.get("sameDirection") is None else int(bool(item["sameDirection"])),
                None if item.get("confirmationOrderValid") is None else int(bool(item["confirmationOrderValid"])),
                None if item.get("insideStructure") is None else int(bool(item["insideStructure"])),
                json.dumps(item.get("reasons", []), ensure_ascii=False, separators=(",", ":")),
            ),
        )

    connection.executemany(
        "INSERT INTO strategy_rejection_counts(backtest_run_id, rejection_stage, rejected_count) VALUES (?, ?, ?)",
        [(run_id, stage, count) for stage, count in sorted(rejection_counts.items())],
    )
    connection.executemany(
        """
        INSERT INTO run_data_snapshots(
            backtest_run_id, symbol, timeframe, first_open_time, last_close_time,
            closed_candle_count, data_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                run_id, symbol, item["timeframe"], item.get("firstOpenTime"),
                item.get("lastCloseTime"), item["closedCandleCount"], item["dataHash"],
            )
            for item in data_snapshots
        ],
    )
    for opportunity in opportunities:
        opportunity_id = str(opportunity["opportunityId"])
        signal_id = hashlib.sha256(f"{run_id}:{opportunity_id}".encode("utf-8")).hexdigest()
        signal_ids[opportunity_id] = signal_id
        connection.execute(
            """
            INSERT INTO candidate_signals(
                signal_id, analysis_run_id, symbol, timeframe, kind, label, side,
                location_time, confirmed_at, price, score, evidence_json, reason,
                data_cutoff, market_regime
            ) VALUES (?, ?, ?, '15m', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                signal_id,
                analysis_run_id,
                symbol,
                opportunity["candidateKind"],
                opportunity["candidateLabel"],
                opportunity["side"],
                opportunity["locationTime"],
                opportunity["confirmedAt"],
                opportunity["candidatePrice"],
                min(100.0, float(opportunity["plannedRiskReward"]) * 25),
                json.dumps(opportunity["evidence"], ensure_ascii=False, separators=(",", ":")),
                f"30M {opportunity['m30CandidateLabel']} / 15M {opportunity['m15CandidateLabel']}",
                opportunity["dataCutoff"],
                opportunity["marketRegime"],
            ),
        )
    for index, trade in enumerate(result.trades):
        trade_id = hashlib.sha256(f"{run_id}:trade:{index}:{trade.opportunity_id}".encode("utf-8")).hexdigest()
        connection.execute(
            """
            INSERT INTO simulated_trades(
                trade_id, backtest_run_id, signal_id, symbol, side, entry_time,
                entry_price, exit_time, exit_price, quantity, fee, funding_estimate,
                realized_pnl, exit_reason, is_open, opportunity_id, candidate_label,
                signal_confirmed_at, data_cutoff, stop_price, target_price,
                reserved_capital, gross_pnl, slippage_cost, market_regime, entry_basis
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trade_id,
                run_id,
                signal_ids.get(trade.opportunity_id),
                trade.symbol,
                trade.side,
                trade.entry_time,
                trade.entry_price,
                trade.exit_time,
                trade.exit_price,
                trade.quantity,
                trade.fee,
                trade.funding_estimate,
                trade.realized_pnl,
                trade.exit_reason,
                trade.opportunity_id,
                trade.candidate_label,
                trade.signal_confirmed_at,
                trade.data_cutoff,
                trade.stop_price,
                trade.target_price,
                trade.reserved_capital,
                trade.gross_pnl,
                trade.slippage_cost,
                trade.market_regime,
                trade.entry_basis,
            ),
        )
    connection.executemany(
        """
        INSERT INTO equity_snapshots(
            backtest_run_id, timestamp, equity, cash, unrealized_pnl, drawdown
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (run_id, item.timestamp, item.equity, item.cash, item.unrealized_pnl, item.drawdown)
            for item in result.equity_curve
        ],
    )
    connection.execute(
        """
        UPDATE backtest_runs
        SET status = 'success', metrics_json = ?, reliability_json = ?,
            result_signature = ?, completed_at = ?, error = NULL
        WHERE backtest_run_id = ?
        """,
        (
            json.dumps(metrics, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            json.dumps(warnings, ensure_ascii=False, separators=(",", ":")),
            result_signature,
            utc_milliseconds(),
            run_id,
        ),
    )
