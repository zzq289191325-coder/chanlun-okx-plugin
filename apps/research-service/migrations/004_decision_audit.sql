CREATE TABLE bar_decisions (
    decision_id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id) ON DELETE CASCADE,
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    execution_timeframe TEXT NOT NULL,
    candle_open_time INTEGER NOT NULL,
    candle_close_time INTEGER NOT NULL,
    data_cutoff INTEGER NOT NULL,
    visible_1d_cutoff INTEGER,
    visible_4h_cutoff INTEGER,
    visible_1h_cutoff INTEGER,
    visible_30m_cutoff INTEGER,
    visible_15m_cutoff INTEGER,
    daily_state TEXT NOT NULL,
    h4_state TEXT NOT NULL,
    h1_state TEXT NOT NULL,
    interval_nesting_state TEXT NOT NULL,
    market_regime TEXT NOT NULL,
    preferred_side TEXT,
    signal_state TEXT NOT NULL,
    score REAL NOT NULL,
    rejection_stage TEXT,
    rejection_reason TEXT,
    algorithm_version TEXT NOT NULL,
    UNIQUE(backtest_run_id, symbol, execution_timeframe, data_cutoff)
);

CREATE INDEX idx_bar_decisions_run_cutoff
    ON bar_decisions(backtest_run_id, data_cutoff);

CREATE TABLE observed_candidates (
    observed_candidate_id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id) ON DELETE CASCADE,
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    source_candidate_id TEXT NOT NULL,
    candidate_kind TEXT NOT NULL,
    candidate_label TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    location_time INTEGER NOT NULL,
    confirmed_at INTEGER NOT NULL,
    first_visible_cutoff INTEGER NOT NULL,
    price REAL NOT NULL,
    score REAL NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
    rejection_reason TEXT,
    UNIQUE(backtest_run_id, timeframe, source_candidate_id)
);

CREATE INDEX idx_observed_candidates_run_time
    ON observed_candidates(backtest_run_id, timeframe, confirmed_at);

CREATE TABLE interval_nesting_checks (
    nesting_check_id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id) ON DELETE CASCADE,
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    data_cutoff INTEGER NOT NULL,
    state TEXT NOT NULL,
    side TEXT,
    m30_candidate_id TEXT,
    m15_candidate_id TEXT,
    m30_confirmed_at INTEGER,
    m15_confirmed_at INTEGER,
    structure_low REAL,
    structure_high REAL,
    m15_price REAL,
    same_direction INTEGER,
    confirmation_order_valid INTEGER,
    inside_structure INTEGER,
    reason_json TEXT NOT NULL,
    UNIQUE(backtest_run_id, data_cutoff)
);

CREATE TABLE strategy_rejection_counts (
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    rejection_stage TEXT NOT NULL,
    rejected_count INTEGER NOT NULL,
    PRIMARY KEY(backtest_run_id, rejection_stage)
);

CREATE TABLE run_data_snapshots (
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    first_open_time INTEGER,
    last_close_time INTEGER,
    closed_candle_count INTEGER NOT NULL,
    data_hash TEXT NOT NULL,
    PRIMARY KEY(backtest_run_id, symbol, timeframe)
);

