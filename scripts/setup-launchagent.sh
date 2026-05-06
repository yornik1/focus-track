#!/bin/bash
# Прописывает реальные пути и устанавливает LaunchAgent

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$REPO_ROOT/mac/com.focus-track.screenshot.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.focus-track.screenshot.plist"

# Читаем GEMINI_API_KEY из .env если есть
if [ -f "$REPO_ROOT/.env" ]; then
  GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")
  export GEMINI_API_KEY
fi

# Проверяем что ключ есть
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "⚠️  GEMINI_API_KEY не найден в .env"
  echo "   Добавьте GEMINI_API_KEY=your-key в $REPO_ROOT/.env"
  echo "   Или установите Ollama и измените FOCUS_PROVIDER=ollama"
  exit 1
fi

# Генерируем plist с реальными путями
sed \
  -e "s|/path/to/focus-track|$REPO_ROOT|g" \
  -e "s|<string></string><!-- GEMINI_API_KEY -->|<string>${GEMINI_API_KEY}</string>|" \
  "$PLIST_SRC" > "$PLIST_DST"

# Выгружаем старый если был
launchctl unload "$PLIST_DST" 2>/dev/null || true

# Загружаем
launchctl load "$PLIST_DST"

echo "✓ LaunchAgent установлен: $PLIST_DST"
echo "  Логи: /tmp/focus-track-screenshot.out.log"
echo "  Ошибки: /tmp/focus-track-screenshot.err.log"
echo ""
echo "⚠️  Важно: дайте разрешение Screen Recording для Terminal/iTerm:"
echo "   System Settings → Privacy & Security → Screen Recording"
