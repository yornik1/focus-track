#!/usr/bin/env bash
# .app-обёртка: в «Запись экрана» одна строка «Focus Capture», не куча focus-capture.

capture_app_dir() {
  echo "${1:-$REPO_ROOT}/mac/Focus Capture.app"
}

capture_cli_path() {
  echo "${1:-$REPO_ROOT}/mac/bin/focus-capture"
}

capture_app_executable() {
  echo "$(capture_app_dir "$1")/Contents/MacOS/focus-capture"
}

# Предпочитаем .app, иначе CLI в mac/bin
resolve_capture_executable() {
  local root="${1:-$REPO_ROOT}"
  local app_exe
  app_exe="$(capture_app_executable "$root")"
  local cli
  cli="$(capture_cli_path "$root")"
  if [[ -x "$app_exe" ]]; then
    echo "$app_exe"
  elif [[ -f "$cli" ]]; then
    echo "$cli"
  fi
}

ensure_capture_app_bundle() {
  local root="${1:-$REPO_ROOT}"
  local cli
  cli="$(capture_cli_path "$root")"
  [[ -f "$cli" ]] || return 1

  local app_dir app_exe macos_dir
  app_dir="$(capture_app_dir "$root")"
  app_exe="$(capture_app_executable "$root")"
  macos_dir="${app_dir}/Contents/MacOS"
  mkdir -p "$macos_dir"

  cp -f "$cli" "$app_exe"
  chmod +x "$app_exe"

  cat > "${app_dir}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>focus-capture</string>
  <key>CFBundleIdentifier</key>
  <string>com.focus-track.capture</string>
  <key>CFBundleName</key>
  <string>Focus Capture</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

  xattr -cr "$app_dir" 2>/dev/null || true
  if command -v codesign >/dev/null 2>&1; then
    codesign --sign - --force --deep --timestamp=none "$app_dir" 2>/dev/null || true
  fi
}
