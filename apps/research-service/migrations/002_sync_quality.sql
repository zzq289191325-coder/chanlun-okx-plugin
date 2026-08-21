CREATE TABLE sync_tasks (
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'okx_public_history',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    cursor_after INTEGER,
    last_success_at INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, timeframe)
);

CREATE TABLE data_quality_issues (
    issue_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    issue_type TEXT NOT NULL,
    start_time INTEGER,
    end_time INTEGER,
    detail TEXT NOT NULL,
    detected_at INTEGER NOT NULL,
    resolved_at INTEGER
);

CREATE INDEX idx_quality_open_issues
    ON data_quality_issues(symbol, timeframe, resolved_at, detected_at);
