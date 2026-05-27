#!/usr/bin/env bash
# Пауза до 9:00 завтра.

set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

TOMORROW_9=$(date -v+1d -v9H -v0M -v0S +%s)
mkdir -p "$DATA_DIR"
echo "$TOMORROW_9" > "$PAUSE_FILE"
HOURS=$(( (TOMORROW_9 - $(date +%s)) / 3600 ))
notify "Focus Tracker" "Стоп до 9:00 завтра (${HOURS}ч)"
echo "Пауза до 9:00 завтра (~${HOURS}ч)."
