#!/usr/bin/env bash
# Checks an FFmpeg has every encoder and filter the desktop app uses (see src/engine/args.ts).
#   scripts/check-ffmpeg.sh path/to/ffmpeg
set -euo pipefail
FF=${1:?path to ffmpeg}
"$FF" -hide_banner -version | head -1
ENC=$("$FF" -hide_banner -encoders)
FIL=$("$FF" -hide_banner -filters)
missing=
for e in libx264 libvpx libvorbis aac mpeg4 mpeg2video mpeg1video mjpeg png gif rawvideo pcm_s16le; do
  grep -qE "^ [A-Z.]{6} $e " <<<"$ENC" || missing="$missing encoder:$e"
done
for f in scale crop pad fps setpts trim concat format fade hue despill lut3d perspective geq colorkey lumakey palettegen paletteuse overlay blend xfade gblur boxblur lutrgb colorchannelmixer atempo amix afade aresample mandelbrot life cellauto testsrc2 gradients; do
  grep -qE "^ [A-Z.]{3} $f " <<<"$FIL" || missing="$missing filter:$f"
done
if [[ -n $missing ]]; then
  echo "this FFmpeg lacks what the app needs:$missing" >&2
  exit 1
fi
echo "has every encoder and filter the app uses"
