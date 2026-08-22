CREATE TABLE paper_account_snapshots (
    snapshot_id TEXT PRIMARY KEY,
    broker_account_id TEXT NOT NULL REFERENCES broker_accounts(broker_account_id),
    timestamp INTEGER NOT NULL,
    initial_capital TEXT NOT NULL,
    cash TEXT NOT NULL,
    equity TEXT NOT NULL,
    state_json TEXT NOT NULL,
    state_hash TEXT NOT NULL
);

CREATE INDEX idx_paper_account_snapshots_latest
    ON paper_account_snapshots(broker_account_id, timestamp DESC);

CREATE TABLE broker_connections (
    broker_connection_id TEXT PRIMARY KEY,
    broker_account_id TEXT NOT NULL REFERENCES broker_accounts(broker_account_id),
    status TEXT NOT NULL,
    read_only INTEGER NOT NULL CHECK (read_only IN (0, 1)),
    websocket_connected INTEGER NOT NULL CHECK (websocket_connected IN (0, 1)),
    connected_at INTEGER,
    disconnected_at INTEGER,
    last_health_at INTEGER,
    message TEXT NOT NULL
);
