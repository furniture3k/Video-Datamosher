<script lang="ts">
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import ShortcutList from '../components/ShortcutList.svelte';
</script>

<Modal title="Help" wide>
  <div class="cols">
    <div class="col text">
      <h4>The idea</h4>
      <p>
        Video codecs don't store every frame as a picture. They store a full picture now and then (an <b class="i">I-frame</b>, or keyframe) and in between
        only <b class="p">P-frames</b>: instructions like "move this block 3px left" plus small corrections.
      </p>
      <p>
        Datamoshing breaks that system on purpose. <b>Remove a keyframe</b> and the movement instructions get applied to the <i>wrong picture</i>, so one
        scene melts into the next. <b>Repeat a P-frame</b> and the same movement is applied again and again, so pixels bloom and smear.
      </p>
      <h4>Quick start</h4>
      <ol>
        <li><b>Import</b> video, photos and music (or <b>Generate</b> clips). Drag them from the Media panel onto the timeline.</li>
        <li>Cut it like any editor: drag clips to reorder, drag their edges to trim, <span class="kbd">S</span> to split, right-click for more. Stack clips on Video 2, 3… above the main track for picture-in-picture, overlays and blend modes. Music goes on an audio track; drag the dots on an audio clip to fade it.</li>
        <li>Click the <b>+</b> on a cut (or drag from the <b>Transitions</b> tab) for a dissolve, wipe, or a <b>Melt</b>: a datamosh transition.</li>
        <li>The player shows your cut instantly (<b>edit</b>) and switches to the rendered <b>mosh</b> when it's ready.</li>
        <li>Open <b>Presets</b> and try <b>Cut Transitions</b> or <b>Bloom Explosion</b>, or add effects and drag their bars on the Mosh FX lanes. Effects stay on their footage when you re-edit.</li>
        <li><b>Randomize</b> rolls a new stack. Lock settings you like and pin effects to keep them.</li>
        <li>Hover a setting and click the curve icon to automate it with a curve or LFO.</li>
        <li>Can't find something? <span class="kbd">Ctrl P</span> (<span class="kbd">⌘ P</span> on a Mac) finds any command, effect or preset by name.</li>
        <li><b>Export</b> to MP4, WebM, GIF, PNG frames or the raw broken AVI.</li>
      </ol>
      <h4>Two kinds of effects</h4>
      <p>
        <b>Bitstream</b> effects (Keyframe Killer, Bloom, Motion Transfer, Stutter, Shuffle, Reverse, Echo, Drop, Byte Glitch) edit the compressed video.
        This is real datamoshing, and the encoder settings in the <b>Encode</b> tab change their texture a lot.
        <b>Pixel</b> effects (Vector Warp, Chroma Drift, Pixel Sort) work on the decoded picture afterwards. Vector Warp is a GPU "flow engine" that gives
        you direct control over motion vectors.
      </p>
      <h4>Tips</h4>
      <ul>
        <li>Moshes are strongest when the second clip has lots of motion and the first has strong colours.</li>
        <li>A low preview width (Encode tab) makes experimenting much faster. Only the clips you change are re-prepared.</li>
        <li>Audio tracks can play clean (like a soundtrack) or <b>follow the mosh</b> (the <b>~</b> button) so they stutter with the picture.</li>
        <li>Titles can sit clean on top or <b>melt with the video</b>.</li>
        <li>Quality 6–12 and a long keyframe interval give the classic chunky look.</li>
        <li>Everything runs on your device; nothing is uploaded.</li>
      </ul>
      <p class="small muted">
        moshpit is free software under the <a href="https://github.com/furniture3k/Video-Datamosher/blob/main/LICENSE" target="_blank" rel="noopener">GNU GPL v3 or later</a>.
        It uses FFmpeg (GPL) and other open-source components; see the
        <a href="https://github.com/furniture3k/Video-Datamosher/blob/main/THIRD-PARTY-NOTICES.md" target="_blank" rel="noopener">third-party notices</a>
        and the <a href="https://github.com/furniture3k/Video-Datamosher" target="_blank" rel="noopener">source code</a>.
      </p>
    </div>
    <div class="col">
      <h4>Keyboard shortcuts</h4>
      <ShortcutList />
    </div>
  </div>
  {#snippet footer()}
    <button onclick={() => ((store.ui.dialog = null), (store.ui.welcome = true))}>Take the tour again</button>
    <button class="primary" onclick={() => (store.ui.dialog = null)}>Close</button>
  {/snippet}
</Modal>

<style>
  a {
    color: var(--text);
  }
  .cols {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 24px;
  }
  @media (max-width: 760px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .text {
    line-height: 1.55;
  }
  h4 {
    margin-top: 10px;
  }
  p,
  ol,
  ul {
    margin: 4px 0;
  }
  .i {
    color: var(--f-i);
  }
  .p {
    color: var(--f-dup);
  }
</style>
