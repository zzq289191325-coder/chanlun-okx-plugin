CREATE TABLE strategy_definitions (
    strategy_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    style TEXT NOT NULL CHECK (style IN ('AGGRESSIVE_INTERVAL', 'FUNDAMENTAL_POSITION')),
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL
);

CREATE TABLE strategy_versions (
    strategy_version_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategy_definitions(strategy_id),
    version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('CANDIDATE', 'PAPER', 'DEMO', 'LIVE', 'RETIRED')),
    config_json TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    git_commit TEXT,
    created_at INTEGER NOT NULL,
    approved_at INTEGER,
    UNIQUE(strategy_id, version)
);

CREATE TABLE strategy_allocations (
    allocation_id TEXT PRIMARY KEY,
    strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(strategy_version_id),
    account_mode TEXT NOT NULL CHECK (account_mode IN ('PAPER', 'DEMO', 'LIVE')),
    allocated_capital REAL NOT NULL,
    maximum_risk REAL NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL
);

CREATE TABLE fundamental_data_versions (
    fundamental_version_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    source TEXT NOT NULL,
    source_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    UNIQUE(symbol, source, source_version)
);

CREATE TABLE fundamental_observations (
    observation_id TEXT PRIMARY KEY,
    fundamental_version_id TEXT NOT NULL REFERENCES fundamental_data_versions(fundamental_version_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    metric TEXT NOT NULL,
    numeric_value REAL,
    text_value TEXT,
    effective_at INTEGER NOT NULL,
    published_at INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL,
    revision_at INTEGER,
    CHECK (recorded_at >= published_at)
);

CREATE INDEX idx_fundamental_point_in_time
    ON fundamental_observations(symbol, metric, recorded_at, revision_at);

CREATE TABLE optimizer_runs (
    optimizer_run_id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategy_definitions(strategy_id),
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'rejected')),
    method TEXT NOT NULL,
    random_seed INTEGER NOT NULL,
    search_space_json TEXT NOT NULL,
    train_start INTEGER NOT NULL,
    train_end INTEGER NOT NULL,
    validation_start INTEGER NOT NULL,
    validation_end INTEGER NOT NULL,
    test_start INTEGER NOT NULL,
    test_end INTEGER NOT NULL,
    git_commit TEXT,
    algorithm_version TEXT NOT NULL,
    data_hash TEXT NOT NULL,
    auxiliary_data_hash TEXT,
    cost_model_json TEXT NOT NULL,
    reliability_json TEXT,
    selected_trial_id TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
);

CREATE TABLE optimizer_trials (
    optimizer_trial_id TEXT PRIMARY KEY,
    optimizer_run_id TEXT NOT NULL REFERENCES optimizer_runs(optimizer_run_id) ON DELETE CASCADE,
    trial_index INTEGER NOT NULL,
    parameters_json TEXT NOT NULL,
    train_metrics_json TEXT NOT NULL,
    validation_metrics_json TEXT NOT NULL,
    test_metrics_json TEXT NOT NULL,
    robustness_json TEXT NOT NULL,
    accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
    rejection_reason TEXT,
    objective_score REAL,
    UNIQUE(optimizer_run_id, trial_index)
);

CREATE TABLE strategy_promotions (
    promotion_id TEXT PRIMARY KEY,
    strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(strategy_version_id),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    optimizer_run_id TEXT REFERENCES optimizer_runs(optimizer_run_id),
    approved_by TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    note TEXT NOT NULL
);

