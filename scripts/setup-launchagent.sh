#!/bin/bash
# Устанавливает оба LaunchAgent: захват скринов + API сервер (дашборд)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$REPO_ROOT/data/logs"

PORT="$(grep '^PORT=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d ' "' | tr -d "'" || true)"
PORT="${PORT:-5001}"

if [[ ! -f "$REPO_ROOT/focus-app-settings.json" ]]; then
  echo "ℹ️  Gemini key — в дашборде: http://localhost:${PORT}/#settings"
  echo ""
fi

install_plist() {
  local name="$1"
  local src="$REPO_ROOT/mac/${name}.plist"
  local dst="$HOME/Library/LaunchAgents/${name}.plist"

  sed -e "s|/path/to/focus-track|$REPO_ROOT|g" \
      -e "s|__FOCUS_PORT__|$PORT|g" \
      "$src" > "$dst"
  launchctl unload "$dst" 2>/dev/null || true
  pkill -f "${name}" 2>/dev/null || true
  sleep 1
  launchctl load "$dst"
  echo "  ✓ $name"
}

echo "Устанавливаю LaunchAgents..."
install_plist "com.focus-track.screenshot"
install_plist "com.focus-track.api-server"

echo ""
echo "Готово! После ребута всё запустится автоматически."
echo ""
echo "  Дашборд: http://localhost:${PORT}/#settings"
echo "  Логи:    $REPO_ROOT/data/logs/"
echo ""
echo "  Screen Recording: добавьте mac/bin/focus-capture в"
echo "  System Settings → Privacy → Screen Recording"
