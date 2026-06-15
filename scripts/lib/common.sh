#!/usr/bin/env bash
# Общие переменные для утилит focus-track.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${REPO_ROOT}/data"
PAUSE_FILE="${DATA_DIR}/pause"
LOG_DIR="${DATA_DIR}/logs"
CAPTURE_CLI="${REPO_ROOT}/mac/bin/focus-capture"
CAPTURE_APP="${REPO_ROOT}/mac/Focus Capture.app"
# Актуальный путь (после prepare_capture_binary предпочитает .app)
CAPTURE_BIN="${REPO_ROOT}/mac/bin/focus-capture"
SETTINGS_FILE="${REPO_ROOT}/focus-app-settings.json"
DB_FILE="${REPO_ROOT}/focus.db"
ENV_FILE="${REPO_ROOT}/.env"

notify() {
  local title="$1"
  local message="$2"
  if command -v terminal-notifier >/dev/null 2>&1; then
    terminal-notifier -title "$title" -message "$message" 2>/dev/null || true
  fi
}

read_dashboard_port() {
  # shellcheck source=port.sh
  source "$(dirname "${BASH_SOURCE[0]}")/port.sh"
  read_env_port "$REPO_ROOT" 5001
}

prepare_capture_binary() {
  local bin="${CAPTURE_CLI}"
  [[ -f "$bin" ]] || return 1
  chmod +x "$bin" 2>/dev/null || true
  xattr -dr com.apple.quarantine "$bin" 2>/dev/null || true
  # shellcheck source=sign-capture.sh
  source "$(dirname "${BASH_SOURCE[0]}")/sign-capture.sh"
  sign_capture_binary "$bin"
  # shellcheck source=capture-app.sh
  source "$(dirname "${BASH_SOURCE[0]}")/capture-app.sh"
  ensure_capture_app_bundle "$REPO_ROOT"
  xattr -dr com.apple.quarantine "$CAPTURE_APP" 2>/dev/null || true
  local resolved
  resolved="$(resolve_capture_executable "$REPO_ROOT")"
  [[ -n "$resolved" ]] && CAPTURE_BIN="$resolved"
}

open_screen_recording_settings() {
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null || true
}
