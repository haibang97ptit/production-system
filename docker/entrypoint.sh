#!/bin/sh
set -e

echo "[entrypoint] Syncing database schema..."
npx prisma db push --schema=/app/prisma/schema.prisma --accept-data-loss --skip-generate

echo "[entrypoint] Starting application (NODE_ENV=${NODE_ENV:-production})..."
exec "$@"
