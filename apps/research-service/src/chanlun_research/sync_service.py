from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass

from .models import CandleRecord, SyncTask
from .okx_public import OkxPublicHistoryClient
from .repository import (
    finish_import,
    start_import,
    update_import_progress,
    upsert_candles,
)


@dataclass(frozen=True, slots=True)
class SyncResult:
    symbol: str
    timeframe: str
    mode: str
    pages: int
    rows_received: int
    rows_upserted: int
    cursor_after: int | None
    status: str
    error: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def sync_task(
    connection: sqlite3.Connection,
    client: OkxPublicHistoryClient,
    task: SyncTask,
    *,
    mode: str = "backfill",
    maximum_pages: int = 1,
    page_size: int = 300,
) -> SyncResult:
    if mode not in {"backfill", "latest"}:
        raise ValueError("Sync mode must be backfill or latest")
    import_id = start_import(connection, task, mode)
    connection.commit()
    cursor = task.cursor_after if mode == "backfill" else None
    pages = 0
    rows_received = 0
    rows_upserted = 0
    try:
        for _ in range(maximum_pages):
            rows = client.get_history_candles(
                task.symbol,
                task.timeframe,
                limit=page_size,
                after=cursor if mode == "backfill" else None,
            )
            if not rows:
                break
            candles = [CandleRecord.from_okx_row(task.symbol, task.timeframe, row) for row in rows]
            next_cursor = min(item.open_time for item in candles)
            if mode == "backfill" and cursor is not None and next_cursor >= cursor:
                break
            with connection:
                upserted = upsert_candles(connection, candles, source=task.source)
                update_import_progress(
                    connection,
                    import_id,
                    task,
                    cursor_after=next_cursor,
                    received=len(rows),
                    upserted=upserted,
                    update_backfill_cursor=mode == "backfill",
                )
            pages += 1
            rows_received += len(rows)
            rows_upserted += upserted
            cursor = next_cursor
            if mode == "latest" or len(rows) < page_size:
                break
        with connection:
            finish_import(connection, import_id, task)
        return SyncResult(
            symbol=task.symbol,
            timeframe=task.timeframe,
            mode=mode,
            pages=pages,
            rows_received=rows_received,
            rows_upserted=rows_upserted,
            cursor_after=cursor,
            status="success",
        )
    except Exception as error:
        message = str(error)
        with connection:
            finish_import(connection, import_id, task, error=message)
        return SyncResult(
            symbol=task.symbol,
            timeframe=task.timeframe,
            mode=mode,
            pages=pages,
            rows_received=rows_received,
            rows_upserted=rows_upserted,
            cursor_after=cursor,
            status="failed",
            error=message,
        )
