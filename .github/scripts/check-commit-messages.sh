#!/usr/bin/env bash
# Checks commit subjects against the convention of ADR-0084: `type: description`, where type is one
# of feat, fix, docs, refactor, test, chore or ci. Reads one subject per line from stdin, prints
# every subject that does not follow it and exits with 1 if there was any.
#
# Usage: git log --no-merges --format=%s origin/main..HEAD | bash .github/scripts/check-commit-messages.sh
set -euo pipefail

readonly PATTERN='^(feat|fix|docs|refactor|test|chore|ci): [^[:space:]].*$'

invalid=0
while IFS= read -r subject || [[ -n "$subject" ]]; do
  if [[ ! "$subject" =~ $PATTERN ]]; then
    printf 'Not a "type: description" subject (ADR-0084): %s\n' "$subject"
    invalid=1
  fi
done

if [[ "$invalid" -ne 0 ]]; then
  echo 'Allowed types: feat, fix, docs, refactor, test, chore, ci. Example: "fix: reject expired carts".'
fi
exit "$invalid"
