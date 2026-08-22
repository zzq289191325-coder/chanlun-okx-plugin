CREATE TABLE desktop_settings (
    setting_key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE research_watchlist (
    symbol TEXT PRIMARY KEY REFERENCES instruments(symbol),
    sort_order INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO research_watchlist(symbol, sort_order, enabled, updated_at)
SELECT symbol, ROW_NUMBER() OVER (ORDER BY symbol), 1, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM instruments;
