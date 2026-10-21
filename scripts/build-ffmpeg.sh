#!/usr/bin/env bash
# Builds the FFmpeg the desktop app bundles, from source, for one target:
#
#   scripts/build-ffmpeg.sh aarch64-apple-darwin      on a Mac with Apple Silicon
#   scripts/build-ffmpeg.sh x86_64-apple-darwin       on a Mac with Apple Silicon (built under Rosetta) or Intel
#   scripts/build-ffmpeg.sh x86_64-unknown-linux-gnu  on Linux
#   scripts/build-ffmpeg.sh x86_64-pc-windows-msvc    on Linux, with mingw-w64 (cross-compiled)
#
# Writes src-tauri/binaries/moshpit-ffmpeg-<target>[.exe] and FFMPEG-NOTICE.txt. Every source is
# checked against scripts/ffmpeg-sources.sh before it is built (nothing prebuilt is downloaded),
# and the result is checked to need nothing but the operating system's own libraries.
#
# Needs: a C compiler, make, nasm, pkg-config, git, curl, gpg (and mingw-w64 for Windows).
set -euo pipefail

TARGET=${1:?target triple}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/ffmpeg-sources.sh"

# x86_64 macOS on an Apple Silicon Mac: the whole build runs under Rosetta, as on an Intel Mac
if [[ $TARGET == x86_64-apple-darwin && $(uname -m) == arm64 && -z ${MOSHPIT_UNDER_ROSETTA:-} ]]; then
  exec env MOSHPIT_UNDER_ROSETTA=1 arch -x86_64 /bin/bash "$0" "$@"
fi

WORK=${MOSHPIT_FFMPEG_WORK:-$ROOT/.ffmpeg-build/$TARGET}
SRC=$WORK/src
P=$WORK/prefix
OUT=$ROOT/src-tauri/binaries
rm -rf "$P"
mkdir -p "$SRC" "$P" "$OUT"
JOBS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
UNPINNED=0

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# check a value against its pin; an empty pin prints the value (see ffmpeg-sources.sh)
pinned() {
  local what=$1 got=$2 want=$3
  if [[ -z $want ]]; then
    echo "UNPINNED $what: $got"
    UNPINNED=1
  elif [[ $got != "$want" ]]; then
    echo "MISMATCH $what: got $got, expected $want" >&2
    exit 1
  else
    echo "verified $what"
  fi
}

# a release archive, checked, unpacked into $SRC/<name>
fetch() {
  local name=$1 url=$2 want=$3 file
  file=$SRC/$(basename "$url")
  [[ -f $file ]] || curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors -o "$file" "$url"
  pinned "$name" "$(sha "$file")" "$want"
  rm -rf "${SRC:?}/$name"
  mkdir -p "$SRC/$name"
  tar -xf "$file" -C "$SRC/$name" --strip-components=1
}

# a git checkout at a pinned commit (a commit id is a hash of everything in it)
checkout() {
  local name=$1 url=$2 ref=$3 want=$4 dir=$SRC/$1
  if [[ ! -d $dir/.git ]]; then
    rm -rf "$dir"
    git clone --quiet --no-checkout "$url" "$dir"
  fi
  git -C "$dir" -c advice.detachedHead=false checkout --quiet --force "$ref"
  pinned "$name" "$(git -C "$dir" rev-parse HEAD)" "$want"
  git -C "$dir" clean -fdxq
}

# ---------------------------------------------------------------- the sources

fetch zlib "$ZLIB_URL" "$ZLIB_SHA256"
fetch ogg "$OGG_URL" "$OGG_SHA256"
fetch vorbis "$VORBIS_URL" "$VORBIS_SHA256"
checkout x264 "$X264_URL" "$X264_COMMIT" "$X264_COMMIT"
checkout libvpx "$LIBVPX_URL" "$LIBVPX_TAG" "$LIBVPX_COMMIT"

