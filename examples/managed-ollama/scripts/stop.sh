#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/run/ollama.pid"

if [[ ! -r "$PID_FILE" ]]; then
  echo "No managed Ollama PID file found; nothing stopped."
  exit 0
fi

PID="$(<"$PID_FILE")"
if [[ ! "$PID" =~ ^[0-9]+$ ]] || ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Recorded Ollama process is no longer running."
  exit 0
fi

CMD="$(tr '\0' ' ' < "/proc/$PID/cmdline")"
if [[ "$CMD" != *"$ROOT/bin/ollama serve"* ]]; then
  echo "PID $PID is not this managed Ollama service; refusing to stop it." >&2
  exit 1
fi

kill -TERM "$PID"
for _ in $(seq 1 20); do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Ollama stopped."
    exit 0
  fi
  sleep 1
done

echo "Ollama did not stop within 20 seconds; PID $PID was left untouched." >&2
exit 1
