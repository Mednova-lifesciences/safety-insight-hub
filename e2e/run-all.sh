#!/usr/bin/env bash
# The whole end-to-end suite, in order, on the synthetic test organisation:
#   reset + PSUR seed -> line lists A and B (upload ... E2B XML) -> the new
#   features (forecast, flags, duplicates, AI log) -> PSUR officer/evaluator/
#   peer + downloads -> two-organisation isolation check.
#
#   PW_DIR=… CHROME_PATH=… OUT_DIR=… TEST_PASSWORD=… SUPABASE_URL=…
#   SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_PUBLISHABLE_KEY=… [BASE_URL=…] e2e/run-all.sh
set -u
cd "$(dirname "$0")/.."
status=0
run() { echo "=== $1"; shift; "$@" || status=1; }

run "reset test org" node scripts/seed/reset-test-org.mjs
run "line lists + E2B" env FILE_B=1 node e2e/flow-linelist.cjs
run "new features" env EXPECT_FLAGS=1 node e2e/flow-features.cjs
run "PSUR" node e2e/flow-psur.cjs
run "organisation isolation" node e2e/rls-check.mjs
exit $status
