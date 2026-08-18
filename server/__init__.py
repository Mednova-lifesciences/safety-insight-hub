"""Compatibility package for Render deployment.

This makes the root-level package `server` resolve to the real FastAPI package in
`src/server`, so commands like `python -m uvicorn server.main:app` work from the repo root.
"""

from pathlib import Path

_src_server_dir = Path(__file__).resolve().parent.parent / "src" / "server"
if _src_server_dir.exists():
    __path__ = [str(_src_server_dir)]
else:
    __path__ = [str(Path(__file__).resolve().parent)]
