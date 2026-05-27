#!/usr/bin/env bash
# Общие переменные для утилит focus-track.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${REPO_ROOT}/data"
PAUSE_FILE="${DATA_DIR}/pause"
LOG_DIR="${DATA_DIR}/logs"
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
