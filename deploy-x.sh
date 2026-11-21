#!/usr/bin/env bash
# Деплой новой вкладки /x на llm.stud-life.com
# Запускать на сервере:  bash deploy-x.sh
set -euo pipefail

# 1. Путь к проекту на сервере — поправьте, если он отличается
PROJECT_DIR="${PROJECT_DIR:-$HOME/LLM_Compare}"
cd "$PROJECT_DIR"

echo "==> Тяну последние изменения из git"
git pull

echo "==> Ставлю зависимости"
npm install

echo "==> Собираю клиент (dist/client)"
npm run build

echo "==> Перезапускаю приложение"
if command -v pm2 >/dev/null 2>&1 && pm2 describe llm-compare >/dev/null 2>&1; then
  pm2 restart llm-compare
elif systemctl list-unit-files 2>/dev/null | grep -q '^llm-compare\.service'; then
  sudo systemctl restart llm-compare
elif command -v pm2 >/dev/null 2>&1; then
  pm2 restart all
else
  echo "!! Автоперезапуск не настроен: перезапустите сервер вручную (npm start)"
fi

echo "==> Готово. Проверьте: https://llm.stud-life.com/x/"
