---
title: Sharing and exporting
description: Export formats, sizes for social media, recipes and the gallery.
order: 5
---

# Sharing and exporting

## Formats

| Format | Good for |
|---|---|
| **MP4** (H.264) | Anywhere: social media, messages, editors |
| **WebM** (VP9 or VP8) | The web |
| **GIF** | Loops in chats and forums |
| **PNG frames** | Taking frames into another tool (a zip) |
| **AVI** | The raw broken file, which plays differently in every player |

**Hardware encoding** (on by default) uses your device's own video encoder for MP4 and WebM where the browser has one: several times faster. **Add to queue** exports in the background while you keep editing; the queue in the corner shows how far each export is and saves it when it's done.

**Made for** sets up the size and shape for TikTok, Reels and Shorts (1080×1920, or 2160×3840 in 4K for Shorts and TikTok), the Instagram feed, square posts, YouTube or a Discord size limit, and can show the apps' safe zones in the player so your text stays clear of their buttons. **Shape** exports a different aspect (9:16 from 16:9…) with the crop following the action, and **Loop** makes seamless loops. On phones and tablets, **Share…** sends the export straight to another app.

## Size, quality and frame rate

- **Output size** is named by what it makes in your project's shape: on a 9:16 project **1080p** is 1080×1920 and **4K** is 2160×3840.
- The **mosh resolution** (Encode tab) is separate: a smaller mosh gives bigger, chunkier smears and is scaled up to the output size. **Full quality: mosh at this size** moshes at the output size instead: the sharpest picture, for 4K uploads, and several times slower.
- **Frame rate** makes 30, 50 or 60 fps from a 24 fps project, the frames in between blended from their neighbours, for smoother motion on phones that play at 60.
- **Colours** stay as they were from your clips to the file, and the file says which colours it is in (BT.709), so phones and Instagram show it the way you saw it. **HDR** clips from phones (iPhone HDR, HDR10) are brought down to normal range so they don't look grey and washed out.
- Instagram shows Reels at 1080×1920 whatever you upload; Shorts and TikTok keep more of a 4K upload.

## Recipes

Every MP4, WebM, AVI and GIF export carries its **recipe**: the effects and settings that made it. Drop a video made in moshpit into the app and it offers to put the same mosh on your own footage. **⋯ → Share code** copies the recipe as text to paste anywhere.

## Recipe files and batches

**⋯ → Save recipe file** keeps the mosh (effects, settings and seeds, no footage) as a `.moshrecipe` file. Its positions are shares of the timeline, so it fits a video of any length. Open it with **⋯ → Open recipe file**, or drop it on the app, to put it on the open project (Undo takes it off).

**⋯ → Batch** puts one mosh (this project's or a recipe file's) on many videos at once. Each gets a project of its own and goes through the export queue, so you can keep editing while they render.

## The gallery

The [gallery](../../#gallery) shows moshes made with moshpit, each with its recipe.

To add yours:

1. Export it (a short MP4 or GIF works best) and copy its share code (**⋯ → Share code**).
2. [Start a gallery post](https://github.com/furniture3k/Video-Datamosher/discussions/new?category=show-and-tell) on GitHub: attach the video, paste the code and give it a title.
3. Once it's added, it appears on the site with an **Open this recipe** link.
