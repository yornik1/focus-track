#!/usr/bin/env bash
# Полная установка focus-track на macOS.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

log() { echo "→ $*"; }
ok()  { echo "  ✓ $*"; }
warn(){ echo "  ⚠ $*"; }

run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

ensure_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Focus Tracker поддерживает только macOS."
    exit 1
  fi
}

ensure_git() {
  if ! command -v git >/dev/null 2>&1; then
    echo "Нужен git. Установите Xcode Command Line Tools:"
    echo "  xcode-select --install"
    exit 1
  fi
}

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew"
    return 0
  fi
  warn "Homebrew не найден — понадобится для Node и terminal-notifier"
  if $DRY_RUN; then
    log "Установка Homebrew (интерактивно)"
    return 0
  fi
  read -r -p "Установить Homebrew? [Y/n] " ans
  if [[ "${ans:-Y}" =~ ^[Yy]$ ]]; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  else
    echo "Без Homebrew нужен Node ≥ 20 и pnpm в PATH."
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    ver=$(node -v | tr -d 'v' | cut -d. -f1)
    if [[ "$ver" -ge 20 ]]; then
      ok "Node $(node -v)"
      return 0
    fi
    warn "Node $(node -v) — нужен ≥ 20"
  fi
  if command -v brew >/dev/null 2>&1; then
    log "Устанавливаю Node 20 через Homebrew..."
    run brew install node@20
    if [[ -d /opt/homebrew/opt/node@20/bin ]]; then
      export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    elif [[ -d /usr/local/opt/node@20/bin ]]; then
      export PATH="/usr/local/opt/node@20/bin:$PATH"
    fi
  else
    echo "Установите Node ≥ 20: https://nodejs.org"
    exit 1
  fi
  ok "Node $(node -v)"
}

ensure_pnpm() {
  export PATH="$HOME/.local/share/pnpm:$PATH"
  if command -v pnpm >/dev/null 2>&1; then
    ok "pnpm $(pnpm -v)"
    return 0
  fi
  log "Включаю pnpm через corepack..."
  run corepack enable
  run corepack prepare pnpm@latest --activate
  ok "pnpm $(pnpm -v)"
}

ensure_terminal_notifier() {
  if command -v terminal-notifier >/dev/null 2>&1; then
    ok "terminal-notifier"
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    log "Устанавливаю terminal-notifier (уведомления pause/resume)..."
    run brew install terminal-notifier
  fi
}

install_deps() {
  log "pnpm install..."
  cd "$REPO_ROOT"
  run pnpm install --frozen-lockfile
  ok "зависимости"
}

push_db() {
  log "Схема БД..."
  cd "$REPO_ROOT"
  run pnpm --filter @workspace/db push
  ok "focus.db"
}

compile_capture() {
  log "Компиляция focus-capture..."
  mkdir -p "$REPO_ROOT/mac/bin"
  if $DRY_RUN; then
    echo "  [dry-run] swiftc ..."
    return 0
  fi
  swiftc -O -o "$REPO_ROOT/mac/bin/focus-capture" \
    "$REPO_ROOT/mac/bin/focus-capture.swift" \
    -framework Cocoa -framework ScreenCaptureKit
  ok "mac/bin/focus-capture"
}

ensure_env() {
  if [[ -f "$REPO_ROOT/.env" ]]; then
    ok ".env уже есть"
    return 0
  fi
  if [[ -f "$REPO_ROOT/.env.example" ]]; then
    cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
    ok ".env создан из .env.example"
  fi
}

request_screen_recording() {
  log "Проверка Screen Recording..."
  local test="/tmp/focus-perm-test.jpg"
  if $DRY_RUN; then
    echo "  [dry-run] focus-capture + open System Settings"
    return 0
  fi
  "$REPO_ROOT/mac/bin/focus-capture" "$test" 640 0.4 2>/dev/null || true
  if [[ -s "$test" ]]; then
    ok "Screen Recording работает"
    rm -f "$test"
    return 0
  fi
  rm -f "$test"
  warn "Screen Recording не выдан — открою System Settings"
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null || true
  echo ""
  echo "  Добавьте в список: $REPO_ROOT/mac/bin/focus-capture"
  echo "  System Settings → Privacy & Security → Screen Recording"
  echo ""
}

install_launchagents() {
  log "LaunchAgents..."
  run "$REPO_ROOT/scripts/setup-launchagent.sh"
}

print_done() {
  echo ""
  echo "============================================"
  echo "  Focus Tracker установлен"
  echo "============================================"
  echo ""
  echo "  Дашборд:  http://localhost:5001"
  echo "  Логи:     $REPO_ROOT/data/logs/"
  echo ""
  echo "  1. Откройте дашборд в браузере"
  echo "  2. Settings → вставьте Gemini API key → Test connection"
  echo "  3. make diagnose — проверка"
  echo ""
  echo "  Пауза:       make pause MIN=10"
  echo "  Стоп сегодня: make stop-today"
  echo "  Бэкап:       make backup"
  echo ""
}

main() {
  echo ""
  echo "Focus Tracker — установка"
  echo "========================="
  echo ""

  ensure_macos
  ensure_git
  ensure_homebrew
  ensure_node
  ensure_pnpm
  ensure_terminal_notifier
  install_deps
  push_db
  compile_capture
  ensure_env
  request_screen_recording
  install_launchagents
  print_done
}

main "$@"
