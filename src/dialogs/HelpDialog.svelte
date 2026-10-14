<script lang="ts">
  import Modal from '../components/Modal.svelte';
  const keys: [string, string][] = [
    ['Space', 'Play / pause'],
    ['← / →', 'Step one frame (Shift = 10)'],
    ['↑ / ↓', 'Previous / next cut'],
    ['Home / End', 'Jump to start / end'],
    ['S  or  Ctrl K', 'Split at playhead'],
    ['Del', 'Delete selected clip, transition or effect'],
    ['D', 'Duplicate selected clip (or effect)'],
    ['Ctrl C / Ctrl V / Ctrl X', 'Copy / paste at playhead / cut clips'],
    ['T', 'Melt transition at the nearest cut'],
    ['N', 'Snapping on / off (Shift while dragging = no snap)'],
    ['+ / − / \\', 'Zoom timeline in / out / fit'],
    ['Esc', 'Deselect'],
    ['I / O', 'Set loop in / out at playhead'],
    ['L / X', 'Toggle loop / clear loop'],
    ['Enter', 'Render now'],
    ['A', 'Add effect'],
    ['P', 'Presets'],
    ['R', 'Randomize the stack'],
    ['M', 'Nudge settings'],
    ['V', 'Variations grid'],
    ['K', 'Force a keyframe at playhead'],
    ['C', 'Compare with original'],
    ['E', 'Export'],
    ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
    ['Ctrl S', 'Save project file'],
    ['Ctrl + wheel', 'Zoom timeline'],
    ['?', 'This help'],
  ];
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
        <li>Cut it like any editor: drag clips to reorder, drag their edges to trim, <span class="kbd">S</span> to split, right-click for more. Music goes on an audio track; drag the dots on an audio clip to fade it.</li>
        <li>Click the <b>+</b> on a cut (or drag from the <b>Transitions</b> tab) for a dissolve, wipe, or a <b>Melt</b>: a datamosh transition.</li>
        <li>The player shows your cut instantly (<b>edit</b>) and switches to the rendered <b>mosh</b> when it's ready.</li>
        <li>Open <b>Presets</b> and try <b>Cut Transitions</b> or <b>Bloom Explosion</b>, or add effects and drag their bars on the Mosh FX lanes. Effects stay on their footage when you re-edit.</li>
        <li><b>Randomize</b> rolls a new stack. Lock settings you like and pin effects to keep them.</li>
        <li>Hover a setting and click the curve icon to automate it with a curve or LFO.</li>
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
        <li>Everything runs in your browser; nothing is uploaded.</li>
      </ul>
    </div>
    <div class="col">
      <h4>Keyboard shortcuts</h4>
      <table>
        <tbody>
          {#each keys as [k, d]}
            <tr><td><span class="kbd">{k}</span></td><td class="small">{d}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</Modal>

<style>
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
  td {
    padding: 3px 6px;
  }
</style>
