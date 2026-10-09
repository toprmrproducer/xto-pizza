#!/bin/bash
# XTO Pizza: one command to run the whole stack (website + iOS/Android app + admin CES)
# Usage:  bash run.sh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org and run this again."
  exit 1
fi

PORT="${PORT:-7788}"
echo ""
echo "  Starting XTO Pizza stack on port $PORT ..."
echo "  Website : http://localhost:$PORT/"
echo "  App     : http://localhost:$PORT/app"
echo "  Admin   : http://localhost:$PORT/admin   (PIN 4321)"
echo ""

# open the storefront after the server is up
sleep 0.6
if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/" 2>/dev/null || true; fi

exec node server.js
