#!/usr/bin/env bash
# Runs the desktop app's smoke test (MOSHPIT_SMOKE_TEST, see src-tauri/src/smoke.rs) on a Linux
# system, as root, usually a fresh container of the distribution being checked:
#
#   scripts/smoke-linux.sh path/to/moshpit.AppImage | .deb | .rpm
#
# It installs what any desktop has (an X server, Mesa, X11 and Wayland client libraries, fonts and
# text shaping, D-Bus: what AppImages leave to the system) and nothing the app should bring itself,
# so a library the AppImage forgot shows up here. The .deb and .rpm are installed with the system's
# package manager, which pulls in what they say they need. MOSHPIT_SMOKE_TEST=network
# (the default here) also checks a download; set SMOKE=1 to leave that out.
set -euo pipefail

pkg=$(realpath "$1")
. /etc/os-release
family=" ${ID} ${ID_LIKE:-} "
echo "== $PRETTY_NAME: $(basename "$pkg")"

case "$family" in
  *" debian "* | *" ubuntu "*)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends xvfb xauth dbus dbus-x11 libegl1 libgl1 libgles2 libgl1-mesa-dri libgbm1 libdrm2 \
      libx11-6 libx11-xcb1 libxcb1 libwayland-client0 fontconfig fonts-dejavu-core libharfbuzz0b libfreetype6 libfribidi0 libexpat1 ca-certificates file > /dev/null
    # the sound library's package was renamed for the 64-bit time change (Ubuntu 24.04, Debian 13)
    apt-get install -y -qq --no-install-recommends libasound2t64 > /dev/null 2>&1 || apt-get install -y -qq --no-install-recommends libasound2 > /dev/null
    case "$pkg" in *.deb) apt-get install -y -qq "$pkg" > /dev/null ;; esac
    ;;
  *" fedora "* | *" rhel "*)
    dnf install -y -q xorg-x11-server-Xvfb dbus-daemon dbus-tools dbus-x11 mesa-libEGL mesa-libGL libglvnd-gles mesa-dri-drivers mesa-libgbm libdrm \
      libX11 libX11-xcb libxcb libwayland-client fontconfig dejavu-sans-fonts harfbuzz freetype fribidi expat alsa-lib ca-certificates file > /dev/null
    case "$pkg" in *.rpm) dnf install -y -q "$pkg" > /dev/null ;; esac
    ;;
  *" suse "* | *" opensuse "*)
    zypper -n -q install -y xvfb-run xorg-x11-server-Xvfb dbus-1 Mesa-libEGL1 Mesa-libGL1 Mesa-libGLESv2-2 Mesa-dri libgbm1 libdrm2 \
      libX11-6 libX11-xcb1 libxcb1 libwayland-client0 fontconfig dejavu-fonts libharfbuzz0 libfreetype6 libfribidi0 libexpat1 alsa ca-certificates file > /dev/null
    case "$pkg" in *.rpm) zypper -n -q --no-gpg-checks install -y "$pkg" > /dev/null ;; esac
    ;;
  *" arch "*)
    pacman -Syu --noconfirm --needed -q xorg-server-xvfb dbus mesa libglvnd libdrm libx11 libxcb wayland fontconfig ttf-dejavu harfbuzz freetype2 fribidi expat alsa-lib ca-certificates file > /dev/null
    ;;
  *)
    echo "don't know how to set up $PRETTY_NAME" >&2
    exit 1
    ;;
esac

case "$pkg" in
  *.AppImage)
    chmod +x "$pkg"
    # containers have no FUSE: the AppImage unpacks itself to a temporary folder instead of mounting
    export APPIMAGE_EXTRACT_AND_RUN=1
    app=("$pkg")
    ;;
  *) app=(moshpit) ;;
esac

Xvfb :99 -screen 0 1440x900x24 -nolisten tcp > /dev/null 2>&1 &
export DISPLAY=:99
sleep 2
export MOSHPIT_SMOKE_TEST=${SMOKE:-network}
code=0
dbus-run-session -- "${app[@]}" > smoke.out 2> smoke.err || code=$?
# the report is the JSON the app printed; its log is kept in case it never reported
sed -n '/^{/,/^}/p' smoke.out
grep -E 'moshpit smoke test|ERROR|CRITICAL|Segmentation|not found' smoke.err | head -40 || true
echo "== $PRETTY_NAME: $(basename "$pkg"): exit $code"
exit $code
