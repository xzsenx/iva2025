#!/usr/bin/env bash
# predeploy.sh — проверки перед `./deploy.sh` (railway up)
set -uo pipefail
cd "$(dirname "$0")"
BE="$(pwd)/backend"; FAIL=0
warn(){ echo "[WARN] $*"; }
err(){ echo "[FAIL] $*"; FAIL=1; }
ok(){ echo "[ OK ] $*"; }

# 1. Синтакс всех .js бэкенда
while IFS= read -r -d '' f; do
  node --check "$f" 2>&1 | sed 's/^/  /' && ok "syntax: ${f#$BE/}" || err "syntax: $f"
done < <(find "$BE/src" "$BE/scripts" -name '*.js' -print0 2>/dev/null)

# 2. ENV: process.env.* из кода должны быть в .env.example
REQ=$(grep -rhoE 'process\.env\.[A-Z_]+' "$BE/src" | sed 's/.*\.//' | sort -u)
OPT="DB_PATH UPLOAD_DIR SITE_DIR APP_DIR DEEPSEEK_BASE_URL DEEPSEEK_MODEL NODE_ENV PORT"
for v in $REQ; do
  echo "$OPT" | grep -qw "$v" && continue
  [ -f "$BE/.env.example" ] && grep -q "^$v=" "$BE/.env.example" || warn "$v в коде, нет в .env.example"
done
ok "env-coverage проверен"

# 3. Миграции БД: только IF NOT EXISTS / safeAlter, никаких DROP
grep -nE "db\.exec\(\s*\`?['\"]?\s*ALTER TABLE" "$BE/src/db.js" | grep -v safeAlter \
  && err "прямой ALTER TABLE вне safeAlter сломает старую БД на проде" \
  || ok "ALTER TABLE только через safeAlter"
grep -q "DROP TABLE" "$BE/src/db.js" && err "DROP TABLE в db.js — потеряешь данные" || ok "нет DROP TABLE"

# 4. Секреты в staged diff
git diff --cached --name-only | grep -qE '(^|/)\.env$' && err ".env в staged — git rm --cached"
LEAK=$(git diff --cached -U0 2>/dev/null | grep -iE "^\+.*(secret|api[_-]?key|password|token)[\"']?\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}" || true)
[ -n "$LEAK" ] && { err "секрет в staged diff"; echo "$LEAK"; } || ok "секретов в staged не найдено"

# 5. Health-check — поднять локально на изолированной БД, curl /health
export PORT=3999 NODE_ENV=development POSIFLORA_USERNAME="" POSIFLORA_PASSWORD=""
export DB_PATH="/tmp/iva-predeploy-$$.db" UPLOAD_DIR="/tmp/iva-predeploy-up-$$"
LOG=/tmp/iva-predeploy.log
(cd "$BE" && node src/index.js) >"$LOG" 2>&1 & PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$DB_PATH" "$DB_PATH-shm" "$DB_PATH-wal"; rm -rf "$UPLOAD_DIR"' EXIT
CODE=000
for i in 1 2 3 4 5; do
  sleep 1
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health") && [ "$CODE" = 200 ] && break
done
[ "$CODE" = 200 ] && ok "/health -> 200" || { err "/health отдал $CODE"; tail -20 "$LOG"; }

# 6. git status
[ -z "$(git status --porcelain)" ] && ok "working tree чистое" \
  || { warn "незакоммиченные изменения (Railway задеплоит только HEAD):"; git status --short; }

[ $FAIL -ne 0 ] && { echo "PRE-DEPLOY FAILED — railway up НЕ запускаю"; exit 1; }
echo "READY -> ./deploy.sh"
