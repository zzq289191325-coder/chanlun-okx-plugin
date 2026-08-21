from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Iterable

from .models import CandleRecord, SyncTask


def utc_milliseconds() -> int:
    return int(time.time() * 1000)


def infer_instrument(symbol: str) -> tuple[str | None, str | None, str]:
    parts = symbol.split("-")
    base = parts[0] if parts else None
    quote = parts[1] if len(parts) > 1 else None
    instrument_type = parts[2] if len(parts) > 2 else "UNKNOWN"
    return base, quote, instrument_type


def upsert_instrument(connection: sqlite3.Connection, symbol: str, now: int | None = None) -> None:
    timestamp = now or utc_milliseconds()
    base, quote, instrument_type = infer_instrument(symbol)
    connection.execute(
        """
        INSERT INTO instruments(
            symbol, base_currency, quote_currency, instrument_type, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            base_currency = excluded.base_currency,
            quote_currency = excluded.quote_currency,
            instrument_type = excluded.instrument_type,
            updated_at = excluded.updated_at
        """,
        (symbol, base, quote, instrument_type, timestamp, timestamp),
    )


def upsert_candles(
    connection: sqlite3.Connection,
    candles: Iterable[CandleRecord],
    *,
    source: str,
    imported_at: int | None = None,
) -> int:
    timestamp = imported_at or utc_milliseconds()
    unique = {(item.symbol, item.timeframe, item.open_time): item for item in candles}
    for candle in unique.values():
        candle.validate()
        upsert_instrument(connection, candle.symbol, timestamp)
    connection.executemany(
        """
        INSERT INTO candles(
            symbol, timeframe, open_time, close_time, open, high, low, close,
            volume, closed, source, imported_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, timeframe, open_time) DO UPDATE SET
            close_time = excluded.close_time,
            open = excluded.open,
            high = excluded.high,
            low = excluded.low,
            close = excluded.close,
            volume = excluded.volume,
            closed = excluded.closed,
            source = excluded.source,
            imported_at = excluded.imported_at
        """,
        [
            (
                item.symbol,
                item.timeframe,
                item.open_time,
                item.close_time,
                item.open,
                item.high,
                item.low,
                item.close,
                item.volume,
                int(item.closed),
                source,
                timestamp,
            )
            for item in unique.values()
        ],
    )
    return len(unique)


def load_backtest_candles(
    connection: sqlite3.Connection,
    symbol: str,
    timeframe: str,
    *,
    data_cutoff: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT symbol, timeframe, open_time, close_time, open, high, low, close, volume, closed
        FROM candles
        WHERE symbol = ? AND timeframe = ? AND closed = 1 AND close_time <= ?
        ORDER BY open_time
        """,
        (symbol, timeframe, data_cutoff),
    ).fetchall()


def seed_sync_tasks(connection: sqlite3.Connection, config_path: Path | str) -> int:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    symbols = [str(item).upper() for item in config["symbols"]]
    timeframes = [str(item) for item in config["timeframes"]]
    source = str(config.get("source", "okx_public_history"))
    now = utc_milliseconds()
    for symbol in symbols:
        upsert_instrument(connection, symbol, now)
    connection.executemany(
        """
        INSERT INTO sync_tasks(symbol, timeframe, source, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(symbol, timeframe) DO UPDATE SET
            source = excluded.source,
            enabled = 1,
            updated_at = excluded.updated_at
        """,
        [(symbol, timeframe, source, now) for symbol in symbols for timeframe in timeframes],
    )
    return len(symbols) * len(timeframes)


def load_sync_tasks(
    connection: sqlite3.Connection,
    *,
    symbols: set[str] | None = None,
    timeframes: set[str] | None = None,
) -> list[SyncTask]:
    rows = connection.execute(
        """
        SELECT symbol, timeframe, source, cursor_after
        FROM sync_tasks
        WHERE enabled = 1
        ORDER BY symbol, timeframe
        """
    ).fetchall()
    return [
        SyncTask(
            symbol=str(row["symbol"]),
            timeframe=str(row["timeframe"]),
            source=str(row["source"]),
            cursor_after=int(row["cursor_after"]) if row["cursor_after"] is not None else None,
        )
        for row in rows
        if (symbols is None or str(row["symbol"]) in symbols)
        and (timeframes is None or str(row["timeframe"]) in timeframes)
    ]


def start_import(connection: sqlite3.Connection, task: SyncTask, mode: str) -> str:
    import_id = str(uuid.uuid4())
    connection.execute(
        """
        INSERT INTO data_imports(
            import_id, symbol, timeframe, source, mode, cursor_after, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
        """,
        (import_id, task.symbol, task.timeframe, task.source, mode, task.cursor_after, utc_milliseconds()),
    )
    return import_id


def update_import_progress(
    connection: sqlite3.Connection,
    import_id: str,
    task: SyncTask,
    *,
    cursor_after: int | None,
    received: int,
    upserted: int,
    update_backfill_cursor: bool,
) -> None:
    now = utc_milliseconds()
    connection.execute(
        """
        UPDATE data_imports
        SET cursor_after = ?, rows_received = rows_received + ?, rows_upserted = rows_upserted + ?
        WHERE import_id = ?
        """,
        (cursor_after, received, upserted, import_id),
    )
    if update_backfill_cursor:
        connection.execute(
            """
            UPDATE sync_tasks
            SET cursor_after = ?, last_success_at = ?, last_error = NULL, updated_at = ?
            WHERE symbol = ? AND timeframe = ?
            """,
            (cursor_after, now, now, task.symbol, task.timeframe),
        )
    else:
        connection.execute(
            """
            UPDATE sync_tasks
            SET last_success_at = ?, last_error = NULL, updated_at = ?
            WHERE symbol = ? AND timeframe = ?
            """,
            (now, now, task.symbol, task.timeframe),
        )


def finish_import(
    connection: sqlite3.Connection,
    import_id: str,
    task: SyncTask,
    *,
    error: str | None = None,
) -> None:
    now = utc_milliseconds()
    status = "failed" if error else "success"
    connection.execute(
        "UPDATE data_imports SET status = ?, completed_at = ?, error = ? WHERE import_id = ?",
        (status, now, error, import_id),
    )
    if error:
        connection.execute(
            """
            UPDATE sync_tasks SET last_error = ?, updated_at = ?
            WHERE symbol = ? AND timeframe = ?
            """,
            (error, now, task.symbol, task.timeframe),
        )
