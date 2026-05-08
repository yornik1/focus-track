#!/usr/bin/env bash
# Периодический снимок экрана: пропуск при простое, JPEG 1280px quality 40%, LLM-анализ.
set -euo pipefail

export PATH="$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node/" 2>/dev/null | tail -1)/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

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

stamp=$(/bin/date +%Y%m%d-%H%M%S)
final="${CAPTURES_DIR}/${stamp}.jpg"

# Swift-утилита: ScreenCaptureKit + resize 1280 + quality 0.4 за один проход
"${FOCUS_TRACK_ROOT}/mac/bin/focus-capture" "${final}" 1280 0.4 2>> "${LOG_FILE}"
if [[ ! -s "${final}" ]]; then
  echo "$(date): Скриншот пустой, пропускаю" >> "${LOG_FILE}"
  rm -f "${final}"
  exit 0
fi

# Анализ через LLM и запись в БД
cd "${FOCUS_TRACK_ROOT}"
FAIL_COUNTER="${DATA_DIR}/.fail-count"
FAIL_NOTIFY_THRESHOLD=3
ANALYZE_ERR_FILE="${DATA_DIR}/.last-analyze-error"

if pnpm --filter @workspace/scripts run analyze "${final}" >> "${LOG_FILE}" 2>"${ANALYZE_ERR_FILE}"; then
  analyze_exit=0
else
  analyze_exit=$?
fi

if [[ "${analyze_exit}" -ne 0 ]]; then
  # Проверяем что это НЕ сетевая ошибка (curl к google резолвится)
  if curl -s --max-time 5 https://google.com > /dev/null 2>&1; then
    # Сеть есть, значит это реальная ошибка (API key, quota, модель)
    count=$(cat "${FAIL_COUNTER}" 2>/dev/null || echo 0)
    count=$((count + 1))
    echo "${count}" > "${FAIL_COUNTER}"

    # Парсим JSON из stderr (provider, model, error)
    err_json=$(tail -1 "${ANALYZE_ERR_FILE}" 2>/dev/null || echo "")
    err_provider=$(echo "${err_json}" | grep -o '"provider":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    err_model=$(echo "${err_json}" | grep -o '"model":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
    err_msg=$(echo "${err_json}" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "неизвестная ошибка")

    echo "$(date): Анализ провалился (${count}/${FAIL_NOTIFY_THRESHOLD}) provider=${err_provider} model=${err_model} error=${err_msg}" >> "${LOG_FILE}"

    LAST_NOTIFY_FILE="${DATA_DIR}/.last-tg-notify"
    now_ts=$(date +%s)
    last_notify_ts=$(cat "${LAST_NOTIFY_FILE}" 2>/dev/null || echo 0)
    notify_cooldown=3600

    if [[ "${count}" -ge "${FAIL_NOTIFY_THRESHOLD}" && $((now_ts - last_notify_ts)) -ge "${notify_cooldown}" ]]; then
      # Отправить в Telegram
      if [[ -f "${FOCUS_TRACK_ROOT}/.env" ]]; then
        TG_BOT_TOKEN=$(grep '^TG_BOT_TOKEN=' "${FOCUS_TRACK_ROOT}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
        TG_CHAT_ID=$(grep '^TG_CHAT_ID=' "${FOCUS_TRACK_ROOT}/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")

        if [[ -n "${TG_BOT_TOKEN:-}" && -n "${TG_CHAT_ID:-}" ]]; then
          msg="⚠️ Focus Tracker: анализ не работает ${count} раз подряд

📡 Провайдер: ${err_provider}
🤖 Модель: ${err_model}
❌ Ошибка: ${err_msg}"
          curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
            -d chat_id="${TG_CHAT_ID}" \
            -d text="${msg}" >> "${LOG_FILE}" 2>&1 || true
          echo "${now_ts}" > "${LAST_NOTIFY_FILE}"
          echo "$(date): Отправлено уведомление в Telegram" >> "${LOG_FILE}"
        fi
      fi
    fi
  else
    echo "$(date): Анализ провалился, но сети нет — не считаем ошибкой" >> "${LOG_FILE}"
  fi
else
  # Успех — сбрасываем счётчик
  if [[ -f "${FAIL_COUNTER}" ]]; then
    rm -f "${FAIL_COUNTER}"
    echo "$(date): Анализ успешен, счётчик сброшен" >> "${LOG_FILE}"
  fi
fi

# Cleanup: удалять скрины старше 7 дней (раз в день)
CLEANUP_MARKER="${DATA_DIR}/.cleanup-$(date +%Y%m%d)"
if [[ ! -f "${CLEANUP_MARKER}" ]]; then
  find "${CAPTURES_DIR}" -name "*.jpg" -mtime +7 -delete 2>/dev/null || true
  touch "${CLEANUP_MARKER}"
fi

