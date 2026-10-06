#!/usr/bin/env bash
# Бэкап локальных данных: settings, настройки цели, запасные вопросы, БД, .env (если есть).

set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

BACKUP_ROOT="${HOME}/focus-track-backup"
STAMP="$(date +%Y-%m-%d-%H%M%S)"
DEST="${BACKUP_ROOT}/${STAMP}"

mkdir -p "$DEST"

copied=0
for f in "$SETTINGS_FILE" "$GOAL_SETTINGS_FILE" "$SPEAKING_TOPICS_FILE" "$DB_FILE" "$ENV_FILE"; do
  if [[ -f "$f" ]]; then
    cp "$f" "$DEST/"
    copied=$((copied + 1))
    echo "  ✓ $(basename "$f")"
  fi
done

if [[ "$copied" -eq 0 ]]; then
  echo "Нечего бэкапить — файлы не найдены."
  rmdir "$DEST" 2>/dev/null || true
  exit 0
fi

echo ""
echo "Бэкап сохранён: $DEST"
echo "Восстановление: make restore DIR=$DEST"
