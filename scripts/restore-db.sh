#!/bin/bash
# Restore PostgreSQL database từ file backup .sql.gz
# Usage: ./scripts/restore-db.sh <backup_file.sql.gz>

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: File $BACKUP_FILE not found"
  exit 1
fi

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

set -a
[ -f .env ] && . .env
set +a

POSTGRES_USER="${POSTGRES_USER:-batchuser}"
POSTGRES_DB="${POSTGRES_DB:-batch_reports}"

echo "[restore] WARNING: This will OVERWRITE database ${POSTGRES_DB}"
read -p "Type 'yes' to confirm: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "Aborted"; exit 1; }

echo "[restore] Restoring from $BACKUP_FILE..."
gunzip -c "$BACKUP_FILE" | docker compose $COMPOSE_FILES exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "[restore] Done. Restart app to reload connection pool:"
echo "  docker compose $COMPOSE_FILES restart app"
