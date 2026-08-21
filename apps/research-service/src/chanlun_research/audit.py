from __future__ import annotations

import sqlite3
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

from .database import integrity_check
from .models import TIMEFRAME_MILLISECONDS
from .repository import utc_milliseconds


@dataclass(frozen=True, slots=True)
class SeriesAudit:
    symbol: str
    timeframe: str
    row_count: int
    closed_count: int
    open_count: int
    first_open_time: int | None
    last_open_time: int | None
    first_open_utc: str | None
    last_open_utc: str | None
    duplicate_count: int
    anomaly_count: int
    gap_count: int
    missing_bars: int

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def iso_utc(milliseconds: int | None) -> str | None:
    if milliseconds is None:
        return None
    return datetime.fromtimestamp(milliseconds / 1000, tz=UTC).isoformat()


def audit_series(connection: sqlite3.Connection, symbol: str, timeframe: str) -> SeriesAudit:
    rows = connection.execute(
        """
        SELECT open_time, close_time, open, high, low, close, volume, closed
        FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY open_time
        """,
        (symbol, timeframe),
    ).fetchall()
    duplicate_count = int(
        connection.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT open_time FROM candles
                WHERE symbol = ? AND timeframe = ?
                GROUP BY open_time HAVING COUNT(*) > 1
            )
            """,
            (symbol, timeframe),
        ).fetchone()[0]
    )
    anomalies = [
        row
        for row in rows
        if row["open_time"] >= row["close_time"]
        or row["high"] < max(row["open"], row["close"])
        or row["low"] > min(row["open"], row["close"])
        or row["high"] < row["low"]
        or row["volume"] < 0
    ]
    duration = TIMEFRAME_MILLISECONDS[timeframe]
    gaps: list[tuple[int, int, int]] = []
    for previous, current in zip(rows, rows[1:]):
        distance = int(current["open_time"]) - int(previous["open_time"])
        if distance > duration:
            gaps.append(
                (
                    int(previous["open_time"]),
                    int(current["open_time"]),
                    max(0, distance // duration - 1),
                )
            )
    first_time = int(rows[0]["open_time"]) if rows else None
    last_time = int(rows[-1]["open_time"]) if rows else None
    return SeriesAudit(
        symbol=symbol,
        timeframe=timeframe,
        row_count=len(rows),
        closed_count=sum(int(row["closed"]) for row in rows),
        open_count=sum(1 - int(row["closed"]) for row in rows),
        first_open_time=first_time,
        last_open_time=last_time,
        first_open_utc=iso_utc(first_time),
        last_open_utc=iso_utc(last_time),
        duplicate_count=duplicate_count,
        anomaly_count=len(anomalies),
        gap_count=len(gaps),
        missing_bars=sum(item[2] for item in gaps),
    )


def save_gap_issues(connection: sqlite3.Connection, symbol: str, timeframe: str) -> int:
    rows = connection.execute(
        "SELECT open_time FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY open_time",
        (symbol, timeframe),
    ).fetchall()
    duration = TIMEFRAME_MILLISECONDS[timeframe]
    now = utc_milliseconds()
    issues: list[tuple[object, ...]] = []
    for previous, current in zip(rows, rows[1:]):
        start = int(previous["open_time"])
        end = int(current["open_time"])
        distance = end - start
        if distance > duration:
            missing = max(0, distance // duration - 1)
            issues.append(
                (
                    str(uuid.uuid4()),
                    symbol,
                    timeframe,
                    "time_gap",
                    start,
                    end,
                    f"Expected interval {duration}ms; estimated missing bars: {missing}",
                    now,
                )
            )
    connection.execute(
        """
        UPDATE data_quality_issues SET resolved_at = ?
        WHERE symbol = ? AND timeframe = ? AND issue_type = 'time_gap' AND resolved_at IS NULL
        """,
        (now, symbol, timeframe),
    )
    connection.executemany(
        """
        INSERT INTO data_quality_issues(
            issue_id, symbol, timeframe, issue_type, start_time, end_time, detail, detected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        issues,
    )
    return len(issues)


def database_report(connection: sqlite3.Connection, *, save_issues: bool = False) -> dict[str, object]:
    series_rows = connection.execute(
        "SELECT DISTINCT symbol, timeframe FROM candles ORDER BY symbol, timeframe"
    ).fetchall()
    audits = [audit_series(connection, str(row["symbol"]), str(row["timeframe"])) for row in series_rows]
    if save_issues:
        with connection:
            for audit in audits:
                save_gap_issues(connection, audit.symbol, audit.timeframe)
    migrations = [
        {"version": int(row["version"]), "name": str(row["name"]), "applied_at": int(row["applied_at"])}
        for row in connection.execute(
            "SELECT version, name, applied_at FROM schema_migrations ORDER BY version"
        )
    ]
    return {
        "integrity": integrity_check(connection),
        "schema_migrations": migrations,
        "series": [item.to_dict() for item in audits],
        "totals": {
            "instruments": int(connection.execute("SELECT COUNT(*) FROM instruments").fetchone()[0]),
            "candles": sum(item.row_count for item in audits),
            "closed_candles": sum(item.closed_count for item in audits),
            "open_candles": sum(item.open_count for item in audits),
            "duplicates": sum(item.duplicate_count for item in audits),
            "anomalies": sum(item.anomaly_count for item in audits),
            "gaps": sum(item.gap_count for item in audits),
            "estimated_missing_bars": sum(item.missing_bars for item in audits),
        },
    }
