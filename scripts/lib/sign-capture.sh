#!/usr/bin/env bash
# Ad-hoc подпись focus-capture — macOS реже сбрасывает TCC при том же CDHash.

sign_capture_binary() {
  local bin="${1:-}"
  [[ -n "$bin" && -f "$bin" ]] || return 1
  if ! command -v codesign >/dev/null 2>&1; then
    return 0
  fi
  xattr -cr "$bin" 2>/dev/null || true
  codesign --sign - --force --timestamp=none "$bin" 2>/dev/null || true
}
