from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from typing import Any

OKX_PUBLIC_BASE_URL = "https://www.okx.com"
HISTORY_CANDLES_PATH = "/api/v5/market/history-candles"

Transport = Callable[[str], Mapping[str, Any]]


class OkxPublicMarketError(RuntimeError):
    pass


class OkxPublicHistoryClient:
    def __init__(
        self,
        *,
        transport: Transport | None = None,
        timeout_seconds: float = 10,
        retries: int = 2,
        minimum_interval_seconds: float = 0.12,
    ) -> None:
        self._transport = transport or self._request_json
        self._timeout_seconds = timeout_seconds
        self._retries = retries
        self._minimum_interval_seconds = minimum_interval_seconds
        self._last_request_at = 0.0

    def get_history_candles(
        self,
        symbol: str,
        timeframe: str,
        *,
        limit: int = 300,
        after: int | None = None,
        before: int | None = None,
    ) -> list[Sequence[str]]:
        query = {
            "instId": symbol,
            "bar": timeframe,
            "limit": str(max(1, min(300, limit))),
        }
        if after is not None:
            query["after"] = str(after)
        if before is not None:
            query["before"] = str(before)
        url = f"{OKX_PUBLIC_BASE_URL}{HISTORY_CANDLES_PATH}?{urllib.parse.urlencode(query)}"
        payload = self._transport(url)
        if str(payload.get("code")) != "0":
            raise OkxPublicMarketError(
                f"OKX public market error: {payload.get('msg') or payload.get('code')}"
            )
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise OkxPublicMarketError("OKX public market response has invalid data")
        return rows

    def _request_json(self, url: str) -> Mapping[str, Any]:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "www.okx.com" or parsed.path != HISTORY_CANDLES_PATH:
            raise OkxPublicMarketError("Only the OKX public history-candles endpoint is allowed")
        last_error: Exception | None = None
        for attempt in range(self._retries + 1):
            delay = self._minimum_interval_seconds - (time.monotonic() - self._last_request_at)
            if delay > 0:
                time.sleep(delay)
            request = urllib.request.Request(
                url,
                method="GET",
                headers={
                    "Accept": "application/json",
                    "User-Agent": "chanlun-okx-local-research/1.1",
                },
            )
            try:
                self._last_request_at = time.monotonic()
                with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                last_error = error
                retryable = error.code == 429 or error.code >= 500
                if not retryable or attempt >= self._retries:
                    break
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = error
                if attempt >= self._retries:
                    break
            time.sleep(min(2.0, 0.15 * (2**attempt)))
        raise OkxPublicMarketError(f"OKX public market request failed: {last_error}")
