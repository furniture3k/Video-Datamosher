<script lang="ts" module>
  // The moshpit mark: a frame whose bottom edge breaks into blocks, the way a datamosh drags
  // macroblocks down the picture, with a play button cut out of it. Drawn on a 32-unit grid.
  export const MARK =
    'M6 8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14h-4v3h-4v-5h-4v7h-4v-4H6zM13.5 9v7l6-3.5z';
</script>

<script lang="ts">
  let { size = 20, color = 'var(--accent)' }: { size?: number; color?: string } = $props();
</script>

<svg width={size} height={size} viewBox="4 3 24 26" aria-hidden="true" class="logo"><path d={MARK} fill={color} fill-rule="evenodd" /></svg>

<style>
  .logo {
    display: block;
    flex: none;
  }
</style>
