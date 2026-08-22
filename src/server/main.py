import os
import sys
from pathlib import Path

# Resolve pv_assist import path - works with git submodule or local filesystem
def _resolve_pv_assist_path():
    """
    Find pv_assist package. Tries multiple locations:
    1. mednova-pv-assist (submodule at repo root)
    2. ../Downloads/mednova-pv-assist (local dev)
    3. PYTHONPATH / installed package
    """
    candidates = [
        Path(__file__).parent.parent.parent / "mednova-pv-assist" / "mednova-pv-assist",  # submodule
        Path.home() / "Downloads" / "mednova-pv-assist" / "mednova-pv-assist",  # local dev
        Path(__file__).parent.parent.parent.parent / "mednova-pv-assist" / "mednova-pv-assist",  # fallback
    ]
    for path in candidates:
        if path.exists() and (path / "pv_assist").exists():
            return path
    # If not found, don't error here - let import fail with clearer message
    return None

pv_path = _resolve_pv_assist_path()
if pv_path:
    if str(pv_path) not in sys.path:
        sys.path.insert(0, str(pv_path))
    if str(pv_path.parent) not in sys.path:
        sys.path.insert(0, str(pv_path.parent))

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
import httpx
from datetime import datetime
import json
from typing import Optional
import logging
from urllib.parse import urlparse

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import routes
from .routes import auth, cases, seriousness, coding, audit, signals, followups, compatibility
from .routes import ai_linelist, ai_psur, ai_icsr, ai_coding

def _get_env(*names: str) -> Optional[str]:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return None

# Load environment
SUPABASE_URL = _get_env("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _get_env("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY")
SUPABASE_JWT_SECRET = _get_env("SUPABASE_JWT_SECRET", "JWT_SECRET")
CORS_ORIGINS = [
    origin.strip()
    for origin in _get_env("CORS_ORIGINS", "VITE_PV_API_BASE_URL").split(",")
    if origin and origin.strip()
]

if not all([SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY]):
    raise ValueError("Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

logger.info(
    "AUTH: Supabase configuration loaded host=%s service_key_configured=%s",
    urlparse(SUPABASE_URL).netloc if SUPABASE_URL else "missing",
    bool(SUPABASE_SERVICE_ROLE_KEY),
)

# Create FastAPI app
app = FastAPI(
    title="SafetyCore PV Operations Platform",
    description="Production-ready pharmacovigilance operations management system",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(auth.router, prefix="/api/auth", tags=["authentication"])
app.include_router(cases.router, prefix="/api/cases", tags=["cases"])
app.include_router(seriousness.router, prefix="/api/seriousness", tags=["seriousness"])
app.include_router(coding.router, prefix="/api/coding", tags=["coding"])
app.include_router(audit.router, prefix="/api/audit", tags=["audit"])
app.include_router(signals.router, prefix="/api/signals", tags=["signals"])
app.include_router(followups.router, prefix="/api/follow-ups", tags=["follow-ups"])
app.include_router(compatibility.router, prefix="/api", tags=["compatibility"])
app.include_router(ai_linelist.router, prefix="/api/ai/linelist", tags=["ai-linelist"])
app.include_router(ai_psur.router, prefix="/api/ai/psur", tags=["ai-psur"])
app.include_router(ai_icsr.router, prefix="/api/ai/icsr", tags=["ai-icsr"])
app.include_router(ai_coding.router, prefix="/api/ai/coding", tags=["ai-coding"])

# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
