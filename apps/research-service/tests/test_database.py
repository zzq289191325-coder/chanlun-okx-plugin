from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from chanlun_research.audit import audit_series, database_report
from chanlun_research.database import (
    backup_database,
    connect_database,
    integrity_check,
    migrate_database,
    restore_database,
)
from chanlun_research.models import CandleRecord
from chanlun_research.repository import load_backtest_candles, upsert_candles


class DatabaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database_path = Path(self.temporary.name) / "research.sqlite3"
        self.connection = connect_database(self.database_path)
        self.addCleanup(self.connection.close)
        migrate_database(self.connection)

    def candle(
        self,
        open_time: int,
        *,
        close: float = 101,
        closed: bool = True,
    ) -> CandleRecord:
        return CandleRecord(
            symbol="BTC-USDT-SWAP",
            timeframe="15m",
            open_time=open_time,
            close_time=open_time + 900_000,
            open=100,
            high=max(102, close),
            low=min(99, close),
            close=close,
            volume=10,
            closed=closed,
        )

    def test_applies_ordered_migrations_and_creates_required_tables(self) -> None:
        versions = [row[0] for row in self.connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
        self.assertEqual(versions, [1, 2, 3])
        tables = {
            row[0]
            for row in self.connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        self.assertTrue(
            {
                "instruments",
                "candles",
                "data_imports",
                "analysis_runs",
                "candidate_signals",
                "backtest_runs",
                "simulated_trades",
                "equity_snapshots",
                "news_events",
                "review_notes",
                "sync_tasks",
                "data_quality_issues",
            }.issubset(tables)
        )
        self.assertEqual(migrate_database(self.connection), [])

    def test_candle_upsert_updates_in_place_and_backtest_excludes_open_candle(self) -> None:
        with self.connection:
            upsert_candles(
                self.connection,
                [self.candle(0, close=101), self.candle(900_000, close=102, closed=False)],
                source="fixture",
                imported_at=1,
            )
            upsert_candles(
                self.connection,
                [self.candle(0, close=105)],
                source="fixture-update",
                imported_at=2,
            )
        count = self.connection.execute("SELECT COUNT(*) FROM candles").fetchone()[0]
        updated = self.connection.execute("SELECT close, source FROM candles WHERE open_time = 0").fetchone()
        backtest = load_backtest_candles(
            self.connection,
            "BTC-USDT-SWAP",
            "15m",
            data_cutoff=10_000_000,
        )
        self.assertEqual(count, 2)
        self.assertEqual((updated["close"], updated["source"]), (105, "fixture-update"))
        self.assertEqual([row["open_time"] for row in backtest], [0])

    def test_audit_reports_gaps_without_false_duplicates(self) -> None:
        with self.connection:
            upsert_candles(
                self.connection,
                [self.candle(0), self.candle(900_000), self.candle(2_700_000)],
                source="fixture",
            )
        audit = audit_series(self.connection, "BTC-USDT-SWAP", "15m")
        report = database_report(self.connection)
        self.assertEqual(audit.gap_count, 1)
        self.assertEqual(audit.missing_bars, 1)
        self.assertEqual(audit.duplicate_count, 0)
        self.assertEqual(audit.anomaly_count, 0)
        self.assertEqual(report["integrity"], "ok")

    def test_backup_and_restore_produce_an_integral_copy(self) -> None:
        with self.connection:
            upsert_candles(self.connection, [self.candle(0)], source="fixture")
        backup_path = Path(self.temporary.name) / "backup.sqlite3"
        restored_path = Path(self.temporary.name) / "restored.sqlite3"
        backup_database(self.connection, backup_path)
        restore_database(backup_path, restored_path)
        restored = connect_database(restored_path)
        try:
            self.assertEqual(integrity_check(restored), "ok")
            self.assertEqual(restored.execute("SELECT COUNT(*) FROM candles").fetchone()[0], 1)
        finally:
            restored.close()


if __name__ == "__main__":
    unittest.main()
