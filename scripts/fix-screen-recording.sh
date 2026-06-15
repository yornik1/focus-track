#!/usr/bin/env bash
# Запись экрана: одна .app «Focus Capture», тест, настройки.
set -euo pipefail

source "$(dirname "$0")/lib/common.sh"
prepare_capture_binary

CAPTURE_BIN="$(resolve_capture_executable "$REPO_ROOT")"
[[ -n "$CAPTURE_BIN" ]] || { echo "✗ Нет mac/bin/focus-capture"; exit 1; }

echo "Focus Tracker — запись экрана"
echo "=============================="
echo ""
echo "macOS не добавляет доступ «сам» по галочке для сырого файла."
echo "Нужно один раз нажать «Разрешить» во всплывающем окне."
echo ""
echo "В настройках ищите: Focus Capture (не старые focus-capture)."
echo "Путь:"
echo "  $CAPTURE_BIN"
echo ""

TEST="/tmp/focus-screen-recording-test.jpg"
ERR="/tmp/focus-capture-test.err"
rm -f "$TEST" "$ERR"

echo "→ Пробный скриншот (должно всплыть окно — Разрешить)..."
if "$CAPTURE_BIN" "$TEST" 640 0.4 2>"$ERR" && [[ -s "$TEST" ]]; then
  echo "✅ Работает ($(ls -lh "$TEST" | awk '{print $5}'))"
  rm -f "$TEST" "$ERR"
  echo ""
  echo "Перезапуск фона:"
  echo "  launchctl unload ~/Library/LaunchAgents/com.focus-track.screenshot.plist"
  echo "  launchctl load ~/Library/LaunchAgents/com.focus-track.screenshot.plist"
  exit 0
fi

echo "❌ Скриншот пустой или ошибка"
[[ -f "$ERR" ]] && cat "$ERR"
echo ""
echo "Сделайте так:"
echo "  1. Настройки → Конфиденциальность → Запись экрана"
echo "  2. Удалите (−) ВСЕ строки focus-capture / Focus Capture"
echo "  3. Снова: make fix-screen-recording"
echo "  4. На всплывающем запросе — Разрешить (не только галочка в списке)"
echo ""
open_screen_recording_settings
exit 1
