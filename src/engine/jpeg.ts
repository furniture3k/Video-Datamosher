/** Split an MJPEG / image2pipe stream into individual JPEG files. */
export function splitJpegs(b: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) starts.push(i);
  return starts.map((s, k) => b.subarray(s, k + 1 < starts.length ? starts[k + 1] : b.length));
}
