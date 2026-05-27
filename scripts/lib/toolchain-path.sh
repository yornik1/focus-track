#!/usr/bin/env bash
# Единый PATH: nvm, fnm, pnpm, Homebrew — для Terminal и LaunchAgent.

focus_export_toolchain_path() {
  local nvm_bin=""
  if [[ -d "${HOME}/.nvm/versions/node" ]]; then
    nvm_bin="${HOME}/.nvm/versions/node/$(ls "${HOME}/.nvm/versions/node/" 2>/dev/null | tail -1)/bin"
  fi
  export PATH="${nvm_bin:+$nvm_bin:}${HOME}/.local/share/fnm/aliases/default/bin:${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
}

# Для подстановки в plist (одна строка)
focus_toolchain_path_string() {
  echo '$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/Library/pnpm:$HOME/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
}
