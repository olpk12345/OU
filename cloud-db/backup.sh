#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)

docker compose exec -T postgres sh -c \
  'pg_dump --clean --if-exists --no-owner --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' \
  > "backups/personal-db-${stamp}.sql"

echo "Backup created: backups/personal-db-${stamp}.sql"
