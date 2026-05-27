#!/usr/bin/env bash
# Восстановление focus-app-settings.json, focus.db, .env из бэкапа.

set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

SRC="${1:-${DIR:-}}"
if [[ -z "$SRC" ]]; then
  echo "Использование: $0 <путь-к-бэкапу>"
  echo "  или: make restore DIR=~/focus-track-backup/2026-05-23-120000"
  exit 1
fi

SRC="${SRC/#\~/$HOME}"
if [[ ! -d "$SRC" ]]; then
  echo "Папка не найдена: $SRC"
  exit 1
fi

restore_file() {
  local name="$1"
  local src="${SRC}/${name}"
  local dst="${REPO_ROOT}/${name}"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  if [[ -f "$dst" ]]; then
    read -r -p "Перезаписать ${name}? [y/N] " ans
    case "$ans" in
      [yY]|[yY][eE][sS]) ;;
      *) echo "  пропуск $name"; return 0 ;;
    esac
  fi
  cp "$src" "$dst"
  echo "  ✓ $name"
}

echo "Восстановление из: $SRC"
restore_file "focus-app-settings.json"
restore_file "focus.db"
restore_file ".env"
echo "Готово."
