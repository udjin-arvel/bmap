#!/bin/sh
set -e

export PORT="${NITRO_PORT:-3000}"
export NITRO_PORT="$PORT"
export HOST="${HOST:-0.0.0.0}"

node .output/server/index.mjs &
NODE_PID=$!

# Fail fast if Nitro did not bind (avoids nginx 502 with no obvious error).
sleep 2
if ! kill -0 "$NODE_PID" 2>/dev/null; then
  echo "error: Nitro server exited during startup" >&2
  exit 1
fi

exec nginx -g "daemon off;"
