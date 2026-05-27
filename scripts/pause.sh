#!/usr/bin/env bash
# Пауза захвата на N минут (по умолчанию 5).

set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

MINS="${1:-${MIN:-5}}"
RESUME_AT=$(( $(date +%s) + MINS * 60 ))

mkdir -p "$DATA_DIR"
echo "$RESUME_AT" > "$PAUSE_FILE"
notify "Focus Tracker" "Пауза ${MINS} мин"
echo "Пауза ${MINS} мин (до $(date -r "$RESUME_AT" '+%H:%M'))"
