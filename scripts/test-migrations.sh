#!/usr/bin/env bash
# Apply every migration to a throwaway local PostgreSQL database and run the SQL
# test files in supabase/tests. Requires a local PostgreSQL server and a superuser
# connection (defaults to running psql as the `postgres` OS user).
#
#   npm run db:test
#   PSQL="psql -h localhost -U postgres" npm run db:test
set -euo pipefail
cd "$(dirname "$0")/.."

DB=${TEST_DB:-vms_test}
if [[ -z "${PSQL:-}" ]]; then
  if [[ "$(id -u)" == "0" ]]; then PSQL="su postgres -c psql"; else PSQL="psql"; fi
fi
run() { # run psql reading SQL from stdin
  if [[ "$PSQL" == su* ]]; then su postgres -c "psql -X -v ON_ERROR_STOP=1 $*"; else $PSQL -X -v ON_ERROR_STOP=1 "$@"; fi
}

echo ">>> recreating database $DB"
printf 'drop database if exists %s;\ncreate database %s;\n' "$DB" "$DB" | run -q -d postgres

{
  cat supabase/tests/local-auth-stub.sql
  for f in supabase/migrations/*.sql; do
    echo "\\echo '>>> migration: $f'"
    cat "$f"
  done
  for f in supabase/tests/*.test.sql; do
    echo "\\echo '>>> tests: $f'"
    cat "$f"
  done
} | run -d "$DB"
echo ">>> done"
