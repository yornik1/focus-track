#!/usr/bin/env bash
# Выбор порта дашборда и запись в .env

port_is_free() {
  local port="$1"
  # Кто-то слушает порт (любой пользователь на Mac)
  if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    return 1
  fi
  # Уже отвечает focus-track API (на случай если lsof не видит)
  if curl -sf --max-time 1 "http://127.0.0.1:${port}/api/settings" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

read_env_port() {
  local repo="${1:-}"
  local default="${2:-5001}"
  local env_file="${repo}/.env"
  if [[ -f "$env_file" ]]; then
    local val
    val=$(grep '^PORT=' "$env_file" 2>/dev/null | cut -d= -f2- | tr -d ' "' | tr -d "'")
    if [[ -n "$val" ]]; then
      echo "$val"
      return 0
    fi
  fi
  echo "$default"
}

write_env_port() {
  local repo="$1"
  local port="$2"
  local env_file="${repo}/.env"
  if [[ ! -f "$env_file" ]]; then
    echo "PORT=${port}" >> "$env_file"
    return 0
  fi
  if grep -q '^PORT=' "$env_file"; then
    sed -i '' "s/^PORT=.*/PORT=${port}/" "$env_file"
  else
    echo "PORT=${port}" >> "$env_file"
  fi
}

find_free_port() {
  local repo="$1"
  local start="${2:-5001}"
  local end="${3:-5010}"
  local p

  # Всегда сканируем диапазон — не доверяем PORT=5001 из .env.example
  for ((p = start; p <= end; p++)); do
    if port_is_free "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}
