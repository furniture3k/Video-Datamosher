<script lang="ts">
  import Modal from '../components/Modal.svelte';
  const keys: [string, string][] = [
    ['Space', 'Play / pause'],
    ['← / →', 'Step one frame (Shift = 10)'],
    ['Home / End', 'Jump to start / end'],
    ['I / O', 'Set loop in / out at playhead'],
    ['L / X', 'Toggle loop / clear loop'],
    ['Enter', 'Render now'],
    ['A', 'Add effect'],
    ['P', 'Presets'],
    ['R', 'Chaos: roll a random mosh'],
    ['M', 'Mutate current settings'],
    ['V', 'Variations grid'],
    ['K', 'Force a keyframe at playhead'],
    ['D / Del', 'Duplicate / delete selected effect'],
    ['C', 'Compare with original'],
    ['E', 'Export'],
    ['Ctrl Z / Ctrl Shift Z', 'Undo / redo'],
    ['Ctrl S', 'Save project file'],
    ['Ctrl + wheel', 'Zoom timeline'],
    ['?', 'This help'],
  ];
</script>

<Modal title="How datamoshing works & shortcuts" wide>
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
        <li>Add two or more clips (or <b>✦ Generate</b> some).</li>
        <li>Open <b>✨ Presets</b> and try <b>Cut Transitions</b> or <b>Bloom Explosion</b>.</li>
        <li>Select an effect bar on the timeline; drag it, resize it, and tweak its settings on the right.</li>
        <li>Hit <b>🎲 Chaos</b> for random ideas. Lock 🔒 settings you like and pin 📌 effects to keep them.</li>
        <li>Click 〰 on any setting to automate it over time with a curve or LFO.</li>
        <li><b>⇩ Export</b> to MP4, WebM, GIF, PNG frames or the raw broken AVI.</li>
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
        <li>A low preview width (Encode tab) makes experimenting much faster.</li>
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
    color: var(--accent2);
  }
  .p {
    color: var(--accent3);
  }
  td {
    padding: 3px 6px;
  }
</style>
