#!/usr/bin/env bash
# Runs the backend test suite including the integration tests against the local
# Supabase (`pnpm db:start`). Takes the API URL and service_role key from
# `supabase status`, so nothing has to be copied by hand.
set -euo pipefail

status="$(pnpm exec supabase status -o env 2>/dev/null)" || {
  echo "Local Supabase is not running. Start it with: pnpm db:start" >&2
  exit 1
}

value() { printf '%s\n' "$status" | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }

TEST_SUPABASE_URL="$(value API_URL)" \
TEST_SUPABASE_SERVICE_ROLE_KEY="$(value SERVICE_ROLE_KEY)" \
  pnpm --filter @circle-wallet/backend test
