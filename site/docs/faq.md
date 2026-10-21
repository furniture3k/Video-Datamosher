---
title: Questions
description: Answers about privacy, browsers, limits and common problems in moshpit.
order: 8
---

# Questions

## Are my videos uploaded anywhere?

No. Decoding, moshing and encoding all happen on your device, in the browser (with WebAssembly) or in the desktop app (with native FFmpeg). Your projects and media are kept in the browser's storage on this device; **⋯ → Storage** shows how much and lets you clean up.

## Which browsers work?

Current Chrome, Edge, Firefox and Safari (iOS 15.4 or later), on computers and phones.

## It says it's out of memory, or the tab closed during a render

Long or high-resolution moshes need a lot of memory in the browser. Lower the preview resolution (the **1/2** button under the player, **Draft** on a phone), use fewer Bloom or Stutter repeats, or try the [desktop app](../desktop/). If renders keep failing, turn off **Encode → Use 4 threads** (the multithreaded engine has less memory) and **Hardware encoding** in Export. If moshpit closes mid-render it starts again with auto-render paused, so you can change things first.

## How long can a video be?

Up to 10 minutes in the browser (14,400 frames at 24 fps) and 30 minutes in the desktop app.

## My iPhone videos look grey or washed out elsewhere

They're HDR. moshpit brings HDR clips (iPhone HDR, HDR10) down to normal range when it prepares and exports them, so the export looks as it should everywhere. If a clip was added before version 1.16, remove it and import it again so moshpit can read its colours.

## Where did my project go?

Every project is listed on the home screen (click the logo). Projects are kept in this browser on this device; to move one to another device, **⋯ → Save project** and re-import its media there.

## I found a bug

**⋯ → Report a problem** opens a bug report on GitHub with the app version and the engine's last messages filled in (no media or file names). Or [open one yourself](https://github.com/furniture3k/Video-Datamosher/issues/new/choose).

## Can I use what I make commercially?

Yes. What you make is yours. moshpit itself is free software under the GPL-3.0.
