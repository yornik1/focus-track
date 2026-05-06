#!/usr/bin/env bash
# Периодический снимок экрана: пропуск при простое, JPEG 1280px quality 40%, LLM-анализ.
set -euo pipefail

: "${FOCUS_TRACK_IDLE_SEC:=300}"
: "${FOCUS_TRACK_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)}"

DATA_DIR="${FOCUS_TRACK_ROOT}/data"
CAPTURES_DIR="${DATA_DIR}/captures"
LOG_FILE="${DATA_DIR}/logs/capture.log"
PAUSE_FILE="${DATA_DIR}/pause"

/bin/mkdir -p "${CAPTURES_DIR}" "$(dirname "${LOG_FILE}")"

# Проверка паузы
if [[ -f "${PAUSE_FILE}" ]]; then
  PAUSE_UNTIL=$(cat "${PAUSE_FILE}")
  NOW=$(date +%s)
  if [[ "${NOW}" -lt "${PAUSE_UNTIL}" ]]; then
    exit 0
  else
    rm -f "${PAUSE_FILE}"
  fi
fi

# Проверка idle
idle_line=$(/usr/sbin/ioreg -c IOHIDSystem -r -k HIDIdleTime 2>/dev/null | /usr/bin/grep HIDIdleTime | /usr/bin/head -1 || true)
idle_ns="${idle_line##*= }"
idle_ns="${idle_ns//[^0-9]/}"
if [[ -n "${idle_ns}" ]]; then
  idle_s=$((idle_ns / 1000000000))
  if [[ "${idle_s}" -gt "${FOCUS_TRACK_IDLE_SEC}" ]]; then
    echo "$(date): Idle ${idle_s}s, пропускаю" >> "${LOG_FILE}"
    exit 0
  fi
fi

tmp="/tmp/focus-capture-$$-${RANDOM}.jpg"
/usr/sbin/screencapture -x -t jpg "${tmp}"

stamp=$(/bin/date +%Y%m%d-%H%M%S)
final="${CAPTURES_DIR}/${stamp}.jpg"

if ! /usr/bin/sips -Z 1280 -s formatOptions 40 "${tmp}" --out "${final}" >/dev/null 2>&1; then
  /bin/mv "${tmp}" "${final}"
else
  /bin/rm -f "${tmp}"
fi

# Анализ через LLM и запись в БД
cd "${FOCUS_TRACK_ROOT}"
pnpm --filter @workspace/scripts run analyze "${final}" >> "${LOG_FILE}" 2>&1 || true

# Cleanup: удалять скрины старше 7 дней (раз в день)
CLEANUP_MARKER="${DATA_DIR}/.cleanup-$(date +%Y%m%d)"
if [[ ! -f "${CLEANUP_MARKER}" ]]; then
  find "${CAPTURES_DIR}" -name "*.jpg" -mtime +7 -delete 2>/dev/null || true
  touch "${CLEANUP_MARKER}"
fi

