# The source code the desktop app's FFmpeg is built from (scripts/build-ffmpeg.sh), pinned.
#
# Each download is checked against the SHA-256 here, and each git checkout against its commit, so
# a file that changes upstream (or anything in between) stops the build instead of going into the
# app. The FFmpeg tarball is also checked against FFmpeg's own signature (FFMPEG_KEY is the
# fingerprint of the FFmpeg release signing key, ffmpeg-devel@ffmpeg.org).
#
# To move to a new version: change the version, empty its hash, and run the build once: it stops
# and prints the hash of what it downloaded. Check that value against the project's own published
# one, then put it here.

FFMPEG_VERSION=8.0
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
FFMPEG_SHA256=b2751fccb6cc4c77708113cd78b561059b6fa904b24162fa0be2d60273d27b8e
FFMPEG_KEY=FCF986EA15E6E293A5644F10B4322F04D67658D8

# x264 has no releases: a commit on its stable branch
X264_URL=https://code.videolan.org/videolan/x264.git
X264_COMMIT=31e19f92f00c7003fa115047ce50978bc98c3a0d

LIBVPX_URL=https://chromium.googlesource.com/webm/libvpx
LIBVPX_TAG=v1.15.0
LIBVPX_COMMIT=9f9b7e9ba2eb9d01640a9e69a3d655866265cf7f

OGG_URL=https://downloads.xiph.org/releases/ogg/libogg-1.3.5.tar.xz
OGG_SHA256=c4d91be36fc8e54deae7575241e03f4211eb102afb3fc0775fbbc1b740016705

VORBIS_URL=https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz
VORBIS_SHA256=b33cc4934322bcbf6efcbacf49e3ca01aadbea4114ec9589d1b1e9d20f72954b

ZLIB_URL=https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.xz
ZLIB_SHA256=38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32
