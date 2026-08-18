#!/usr/bin/env python3
"""
FastAPI backend startup script for MedNova PV-Assist
"""

import os
import sys
import subprocess
from pathlib import Path

def _get_env(*names):
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return ""


def main():
    # Add parent directories to Python path for imports
    project_root = Path(__file__).parent.resolve()
    sys.path.insert(0, str(project_root / "src"))
    sys.path.insert(0, str(Path.home() / "Downloads" / "mednova-pv-assist" / "mednova-pv-assist"))

    supabase_url = _get_env("SUPABASE_URL")
    service_role_key = _get_env("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY")
    if supabase_url:
        os.environ["SUPABASE_URL"] = supabase_url
    if service_role_key:
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = service_role_key

    # Check for required environment variables
    required_env_vars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    
    if missing_vars:
        print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
        print(f"Please set these in .env file and try again.")
        sys.exit(1)

    # Start the FastAPI server
    host = os.getenv("SERVER_HOST", "0.0.0.0")
    port = int(os.getenv("SERVER_PORT", "8000"))
    
    print(f"Starting FastAPI server on {host}:{port}...")
    print(f"API will be available at http://localhost:{port}")
    print(f"Frontend expects VITE_PV_API_BASE_URL=http://localhost:{port}")
    print()
    
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "server.main:app",
                "--host",
                host,
                "--port",
                str(port),
                "--reload",
            ],
            cwd=str(project_root / "src"),
        )
    except KeyboardInterrupt:
        print("\nServer stopped.")
        sys.exit(0)
    except Exception as e:
        print(f"Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
