#!/usr/bin/env bash
# Полная установка focus-track на macOS. Одна команда: make focus-great-again

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
die() { echo ""; echo "✗ $*"; echo ""; exit 1; }

run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# ZIP из браузера: macOS ставит quarantine — скрипты могут не запускаться
clear_quarantine() {
  if $DRY_RUN; then
    return 0
  fi
  if xattr -l "$REPO_ROOT" 2>/dev/null | grep -q com.apple.quarantine; then
    log "Снимаю quarantine (скачано из браузера)..."
    xattr -dr com.apple.quarantine "$REPO_ROOT" 2>/dev/null || true
  fi
}

# GitHub ZIP часто снимает +x — без этого bootstrap ошибочно лезет в Xcode CLT
prepare_release_binaries() {
  # shellcheck source=lib/common.sh
  source "$(dirname "$0")/lib/common.sh"
  prepare_capture_binary 2>/dev/null || true
  chmod +x "$REPO_ROOT/mac/"*.sh 2>/dev/null || true
  chmod +x "$REPO_ROOT/scripts/"*.sh 2>/dev/null || true
}

# Релизный ZIP: focus-capture уже в архиве
is_release_install() {
  [[ -f "$REPO_ROOT/mac/bin/focus-capture" ]]
}

ensure_network() {
  if $DRY_RUN; then
    return 0
  fi
  if ! curl -fsSL --max-time 10 https://registry.npmjs.org/pnpm/-/pnpm-10.0.0.tgz -o /dev/null 2>/dev/null; then
    die "Нет интернета или npm registry недоступен. Проверьте сеть и VPN."
  fi
  ok "интернет"
}

ensure_port() {
  # shellcheck source=lib/port.sh
  source "$(dirname "$0")/lib/port.sh"
  if $DRY_RUN; then
    FOCUS_PORT=5001
    ok "порт $FOCUS_PORT"
    return 0
  fi
  if ! FOCUS_PORT="$(find_free_port "$REPO_ROOT" 5001 5010)"; then
    die "Нет свободного порта 5001–5010"
  fi
  write_env_port "$REPO_ROOT" "$FOCUS_PORT"
  if [[ "$FOCUS_PORT" != "5001" ]]; then
    warn "5001 занят — дашборд на порту $FOCUS_PORT"
  fi
  ok "порт $FOCUS_PORT"
}

# Homebrew часто ставится, но не попадает в PATH текущей сессии
setup_brew_path() {
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

ensure_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "Focus Tracker работает только на macOS."
  fi
}

# git + swiftc — только если нужна пересборка focus-capture (в релизе бинарник уже в ZIP)
ensure_xcode_clt() {
  if command -v swiftc >/dev/null 2>&1 && xcode-select -p >/dev/null 2>&1; then
    return 0
  fi
  if $DRY_RUN; then
    log "Xcode CLT (окно Install)"
    return 0
  fi
  echo ""
  echo "  Нужны Xcode Command Line Tools — только если в папке нет mac/bin/focus-capture."
  echo "  Скачайте релизный ZIP (v0.0.9+) или: chmod +x mac/bin/focus-capture"
  echo ""
  xcode-select --install 2>/dev/null || true
  die "Дождитесь установки Command Line Tools и запустите make focus-great-again ещё раз."
}

# Бинарник из релиза подходит для текущей архитектуры?
capture_binary_usable() {
  local bin="$REPO_ROOT/mac/bin/focus-capture"
  [[ -f "$bin" ]] || return 1
  chmod +x "$bin" 2>/dev/null || true
  [[ -x "$bin" ]] || return 1
  local host
  host="$(uname -m)"
  local info
  info="$(file -b "$bin" 2>/dev/null || true)"
  case "$host" in
    arm64)  [[ "$info" == *arm64* ]] ;;
    x86_64) [[ "$info" == *x86_64* ]] ;;
    *)      return 1 ;;
  esac
}

# Homebrew — только если доступен. Без admin не ставим (нужен пароль).
brew_usable() {
  setup_brew_path
  command -v brew >/dev/null 2>&1 || return 1
  brew --version >/dev/null 2>&1 || return 1
  # brew в PATH, но чужой (Permission denied у второго юзера)
  brew install --dry-run --quiet hello >/dev/null 2>&1 || return 1
}

user_is_admin() {
  groups 2>/dev/null | grep -qE '(admin|wheel)' || [[ "$(id -u)" -eq 0 ]]
}

