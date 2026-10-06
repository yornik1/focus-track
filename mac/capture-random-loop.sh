#!/usr/bin/env bash
# Бесконечный цикл: один снимок (с idle-check внутри), пауза случайной длины.
# Интервал перечитывается из focus-app-settings.json каждый тик.
set -euo pipefail

_here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_root="$(cd "${_here}/.." && pwd)"
_capture="${_here}/capture-if-active.sh"
_goal_report="${_here}/goal-report-send.sh"
_settings="${_root}/focus-app-settings.json"

while true; do
  "${_capture}" || true

  # Сообщения по цели (вопрос дня, итог недели); без focus-goal.json скрипт сразу выходит
  "${_goal_report}" || true

  # Читаем screenshot_interval из JSON (минуты), fallback на env или 2 мин
  interval_min=2
  if [[ -f "${_settings}" ]]; then
    val=$(grep '"screenshot_interval"' "${_settings}" | grep -o '[0-9]*')
    [[ -n "${val}" ]] && interval_min="${val}"
  fi

  # Рандом ±30% от интервала
  base_sec=$((interval_min * 60))
  jitter=$((base_sec * 30 / 100))
  min_sec=$((base_sec - jitter))
  max_sec=$((base_sec + jitter))
  span=$((max_sec - min_sec + 1))
  wait_sec=$((min_sec + RANDOM % span))

  /bin/sleep "${wait_sec}"
done
