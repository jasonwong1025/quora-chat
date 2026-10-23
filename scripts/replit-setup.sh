#!/usr/bin/env bash
# One-shot setup for a fresh Replit copy of Quora Chat (development only).
#
#   bash scripts/replit-setup.sh           # fresh/empty database: create schema + demo data
#                                          # already set up: apply pending migrations only
#   bash scripts/replit-setup.sh --reset   # wipe the DEVELOPMENT database and start over
#
# Never run this in a deployment or against a production database.
set -euo pipefail
cd "$(dirname "$0")/.."

RESET=0
[[ "${1:-}" == "--reset" ]] && RESET=1
PNPM_WANT=$(node -p "require('./package.json').packageManager.split('@')[1]")
step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

[[ -n "${REPLIT_DEPLOYMENT:-}" ]] && fail "this is a deployment. Run setup only in the workspace Shell."

step "Checking prerequisites"
[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is missing. Create a database first: Tools → Database → Create database."
if [[ -z "${AI_INTEGRATIONS_OPENAI_BASE_URL:-}" || -z "${AI_INTEGRATIONS_OPENAI_API_KEY:-}" ]]; then
fail "Replit AI Integrations (OpenAI) is not set up. Ask Replit Agent: \"Enable Replit AI Integrations for OpenAI in this project. Do not change any code.\" Then rerun this script."
fi
command -v psql >/dev/null || fail "psql not found. Check that .replit has the postgresql-16 module."

# Replit's pnpm must match the pinned version, otherwise it tries to self-switch.
if [[ "$(timeout 30 pnpm --version 2>/dev/null || true)" == "$PNPM_WANT" ]]; then
PNPM=(pnpm)
else
PNPM=(corepack pnpm)
[[ "$("${PNPM[@]}" --version 2>/dev/null || true)" == "$PNPM_WANT" ]] ||
fail "could not run pnpm $PNPM_WANT (tried pnpm and corepack pnpm)."
fi
echo "pnpm $PNPM_WANT via: ${PNPM[*]}"
echo "AI: Replit AI Integrations (OpenAI), model ${AI_MODEL:-gpt-5-mini}"

step "Installing dependencies"
CI=true "${PNPM[@]}" install --frozen-lockfile

q() { psql "$DATABASE_URL" -Atqc "$1"; }
has_table() { [[ "$(q "select to_regclass('public.$1') is not null")" == "t" ]]; }

if (( RESET )); then
step "Resetting the DEVELOPMENT database (all data in it is deleted)"
q "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
fi

if has_table businesses; then
has_table app_migrations ||
fail "the database has an old schema without migration history. Rerun with --reset to start fresh."
step "Database already set up: applying pending migrations only"
"${PNPM[@]}" db:migrate
else
[[ "$(q "select count(*) from information_schema.tables where table_schema='public'")" == "0" ]] ||
fail "the database has unknown tables. Rerun with --reset to start fresh."
step "Creating schema"
"${PNPM[@]}" db:push --force
step "Recording migrations"
"${PNPM[@]}" db:migrate
step "Seeding the 5 demo businesses"
"${PNPM[@]}" db:seed
fi

step "Checking"
echo "tables: $(q "select count(*) from information_schema.tables where table_schema='public'") (expect 25)"
echo "businesses: $(q "select string_agg(id, ', ' order by id) from businesses")"
echo "migrations: $(q "select count(*) from app_migrations")"

step "Building (same command the deployment uses)"
"${PNPM[@]}" build >/dev/null
echo "build ok"

printf '\nDone. Press Run to start the app and worker (port 5000), then follow SETUP.md to publish.\n'
