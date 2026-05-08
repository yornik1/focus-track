#!/usr/bin/env bash
# Тест отправки сообщения в Telegram
set -euo pipefail

FOCUS_TRACK_ROOT="${FOCUS_TRACK_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

if [[ ! -f "${FOCUS_TRACK_ROOT}/.env" ]]; then
  echo "Нет .env файла"
  exit 1
fi

TG_BOT_TOKEN=$(grep '^TG_BOT_TOKEN=' "${FOCUS_TRACK_ROOT}/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
TG_CHAT_ID=$(grep '^TG_CHAT_ID=' "${FOCUS_TRACK_ROOT}/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [[ -z "${TG_BOT_TOKEN}" || -z "${TG_CHAT_ID}" ]]; then
  echo "TG_BOT_TOKEN или TG_CHAT_ID не заданы в .env"
  exit 1
fi

msg="${1:-🧪 Focus Tracker: тестовое сообщение ($(date))}"

echo "Отправляю в Telegram (chat_id=${TG_CHAT_ID})..."
response=$(curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TG_CHAT_ID}" \
  -d text="${msg}")

if echo "${response}" | grep -q '"ok":true'; then
  echo "Успешно отправлено!"
else
  echo "Ошибка: ${response}"
  exit 1
fi
