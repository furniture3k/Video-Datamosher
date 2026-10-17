<script lang="ts">
  const canScreen = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  import { onDestroy } from 'svelte';
  import Modal from '../components/Modal.svelte';
  import { store } from '../lib/store.svelte';
  import { addFiles } from '../lib/media';
  import { finalizeRecording } from '../lib/renderer';
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
  let source = $state<'camera' | 'screen' | null>(null);
  let facing = $state<'user' | 'environment'>('user');
  let cameras = $state(0);
  let saving = $state(false);
  let destroyed = false;
  // the latest start(): an older one that finishes later (or after the dialog closed) lets its stream go
  let attempt = 0;

  async function start(kind: 'camera' | 'screen') {
    error = '';
    stop();
    const my = ++attempt;
    let s: MediaStream | null = null;
    try {
      s =
        kind === 'camera'
          ? await navigator.mediaDevices.getUserMedia({
              // ideal (not exact) sizes: phones and some webcams reject hard constraints
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: { ideal: facing } },
              audio: withAudio ? { echoCancellation: false, noiseSuppression: false } : false,
            })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: withAudio });
      if (destroyed || my !== attempt) return void s.getTracks().forEach((t) => t.stop());
      stream = s;
      source = kind;
      // the browser's own "Stop sharing" (or an unplugged camera) ends the recording like Stop does
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (stream !== s) return;
        if (recording) finish();
        else stop();
      });
      video.srcObject = stream;
      await video.play();
      if (kind === 'camera') cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length;
    } catch (e) {
      if (destroyed || my !== attempt) return;
      error = 'Could not access the ' + kind + ': ' + (e as Error).message;
      source = null;
      // got the camera but couldn't show it: don't leave it running
      if (s && stream === s) stop();
    }
  }
  function flip() {
    facing = facing === 'user' ? 'environment' : 'user';
    start('camera');
  }
  function stop() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) video.srcObject = null;
  }
  function rec() {
    if (!stream) return;
    chunks = [];
    error = '';
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    } catch (e) {
      error = 'This browser cannot record this: ' + (e as Error).message;
      return;
    }
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      // the recorder can also stop by itself (the source went away)
      clearInterval(timer);
      recording = false;
      if (discard) return;
      const type = recorder?.mimeType || 'video/webm';
      const dur = (performance.now() - started) / 1000;
      stop();
      saving = true;
      try {
        const file = await finalizeRecording(new Blob(chunks, { type }), `recording-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
        // closed while saving: still add it, but don't close whatever dialog is open now
        if (!destroyed) store.ui.dialog = null;
        await addFiles([file], { track: 'v1', index: Infinity }, dur);
      } catch (e) {
        if (destroyed) store.toast('Could not save the recording: ' + (e as Error).message, 'error', 6000);
        else error = 'Could not save the recording: ' + (e as Error).message;
      } finally {
        saving = false;
      }
    };
    recorder.start(250);
    started = performance.now();
    elapsed = 0;
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
    destroyed = true;
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
      {#if source === 'camera' && cameras > 1}<button onclick={flip} disabled={recording} title="Switch between front and back camera"><Icon name="reset" />Flip</button>{/if}
      <label class="row small"><input type="checkbox" bind:checked={withAudio} disabled={recording} /> with sound</label>
    </div>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} muted playsinline class:on={!!stream} class:mirror={source === 'camera' && facing === 'user'}></video>
    {#if saving}<p class="small muted">Saving the recording…</p>{/if}
    {#if !stream}<p class="small muted">Pick a source. Moshing feeds on motion, so move the camera or wave a hand.</p>{/if}
    {#if error}<p class="small" style="color:var(--danger)">{error}</p>{/if}
  </div>
  {#snippet footer()}
    {#if recording}
      <span class="mono small rec">REC {elapsed.toFixed(1)}s</span>
      <button class="primary" onclick={finish}>Stop and add</button>
    {:else}
      <button onclick={() => (store.ui.dialog = null)}>Cancel</button>
      <button class="primary" disabled={!stream || saving} onclick={rec}><Icon name="rec" size={12} />Record</button>
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
    max-height: 60vh;
    object-fit: contain;
  }
  /* selfie preview is mirrored like a camera app; the recording itself is not */
  video.mirror {
    transform: scaleX(-1);
  }
  .row {
    flex-wrap: wrap;
  }
  .rec {
    color: var(--danger);
    margin-right: auto;
  }
</style>
