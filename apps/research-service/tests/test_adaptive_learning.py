from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from chanlun_research.adaptive_learning import (
    PROFILES,
    PointInTimeSeries,
    _build_samples,
    _feature_vector,
    audit_learning,
    evaluate_pending_outcomes,
    evaluate_promotion,
    rollback_champion,
    train_and_evaluate,
    walk_forward,
)
from chanlun_research.database import connect_database, migrate_database


INTERVALS = {"15m": 900_000, "30m": 1_800_000, "4H": 14_400_000, "1D": 86_400_000}


class AdaptiveLearningTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.connection = connect_database(Path(self.temporary.name) / "research.sqlite3")
        self.addCleanup(self.connection.close)
        migrate_database(self.connection)
        now = 1_700_000_000_000
        with self.connection:
            self.connection.execute(
                "INSERT INTO instruments(symbol,base_currency,quote_currency,instrument_type,enabled,created_at,updated_at) VALUES('TEST-USDT-SWAP','TEST','USDT','SWAP',1,?,?)",
                (now, now),
            )
            for timeframe, interval in INTERVALS.items():
                count = 260 if timeframe == "15m" else 160
                for index in range(count):
                    open_time = now - count * interval + index * interval
                    close = 100 + index * 0.04 + math.sin(index / 5) * 1.8
                    self.connection.execute(
                        "INSERT INTO candles(symbol,timeframe,open_time,close_time,open,high,low,close,volume,closed,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,1,'fixture',?)",
                        ('TEST-USDT-SWAP', timeframe, open_time, open_time + interval, close - 0.1, close + 0.7, close - 0.7, close, 100 + index, now),
                    )

    def test_future_news_and_candles_do_not_change_prefix_features(self) -> None:
        profile = PROFILES["paper-aggressive"]
        samples, series = _build_samples(self.connection, "TEST-USDT-SWAP", profile)
        cutoff = int(samples[30]["cutoff"])
        before, _ = _feature_vector(self.connection, series, profile, cutoff)
        with self.connection:
            self.connection.execute(
                "INSERT INTO news_events(news_event_id,symbol,headline,source,published_at,recorded_at,impact_bias,risk_level) VALUES('future','TEST-USDT-SWAP','future','fixture',?,?, 'POSITIVE','HIGH')",
                (cutoff + 1, cutoff + 1),
            )
            last = series.rows["15m"][-1]
            self.connection.execute(
                "UPDATE candles SET close=close*1.5,high=high*1.5 WHERE symbol='TEST-USDT-SWAP' AND timeframe='15m' AND open_time=?",
                (last["open_time"],),
            )
        after, _ = _feature_vector(self.connection, PointInTimeSeries(self.connection, "TEST-USDT-SWAP"), profile, cutoff)
        self.assertEqual(before, after)

    def test_training_creates_challenger_and_does_not_auto_promote(self) -> None:
        result = train_and_evaluate(
            self.connection,
            account_id="paper-aggressive",
            symbol="TEST-USDT-SWAP",
            model_dir=Path(self.temporary.name) / "models",
            auto_promote=False,
        )
        self.assertEqual(result["state"], "challenger")
        self.assertFalse(result["promotion"]["approved"])
        self.assertEqual(result["metrics"]["future_leak_count"], 0)
        row = self.connection.execute("SELECT state,artifact_path FROM ml_model_versions").fetchone()
        self.assertEqual(row["state"], "challenger")
        self.assertTrue(Path(row["artifact_path"]).is_file())
        prediction = self.connection.execute("SELECT feature_cutoff,generated_at,data_quality_json FROM ml_predictions").fetchone()
        self.assertLessEqual(prediction["feature_cutoff"], prediction["generated_at"])
        self.assertTrue(json.loads(prediction["data_quality_json"])["closed_only"])
        decision = self.connection.execute("SELECT allowed,reason FROM paper_decision_events").fetchone()
        self.assertEqual(decision["allowed"], 0)
        self.assertIn("champion", decision["reason"])
        self.assertTrue(audit_learning(self.connection)["safe"])
        latest = self.connection.execute("SELECT MAX(open_time) FROM candles WHERE symbol='TEST-USDT-SWAP' AND timeframe='15m'").fetchone()[0]
        with self.connection:
            for offset in range(1, 5):
                open_time = latest + offset * INTERVALS["15m"]
                close = 112 + offset
                self.connection.execute(
                    "INSERT INTO candles(symbol,timeframe,open_time,close_time,open,high,low,close,volume,closed,source,imported_at) VALUES(?,?,?,?,?,?,?,?,?,1,'outcome',?)",
                    ('TEST-USDT-SWAP', '15m', open_time, open_time + INTERVALS['15m'], close - 0.2, close + 0.5, close - 0.5, close, 100, 1_700_000_000_000),
                )
        self.assertEqual(evaluate_pending_outcomes(self.connection), 1)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ml_prediction_outcomes").fetchone()[0], 1)

    def test_walk_forward_uses_embargo_and_nonoverlapping_cutoffs(self) -> None:
        result = walk_forward(self.connection, account_id="paper-aggressive", symbol="TEST-USDT-SWAP", folds=3)
        for fold in result["folds"]:
            self.assertGreater(fold["test_start"], fold["train_end"])
            self.assertEqual(fold["embargo_bars"], PROFILES["paper-aggressive"].horizon_bars)

    def test_repeated_training_is_deterministic_and_champion_can_roll_back(self) -> None:
        first = train_and_evaluate(self.connection, account_id="paper-aggressive", symbol="TEST-USDT-SWAP", model_dir=Path(self.temporary.name) / "models")
        second = train_and_evaluate(self.connection, account_id="paper-aggressive", symbol="TEST-USDT-SWAP", model_dir=Path(self.temporary.name) / "models")
        first_row = self.connection.execute("SELECT artifact_path FROM ml_model_versions WHERE model_version_id=?", (first["model_version_id"],)).fetchone()
        second_row = self.connection.execute("SELECT artifact_path FROM ml_model_versions WHERE model_version_id=?", (second["model_version_id"],)).fetchone()
        first_model = json.loads(Path(first_row["artifact_path"]).read_text(encoding="utf-8"))
        second_model = json.loads(Path(second_row["artifact_path"]).read_text(encoding="utf-8"))
        self.assertEqual(first_model["weights"], second_model["weights"])
        self.assertEqual(first_model["metrics"], second_model["metrics"])
        with self.connection:
            passing = {"sample_count": 30, "future_leak_count": 0, "macro_f1": 0.5, "accuracy": 0.6, "baseline": {"accuracy": 0.4}, "log_loss": 0.9, "maximum_drawdown_percent": 10, "trade_count": 20}
            self.connection.execute("UPDATE ml_training_runs SET metrics_json=? WHERE training_run_id=?", (json.dumps(passing), first["training_run_id"]))
            promoted = evaluate_promotion(self.connection, account_id="paper-aggressive", challenger_model_id=first["model_version_id"], auto_promote=True)
            self.assertTrue(promoted["approved"])
            self.connection.execute("UPDATE ml_model_versions SET state='retired' WHERE model_version_id=?", (first["model_version_id"],))
            self.connection.execute("UPDATE ml_model_versions SET state='champion' WHERE model_version_id=?", (second["model_version_id"],))
            result = rollback_champion(self.connection, account_id="paper-aggressive", target_model_id=first["model_version_id"])
        self.assertEqual(result["champion_model_id"], first["model_version_id"])
        states = {row["model_version_id"]: row["state"] for row in self.connection.execute("SELECT model_version_id,state FROM ml_model_versions")}
        self.assertEqual(states[first["model_version_id"]], "champion")
        self.assertEqual(states[second["model_version_id"]], "retired")


if __name__ == "__main__":
    unittest.main()
