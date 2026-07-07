#!/usr/bin/env bash
# FreeFlo secret regression guard (first codified detector, audit 2026-07-06).
# Two checks, both fail the build on violation:
#   1. no tracked non-example .env file (the class of the witness-key leak)
#   2. gitleaks scan (working tree + full history) with the tuned .gitleaks.toml
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0

echo "== check 1: no tracked non-example .env =="
tracked_env="$(git ls-files | grep -E '\.env($|\.)' | grep -vE '\.(example|sample)$' || true)"
if [ -n "$tracked_env" ]; then
  echo "  FAIL — these secret-bearing env files are tracked:"; echo "$tracked_env" | sed 's/^/    /'
  echo "  fix: git rm --cached <file>  (and confirm it's covered by .gitignore)"
  fail=1
else
  echo "  ok — only *.env.example/.sample are tracked"
fi

echo "== check 2: gitleaks (protect working tree + detect full history) =="
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "  SKIP — gitleaks not installed (brew install gitleaks). CI must have it."
else
  gitleaks git . --config .gitleaks.toml --redact --exit-code 1 \
    || { echo "  FAIL — gitleaks found secrets (see above)"; fail=1; }
  [ "$fail" -eq 0 ] && echo "  ok — no secrets"
fi

exit $fail
