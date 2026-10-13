<script lang="ts" module>
  // 16px line icons, drawn for this app. Stroke = currentColor.
  const P: Record<string, string> = {
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
    save: '<path d="M3 2.5h8l2 2v9H3zM5.5 2.5v3.5h5V2.5M5.5 13.5V10h5v3.5"/>',
    link: '<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>',
    theme: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor"/>',
    file: '<path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3"/>',
    camera: '<rect x="1.5" y="4.5" width="9" height="7" rx="1"/><path d="M10.5 7l4-2v6l-4-2"/>',
    screen: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13.5h4M8 11v2.5"/>',
    image: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 11l3.5-3.5 3 3 2-2L14 12"/><circle cx="10.5" cy="6" r="1"/>',
    check: '<path d="M3 8.5l3 3 7-7"/>',
    reset: '<path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5v2.5h2.5"/>',
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
