#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/bin/ollama"
PID_FILE="$ROOT/run/ollama.pid"
LOG_FILE="$ROOT/logs/ollama.log"

mkdir -p "$ROOT/models" "$ROOT/logs" "$ROOT/run"

if [[ ! -x "$BIN" ]]; then
  echo "Ollama binary not found: $BIN" >&2
  exit 1
fi

if [[ -r "$PID_FILE" ]]; then
  PID="$(<"$PID_FILE")"
  if [[ "$PID" =~ ^[0-9]+$ ]] && kill -0 "$PID" 2>/dev/null; then
    echo "Ollama is already running (PID $PID)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if ss -ltn 'sport = :11434' | tail -n +2 | grep -q .; then
  echo "Port 11434 is already in use; refusing to start another service." >&2
  exit 1
fi

export OLLAMA_MODELS="$ROOT/models"
export OLLAMA_HOST="127.0.0.1:11434"
nohup "$BIN" serve >>"$LOG_FILE" 2>&1 &
PID=$!
printf '%s\n' "$PID" >"$PID_FILE"

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    echo "Ollama is ready at http://127.0.0.1:11434 (PID $PID)."
    exit 0
  fi
  sleep 1
done

echo "Ollama did not become ready. Recent log output:" >&2
tail -n 30 "$LOG_FILE" >&2 || true
kill "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
exit 1
