#!/usr/bin/env bash
# Opens the .dmg built by the release workflow and runs the desktop app's smoke test
# (MOSHPIT_SMOKE_TEST, see src-tauri/src/smoke.rs) on the app inside it.
#
#   scripts/smoke-macos.sh path/to/moshpit.dmg
set -euo pipefail

dmg=$(realpath "$1")
echo "== macOS $(sw_vers -productVersion) ($(uname -m)): $(basename "$dmg")"
mnt=$(mktemp -d)
hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mnt" > /dev/null
trap 'hdiutil detach "$mnt" -force > /dev/null || true' EXIT
app="$mnt/moshpit.app/Contents/MacOS/moshpit"
file "$app" "$mnt/moshpit.app/Contents/MacOS/moshpit-ffmpeg"

export MOSHPIT_SMOKE_TEST=${SMOKE:-network}
code=0
"$app" > smoke.out 2> smoke.err || code=$?
sed -n '/^{/,/^}/p' smoke.out
grep -E 'moshpit smoke test' smoke.err || tail -20 smoke.err
echo "== macOS $(sw_vers -productVersion): exit $code"
exit $code
