# Motion-vector editing spike: result

**Decision: go.** Shipped as the **Vector Edit** (`MVX`) effect.

## Question

Can moshpit change the motion vectors *inside* the compressed MPEG-4 Part 2 (Xvid) P-frames it
moshes, instead of imitating vector edits on decoded pictures (Vector Warp, Flow Paint), and
write frames that every decoder still reads?

## What was built

`src/engine/mpeg4mv.ts` parses a P-VOP down to the macroblock layer:

- the VOL and VOP headers;
- every macroblock: not-coded flag, MCBPC, CBPY, DQUANT and the vector differences;
- the coefficient data of inter and intra blocks, including all three MPEG-4 escape modes (it is
  skipped, not decoded, but has to be read to find where each macroblock ends);
- video packets (resync markers). FFmpeg's slice-threaded encoder writes them in every frame.

It rebuilds each frame's vector field with the codec's median prediction, following FFmpeg's
`ff_h263_pred_motion` including the "first slice line" rules after a resync marker. It then writes
the frame back, re-deriving every vector difference from the edited field. All other bits are
copied, and the stuffing before each resync marker is redone so the marker stays byte-aligned.
The VLC tables come from FFmpeg's libavcodec (LGPL-2.1-or-later).

## Evidence (`tests/mpeg4mv.test.ts`, native FFmpeg)

- Three streams were encoded with moshpit's own settings: a test pattern at quality 4, a fast
  Mandelbrot zoom at quality 12 and grainy noise at quality 2. They include intra macroblocks
  inside P-frames and many video packets. **Every P-frame round-trips bit for bit.** Because
  writing re-derives each difference from the rebuilt field, this also shows the prediction
  matches the encoder's exactly.
- With every vector doubled, FFmpeg decodes the stream with **no errors** and reads back exactly
  the vectors that were written. The picture changes as expected.
- The full effect (amplify, turn, jitter and a painted swirl) decodes cleanly. MPEG-2 streams are
  left untouched rather than broken.

## Limits

- **Codec:** MPEG-4 Part 2 only. MPEG-1/2 streams pass through unchanged, since their syntax
  differs and the effect says so.
- **Unsupported encoder options:** 4MV (four vectors per macroblock), quarter-pel, interlacing,
  data partitioning and header extensions in video packets. moshpit's encoder uses none of these
  by default (4MV and quarter-pel are switches in the Encode tab). A frame that can't be read is
  left as it was.
- **Range:** vectors are limited to what each frame's f_code can express, so very large
  amplifications clamp.
- **Skipped macroblocks** stay skipped (motion 0). Painting over a still area has no effect where
  the encoder skipped blocks.
