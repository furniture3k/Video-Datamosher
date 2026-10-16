<script lang="ts" module>
  // 16px line icons, drawn for this app. Stroke = currentColor.
  const P: Record<string, string> = {
    magnet: '<path d="M4 2.5v5a4 4 0 0 0 8 0v-5M4 5.5h2.5M9.5 5.5H12M6.5 2.5v5a1.5 1.5 0 0 0 3 0v-5"/>',
    bug: '<path d="M5.5 5.5a2.5 2.5 0 0 1 5 0M4.5 6.5h7v3.5a3.5 3.5 0 0 1-7 0zM8 6.5v7M2 8.5h2.5M11.5 8.5H14M2.5 12.5l2.2-1M13.5 12.5l-2.2-1M2.5 4.5l2 1.5M13.5 4.5l-2 1.5"/>',
    storage: '<ellipse cx="8" cy="4" rx="5.5" ry="2"/><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>',
    sparkle: '<path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4zM12.5 11v3M11 12.5h3"/>',
    text: '<path d="M3 4V2.5h10V4M8 2.5v11M6 13.5h4"/>',
    music: '<path d="M6 12V3.5l7-1.5V10.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="11.5" cy="10.5" r="1.5"/>',
    film: '<path d="M2.5 3h11v10h-11zM5 3v10M11 3v10M2.5 6H5M2.5 10H5M11 6h2.5M11 10h2.5"/>',
    fit: '<path d="M2.5 8h11M5 5.5L2.5 8 5 10.5M11 5.5l2.5 2.5-2.5 2.5"/>',
    blade: '<path d="M8 1.5v13M5 4l3-2.5L11 4"/>',
    play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M5 3.5v9M11 3.5v9" stroke-width="2.2"/>',
    prev: '<path d="M11.5 4l-5 4 5 4zM4.5 4v8"/>',
    next: '<path d="M4.5 4l5 4-5 4zM11.5 4v8"/>',
    start: '<path d="M3.5 3.5v9M12.5 4l-6 4 6 4z"/>',
    end: '<path d="M12.5 3.5v9M3.5 4l6 4-6 4z"/>',
    loop: '<path d="M3 7V6a2 2 0 0 1 2-2h7.5M11 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5 14l-2-2 2-2"/>',
    sound: '<path d="M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"/>',
    mute: '<path d="M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 6l4 4M14.5 6l-4 4"/>',
    still: '<rect x="2" y="4" width="12" height="9" rx="1"/><path d="M5.5 4l1-1.5h3l1 1.5"/><circle cx="8" cy="8.5" r="2.2"/>',
    render: '<path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5"/>',
    undo: '<path d="M5.5 3L2.5 6l3 3M2.5 6h7a4 4 0 0 1 0 8H7"/>',
    redo: '<path d="M10.5 3l3 3-3 3M13.5 6h-7a4 4 0 0 0 0 8H9"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    up: '<path d="M8 13V3.5M4 7l4-4 4 4"/>',
    down: '<path d="M8 3v9.5M4 9l4 4 4-4"/>',
    pointer: '<path d="M4 2.5l8.5 5.5-3.8.9 2.2 4.3-1.6.8-2.2-4.3L4 12.5z"/>',
    trim: '<path d="M6.5 2.5v11M9.5 2.5v11M2.5 8h2.5M3.8 6.5 2.5 8l1.3 1.5M13.5 8H11M12.2 6.5 13.5 8l-1.3 1.5"/>',
    marker: '<path d="M4.5 2.5h7v7L8 13l-3.5-3.5z"/>',
    freeze: '<path d="M8 1.5v13M2.4 4.8l11.2 6.4M2.4 11.2l11.2-6.4M6.5 2.8 8 4.2l1.5-1.4M6.5 13.2 8 11.8l1.5 1.4"/>',
    eyeoff: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
    dice: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><circle cx="5.5" cy="5.5" r=".9" fill="currentColor"/><circle cx="10.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/>',
    curve: '<path d="M2 12c3 0 3-8 6-8s3 8 6 8"/>',
    more: '<circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/>',
    import: '<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 11v2.5h11V11"/>',
    export: '<path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M2.5 11v2.5h11V11"/>',
    rec: '<circle cx="8" cy="8" r="4" fill="currentColor" stroke="none"/>',
    gen: '<path d="M2.5 13.5h11M4 13.5V9M7 13.5V5M10 13.5V7.5M13 13.5V3"/>',
    live: '<circle cx="8" cy="8" r="1.6" fill="currentColor"/><path d="M5 5a4.2 4.2 0 0 0 0 6M11 5a4.2 4.2 0 0 1 0 6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10"/>',
    copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M3 10.5V3.5a1 1 0 0 1 1-1h6.5"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
    pin: '<path d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5"/>',
    grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="2.5" width="4.5" height="4.5"/><rect x="2.5" y="9" width="4.5" height="4.5"/><rect x="9" y="9" width="4.5" height="4.5"/>',
    nudge: '<path d="M2.5 8h3l1.5-3 2 6 1.5-3h3"/>',
    list: '<path d="M2.5 4h11M2.5 8h11M2.5 12h7"/>',
    split: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M8 1.5v13"/>',
    eye: '<path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.5v.2"/>',
    folder: '<path d="M2 4.5V12.5h12V6H8L6.5 4.5z"/>',
    history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3.2l2 1.3"/>',
    pen: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
    save: '<path d="M3 2.5h8l2 2v9H3zM5.5 2.5v3.5h5V2.5M5.5 13.5V10h5v3.5"/>',
    link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
    theme: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor"/>',
    file: '<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3"/>',
    camera: '<rect x="1.5" y="4.5" width="9" height="7" rx="1"/><path d="M10.5 7l4-2v6l-4-2"/>',
    screen: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13.5h4M8 11v2.5"/>',
    image: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 11l3.5-3.5 3 3 2-2L14 12"/><circle cx="10.5" cy="6" r="1"/>',
    check: '<path d="M3 8.5l3 3 7-7"/>',
    reset: '<path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.5h2.5"/>',
    fullscreen: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    speed: '<path d="M2.5 11.5a5.5 5.5 0 1 1 11 0"/><path d="M8 11.5l3-4"/>',
    scissors: '<circle cx="4.5" cy="11.5" r="2"/><circle cx="11.5" cy="11.5" r="2"/><path d="M6 10l6-7.5M10 10L4 2.5"/>',
    sliders: '<path d="M3 4h10M3 8h10M3 12h10"/><circle cx="6" cy="4" r="1.4" fill="var(--surface, #000)"/><circle cx="10.5" cy="8" r="1.4" fill="var(--surface, #000)"/><circle cx="5" cy="12" r="1.4" fill="var(--surface, #000)"/>',
    transition: '<path d="M2.5 3.5h5v9h-5zM8.5 3.5h5v9h-5z"/><path d="M6 8h4M8.6 6.5 10 8l-1.4 1.5"/>',
    fx: '<path d="M2.5 13.5c2-1 3-3 3.5-6l.5-2.5c.3-1.5 1-2.5 2.5-2.5M4 6.5h4.5M9 8.5l4 5M13 8.5l-4 5"/>',
    melt: '<path d="M2.5 2.5h11v5c0 1-.7 1.5-1.5 1.5S10.5 8.5 10.5 9.5v2.5c0 .8-.7 1.5-1.5 1.5S7.5 12.8 7.5 12V10c0-.8-.7-1.5-1.5-1.5S4.5 9.2 4.5 10v.5c0 .8-.7 1.5-1.5 1.5"/>',
    layers: '<path d="M8 2.5l5.5 3L8 8.5l-5.5-3zM2.5 8.5 8 11.5l5.5-3M2.5 11 8 14l5.5-3"/>',
    cc: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M7 6.6a1.8 1.8 0 1 0 0 2.8M12 6.6a1.8 1.8 0 1 0 0 2.8"/>',
    back: '<path d="M10 3L5 8l5 5"/>',
    chevron: '<path d="M6 3l5 5-5 5"/>',
    reverse: '<path d="M13 5.5H4M6.5 3 4 5.5 6.5 8M3 10.5h9M9.5 8l2.5 2.5L9.5 13"/>',
    volume: '<path d="M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5"/>',
    crop: '<path d="M4.5 1.5v10h10M1.5 4.5h10v10"/>',
    add: '<rect x="2" y="2" width="12" height="12" rx="2.5"/><path d="M8 5v6M5 8h6"/>',
  };
  export type IconName = keyof typeof P;
  export const ICONS = P;
</script>

<script lang="ts">
  let { name, size = 16, stroke = 1.4 }: { name: string; size?: number; stroke?: number } = $props();
</script>

<svg
  class="ic"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true">{@html P[name] ?? ''}</svg
>

<style>
  .ic {
    flex: none;
    display: block;
  }
</style>
