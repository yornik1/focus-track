#!/usr/bin/env bash
# Сообщения по цели: спрашивает у goal-report, что слать, отправляет в Telegram и ставит метку.
# Вызывается из capture-random-loop.sh на каждом проходе; без focus-goal.json сразу выходит.
set -euo pipefail

_mac_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=../scripts/lib/toolchain-path.sh
source "${_mac_dir}/../scripts/lib/toolchain-path.sh"
focus_export_toolchain_path

: "${FOCUS_TRACK_ROOT:=$(cd "${_mac_dir}/.." && pwd)}"
cd "${FOCUS_TRACK_ROOT}"

# Файл цели и метки лежат рядом с базой — так же их ищет goal-report.
GOAL_DIR="$(dirname "${DATABASE_PATH:-${FOCUS_TRACK_ROOT}/focus.db}")"
GOAL_FILE="${GOAL_DIR}/focus-goal.json"
MARKERS_DIR="${GOAL_DIR}/data/markers"
DATA_DIR="${FOCUS_TRACK_ROOT}/data"
LOG_FILE="${DATA_DIR}/logs/capture.log"
PAUSE_FILE="${DATA_DIR}/pause"
ENV_FILE="${FOCUS_TRACK_ROOT}/.env"

# Нет файла цели — обычное состояние на чужих установках, молчим.
[[ -f "${GOAL_FILE}" ]] || exit 0

# Пауза — та же, что у захвата снимков.
if [[ -f "${PAUSE_FILE}" ]]; then
  pause_until="$(cat "${PAUSE_FILE}" 2>/dev/null || true)"
  pause_until="${pause_until//[^0-9]/}"
  if [[ -n "${pause_until}" && "$(date +%s)" -lt "${pause_until}" ]]; then
    exit 0
  fi
fi

/bin/mkdir -p "${MARKERS_DIR}" "$(dirname "${LOG_FILE}")" 2>/dev/null || true
# Метки не пишутся — выходим до отправки: иначе сообщение уходило бы на каждом проходе.
[[ -d "${MARKERS_DIR}" && -w "${MARKERS_DIR}" ]] || exit 0
today="$(/bin/date +%Y-%m-%d)"
# Метки и штампы журнала старше 60 дней уже ни на что не влияют.
/usr/bin/find "${MARKERS_DIR}" -type f -mtime +60 -delete 2>/dev/null || true

# Пишет строку в журнал не чаще раза в день на каждый вид события.
log_once() {
  local kind="$1" message="$2"
  local stamp="${MARKERS_DIR}/log-${kind}-${today}"
  [[ -f "${stamp}" ]] && return 0
  echo "$(date): goal-report: ${message}" >> "${LOG_FILE}"
  : > "${stamp}"
}

# Без настроек Telegram слать некуда — выходим до запуска скрипта, чтобы не звать его и ИИ на каждом проходе.
TG_BOT_TOKEN=""
TG_CHAT_ID=""
if [[ -f "${ENV_FILE}" ]]; then
  TG_BOT_TOKEN="$(grep '^TG_BOT_TOKEN=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  TG_CHAT_ID="$(grep '^TG_CHAT_ID=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
fi
if [[ -z "${TG_BOT_TOKEN}" || -z "${TG_CHAT_ID}" ]]; then
  log_once "no-telegram" "TG_BOT_TOKEN или TG_CHAT_ID не заданы в .env, сообщения не отправляются"
  exit 0
fi

err_file="$(/usr/bin/mktemp -t goal-report-err)"
trap 'rm -f "${err_file}"' EXIT

# Ключи скрипту не передаются: пробные запуски (--dry-run, --as-of) делаются напрямую, без отправки.
if ! output="$(pnpm --silent --filter @workspace/scripts run goal-report 2>"${err_file}")"; then
  log_once "crash" "скрипт завершился с ошибкой: $(tail -1 "${err_file}" | head -c 200)"
  exit 0
fi

# Файл цели есть, но негоден — причина в stderr строкой «goal-report: …».
if [[ -z "${output}" ]] && invalid_reason="$(grep -m1 '^goal-report:' "${err_file}")"; then
  log_once "invalid" "${invalid_reason:0:200}"
fi

# Пусто — «ещё не время»: ничего не делаем и метку не ставим.
[[ -n "${output}" ]] || exit 0

marker="${output%%$'\n'*}"
if [[ ! "${marker}" =~ ^goal-(streak|daily|weekly|review)-[0-9-]+$ ]]; then
  log_once "protocol" "непонятная первая строка вывода, сообщение не отправлено"
  exit 0
fi

text=""
if [[ "${output}" == *$'\n'* ]]; then
  text="${output#*$'\n'}"
fi

# Только имя метки — «решено молчать»: ставим метку и не шлём.
if [[ -z "${text//[[:space:]]/}" ]]; then
  : > "${MARKERS_DIR}/${marker}"
  exit 0
fi

# --data-urlencode: в тексте есть свободные слова, а простой -d обрезает его на &, + и %.
response="$(curl -s --max-time 10 "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TG_CHAT_ID}" \
  --data-urlencode "text=${text}" 2>/dev/null || true)"

# Метка — только после подтверждения Telegram; иначе попробуем на следующем проходе.
if echo "${response}" | grep -q '"ok":true'; then
  : > "${MARKERS_DIR}/${marker}"
  echo "$(date): goal-report: отправлено ${marker}" >> "${LOG_FILE}"
else
  log_once "send-failed" "не отправлено ${marker}: $(echo "${response}" | head -c 200)"
fi
