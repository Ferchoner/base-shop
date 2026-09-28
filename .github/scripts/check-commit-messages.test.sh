#!/usr/bin/env bash
# Tests for check-commit-messages.sh. Run with: bash .github/scripts/check-commit-messages.test.sh
set -uo pipefail

CHECK="$(dirname "$0")/check-commit-messages.sh"
readonly CHECK
failures=0

expect() {
  local expected="$1" subject="$2"
  local status=0
  printf '%s\n' "$subject" | bash "$CHECK" >/dev/null || status=$?
  if [[ "$expected" == valid && "$status" -ne 0 ]] || [[ "$expected" == invalid && "$status" -eq 0 ]]; then
    printf 'FAIL: expected %s: %s\n' "$expected" "$subject"
    failures=$((failures + 1))
  fi
}

expect valid 'feat: add the namespaced cache and public catalog invalidation'
expect valid 'fix: reject expired carts'
expect valid 'docs: record ADR-0104 and mark T-119 as done'
expect valid 'refactor: extract the price calculator'
expect valid 'test: cover idempotent replays'
expect valid 'chore: bump the npm dependencies'
expect valid 'ci: run the pipeline on every pull request'
expect valid 'feat: add GET /v1/products (T-140)'

expect invalid ''
expect invalid 'add the cache'
expect invalid 'Feat: add the cache'
expect invalid 'feature: add the cache'
expect invalid 'build: update the Dockerfile'
expect invalid 'feat:add the cache'
expect invalid 'feat:  add the cache'
expect invalid 'feat: '
expect invalid 'feat(cache): add the cache'
expect invalid 'feat!: drop the v1 routes'
expect invalid 'Revert "feat: add the cache"'
expect invalid 'fixup! feat: add the cache'
expect invalid 'Merge branch '\''main'\'' into feat/T-119-cache'
expect invalid ' feat: add the cache'

# Several subjects: one bad subject fails the whole list, and every subject is reported.
output="$(printf 'feat: add the cache\nwip\nfix: keep the TTL\nmore wip\n' | bash "$CHECK")"
status=$?
if [[ "$status" -eq 0 ]] || [[ "$(grep -c '^Not a' <<<"$output")" -ne 2 ]]; then
  echo 'FAIL: a list with two bad subjects must fail and report both'
  failures=$((failures + 1))
fi

# No subjects (a pull request with only merge commits) is valid.
if ! bash "$CHECK" </dev/null >/dev/null; then
  echo 'FAIL: an empty list must be valid'
  failures=$((failures + 1))
fi

if [[ "$failures" -ne 0 ]]; then
  echo "$failures commit message test(s) failed"
  exit 1
fi
echo 'All commit message tests passed'
