<script lang="ts">
  const canScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  import { onDestroy } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { addFiles } from '../lib/media';
  import Icon from '../components/Icon.svelte';

  let video: HTMLVideoElement;
  let stream = $state<MediaStream | null>(null);
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let recording = $state(false);
  let started = 0;
  let elapsed = $state(0);
  let timer = 0;
  let error = $state('');
  let withAudio = $state(true);
  let discard = false;

  async function start(kind: 'camera' | 'screen') {
    error = '';
    stop();
    try {
      stream =
        kind === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: withAudio })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: withAudio });
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      error = 'Could not access the ' + kind + ': ' + (e as Error).message;
    }
  }
  function stop() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  function rec() {
    if (!stream) return;
    chunks = [];
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      if (discard) return;
      const type = recorder?.mimeType || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File(chunks, `recording-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${ext}`, { type });
      const dur = (performance.now() - started) / 1000;
      stop();
      store.ui.dialog = null;
      await addFiles([file], 'auto', dur);
    };
    recorder.start(250);
    started = performance.now();
    recording = true;
    timer = window.setInterval(() => (elapsed = (performance.now() - started) / 1000), 100);
  }
  function finish() {
    clearInterval(timer);
    recording = false;
    recorder?.stop();
  }
  onDestroy(() => {
    // closing the dialog mid-recording throws the recording away
    discard = true;
    clearInterval(timer);
    if (recorder?.state === 'recording') recorder.stop();
    stop();
  });
</script>

<Modal title="Record">
  <div class="col">
    <div class="row">
      <button onclick={() => start('camera')} disabled={recording}><Icon name="camera" />Camera</button>
      {#if canScreen}<button onclick={() => start('screen')} disabled={recording}><Icon name="screen" />Screen</button>{/if}
      <label class="row small"><input type="checkbox" bind:checked={withAudio} disabled={recording} /> with sound</label>
    </div>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} muted playsinline class:on={!!stream}></video>
    {#if !stream}<p class="small muted">Pick a source. Moshing feeds on motion, so move the camera or wave a hand.</p>{/if}
    {#if error}<p class="small" style="color:var(--danger)">{error}</p>{/if}
  </div>
  {#snippet footer()}
    {#if recording}
      <span class="mono small rec">REC {elapsed.toFixed(1)}s</span>
      <button class="primary" onclick={finish}>Stop and add</button>
    {:else}
      <button onclick={() => (store.ui.dialog = null)}>Cancel</button>
      <button class="primary" disabled={!stream} onclick={rec}><Icon name="rec" size={12} />Record</button>
    {/if}
  {/snippet}
</Modal>

<style>
  video {
    width: 100%;
    background: #000;
    display: none;
  }
  video.on {
    display: block;
  }
  .rec {
    color: var(--danger);
    margin-right: auto;
  }
</style>
