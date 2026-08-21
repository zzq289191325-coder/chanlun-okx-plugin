CREATE TABLE instruments (
    symbol TEXT PRIMARY KEY,
    base_currency TEXT,
    quote_currency TEXT,
    instrument_type TEXT NOT NULL DEFAULT 'SWAP',
    display_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE candles (
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL CHECK (timeframe IN ('1D', '4H', '1H', '30m', '15m')),
    open_time INTEGER NOT NULL,
    close_time INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL,
    closed INTEGER NOT NULL CHECK (closed IN (0, 1)),
    source TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, timeframe, open_time),
    CHECK (open_time < close_time),
    CHECK (high >= low),
    CHECK (high >= open AND high >= close),
    CHECK (low <= open AND low <= close),
    CHECK (volume >= 0)
);

CREATE INDEX idx_candles_series_close
    ON candles(symbol, timeframe, close_time);

CREATE INDEX idx_candles_backtest
    ON candles(symbol, timeframe, closed, close_time);

CREATE TABLE data_imports (
    import_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    source TEXT NOT NULL,
    mode TEXT NOT NULL,
    requested_start INTEGER,
    requested_end INTEGER,
    cursor_after INTEGER,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    rows_received INTEGER NOT NULL DEFAULT 0,
    rows_upserted INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
);

CREATE TABLE analysis_runs (
    analysis_run_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    data_cutoff INTEGER NOT NULL,
    algorithm_version TEXT NOT NULL,
    config_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
);

CREATE TABLE candidate_signals (
    signal_id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(analysis_run_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN (
        'candidate_1_buy', 'candidate_2_buy', 'candidate_3_buy',
        'candidate_1_sell', 'candidate_2_sell', 'candidate_3_sell'
    )),
    label TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    location_time INTEGER NOT NULL,
    confirmed_at INTEGER NOT NULL,
    price REAL NOT NULL,
    score REAL NOT NULL,
    evidence_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    CHECK (confirmed_at >= location_time)
);

CREATE INDEX idx_candidate_signals_point_in_time
    ON candidate_signals(symbol, timeframe, confirmed_at);

CREATE TABLE backtest_runs (
    backtest_run_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    initial_capital REAL NOT NULL,
    strategy_version TEXT NOT NULL,
    git_commit TEXT,
    data_hash TEXT,
    random_seed INTEGER,
    data_start INTEGER NOT NULL,
    data_end INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    metrics_json TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
);

CREATE TABLE simulated_trades (
    trade_id TEXT PRIMARY KEY,
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    signal_id TEXT REFERENCES candidate_signals(signal_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    side TEXT NOT NULL CHECK (side IN ('long', 'short')),
    entry_time INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    exit_time INTEGER,
    exit_price REAL,
    quantity REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    funding_estimate REAL NOT NULL DEFAULT 0,
    realized_pnl REAL,
    exit_reason TEXT,
    is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1))
);

CREATE TABLE equity_snapshots (
    backtest_run_id TEXT NOT NULL REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    timestamp INTEGER NOT NULL,
    equity REAL NOT NULL,
    cash REAL NOT NULL,
    unrealized_pnl REAL NOT NULL,
    drawdown REAL NOT NULL,
    PRIMARY KEY (backtest_run_id, timestamp)
);

CREATE TABLE news_events (
    news_event_id TEXT PRIMARY KEY,
    symbol TEXT REFERENCES instruments(symbol),
    headline TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'local_manual',
    published_at INTEGER NOT NULL,
    event_at INTEGER,
    recorded_at INTEGER NOT NULL,
    impact_bias TEXT NOT NULL CHECK (impact_bias IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL', 'MIXED')),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    notes TEXT
);

CREATE TABLE review_notes (
    review_note_id TEXT PRIMARY KEY,
    backtest_run_id TEXT REFERENCES backtest_runs(backtest_run_id) ON DELETE CASCADE,
    trade_id TEXT REFERENCES simulated_trades(trade_id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
