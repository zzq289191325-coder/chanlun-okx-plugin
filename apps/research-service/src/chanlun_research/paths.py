from __future__ import annotations

from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
SERVICE_ROOT = PACKAGE_DIR.parents[1]
PROJECT_ROOT = SERVICE_ROOT.parents[1]
DEFAULT_DATABASE = PROJECT_ROOT / "data" / "chanlun_research.sqlite3"
DEFAULT_BACKUP_DIR = PROJECT_ROOT / "data" / "backups"
DEFAULT_CONFIG = SERVICE_ROOT / "config" / "example_sync_tasks.json"
MIGRATIONS_DIR = SERVICE_ROOT / "migrations"
