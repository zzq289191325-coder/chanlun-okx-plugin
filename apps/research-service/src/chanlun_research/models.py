from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

TIMEFRAME_MILLISECONDS = {
    "1D": 86_400_000,
    "4H": 14_400_000,
    "1H": 3_600_000,
    "30m": 1_800_000,
    "15m": 900_000,
}


@dataclass(frozen=True, slots=True)
class CandleRecord:
    symbol: str
    timeframe: str
    open_time: int
    close_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    closed: bool

    def validate(self) -> None:
        if self.timeframe not in TIMEFRAME_MILLISECONDS:
            raise ValueError(f"Unsupported timeframe: {self.timeframe}")
        if self.open_time >= self.close_time:
            raise ValueError("Candle open_time must be before close_time")
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("Candle OHLC values are inconsistent")
        if self.high < self.low or self.volume < 0:
            raise ValueError("Candle high/low/volume values are invalid")

    @classmethod
    def from_okx_row(
        cls,
        symbol: str,
        timeframe: str,
        row: Sequence[str],
    ) -> "CandleRecord":
        if len(row) < 9:
            raise ValueError("OKX candle row must contain nine fields")
        duration = TIMEFRAME_MILLISECONDS.get(timeframe)
        if duration is None:
            raise ValueError(f"Unsupported timeframe: {timeframe}")
        open_time = int(row[0])
        candle = cls(
            symbol=symbol,
            timeframe=timeframe,
            open_time=open_time,
            close_time=open_time + duration,
            open=float(row[1]),
            high=float(row[2]),
            low=float(row[3]),
            close=float(row[4]),
            volume=float(row[5]),
            closed=row[8] == "1",
        )
        candle.validate()
        return candle


@dataclass(frozen=True, slots=True)
class SyncTask:
    symbol: str
    timeframe: str
    source: str
    cursor_after: int | None
