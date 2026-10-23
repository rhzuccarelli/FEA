#!/usr/bin/env bash
# Start the FEA web UI on http://localhost:${PORT:-8000}
set -euo pipefail
cd "$(dirname "$0")/.."

exec python3 -m uvicorn backend.server:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}"
