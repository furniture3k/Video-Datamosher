<script lang="ts">
  let { jpegs, fps }: { jpegs: Uint8Array[]; fps: number } = $props();
  let canvas: HTMLCanvasElement;
  $effect(() => {
    let alive = true;
    let i = 0;
    const bitmaps: (ImageBitmap | null)[] = [];
    Promise.all(jpegs.map((j) => createImageBitmap(new Blob([j as BlobPart], { type: 'image/jpeg' })))).then((b) => {
      if (!alive) return b.forEach((x) => x.close());
      bitmaps.push(...b);
      if (b[0]) {
        canvas.width = b[0].width;
        canvas.height = b[0].height;
      }
    });
    const id = setInterval(() => {
      const b = bitmaps[i % Math.max(1, bitmaps.length)];
      if (b) canvas.getContext('2d')!.drawImage(b, 0, 0);
      i++;
    }, 1000 / fps);
    return () => {
      alive = false;
      clearInterval(id);
      bitmaps.forEach((b) => b?.close());
    };
  });
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas {
    width: 100%;
    display: block;
    background: #000;
    border-radius: 6px;
  }
</style>
