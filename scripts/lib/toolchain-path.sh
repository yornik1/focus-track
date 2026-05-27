#!/usr/bin/env bash
# Единый PATH: nvm, fnm, pnpm, Homebrew — для Terminal и LaunchAgent.

focus_export_toolchain_path() {
  local nvm_bin=""
  if [[ -d "${HOME}/.nvm/versions/node" ]]; then
    nvm_bin="${HOME}/.nvm/versions/node/$(ls "${HOME}/.nvm/versions/node/" 2>/dev/null | tail -1)/bin"
  fi
  export PATH="${nvm_bin:+$nvm_bin:}${HOME}/.local/share/fnm/aliases/default/bin:${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
}

# fnm бинарник с GitHub — без Homebrew (второй юзер на Mac)
install_fnm_binary() {
  export FNM_DIR="${HOME}/.local/share/fnm"
  mkdir -p "${FNM_DIR}"
  if [[ -x "${FNM_DIR}/fnm" ]]; then
    return 0
  fi
  local zip="/tmp/fnm-macos-$$.zip"
  curl -fsSL "https://github.com/Schniz/fnm/releases/latest/download/fnm-macos.zip" -o "${zip}"
  unzip -qo "${zip}" -d "${FNM_DIR}"
  chmod +x "${FNM_DIR}/fnm"
  rm -f "${zip}"
}
