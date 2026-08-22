from __future__ import annotations

import sys
import tempfile
import unittest
import urllib.parse
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from chanlun_research.database import connect_database, migrate_database
from chanlun_research.okx_public import (
    FUNDING_RATE_HISTORY_PATH,
    HISTORY_CANDLES_PATH,
    OPEN_INTEREST_PATH,
    OkxPublicHistoryClient,
)
from chanlun_research.repository import load_sync_tasks, seed_sync_tasks
from chanlun_research.sync_service import sync_task


def row(timestamp: int, close: float = 101, confirm: str = "1") -> list[str]:
    return [str(timestamp), "100", "102", "99", str(close), "10", "0", "0", confirm]


class PagingClient:
    def __init__(self) -> None:
        self.after_values: list[int | None] = []

    def get_history_candles(
        self,
        _symbol: str,
        _timeframe: str,
        *,
        limit: int,
        after: int | None = None,
        before: int | None = None,
    ) -> list[list[str]]:
        del limit, before
        self.after_values.append(after)
        if after is None:
            return [row(1_800_000), row(900_000)]
        if after == 900_000:
            return [row(0)]
        return []


class OkxSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.connection = connect_database(Path(self.temporary.name) / "research.sqlite3")
        self.addCleanup(self.connection.close)
        migrate_database(self.connection)
        self.config = Path(self.temporary.name) / "tasks.json"
        self.config.write_text(
            '{"symbols":["BTC-USDT-SWAP"],"timeframes":["15m"],"source":"okx_public_history"}',
            encoding="utf-8",
        )
        with self.connection:
            seed_sync_tasks(self.connection, self.config)

    def test_client_uses_only_public_history_endpoint_without_credentials(self) -> None:
        requested: list[str] = []

        def transport(url: str) -> dict[str, object]:
            requested.append(url)
            return {"code": "0", "msg": "", "data": [row(0)]}

        client = OkxPublicHistoryClient(transport=transport)
        candles = client.get_history_candles("BTC-USDT-SWAP", "15m", after=123, limit=500)
        parsed = urllib.parse.urlparse(requested[0])
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(parsed.path, HISTORY_CANDLES_PATH)
        self.assertEqual(query["after"], ["123"])
        self.assertEqual(query["limit"], ["300"])
        self.assertNotIn("apiKey", requested[0])
        self.assertNotIn("trade", parsed.path)
        self.assertEqual(len(candles), 1)

    def test_context_endpoints_are_public_allowlisted_and_have_no_credentials(self) -> None:
        requested: list[str] = []

        def transport(url: str) -> dict[str, object]:
            requested.append(url)
            return {"code": "0", "msg": "", "data": []}

        client = OkxPublicHistoryClient(transport=transport)
        client.get_funding_rate_history("BTC-USDT-SWAP")
        client.get_open_interest("BTC-USDT-SWAP")
        self.assertEqual(
            [urllib.parse.urlparse(item).path for item in requested],
            [FUNDING_RATE_HISTORY_PATH, OPEN_INTEREST_PATH],
        )
        self.assertTrue(all("apiKey" not in item and "/trade/" not in item for item in requested))

    def test_backfill_persists_cursor_and_resumes_without_duplicates(self) -> None:
        task = load_sync_tasks(self.connection)[0]
        client = PagingClient()
        first = sync_task(
            self.connection,
            client,  # type: ignore[arg-type]
            task,
            maximum_pages=2,
            page_size=2,
        )
        refreshed = load_sync_tasks(self.connection)[0]
        second = sync_task(
            self.connection,
            client,  # type: ignore[arg-type]
            refreshed,
            maximum_pages=1,
            page_size=2,
        )
        count = self.connection.execute("SELECT COUNT(*) FROM candles").fetchone()[0]
        imports = self.connection.execute(
            "SELECT status, rows_upserted FROM data_imports ORDER BY started_at, import_id"
        ).fetchall()
        self.assertEqual(first.status, "success")
        self.assertEqual(first.cursor_after, 0)
        self.assertEqual(second.rows_upserted, 0)
        self.assertEqual(count, 3)
        self.assertTrue(all(item["status"] == "success" for item in imports))

    def test_failed_download_does_not_change_existing_candles(self) -> None:
        task = load_sync_tasks(self.connection)[0]

        class FailedClient:
            def get_history_candles(self, *_args: object, **_kwargs: object) -> list[list[str]]:
                raise RuntimeError("network unavailable")

        result = sync_task(
            self.connection,
            FailedClient(),  # type: ignore[arg-type]
            task,
            maximum_pages=1,
        )
        self.assertEqual(result.status, "failed")
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM candles").fetchone()[0], 0)
        status = self.connection.execute("SELECT status FROM data_imports").fetchone()[0]
        self.assertEqual(status, "failed")


if __name__ == "__main__":
    unittest.main()
