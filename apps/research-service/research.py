from __future__ import annotations

import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from chanlun_research.cli import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
