CREATE TABLE broker_accounts (
    broker_account_id TEXT PRIMARY KEY,
    broker TEXT NOT NULL,
    account_mode TEXT NOT NULL CHECK (account_mode IN ('PAPER', 'DEMO', 'LIVE')),
    display_name TEXT NOT NULL,
    credential_target TEXT,
    api_key_fingerprint TEXT,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (account_mode = 'PAPER' OR credential_target IS NOT NULL)
);

CREATE TABLE order_intents (
    order_intent_id TEXT PRIMARY KEY,
    broker_account_id TEXT NOT NULL REFERENCES broker_accounts(broker_account_id),
    strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(strategy_version_id),
    account_mode TEXT NOT NULL CHECK (account_mode IN ('PAPER', 'DEMO', 'LIVE')),
    signal_id TEXT,
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    position_side TEXT NOT NULL CHECK (position_side IN ('long', 'short', 'net')),
    order_type TEXT NOT NULL,
    quantity TEXT NOT NULL,
    limit_price TEXT,
    reduce_only INTEGER NOT NULL DEFAULT 0 CHECK (reduce_only IN (0, 1)),
    candidate_label TEXT,
    location_time INTEGER,
    confirmed_at INTEGER,
    data_cutoff INTEGER,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE order_previews (
    order_preview_id TEXT PRIMARY KEY,
    order_intent_id TEXT NOT NULL REFERENCES order_intents(order_intent_id) ON DELETE CASCADE,
    risk_allowed INTEGER NOT NULL CHECK (risk_allowed IN (0, 1)),
    estimated_notional TEXT NOT NULL,
    estimated_fee TEXT NOT NULL,
    estimated_slippage TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE broker_orders (
    broker_order_id TEXT PRIMARY KEY,
    order_intent_id TEXT NOT NULL REFERENCES order_intents(order_intent_id),
    client_order_id TEXT NOT NULL UNIQUE,
    exchange_order_id TEXT,
    account_mode TEXT NOT NULL CHECK (account_mode IN ('PAPER', 'DEMO', 'LIVE')),
    status TEXT NOT NULL,
    request_at INTEGER NOT NULL,
    response_at INTEGER,
    last_exchange_update_at INTEGER,
    reconciliation_status TEXT NOT NULL DEFAULT 'pending',
    error_code TEXT,
    error_message TEXT
);

CREATE TABLE broker_fills (
    broker_fill_id TEXT PRIMARY KEY,
    broker_order_id TEXT NOT NULL REFERENCES broker_orders(broker_order_id) ON DELETE CASCADE,
    exchange_fill_id TEXT,
    fill_time INTEGER NOT NULL,
    price TEXT NOT NULL,
    quantity TEXT NOT NULL,
    fee TEXT NOT NULL,
    fee_currency TEXT,
    slippage_cost TEXT NOT NULL DEFAULT '0',
    funding_cost TEXT NOT NULL DEFAULT '0',
    UNIQUE(broker_order_id, exchange_fill_id)
);

CREATE TABLE position_snapshots (
    broker_account_id TEXT NOT NULL REFERENCES broker_accounts(broker_account_id),
    strategy_version_id TEXT REFERENCES strategy_versions(strategy_version_id),
    symbol TEXT NOT NULL REFERENCES instruments(symbol),
    position_side TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    quantity TEXT NOT NULL,
    average_price TEXT NOT NULL,
    mark_price TEXT NOT NULL,
    unrealized_pnl TEXT NOT NULL,
    PRIMARY KEY(broker_account_id, strategy_version_id, symbol, position_side, timestamp)
);

CREATE TABLE reconciliation_runs (
    reconciliation_run_id TEXT PRIMARY KEY,
    broker_account_id TEXT NOT NULL REFERENCES broker_accounts(broker_account_id),
    status TEXT NOT NULL,
    local_open_orders INTEGER NOT NULL,
    remote_open_orders INTEGER NOT NULL,
    discrepancies_json TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error TEXT
);

CREATE TABLE risk_events (
    risk_event_id TEXT PRIMARY KEY,
    broker_account_id TEXT REFERENCES broker_accounts(broker_account_id),
    order_intent_id TEXT REFERENCES order_intents(order_intent_id),
    strategy_version_id TEXT REFERENCES strategy_versions(strategy_version_id),
    severity TEXT NOT NULL,
    rule TEXT NOT NULL,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    detail_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE kill_switch_events (
    kill_switch_event_id TEXT PRIMARY KEY,
    broker_account_id TEXT REFERENCES broker_accounts(broker_account_id),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    scope TEXT NOT NULL,
    reason TEXT NOT NULL,
    activated_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

