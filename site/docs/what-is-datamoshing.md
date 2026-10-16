---
title: What is datamoshing?
description: Why videos melt when their keyframes go missing, and what each kind of damage looks like.
order: 2
---

# What is datamoshing?

Most frames in a video file aren't pictures. To save space, a codec stores a full picture only now and then (a **keyframe**, or I-frame) and, for the frames in between, only **how blocks of the previous picture move** (P-frames).

Datamoshing breaks that on purpose:

| Do this | And the decoder… | Looks like |
|---|---|---|
| Remove a keyframe at a cut | keeps moving blocks of the *old* picture with the *new* shot's motion | one shot melting into the next |
| Repeat a P-frame | applies the same movement again and again | the picture smearing and blooming outward |
| Copy P-frames from another clip | moves this picture with that clip's motion | a face moving like a dancer |
| Corrupt the bytes | misreads blocks and colours | tears, blocky rain, colour shifts |
| Edit the motion vectors | moves blocks where you tell it | swirls, drifts, turbulence |

## How moshpit does it

1. Your timeline is encoded to MPEG-4 Part 2 (Xvid) in an AVI file, the classic moshing format: every frame is a separate chunk that's easy to find, and decoders tolerate damage instead of giving up.
2. moshpit reads the file into a list of frames and works out which are keyframes.
3. The effects on your timeline rewrite that list: removing, repeating, reordering, borrowing and corrupting frames.
4. The broken file is decoded again. The decoder's attempt to make sense of the damage is the mosh.
5. Picture effects run on the GPU, and the result is encoded to MP4, WebM or GIF.

Because every random choice comes from a seed, the same settings always give the same result.

## Why the AVI looks different everywhere

A moshed AVI is broken on purpose, and every player hides broken video in its own way. MP4, WebM and GIF exports contain exactly what moshpit's preview shows.
