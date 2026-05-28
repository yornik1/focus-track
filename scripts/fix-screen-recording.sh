#!/usr/bin/env bash
# Сброс путаницы TCC: подпись бинарника, тест, открыть настройки.
set -euo pipefail

source "$(dirname "$0")/lib/common.sh"
# shellcheck source=lib/sign-capture.sh
source "$(dirname "$0")/lib/sign-capture.sh"

echo "Focus Tracker — запись экрана"
echo "=============================="
echo ""
echo "Путь к утилите (именно его спрашивает macOS):"
echo "  $CAPTURE_BIN"
echo ""

chmod +x "$CAPTURE_BIN" 2>/dev/null || true
sign_capture_binary "$CAPTURE_BIN"

TEST="/tmp/focus-screen-recording-test.jpg"
rm -f "$TEST"

echo "→ Пробный скриншот (может всплыть ОДИН запрос — нажмите Разрешить)..."
if "$CAPTURE_BIN" "$TEST" 640 0.4 2>/tmp/focus-capture-test.err && [[ -s "$TEST" ]]; then
  echo "✅ Запись экрана работает ($(ls -lh "$TEST" | awk '{print $5}'))"
  rm -f "$TEST" /tmp/focus-capture-test.err
  exit 0
fi

echo "❌ Скриншот не вышел"
[[ -f /tmp/focus-capture-test.err ]] && tail -3 /tmp/focus-capture-test.err
echo ""
echo "В Системных настройках → Конфиденциальность → Запись экрана:"
echo "  1. Удалите ВСЕ строки «focus-capture» (кнопка −) — это старые копии с других путей."
echo "  2. Не включайте галочки вручную — снова запустите: make fix-screen-recording"
echo "  3. Или +: выберите файл выше → включите только его."
echo ""

open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null || true

exit 1
