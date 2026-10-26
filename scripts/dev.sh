#!/usr/bin/env bash
# Start the PixelGPU backend and frontend together. Ctrl+C stops both.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for tool in uv npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: '$tool' is required but was not found on PATH (see docs/DEVELOPMENT.md)" >&2
    exit 1
  fi
done

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "error: frontend dependencies are missing. Run 'make install' first." >&2
  exit 1
fi

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for port in 8000 5173; do
  if port_in_use "$port"; then
    echo "error: port $port is already in use. Is another 'make dev' running or suspended (Ctrl+Z)?" >&2
    echo "       Find it with: ps -eo pid,stat,cmd | grep -E 'pixelgpu|vite'   (STAT 'T' = suspended)" >&2
    exit 1
  fi
done

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "▶ backend  → http://127.0.0.1:8000/api/health"
(cd "$ROOT/backend" && exec uv run python -m pixelgpu) &
pids+=($!)

echo "▶ frontend → http://localhost:5173"
(cd "$ROOT/frontend" && exec npm run dev --silent) &
pids+=($!)

# Exit as soon as either service stops so a crash is never silently ignored.
wait -n
