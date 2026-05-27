#!/usr/bin/env bash
# Единый PATH: user-local (fnm/pnpm) + Homebrew. Без nvm, без sudo.

focus_export_toolchain_path() {
  export PATH="${HOME}/.local/share/fnm/aliases/default/bin:${HOME}/Library/pnpm:${HOME}/.local/share/pnpm:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
}
