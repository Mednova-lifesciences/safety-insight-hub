"""Compatibility shim.

The real application entrypoint lives in src/server/main.py. Keeping this file as a stub
avoids the recursive import caused by a root-level package alias.
"""

from pathlib import Path
import sys

_src_server_dir = Path(__file__).resolve().parent.parent / "src" / "server"
if _src_server_dir.exists() and str(_src_server_dir.parent) not in sys.path:
    sys.path.insert(0, str(_src_server_dir.parent))

# Import the real app. This file is only used if someone explicitly references
# `server.main` from the root package while the package path is still being resolved.
from src.server.main import app  # type: ignore  # noqa: F401