# FFmpeg: its hash, and its signature by the FFmpeg release key
FF=$SRC/ffmpeg-$FFMPEG_VERSION.tar.xz
[[ -f $FF ]] || curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors -o "$FF" "$FFMPEG_URL"
curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors -o "$FF.asc" "$FFMPEG_URL.asc"
# (a short path: gpg's agent socket lives in it, and macOS limits socket paths to ~100 characters)
export GNUPGHOME=$(mktemp -d /tmp/mp-gpg.XXXXXX)
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT
curl -fsSL --retry 5 --retry-delay 10 --retry-all-errors https://ffmpeg.org/ffmpeg-devel.asc | gpg --batch --quiet --import
# (read whole first: grep -q stopping early would fail the pipe)
SIG=$(gpg --batch --status-fd 1 --verify "$FF.asc" "$FF" 2>/dev/null || true)
grep -q "^\[GNUPG:\] VALIDSIG .*$FFMPEG_KEY" <<<"$SIG" || {
  echo "FFmpeg's signature doesn't check out against the release key $FFMPEG_KEY" >&2
  exit 1
}
echo "verified ffmpeg signature"
pinned ffmpeg "$(sha "$FF")" "$FFMPEG_SHA256"
rm -rf "$SRC/ffmpeg"
mkdir -p "$SRC/ffmpeg"
tar -xf "$FF" -C "$SRC/ffmpeg" --strip-components=1

if [[ $UNPINNED == 1 && -z ${MOSHPIT_FFMPEG_LEARN:-} ]]; then
  echo "Some sources aren't pinned yet (above): check those values and put them in scripts/ffmpeg-sources.sh." >&2
  exit 1
fi

# ---------------------------------------------------------------- the build

export PKG_CONFIG_LIBDIR=$P/lib/pkgconfig
export PKG_CONFIG_PATH=$P/lib/pkgconfig
HOST=()
case $TARGET in
  *-apple-darwin)
    export MACOSX_DEPLOYMENT_TARGET=11.0
    export CFLAGS="-mmacosx-version-min=11.0 ${CFLAGS:-}"
    VPX_TARGET=$([[ $TARGET == aarch64-* ]] && echo arm64-darwin20-gcc || echo x86_64-darwin20-gcc)
    FF_EXTRA=(--enable-videotoolbox --enable-audiotoolbox)
    ;;
  x86_64-unknown-linux-gnu)
    VPX_TARGET=x86_64-linux-gcc
    FF_EXTRA=(--extra-libs="-lpthread -lm")
    ;;
  x86_64-pc-windows-msvc)
    CROSS=x86_64-w64-mingw32-
    # (the cross compiler named outright: a configure that can't find it would quietly use the Linux one)
    HOST=(--host=x86_64-w64-mingw32 CC=${CROSS}gcc AR=${CROSS}ar RANLIB=${CROSS}ranlib)
    VPX_TARGET=x86_64-win64-gcc
    FF_EXTRA=(--enable-cross-compile --arch=x86_64 --target-os=mingw32 --cross-prefix=$CROSS --pkg-config=pkg-config --extra-ldflags=-static)
    ;;
  *)
    echo "no build for $TARGET" >&2
    exit 1
    ;;
esac

echo "building zlib"
cd "$SRC/zlib"
if [[ $TARGET == *windows* ]]; then
  make -f win32/Makefile.gcc PREFIX=$CROSS -j"$JOBS" >/dev/null
  make -f win32/Makefile.gcc install BINARY_PATH="$P/bin" INCLUDE_PATH="$P/include" LIBRARY_PATH="$P/lib" >/dev/null
  # (its Makefile writes no pkg-config file; FFmpeg finds it by the header and -lz)
else
  ./configure --static --prefix="$P" >/dev/null
  make -j"$JOBS" >/dev/null
  make install >/dev/null
fi

echo "building libogg"
cd "$SRC/ogg"
./configure ${HOST[@]+"${HOST[@]}"} --prefix="$P" --disable-shared --enable-static >/dev/null
make -j"$JOBS" >/dev/null
make install >/dev/null

echo "building libvorbis"
cd "$SRC/vorbis"
# its configure passes a flag Apple's newer compilers refuse
sed -i.bak 's/-force_cpusubtype_ALL//g' configure
./configure ${HOST[@]+"${HOST[@]}"} --prefix="$P" --disable-shared --enable-static --with-ogg="$P" --disable-oggtest >/dev/null
make -j"$JOBS" >/dev/null
make install >/dev/null

