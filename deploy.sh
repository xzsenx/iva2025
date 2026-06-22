#!/usr/bin/env bash
# Деплой на Railway с подписью = заголовок последнего коммита.
# Запуск: ./deploy.sh   (или ./deploy.sh "своя подпись")

set -e
cd "$(dirname "$0")"

if [ -n "$1" ]; then
  MSG="$1"
else
  MSG="$(git log -1 --pretty=%s)"
  HASH="$(git rev-parse --short HEAD)"
  MSG="$HASH · $MSG"
fi

echo "🚂 Деплой: $MSG"
railway up --detach -m "$MSG"
