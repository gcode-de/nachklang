#!/bin/sh
set -eu
if [ "${1:-}" = "node" ] && [ "${2:-}" = "server.js" ]; then
  node --import tsx scripts/migrate.ts
fi
exec "$@"
