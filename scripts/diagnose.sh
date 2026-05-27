#!/usr/bin/env bash
# Диагностика локальной установки focus-track.

set -euo pipefail

source "$(dirname "$0")/lib/common.sh"

echo "============================================"
echo "  Focus Tracker — диагностика"
echo "  $(date)"
echo "  REPO: $REPO_ROOT"
echo "============================================"
echo ""

echo "=== 1. Скринер ==="
if [[ -x "$CAPTURE_BIN" ]]; then
  echo "✅ focus-capture есть"
  TEST="/tmp/focus-diag-test.jpg"
  if "$CAPTURE_BIN" "$TEST" 768 0.4 2>/dev/null && [[ -s "$TEST" ]]; then
    echo "✅ Скриншот работает ($(ls -lh "$TEST" | awk '{print $5}'))"
    rm -f "$TEST"
  else
    echo "❌ Скриншот пустой — проверьте Screen Recording для mac/bin/focus-capture"
    rm -f "$TEST"
  fi
else
  echo "❌ focus-capture не найден — запустите: make focus-great-again"
fi
echo ""

echo "=== 2. LaunchAgents ==="
for label in com.focus-track.screenshot com.focus-track.api-server; do
  if launchctl list 2>/dev/null | grep -q "$label"; then
    line=$(launchctl list 2>/dev/null | grep "$label" || true)
    echo "✅ $label: $line"
  else
    echo "❌ $label не загружен"
  fi
done
echo ""

echo "=== 3. Пауза ==="
if [[ -f "$PAUSE_FILE" ]]; then
  until=$(cat "$PAUSE_FILE" 2>/dev/null || echo 0)
  now=$(date +%s)
  if [[ "$until" -gt "$now" ]]; then
    mins=$(( (until - now) / 60 ))
    echo "⚠️  На паузе ещё ~${mins} мин"
  else
    echo "⚠️  Файл паузы есть, но время истекло"
  fi
else
  echo "✅ Активен (не на паузе)"
fi
echo ""

echo "=== 4. Idle ==="
idle_line=$(ioreg -c IOHIDSystem -r -k HIDIdleTime 2>/dev/null | grep HIDIdleTime | head -1 || true)
idle_ns="${idle_line##*= }"
idle_ns="${idle_ns//[^0-9]/}"
idle_s=$((idle_ns / 1000000000))
if [[ "$idle_s" -gt 300 ]]; then
  echo "⚠️  Idle ${idle_s}s — скрины не делаются (порог из настроек)"
else
  echo "✅ Активен (idle ${idle_s}s)"
fi
echo ""

echo "=== 5. Настройки ==="
if [[ -f "$SETTINGS_FILE" ]]; then
  provider=$(grep '"provider"' "$SETTINGS_FILE" | head -1 | grep -o '"[^"]*"' | tail -1 | tr -d '"' || echo "?")
  has_token=$(grep '"token"' "$SETTINGS_FILE" | grep -v '""' | head -1 || true)
  if [[ -n "$has_token" ]]; then
    echo "✅ focus-app-settings.json ($provider, ключ задан)"
  else
    echo "⚠️  focus-app-settings.json есть, но token пуст — Settings → Test connection"
  fi
else
  echo "⚠️  focus-app-settings.json нет — настройте Gemini в дашборде"
fi
echo ""

echo "=== 6. База данных ==="
if [[ -f "$DB_FILE" ]]; then
  count=$(sqlite3 "$DB_FILE" "SELECT count(*) FROM focus_log;" 2>/dev/null || echo "?")
  last=$(sqlite3 "$DB_FILE" "SELECT datetime, focus_score, summary FROM focus_log ORDER BY id DESC LIMIT 1;" 2>/dev/null || true)
  echo "✅ focus.db — записей: $count"
  if [[ -n "$last" ]]; then
    echo "   Последняя: $last"
  fi
else
  echo "⚠️  focus.db нет (создастся при первом анализе)"
fi
echo ""

echo "=== 7. Логи захвата (последние 10) ==="
if [[ -f "${LOG_DIR}/capture.log" ]]; then
  tail -10 "${LOG_DIR}/capture.log"
else
  echo "(пусто — ${LOG_DIR}/capture.log)"
fi
echo ""

echo "=== 8. API сервер ==="
DASH_PORT="$(read_dashboard_port)"
if curl -sf "http://localhost:${DASH_PORT}/api/settings" >/dev/null 2>&1; then
  echo "✅ http://localhost:${DASH_PORT} отвечает"
  echo "   Settings: http://localhost:${DASH_PORT}/#settings"
else
  echo "❌ Дашборд не отвечает на :${DASH_PORT} — make dev или LaunchAgent"
fi
echo ""

echo "============================================"
