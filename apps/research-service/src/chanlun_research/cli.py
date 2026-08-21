from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from .audit import database_report
from .backtest_config import BacktestConfig
from .backtest_service import run_single_backtest
from .database import (
    backup_database,
    connect_database,
    integrity_check,
    migrate_database,
    restore_database,
)
from .okx_public import OkxPublicHistoryClient
from .paths import DEFAULT_BACKUP_DIR, DEFAULT_CONFIG, DEFAULT_DATABASE
from .repository import load_sync_tasks, seed_sync_tasks
from .sync_service import sync_task


def json_print(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="chanlun-research",
        description="Local-only OKX public historical market database",
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DATABASE, help="SQLite database path")
    commands = parser.add_subparsers(dest="command", required=True)

    init = commands.add_parser("init", help="Create/migrate database and seed example tasks")
    init.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    commands.add_parser("migrate", help="Apply pending schema migrations")

    sync = commands.add_parser("sync", help="Download OKX public historical candles")
    sync.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    sync.add_argument("--mode", choices=("backfill", "latest"), default="backfill")
    sync.add_argument("--pages", type=int, default=1)
    sync.add_argument("--page-size", type=int, default=300)
    sync.add_argument("--symbol", action="append")
    sync.add_argument("--timeframe", action="append")

    audit = commands.add_parser("audit", help="Check integrity, gaps, duplicates and anomalies")
    audit.add_argument("--save-issues", action="store_true")

    commands.add_parser("stats", help="Print database coverage statistics")
    commands.add_parser("integrity", help="Run SQLite integrity_check")

    backup = commands.add_parser("backup", help="Create a consistent SQLite backup")
    backup.add_argument("--output", type=Path)

    restore = commands.add_parser("restore", help="Restore a database backup")
    restore.add_argument("--backup", type=Path, required=True)
    restore.add_argument("--force", action="store_true")

    backtest = commands.add_parser("backtest", help="Run local-only point-in-time paper backtests")
    backtest.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG.parent / "backtest_default.json",
    )
    backtest.add_argument("--symbol", action="append")
    backtest.add_argument("--start", type=int)
    backtest.add_argument("--end", type=int)
    backtest.add_argument("--name", default="V1.1 Chanlun local paper backtest")
    backtest.add_argument("--no-sensitivity", action="store_true")
    return parser


def default_backup_path() -> Path:
    stamp = datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")
    return DEFAULT_BACKUP_DIR / f"chanlun_research_{stamp}.sqlite3"


def run(args: argparse.Namespace) -> int:
    database_path = Path(args.db).resolve()
    if args.command == "restore":
        restored = restore_database(args.backup, database_path, force=args.force)
        restored_connection = connect_database(restored)
        try:
            restored_integrity = integrity_check(restored_connection)
        finally:
            restored_connection.close()
        json_print({"restored": str(restored), "integrity": restored_integrity})
        return 0

    connection = connect_database(database_path)
    try:
        applied = migrate_database(connection)
        if args.command == "migrate":
            json_print({"database": str(database_path), "applied_migrations": applied})
            return 0
        if args.command == "init":
            with connection:
                tasks = seed_sync_tasks(connection, args.config)
            json_print(
                {
                    "database": str(database_path),
                    "applied_migrations": applied,
                    "seeded_tasks": tasks,
                    "integrity": integrity_check(connection),
                }
            )
            return 0
        if args.command == "sync":
            with connection:
                seed_sync_tasks(connection, args.config)
            symbols = {item.upper() for item in args.symbol} if args.symbol else None
            timeframes = set(args.timeframe) if args.timeframe else None
            tasks = load_sync_tasks(connection, symbols=symbols, timeframes=timeframes)
            client = OkxPublicHistoryClient()
            results = [
                sync_task(
                    connection,
                    client,
                    task,
                    mode=args.mode,
                    maximum_pages=max(1, args.pages),
                    page_size=max(1, min(300, args.page_size)),
                )
                for task in tasks
            ]
            output = [item.to_dict() for item in results]
            json_print({"database": str(database_path), "results": output})
            return 1 if any(item.status == "failed" for item in results) else 0
        if args.command in {"audit", "stats"}:
            report = database_report(
                connection,
                save_issues=bool(getattr(args, "save_issues", False)),
            )
            json_print({"database": str(database_path), **report})
            return 0 if report["integrity"] == "ok" else 1
        if args.command == "integrity":
            result = integrity_check(connection)
            json_print({"database": str(database_path), "integrity": result})
            return 0 if result == "ok" else 1
        if args.command == "backup":
            destination = args.output or default_backup_path()
            target = backup_database(connection, destination)
            json_print({"database": str(database_path), "backup": str(target), "integrity": "ok"})
            return 0
        if args.command == "backtest":
            payload = json.loads(args.config.read_text(encoding="utf-8"))
            config_values = dict(payload.get("strategy", {}))
            if args.no_sensitivity:
                config_values["sensitivity_percent"] = 0.0
            config = BacktestConfig(**config_values)
            symbols = [item.upper() for item in args.symbol] if args.symbol else [
                str(item).upper() for item in payload["symbols"]
            ]
            outputs = []
            errors = []
            for symbol in symbols:
                try:
                    outputs.append(
                        run_single_backtest(
                            connection,
                            symbol=symbol,
                            config=config,
                            name=args.name,
                            data_start=args.start,
                            data_end=args.end,
                        ).to_dict()
                    )
                except Exception as error:
                    errors.append({"symbol": symbol, "error": str(error)})
            json_print({"database": str(database_path), "runs": outputs, "errors": errors})
            return 1 if errors else 0
        raise RuntimeError(f"Unhandled command: {args.command}")
    finally:
        connection.close()


def main(argv: list[str] | None = None) -> int:
    try:
        return run(build_parser().parse_args(argv))
    except (OSError, RuntimeError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"chanlun-research: {error}", file=sys.stderr)
        return 2
