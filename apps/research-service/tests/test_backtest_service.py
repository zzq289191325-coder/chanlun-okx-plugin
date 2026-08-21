from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from chanlun_research.backtest_config import BacktestConfig
from chanlun_research.backtest_service import run_single_backtest
from chanlun_research.database import connect_database, migrate_database
from chanlun_research.models import CandleRecord, TIMEFRAME_MILLISECONDS
from chanlun_research.repository import upsert_candles


class BacktestServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.connection = connect_database(Path(self.temporary.name) / "research.sqlite3")
        self.addCleanup(self.connection.close)
        migrate_database(self.connection)
        with self.connection:
            for timeframe, duration in TIMEFRAME_MILLISECONDS.items():
                count = 4 if timeframe != "15m" else 6
                candles = [
                    CandleRecord(
                        symbol="TEST-USDT-SWAP",
                        timeframe=timeframe,
                        open_time=index * duration,
                        close_time=(index + 1) * duration,
                        open=100,
                        high=103,
                        low=99,
                        close=101,
                        volume=100,
                        closed=True,
                    )
                    for index in range(count)
                ]
                upsert_candles(self.connection, candles, source="fixture", imported_at=1)

    @staticmethod
    def bridge(bundle: dict[str, list[dict[str, object]]], _config: dict[str, object]) -> dict[str, object]:
        cutoff = int(bundle["15m"][1]["closeTime"])
        return {
            "algorithmVersion": "fixture-algorithm",
            "strategyVersion": "fixture-strategy",
            "diagnostics": {"executionBars": len(bundle["15m"]), "evaluatedBars": 1},
            "opportunities": [
                {
                    "opportunityId": "fixture-opportunity",
                    "symbol": "TEST-USDT-SWAP",
                    "side": "long",
                    "candidateKind": "candidate_2_buy",
                    "candidateLabel": "候选2买",
                    "candidatePrice": 101,
                    "locationTime": 0,
                    "confirmedAt": cutoff,
                    "dataCutoff": cutoff,
                    "entryMin": 100,
                    "entryMax": 102,
                    "stop": 98,
                    "target": 102,
                    "target2": 104,
                    "plannedRiskReward": 2,
                    "marketRegime": "TREND_UP",
                    "ma40": 100,
                    "atr": 1,
                    "atrPercent": 1,
                    "m30CandidateLabel": "候选2买",
                    "m15CandidateLabel": "候选2买",
                    "evidence": ["fixture"],
                }
            ],
        }

    def test_repeated_runs_keep_identical_data_and_result_signatures(self) -> None:
        config = BacktestConfig(
            slippage_bps=0,
            funding_rate_per_8h=0,
            sensitivity_percent=0,
        )
        report_dir = Path(self.temporary.name) / "reports"
        first = run_single_backtest(
            self.connection,
            symbol="TEST-USDT-SWAP",
            config=config,
            name="fixture",
            report_dir=report_dir,
            bridge_runner=self.bridge,
        )
        second = run_single_backtest(
            self.connection,
            symbol="TEST-USDT-SWAP",
            config=config,
            name="fixture",
            report_dir=report_dir,
            bridge_runner=self.bridge,
        )
        self.assertEqual(first.data_hash, second.data_hash)
        self.assertEqual(first.result_signature, second.result_signature)
        self.assertNotEqual(first.run_id, second.run_id)
        self.assertTrue(Path(first.report_path).is_file())
        runs = self.connection.execute("SELECT status, data_hash, result_signature FROM backtest_runs").fetchall()
        self.assertEqual(len(runs), 2)
        self.assertTrue(all(row["status"] == "success" for row in runs))
        trades = self.connection.execute(
            "SELECT signal_confirmed_at, data_cutoff, entry_time FROM simulated_trades"
        ).fetchall()
        self.assertTrue(all(row["signal_confirmed_at"] <= row["data_cutoff"] <= row["entry_time"] for row in trades))


if __name__ == "__main__":
    unittest.main()
