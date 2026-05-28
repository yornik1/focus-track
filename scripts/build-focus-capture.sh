#!/usr/bin/env bash
# Сборка mac/bin/focus-capture (universal arm64 + x86_64). Нужен swiftc (Xcode CLT) — только у maintainer.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/mac/bin/focus-capture.swift"
OUT="$REPO_ROOT/mac/bin/focus-capture"
BIN_DIR="$REPO_ROOT/mac/bin"
TMP="$BIN_DIR/.build-capture"

[[ -f "$SRC" ]] || { echo "✗ Нет $SRC" >&2; exit 1; }
command -v swiftc >/dev/null 2>&1 || { echo "✗ Нужен swiftc (Xcode Command Line Tools)" >&2; exit 1; }

mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

FRAMEWORKS=(-framework Cocoa -framework ScreenCaptureKit)
SWIFT_FLAGS=(-O)

build_arch() {
  local arch="$1"
  local out="$2"
  swiftc "${SWIFT_FLAGS[@]}" -o "$out" "$SRC" "${FRAMEWORKS[@]}" -target "${arch}-apple-macos14.0"
}

echo "→ arm64..."
build_arch arm64 "$TMP/focus-capture-arm64"
echo "→ x86_64..."
build_arch x86_64 "$TMP/focus-capture-x86_64"
echo "→ lipo universal..."
lipo -create -output "$OUT" "$TMP/focus-capture-arm64" "$TMP/focus-capture-x86_64"
chmod +x "$OUT"
# shellcheck source=lib/sign-capture.sh
source "$(dirname "$0")/lib/sign-capture.sh"
sign_capture_binary "$OUT"

echo "✓ $OUT"
codesign -dv "$OUT" 2>/dev/null | grep -E 'Signature|Identifier' || true
lipo -info "$OUT"
