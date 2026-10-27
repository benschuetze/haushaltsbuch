#!/usr/bin/env bash
# Compiles the platform-independent core of the iOS app with the Mac's Swift toolchain and runs the checks in
# ios/Tests/main.swift. Needs only the Command Line Tools, not Xcode. Run from anywhere: paths are resolved here.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="${TMPDIR:-/tmp}/haushaltsbuch-core-tests"
mkdir -p "$out"
# The sandbox forbids the default module cache; an explicit one inside TMPDIR works everywhere.
swiftc -module-cache-path "$out/module-cache" -O \
  "$root"/ios/Haushaltsbuch/Core/*.swift "$root"/ios/Tests/main.swift \
  -o "$out/core-tests" 2>&1 | grep -v 'xcrun_db' || true
test -x "$out/core-tests" || { echo "compile failed"; exit 1; }
"$out/core-tests" "$root"
