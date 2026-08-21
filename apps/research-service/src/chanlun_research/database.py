from __future__ import annotations

import hashlib
import sqlite3
import time
from pathlib import Path

from .paths import MIGRATIONS_DIR


def connect_database(path: Path | str) -> sqlite3.Connection:
    database_path = Path(path).resolve()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def migrate_database(
    connection: sqlite3.Connection,
    migrations_dir: Path = MIGRATIONS_DIR,
) -> list[int]:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            checksum TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        )
        """
    )
    connection.commit()
    applied = {
        int(row["version"]): str(row["checksum"])
        for row in connection.execute("SELECT version, checksum FROM schema_migrations")
    }
    newly_applied: list[int] = []
    for migration_path in sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql")):
        version = int(migration_path.name.split("_", 1)[0])
        sql = migration_path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
        if version in applied:
            if applied[version] != checksum:
                raise RuntimeError(f"Applied migration {version} checksum changed")
            continue
        statement = (
            "BEGIN IMMEDIATE;\n"
            f"{sql}\n"
            "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES "
            f"({version}, {sql_quote(migration_path.name)}, {sql_quote(checksum)}, {int(time.time() * 1000)});\n"
            "COMMIT;"
        )
        try:
            connection.executescript(statement)
        except Exception:
            if connection.in_transaction:
                connection.rollback()
            raise
        newly_applied.append(version)
    return newly_applied


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def integrity_check(connection: sqlite3.Connection) -> str:
    rows = connection.execute("PRAGMA integrity_check").fetchall()
    return "; ".join(str(row[0]) for row in rows)


def backup_database(connection: sqlite3.Connection, destination: Path | str) -> Path:
    target = Path(destination).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError(f"Backup already exists: {target}")
    target_connection = sqlite3.connect(target)
    try:
        connection.backup(target_connection)
        result = target_connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Backup integrity check failed")
    finally:
        target_connection.close()
    return target


def restore_database(source: Path | str, destination: Path | str, *, force: bool = False) -> Path:
    backup_path = Path(source).resolve()
    target_path = Path(destination).resolve()
    if not backup_path.is_file():
        raise FileNotFoundError(f"Backup not found: {backup_path}")
    if backup_path == target_path:
        raise ValueError("Restore source and destination must be different files")
    if target_path.exists() and not force:
        raise FileExistsError(f"Restore target exists: {target_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(backup_path)
    try:
        result = source_connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Source backup integrity check failed")
        target_connection = sqlite3.connect(target_path)
        try:
            source_connection.backup(target_connection)
        finally:
            target_connection.close()
    finally:
        source_connection.close()
    return target_path
