from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .paths import PROJECT_ROOT

TIMEFRAMES = ("1D", "4H", "1H", "30m", "15m")
DEFAULT_BRIDGE = PROJECT_ROOT / "dist" / "packages" / "core" / "src" / "backtest" / "bridgeCli.js"


def load_candle_bundle(
    connection: sqlite3.Connection,
    symbol: str,
    *,
    data_end: int | None = None,
) -> dict[str, list[dict[str, object]]]:
    bundle: dict[str, list[dict[str, object]]] = {}
    for timeframe in TIMEFRAMES:
        parameters: list[object] = [symbol, timeframe]
        cutoff_sql = ""
        if data_end is not None:
            cutoff_sql = " AND close_time <= ?"
            parameters.append(data_end)
        rows = connection.execute(
            f"""
            SELECT symbol, timeframe, open_time, close_time, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ? AND closed = 1{cutoff_sql}
            ORDER BY open_time
            """,
            parameters,
        ).fetchall()
        bundle[timeframe] = [
            {
                "symbol": str(row["symbol"]),
                "timeframe": str(row["timeframe"]),
                "openTime": int(row["open_time"]),
                "closeTime": int(row["close_time"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
                "closed": True,
            }
            for row in rows
        ]
    return bundle


def canonical_data_hash(bundle: dict[str, list[dict[str, object]]]) -> str:
    payload = json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def resolve_node() -> str:
    configured = os.environ.get("CHANLUN_NODE") or os.environ.get("NODE")
    if configured:
        return configured
    node = shutil.which("node")
    if node:
        return node
    raise RuntimeError("Node.js was not found; set CHANLUN_NODE or install Node.js 24+")


def run_strategy_bridge(
    bundle: dict[str, list[dict[str, object]]],
    strategy_config: dict[str, object],
    *,
    bridge_path: Path = DEFAULT_BRIDGE,
) -> dict[str, Any]:
    if not bridge_path.is_file():
        raise RuntimeError(f"Compiled strategy bridge not found: {bridge_path}; run pnpm build first")
    request = {"candles": bundle, "config": strategy_config}
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
            json.dump(request, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            temporary_path = Path(handle.name)
        completed = subprocess.run(
            [resolve_node(), str(bridge_path), "--input", str(temporary_path)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if completed.returncode != 0:
            raise RuntimeError(f"Strategy bridge failed: {completed.stderr.strip()}")
        return json.loads(completed.stdout)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