ensure_homebrew() {
  if brew_usable; then
    ok "Homebrew"
    return 0
  fi
  setup_brew_path
  if command -v brew >/dev/null 2>&1; then
    warn "Homebrew установлен другим пользователем — пропускаю"
    return 0
  fi
  if $DRY_RUN; then
    log "Homebrew (если admin)"
    return 0
  fi
  if ! user_is_admin; then
    warn "Homebrew недоступен (нет прав admin) — Node/pnpm поставлю в ~/"
    return 0
  fi
  log "Ставлю Homebrew (macOS один раз спросит пароль admin)..."
  NONINTERACTIVE=1 run /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  setup_brew_path
  if brew_usable; then
    ok "Homebrew"
  else
    warn "Homebrew не установился — продолжаю без него"
  fi
}

verify_node_pnpm() {
  focus_export_toolchain_path
  hash -r 2>/dev/null || true

  command -v node >/dev/null 2>&1 || return 1
  command -v pnpm >/dev/null 2>&1 || return 1

  local ver
  ver=$(node -v | tr -d 'v' | cut -d. -f1)
  [[ "$ver" -ge 20 ]]
}

# Node + pnpm через Homebrew (если brew работает у этого юзера)
ensure_toolchain_brew() {
  local missing=()
  focus_export_toolchain_path
  command -v node >/dev/null 2>&1 || missing+=(node)
  command -v pnpm >/dev/null 2>&1 || missing+=(pnpm)

  if [[ ${#missing[@]} -gt 0 ]]; then
    log "Ставлю через Homebrew: ${missing[*]}..."
    run brew install "${missing[@]}"
    setup_brew_path
    hash -r 2>/dev/null || true
  fi

  if ! brew_usable; then
    return 1
  fi

  if command -v terminal-notifier >/dev/null 2>&1; then
    :
  else
    run brew install terminal-notifier 2>/dev/null || warn "terminal-notifier пропущен"
  fi

  verify_node_pnpm
}

# Node + pnpm в ~/ — без admin, без Homebrew
ensure_toolchain_user_local() {
  if $DRY_RUN; then
    log "Node/pnpm → ~/.local (fnm, без brew)"
    return 0
  fi

  log "Ставлю Node/pnpm в ~/ (без Homebrew)..."

  # shellcheck source=lib/toolchain-path.sh
  source "$(dirname "$0")/lib/toolchain-path.sh"
  install_fnm_binary

  export FNM_DIR="${HOME}/.local/share/fnm"
  export PATH="${FNM_DIR}:${PATH:-}"
  # shellcheck disable=SC1090
  eval "$(fnm env --shell=bash)"

  if ! fnm list 2>/dev/null | grep -qE '\b22\b'; then
    run fnm install 22
  fi
  run fnm default 22
  eval "$(fnm env --shell=bash)"

  if ! command -v pnpm >/dev/null 2>&1; then
    run npm install -g pnpm@10
  fi

  focus_export_toolchain_path
  hash -r 2>/dev/null || true

  verify_node_pnpm || die "Node/pnpm не установились. Лог: bash -x scripts/bootstrap.sh 2>&1 | tee ~/focus-install.log"
}

ensure_toolchain() {
  # shellcheck source=lib/toolchain-path.sh
  source "$(dirname "$0")/lib/toolchain-path.sh"
  focus_export_toolchain_path
  hash -r 2>/dev/null || true

  if verify_node_pnpm; then
    ok "Node $(node -v)"
    ok "pnpm $(pnpm -v)"
    command -v terminal-notifier >/dev/null 2>&1 && ok "terminal-notifier" || warn "terminal-notifier нет (уведомления pause/resume отключены)"
    return 0
  fi

  # Релиз: не ставим Homebrew с нуля (его установщик тянет Command Line Tools)
  if is_release_install; then
    log "Node/pnpm → ~/ (релизный ZIP, без установки Homebrew)"
    ensure_toolchain_user_local
    ok "Node $(node -v)"
    ok "pnpm $(pnpm -v)"
    return 0
  fi

  if ! brew_usable; then
    log "Node/pnpm → ~/ (Homebrew недоступен этому пользователю)"
  elif ! ensure_toolchain_brew || ! verify_node_pnpm; then
    warn "Homebrew не сработал — ставлю Node/pnpm в ~/"
  else
    ok "Node $(node -v)"
    ok "pnpm $(pnpm -v)"
    command -v terminal-notifier >/dev/null 2>&1 && ok "terminal-notifier" || warn "terminal-notifier нет"
    return 0
  fi

  ensure_toolchain_user_local
  ok "Node $(node -v)"
  ok "pnpm $(pnpm -v)"
}

install_deps() {
  log "Зависимости проекта (первый раз 5–15 мин, не прерывайте)..."
  cd "$REPO_ROOT"
  if ! run pnpm install --frozen-lockfile; then
    die "pnpm install упал. Запустите make focus-great-again ещё раз. Лог: bash -x scripts/bootstrap.sh 2>&1 | tee ~/focus-install.log"
  fi
  ok "зависимости"
}

push_db() {
  log "База данных..."
  cd "$REPO_ROOT"
  run pnpm --filter @workspace/db push
  ok "focus.db"
}

compile_capture() {
  log "Утилита захвата экрана..."
  mkdir -p "$REPO_ROOT/mac/bin"
  if $DRY_RUN; then
    echo "  [dry-run] focus-capture"
    return 0
  fi
  if capture_binary_usable; then
    ok "mac/bin/focus-capture (из релиза)"
    return 0
  fi
  ensure_xcode_clt
  if ! command -v swiftc >/dev/null 2>&1; then
    die "Нет focus-capture и нет swiftc — скачайте релизный ZIP или установите Command Line Tools"
  fi
  log "Сборка focus-capture из исходников..."
  swiftc -O -o "$REPO_ROOT/mac/bin/focus-capture" \
    "$REPO_ROOT/mac/bin/focus-capture.swift" \
    -framework Cocoa -framework ScreenCaptureKit
  source "$(dirname "$0")/lib/common.sh"
  prepare_capture_binary
  ok "mac/bin/focus-capture (собран)"
}

ensure_env() {
  if [[ -f "$REPO_ROOT/.env" ]]; then
    ok ".env уже есть"
    return 0
  fi
  if [[ -f "$REPO_ROOT/.env.example" ]]; then
    cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
    ok ".env создан"
  fi
}

request_screen_recording() {
  log "Разрешение Screen Recording..."
  local test="/tmp/focus-perm-test.jpg"
  local bin="$REPO_ROOT/mac/bin/focus-capture"
  if $DRY_RUN; then
    echo "  [dry-run] focus-capture + System Settings"
    return 0
  fi
  source "$(dirname "$0")/lib/common.sh"
  prepare_capture_binary
  echo ""
  echo "  Если всплывёт запрос — Разрешить (для этого файла):"
  echo "  $bin"
  echo ""
  "$bin" "$test" 640 0.4 2>/dev/null || true
  if [[ -s "$test" ]]; then
    ok "Screen Recording OK"
    rm -f "$test"
    return 0
  fi
  rm -f "$test"
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null || true
  echo ""
  warn "Запись экрана: удалите ВСЕ старые «focus-capture» в списке (−), затем:"
  echo "  make fix-screen-recording"
  echo "  или + → $bin"
  echo ""
}

install_launchagents() {
  log "Фоновые сервисы..."
  run "$REPO_ROOT/scripts/setup-launchagent.sh"
}

print_gemini_hint() {
  local keys_url="https://aistudio.google.com/api-keys"
  echo "  Ключ Gemini: $keys_url"
  echo "  Название проекта и ключа — любые. Скопируйте ключ → вставьте в Settings."
}

print_done() {
  local url="http://localhost:${FOCUS_PORT:-5001}/#settings"
  local keys_url="https://aistudio.google.com/api-keys"
  echo ""
  echo "============================================"
  echo "  Готово"
  echo "============================================"
  echo ""
  echo "  Настройка Gemini (откроется в браузере):"
  echo "  $keys_url"
  echo "  $url"
  echo ""
  print_gemini_hint
  echo ""
  if ! $DRY_RUN; then
    sleep 2
    open "$keys_url" 2>/dev/null || true
    open "$url" 2>/dev/null || true
  fi
  echo "  Проверка: make diagnose"
  echo ""
}

main() {
  echo ""
  echo "Focus Tracker — установка"
  echo "========================="
  echo ""

  ensure_macos
  clear_quarantine
  prepare_release_binaries
  ensure_network
  if is_release_install; then
    setup_brew_path
    if brew_usable; then
      ok "Homebrew (уже был)"
    else
      warn "Homebrew не ставим — в релизе уже есть focus-capture, Node/pnpm пойдут в ~/"
    fi
  else
    ensure_homebrew
  fi
  ensure_toolchain
  install_deps
  push_db
  compile_capture
  ensure_env
  request_screen_recording
  ensure_port
  install_launchagents
  print_done
}

main "$@"
