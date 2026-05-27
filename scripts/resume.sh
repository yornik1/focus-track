#!/usr/bin/env bash
# Снять паузу захвата.

set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

rm -f "$PAUSE_FILE"
notify "Focus Tracker" "Трекер включён"
echo "Трекер активен."
