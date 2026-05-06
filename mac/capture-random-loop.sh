#!/usr/bin/env bash
# Бесконечный цикл: один снимок (с idle-check внутри), пауза случайной длины в заданных пределах секунд.
set -euo pipefail

: "${FOCUS_TRACK_TICK_MIN_SEC:=120}"
: "${FOCUS_TRACK_TICK_MAX_SEC:=600}"

min="${FOCUS_TRACK_TICK_MIN_SEC}"
max="${FOCUS_TRACK_TICK_MAX_SEC}"
if (( min > max )); then
  t="${min}"
  min="${max}"
  max="${t}"
fi

_here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_capture="${_here}/capture-if-active.sh"

while true; do
  "${_capture}" || true
  span=$((max - min + 1))
  wait_sec=$((min + RANDOM % span))
  /bin/sleep "${wait_sec}"
done