echo "building x264"
cd "$SRC/x264"
X264_HOST=()
[[ $TARGET == *windows* ]] && X264_HOST=(--host=x86_64-w64-mingw32 --cross-prefix=$CROSS)
./configure ${X264_HOST[@]+"${X264_HOST[@]}"} --prefix="$P" --enable-static --enable-pic --disable-cli >/dev/null
make -j"$JOBS" >/dev/null
make install >/dev/null

echo "building libvpx"
cd "$SRC/libvpx"
CROSS=${CROSS:-} ./configure --target=$VPX_TARGET --prefix="$P" --disable-shared --enable-static --enable-pic --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp8 --enable-vp9 >/dev/null
CROSS=${CROSS:-} make -j"$JOBS" >/dev/null
make install >/dev/null

echo "building FFmpeg $FFMPEG_VERSION"
cd "$SRC/ffmpeg"
# nothing the build machine happens to have installed gets in: only what is built above
./configure --prefix="$P" --pkg-config-flags=--static --disable-autodetect --enable-gpl --enable-static --disable-shared \
  --disable-ffplay --disable-ffprobe --disable-doc --disable-debug \
  --enable-zlib --enable-libx264 --enable-libvpx --enable-libvorbis \
  --extra-cflags="-I$P/include" --extra-ldflags="-L$P/lib" "${FF_EXTRA[@]}" >/dev/null || {
  tail -40 ffbuild/config.log >&2
  exit 1
}
make -j"$JOBS" >/dev/null
EXE=$([[ $TARGET == *windows* ]] && echo .exe || true)
DEST=$OUT/moshpit-ffmpeg-$TARGET$EXE
cp "ffmpeg$EXE" "$DEST"
chmod 755 "$DEST"

# ---------------------------------------------------------------- what it needs to run

case $TARGET in
  *-apple-darwin)
    LIBS=$(otool -L "$DEST" | tail -n +2 | awk '{print $1}')
    BAD=$(grep -v -E '^(/usr/lib/|/System/Library/)' <<<"$LIBS" || true)
    ;;
  *linux*)
    LIBS=$(ldd "$DEST" | awk '{print $1}')
    BAD=$(grep -v -E '^(linux-vdso\.so|/lib64/ld-linux|libc\.so|libm\.so|libpthread\.so|libdl\.so|librt\.so)' <<<"$LIBS" || true)
    ;;
  *windows*)
    LIBS=$(${CROSS}objdump -p "$DEST" | awk '/DLL Name/ {print $3}')
    # Windows' own DLLs; mingw's runtime (libgcc, libwinpthread) must be linked in, not alongside
    BAD=$(grep -i -E '^(lib|.*mingw)' <<<"$LIBS" || true)
    ;;
esac
echo "needs: $(tr '\n' ' ' <<<"$LIBS")"
if [[ -n $BAD ]]; then
  echo "the build needs libraries that won't be on other computers: $BAD" >&2
  exit 1
fi

# ---------------------------------------------------------------- what the app asks of it

# (a Windows build is run and checked on Windows: scripts/check-ffmpeg.sh)
[[ $TARGET == *windows* ]] || "$ROOT/scripts/check-ffmpeg.sh" "$DEST"

# ---------------------------------------------------------------- the notice shipped with it

cat >"$OUT/FFMPEG-NOTICE.txt" <<EOF
moshpit bundles FFmpeg as a separate program (moshpit-ffmpeg).

FFmpeg $FFMPEG_VERSION, built for $TARGET by moshpit's own build (scripts/build-ffmpeg.sh) from:
  FFmpeg   $FFMPEG_URL (sha256 $FFMPEG_SHA256, signed by the FFmpeg release key $FFMPEG_KEY)
  x264     $X264_URL at commit $X264_COMMIT
  libvpx   $LIBVPX_URL at $LIBVPX_TAG (commit $LIBVPX_COMMIT)
  libvorbis $VORBIS_URL (sha256 $VORBIS_SHA256)
  libogg   $OGG_URL (sha256 $OGG_SHA256)
  zlib     $ZLIB_URL (sha256 $ZLIB_SHA256)

FFmpeg is free software. This build includes GPL components (libx264), so it is licensed under the
GNU General Public License, version 2 or later. See https://ffmpeg.org/legal.html. The sources
above are the exact source code; moshpit's own source, with the build script, is at
https://github.com/furniture3k/Video-Datamosher
EOF

echo "ffmpeg ready: $DEST"
