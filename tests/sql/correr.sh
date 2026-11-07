#!/usr/bin/env bash
# Prueba la migración y la seguridad en una base temporal de Postgres local.
# Uso: tests/sql/correr.sh   (necesita psql y un servidor Postgres corriendo)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="qualityos_prueba_$$"
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
$PSQL -d "$DB" -f tests/sql/supabase_simulado.sql
$PSQL -d "$DB" -f supabase/migrations/0001_inicial.sql
$PSQL -d "$DB" -o /dev/null -f tests/sql/pruebas.sql
echo "Pruebas SQL: OK"
