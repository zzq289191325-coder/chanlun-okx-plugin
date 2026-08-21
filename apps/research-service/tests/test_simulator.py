from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from chanlun_research.backtest_config import BacktestConfig
from chanlun_research.simulator import simulate_symbol

STEP = 900_000


def candle(index: int, *, open_price: float = 100, high: float = 101, low: float = 99, close: float = 100, closed: bool = True) -> dict[str, object]:
    return {
        "symbol": "TEST-USDT-SWAP",
        "timeframe": "15m",
        "openTime": index * STEP,
        "closeTime": (index + 1) * STEP,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": 100,
        "closed": closed,
    }


def opportunity(*, cutoff: int = STEP, stop: float = 98, target: float = 102) -> dict[str, object]:
    return {
        "opportunityId": "opportunity-1",
        "symbol": "TEST-USDT-SWAP",
        "side": "long",
        "candidateKind": "candidate_2_buy",
        "candidateLabel": "候选2买",
        "candidatePrice": 100,
        "locationTime": 0,
        "confirmedAt": cutoff,
        "dataCutoff": cutoff,
        "entryMin": 99.5,
        "entryMax": 100.5,
        "stop": stop,
        "target": target,
        "target2": 104,
        "plannedRiskReward": 2,
        "marketRegime": "TREND_UP",
        "ma40": 99,
        "atr": 1,
        "atrPercent": 1,
        "m30CandidateLabel": "候选2买",
        "m15CandidateLabel": "候选2买",
        "evidence": ["fixture"],
    }


class SimulatorTest(unittest.TestCase):
    def test_fills_only_at_the_next_candle_open_and_never_exceeds_capital(self) -> None:
        config = BacktestConfig(slippage_bps=0, funding_rate_per_8h=0)
        candles = [
            candle(0),
            candle(1, open_price=101, high=103, low=100, close=102),
            candle(2),
        ]
        result = simulate_symbol("TEST-USDT-SWAP", candles, [opportunity()], config)
        trade = result.trades[0]
        self.assertEqual(trade.entry_time, STEP)
        self.assertEqual(trade.entry_price, 101)
        self.assertLessEqual(
            trade.reserved_capital * (1 + config.fee_rate),
            config.initial_capital + 1e-9,
        )
        self.assertGreater(trade.realized_pnl, 0)

    def test_same_bar_conflict_defaults_to_stop_first_but_is_configurable(self) -> None:
        candles = [candle(0), candle(1, high=103, low=97, close=100)]
        stop_first = simulate_symbol(
            "TEST-USDT-SWAP",
            candles,
            [opportunity()],
            BacktestConfig(slippage_bps=0, funding_rate_per_8h=0),
        )
        target_first = simulate_symbol(
            "TEST-USDT-SWAP",
            candles,
            [opportunity()],
            BacktestConfig(
                slippage_bps=0,
                funding_rate_per_8h=0,
                intrabar_priority="target_first",
            ),
        )
        self.assertEqual(stop_first.trades[0].exit_reason, "stop_same_bar")
        self.assertEqual(target_first.trades[0].exit_reason, "target_same_bar")
        self.assertLess(stop_first.trades[0].realized_pnl, target_first.trades[0].realized_pnl)

    def test_open_candles_are_ignored_and_fees_slippage_funding_reduce_equity(self) -> None:
        candles = [candle(0), candle(1, high=103, low=99, close=102), candle(2, closed=False)]
        free = BacktestConfig(fee_rate=0, slippage_bps=0, funding_rate_per_8h=0)
        costly = replace(free, fee_rate=0.001, slippage_bps=5, funding_rate_per_8h=0.001)
        free_result = simulate_symbol("TEST-USDT-SWAP", candles, [opportunity()], free)
        costly_result = simulate_symbol("TEST-USDT-SWAP", candles, [opportunity()], costly)
        self.assertEqual(len(free_result.equity_curve), 2)
        self.assertLess(costly_result.metrics["final_equity"], free_result.metrics["final_equity"])
        self.assertGreater(costly_result.metrics["fees"], 0)
        self.assertGreater(costly_result.metrics["slippage_cost"], 0)
        self.assertGreater(costly_result.metrics["funding_estimate"], 0)

    def test_rejects_an_opportunity_emitted_before_confirmation(self) -> None:
        invalid = opportunity(cutoff=STEP)
        invalid["confirmedAt"] = STEP + 1
        with self.assertRaises(ValueError):
            simulate_symbol(
                "TEST-USDT-SWAP",
                [candle(0), candle(1)],
                [invalid],
                BacktestConfig(),
            )

    def test_parameter_sensitivity_variants_are_symmetric_and_deterministic(self) -> None:
        config = BacktestConfig(minimum_atr_percent=0.2, minimum_risk_reward=2, sensitivity_percent=0.1)
        variants = config.sensitivity_variants()
        self.assertAlmostEqual(variants["atr_lower"].minimum_atr_percent, 0.18)
        self.assertAlmostEqual(variants["atr_higher"].minimum_atr_percent, 0.22)
        self.assertAlmostEqual(variants["rr_lower"].minimum_risk_reward, 1.8)
        self.assertAlmostEqual(variants["rr_higher"].minimum_risk_reward, 2.2)
        candles = [candle(0), candle(1, high=103, low=99, close=102)]
        first = simulate_symbol("TEST-USDT-SWAP", candles, [opportunity()], config)
        second = simulate_symbol("TEST-USDT-SWAP", candles, [opportunity()], config)
        self.assertEqual(first.deterministic_payload(), second.deterministic_payload())


if __name__ == "__main__":
    unittest.main()
