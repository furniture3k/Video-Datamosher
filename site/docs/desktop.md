---
title: The desktop app
description: Installing moshpit on Windows, macOS and Linux, and when the desktop app is the better choice.
order: 7
---

# The desktop app

The desktop app is the same editor in a native window, running a native FFmpeg instead of the browser one. It uses every CPU core, so preparing and exporting are many times faster, 1440p and 4K are practical, and videos can be up to 30 minutes long (10 in the browser). Exports are saved with the normal Save dialog.

## Download

Get it from the [releases page](https://github.com/furniture3k/Video-Datamosher/releases/latest):

| System | File |
|---|---|
| Windows 10 / 11 | `moshpit_x.y.z_x64-setup.exe` or `.msi` |
| macOS (Apple Silicon) | `moshpit_x.y.z_aarch64.dmg` |
| macOS (Intel) | `moshpit_x.y.z_x64.dmg` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

The builds aren't code-signed yet, so your system warns about them the first time:

- **macOS**: right-click the app and choose **Open**, then **Open** again.
- **Windows**: if SmartScreen appears, choose **More info → Run anyway**.

## Opening files with it

Right-click a video, choose **Open with**, and pick moshpit (on Windows, **Choose another app** and browse to it the first time), or drop files on its icon. Opening another file while it's running adds it to the open window.

## OSC controllers

The desktop app can listen for OSC (Open Sound Control) on a UDP port: **Help → MIDI and OSC controllers → Listen**. Send numbers from 0 to 1 (or 0–127) to any address from TouchOSC, Max, Pure Data or a phone on the same network. Right-click an effect setting, send a message, and that address moves the setting from then on.

## Installing from the browser instead

The web version installs too, and then works offline:

- **iPhone / iPad**: Safari → Share → **Add to Home Screen**.
- **Android**: Chrome → menu → **Install app**.
- **Chrome / Edge on a computer**: the install icon in the address bar. Installed this way, videos get moshpit in their **Open with** menu.
