CREATE TABLE ml_feature_sets (
    feature_set_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    feature_names_json TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(name, version)
);

CREATE TABLE ml_training_runs (
    training_run_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL CHECK (account_id IN ('paper-aggressive', 'paper-fundamental')),
    feature_set_id TEXT NOT NULL REFERENCES ml_feature_sets(feature_set_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    training_start INTEGER NOT NULL,
    training_end INTEGER NOT NULL,
    embargo_bars INTEGER NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    data_hash TEXT NOT NULL,
    git_commit TEXT,
    parameters_json TEXT NOT NULL,
    metrics_json TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
);

CREATE TABLE ml_model_versions (
    model_version_id TEXT PRIMARY KEY,
    training_run_id TEXT NOT NULL REFERENCES ml_training_runs(training_run_id),
    account_id TEXT NOT NULL CHECK (account_id IN ('paper-aggressive', 'paper-fundamental')),
    model_type TEXT NOT NULL,
    version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('challenger', 'champion', 'retired', 'rejected')),
    artifact_path TEXT NOT NULL,
    artifact_hash TEXT NOT NULL,
    feature_schema_hash TEXT NOT NULL,
    trained_through INTEGER NOT NULL,
    promoted_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(account_id, version)
);

CREATE UNIQUE INDEX idx_ml_one_champion_per_account
    ON ml_model_versions(account_id) WHERE state = 'champion';

CREATE TABLE ml_predictions (
    prediction_id TEXT PRIMARY KEY,
    model_version_id TEXT NOT NULL REFERENCES ml_model_versions(model_version_id),
    account_id TEXT NOT NULL,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    timeframe TEXT NOT NULL,
    feature_cutoff INTEGER NOT NULL,
    generated_at INTEGER NOT NULL,
    long_probability REAL NOT NULL CHECK (long_probability BETWEEN 0 AND 1),
    short_probability REAL NOT NULL CHECK (short_probability BETWEEN 0 AND 1),
    hold_probability REAL NOT NULL CHECK (hold_probability BETWEEN 0 AND 1),
    decision TEXT NOT NULL CHECK (decision IN ('LONG_CANDIDATE', 'SHORT_CANDIDATE', 'HOLD', 'CLOSE_CANDIDATE')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED')),
    explanation_json TEXT NOT NULL,
    feature_values_json TEXT NOT NULL,
    data_quality_json TEXT NOT NULL,
    UNIQUE(model_version_id, symbol, feature_cutoff)
);

CREATE TABLE ml_prediction_outcomes (
    prediction_id TEXT PRIMARY KEY REFERENCES ml_predictions(prediction_id) ON DELETE CASCADE,
    outcome_cutoff INTEGER NOT NULL,
    realized_return REAL NOT NULL,
    realized_class TEXT NOT NULL CHECK (realized_class IN ('long', 'short', 'hold')),
    evaluated_at INTEGER NOT NULL
);

CREATE TABLE ml_promotion_runs (
    promotion_run_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    challenger_model_id TEXT NOT NULL REFERENCES ml_model_versions(model_version_id),
    champion_model_id TEXT REFERENCES ml_model_versions(model_version_id),
    approved INTEGER NOT NULL CHECK (approved IN (0, 1)),
    gates_json TEXT NOT NULL,
    comparison_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE ml_drift_reports (
    drift_report_id TEXT PRIMARY KEY,
    model_version_id TEXT NOT NULL REFERENCES ml_model_versions(model_version_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    data_cutoff INTEGER NOT NULL,
    drift_score REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'blocked')),
    details_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE ml_data_quality_reports (
    quality_report_id TEXT PRIMARY KEY,
    training_run_id TEXT REFERENCES ml_training_runs(training_run_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    data_cutoff INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'blocked')),
    closed_candle_count INTEGER NOT NULL,
    open_candle_count INTEGER NOT NULL,
    gap_count INTEGER NOT NULL,
    duplicate_count INTEGER NOT NULL,
    future_leak_count INTEGER NOT NULL,
    details_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE paper_decision_events (
    paper_decision_event_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    model_version_id TEXT REFERENCES ml_model_versions(model_version_id),
    prediction_id TEXT REFERENCES ml_predictions(prediction_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    decision TEXT NOT NULL,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    reason TEXT NOT NULL,
    risk_checks_json TEXT NOT NULL,
    data_cutoff INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE ml_runtime_settings (
    account_id TEXT PRIMARY KEY CHECK (account_id IN ('paper-aggressive', 'paper-fundamental')),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    last_scheduler_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE public_funding_rates (
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    funding_time INTEGER NOT NULL,
    funding_rate REAL NOT NULL,
    source TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    PRIMARY KEY(symbol, funding_time)
);

CREATE TABLE public_open_interest_snapshots (
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    observed_at INTEGER NOT NULL,
    open_interest REAL NOT NULL,
    source TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    PRIMARY KEY(symbol, observed_at)
);

CREATE INDEX idx_ml_predictions_latest ON ml_predictions(account_id, symbol, generated_at DESC);
CREATE INDEX idx_ml_training_runs_latest ON ml_training_runs(account_id, started_at DESC);
CREATE INDEX idx_paper_decisions_latest ON paper_decision_events(account_id, created_at DESC);

INSERT INTO ml_runtime_settings(account_id, enabled, updated_at) VALUES
    ('paper-aggressive', 0, CAST(strftime('%s','now') AS INTEGER) * 1000),
    ('paper-fundamental', 0, CAST(strftime('%s','now') AS INTEGER) * 1000);
