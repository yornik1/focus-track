#!/usr/bin/env bash
# Периодический снимок экрана: пропуск при простое, JPEG, уменьшение длинной стороны до ~1280px.
set -euo pipefail

# Порог простоя (сек): при меньшем значении скрин не делаем.
: "${FOCUS_TRACK_IDLE_SEC:=60}"

idle_line=$(/usr/sbin/ioreg -c IOHIDSystem -r -k HIDIdleTime 2>/dev/null | /usr/bin/grep HIDIdleTime | /usr/bin/head -1 || true)
idle_ns="${idle_line##*= }"
idle_ns="${idle_ns//[^0-9]/}"
if [[ -n "${idle_ns}" ]]; then
  idle_s=$((idle_ns / 1000000000))
  if [[ "${idle_s}" -lt "${FOCUS_TRACK_IDLE_SEC}" ]]; then
    exit 0
  fi
fi

out_dir="${HOME}/Library/Application Support/focus-track/captures"
/bin/mkdir -p "${out_dir}"

tmp="/tmp/focus-capture-$$-${RANDOM}.jpg"
/usr/sbin/screencapture -x -t jpg "${tmp}"

stamp=$(/bin/date +%Y%m%d-%H%M%S)
final="${out_dir}/${stamp}.jpg"
# -Z 1280 — вписать в квадрат со стороной не больше 1280 (пропорции сохраняются).
if ! /usr/bin/sips -Z 1280 "${tmp}" --out "${final}" >/dev/null 2>&1; then
  /bin/mv "${tmp}" "${final}"
else
  /bin/rm -f "${tmp}"
fi
