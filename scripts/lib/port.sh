#!/usr/bin/env bash
# Выбор порта дашборда и запись в .env

port_is_free() {
  ! lsof -i ":$1" -sTCP:LISTEN >/dev/null 2>&1
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
  local existing p

  existing="$(read_env_port "$repo" "$start")"
  if port_is_free "$existing"; then
    echo "$existing"
    return 0
  fi

  for ((p = start; p <= end; p++)); do
    if port_is_free "$p"; then
      echo "$p"
      return 0
    fi
  done
  return 1
}
