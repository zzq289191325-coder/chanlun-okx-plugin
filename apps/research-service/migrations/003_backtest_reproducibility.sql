ALTER TABLE analysis_runs ADD COLUMN backtest_run_id TEXT REFERENCES backtest_runs(backtest_run_id);

ALTER TABLE candidate_signals ADD COLUMN data_cutoff INTEGER;
ALTER TABLE candidate_signals ADD COLUMN market_regime TEXT;

ALTER TABLE backtest_runs ADD COLUMN result_signature TEXT;
ALTER TABLE backtest_runs ADD COLUMN reliability_json TEXT;

ALTER TABLE simulated_trades ADD COLUMN opportunity_id TEXT;
ALTER TABLE simulated_trades ADD COLUMN candidate_label TEXT;
ALTER TABLE simulated_trades ADD COLUMN signal_confirmed_at INTEGER;
ALTER TABLE simulated_trades ADD COLUMN data_cutoff INTEGER;
ALTER TABLE simulated_trades ADD COLUMN stop_price REAL;
ALTER TABLE simulated_trades ADD COLUMN target_price REAL;
ALTER TABLE simulated_trades ADD COLUMN reserved_capital REAL;
ALTER TABLE simulated_trades ADD COLUMN gross_pnl REAL;
ALTER TABLE simulated_trades ADD COLUMN slippage_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE simulated_trades ADD COLUMN market_regime TEXT;
ALTER TABLE simulated_trades ADD COLUMN entry_basis TEXT;

CREATE INDEX idx_backtest_runs_signature ON backtest_runs(data_hash, result_signature);
CREATE INDEX idx_simulated_trades_run_entry ON simulated_trades(backtest_run_id, entry_time);
