#!/bin/bash
# Backup PostgreSQL database ra file .sql.gz
# Usage: ./scripts/backup-db.sh [output_dir]
#
# Cron sample (backup mỗi ngày lúc 2h sáng):
#   0 2 * * * cd /opt/batch-report-system && ./scripts/backup-db.sh /var/backups/batch-reports >> /var/log/batch-backup.log 2>&1

set -e

OUTPUT_DIR="${1:-./backups}"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="batch_reports_${TIMESTAMP}.sql.gz"

# Load .env để lấy user/db
set -a
[ -f .env ] && . .env
set +a

POSTGRES_USER="${POSTGRES_USER:-batchuser}"
POSTGRES_DB="${POSTGRES_DB:-batch_reports}"

mkdir -p "$OUTPUT_DIR"

echo "[backup] Dumping database ${POSTGRES_DB}..."
docker compose $COMPOSE_FILES exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip > "$OUTPUT_DIR/$FILENAME"

SIZE=$(du -h "$OUTPUT_DIR/$FILENAME" | cut -f1)
echo "[backup] Saved: $OUTPUT_DIR/$FILENAME ($SIZE)"

# Xóa backup cũ hơn 30 ngày
find "$OUTPUT_DIR" -name "batch_reports_*.sql.gz" -mtime +30 -delete 2>/dev/null || true
echo "[backup] Done. Old backups (>30 days) cleaned up."
