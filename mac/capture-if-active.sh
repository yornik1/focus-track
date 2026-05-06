#!/usr/bin/env bash
# Периодический снимок экрана: пропуск при простое, JPEG, уменьшение длинной стороны до ~1280px, LLM-анализ.
set -euo pipefail

# Порог простоя (сек): если idle БОЛЬШЕ этого — пропускаем (пользователь ушёл)
: "${FOCUS_TRACK_IDLE_SEC:=300}"
: "${FOCUS_TRACK_ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)}"

# Проверка паузы
PAUSE_FILE="${HOME}/.focus-track-pause"
if [[ -f "${PAUSE_FILE}" ]]; then
  PAUSE_UNTIL=$(cat "${PAUSE_FILE}")
  NOW=$(date +%s)
  if [[ "${NOW}" -lt "${PAUSE_UNTIL}" ]]; then
    exit 0  # на паузе
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
    exit 0  # пользователь неактивен
  fi
fi

out_dir="${HOME}/Library/Application Support/focus-track/captures"
/bin/mkdir -p "${out_dir}"

tmp="/tmp/focus-capture-$$-${RANDOM}.jpg"
/usr/sbin/screencapture -x -t jpg "${tmp}"

stamp=$(/bin/date +%Y%m%d-%H%M%S)
final="${out_dir}/${stamp}.jpg"
# -Z 1280 — вписать в квадрат со стороной не больше 1280 (пропорции сохраняются).
# formatOptions 40 — агрессивное сжатие JPEG (~150-350 KB вместо 1-2 MB)
if ! /usr/bin/sips -Z 1280 "${tmp}" --out "${final}" >/dev/null 2>&1; then
  /bin/mv "${tmp}" "${final}"
else
  /bin/rm -f "${tmp}"
fi
/usr/bin/sips -s formatOptions 40 "${final}" --out "${final}" >/dev/null 2>&1 || true

# Анализ через LLM и запись в БД
cd "${FOCUS_TRACK_ROOT}"
pnpm --filter @workspace/scripts run analyze "${final}" >/dev/null 2>&1 || true

# Cleanup: удалять скрины старше 7 дней
find "${out_dir}" -name "*.jpg" -mtime +7 -delete 2>/dev/null || true

