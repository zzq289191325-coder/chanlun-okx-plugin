from __future__ import annotations

import sqlite3
from typing import Any

from .okx_public import OkxPublicHistoryClient
from .repository import utc_milliseconds


def sync_public_context(
    connection: sqlite3.Connection,
    client: OkxPublicHistoryClient,
    symbols: list[str],
) -> dict[str, Any]:
    """Persist public-only funding and open-interest observations atomically per symbol."""
    results = []
    for symbol in symbols:
        funding_rows = client.get_funding_rate_history(symbol)
        oi_rows = client.get_open_interest(symbol)
        now = utc_milliseconds()
        with connection:
            funding_count = 0
            for row in funding_rows:
                funding_time = int(str(row.get("fundingTime", "0")))
                funding_rate = float(str(row.get("fundingRate", "0")))
                if funding_time <= 0:
                    continue
                connection.execute(
                    "INSERT INTO public_funding_rates(symbol,funding_time,funding_rate,source,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(symbol,funding_time) DO UPDATE SET funding_rate=excluded.funding_rate,imported_at=excluded.imported_at",
                    (symbol, funding_time, funding_rate, "OKX_PUBLIC_REST", now),
                )
                funding_count += 1
            oi_count = 0
            for row in oi_rows:
                observed_at = int(str(row.get("ts", now)))
                open_interest = float(str(row.get("oi", "0")))
                if observed_at <= 0 or open_interest < 0:
                    continue
                connection.execute(
                    "INSERT INTO public_open_interest_snapshots(symbol,observed_at,open_interest,source,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(symbol,observed_at) DO UPDATE SET open_interest=excluded.open_interest,imported_at=excluded.imported_at",
                    (symbol, observed_at, open_interest, "OKX_PUBLIC_REST", now),
                )
                oi_count += 1
        results.append({"symbol": symbol, "funding_rows": funding_count, "open_interest_rows": oi_count})
    return {"source": "OKX public REST only", "credentials_used": False, "results": results}
