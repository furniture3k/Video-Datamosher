<script lang="ts">
  // Handles on the player. Click a title or a clip on a track above to pick it, drag it to move it,
  // drag a corner to make it bigger or smaller, the round handle to turn it (Shift: in 15° steps).
  // Moving snaps to the middle of the frame and to the other things on screen (Alt: no snapping).
  // A main-track clip gets handles once it's selected on the timeline. Each drag is one undo step.
  // On a touch screen two fingers pinch and twist it. Double-click (or double-tap) a title to
  // change its words right there.
  import { store } from '../lib/store.svelte';
  import { layerQuad } from '../lib/layers';
  import { fontState } from '../lib/fonts.svelte';
  import { centre, pictureQuad, pinch, poseOf, scaleBy, setPose, snapTo, snapTurn, turnBy, turnHandle, type Pose, type Pt, type Quad } from '../engine/gizmo';
  import { pictureMatrix } from '../engine/placement';
  import { baseHidden, layers as upperClips, layoutVideo } from '../engine/timeline';
  import { drawOrder, isEmpty, layerEnd } from '../engine/layers';
  import { cardRect, hasCanvas } from '../engine/canvas';
  import { VIDEO_TRACK, clipOn, transformOf, type Clip, type MediaItem } from '../engine/types';

  /** compact: the phone player, where a tap on the picture plays and pauses */
  let { W, H, box, compact = false }: { W: number; H: number; box: { left: number; top: number; width: number; height: number }; compact?: boolean } = $props();

  interface Item {
    id: string;
    quad: Quad;
  }

  const locked = (track: string) => !!store.project.tracks.find((t) => t.id === track)?.locked;

  /** with a canvas the picture (clips) is shown on a card: between picture and frame pixels */
  const card = $derived(hasCanvas(store.project.canvas) ? cardRect(store.project.canvas, W, H) : null);
  const toCard = ([x, y]: Pt): Pt => (card ? [card.x + ((x - card.crop.x) * card.w) / card.crop.w, card.y + ((y - card.crop.y) * card.h) / card.crop.h] : [x, y]);
  const fromCard = ([x, y]: Pt): Pt => (card ? [card.crop.x + ((x - card.x) * card.crop.w) / card.w, card.crop.y + ((y - card.y) * card.crop.h) / card.h] : [x, y]);
  const isLayer = (id: string) => store.project.layers.some((l) => l.id === id);
  /** a pointer in the space of what's dragged: the frame for graphics, the picture for clips */
  const at = (id: string, e: { clientX: number; clientY: number }) => (isLayer(id) ? toFrame(e) : fromCard(toFrame(e)));

  function clipItem(c: Clip, m: MediaItem, local: number): Item {
    const T = transformOf(c);
    return { id: c.id, quad: pictureQuad(pictureMatrix(c, local, m.width, m.height, W, H), W, H, T.cropL, T.cropT, 1 - T.cropR, 1 - T.cropB).map(toCard) as Quad };
  }

  /** what can be picked at the playhead, bottom first (later ones are on top) */
  const items = $derived.by(() => {
    // titles are measured again once their font has loaded
    void fontState.loaded;
    const p = store.project;
    const t = store.ui.time;
    const out: Item[] = [];
    if (!baseHidden(p) && !locked(VIDEO_TRACK))
      for (const pl of layoutVideo(p)) if (store.ui.selectedClips.includes(pl.clip.id) && clipOn(pl.clip) && t >= pl.start && t < pl.end) out.push(clipItem(pl.clip, pl.media, t - pl.start));
    for (const l of upperClips(p)) if (t >= l.start && t < l.end && !locked(l.track) && l.media.source.kind !== 'adjust') out.push(clipItem(l.clip, l.media, t - l.start));
    for (const l of drawOrder(p.layers)) if (t >= l.start && t < layerEnd(l) && !isEmpty(l)) out.push({ id: l.id, quad: layerQuad(l, t, W, H) });
    return out;
  });
  const sel = $derived(store.ui.selectedClips.length === 1 ? items.find((it) => it.id === store.ui.selectedClips[0]) : undefined);
  /** frame pixels per screen pixel */
  const k = $derived(W / Math.max(1, box.width));
  const pts = (q: Quad) => q.map(([x, y]) => `${x},${y}`).join(' ');

  let svg = $state<SVGSVGElement>();
  function toFrame(e: { clientX: number; clientY: number }): Pt {
    const r = svg!.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  }

  let drag: {
    mode: 'move' | 'scale' | 'turn' | 'pinch';
    id: string;
    t: number;
    p0: Pt;
    start: Pose;
    anchor: Pt;
    snapX: number[];
    snapY: number[];
    moved: boolean;
    /** touch: where each finger is (frame pixels) */
    fingers: Map<number, Pt>;
    /** two fingers: where they were when the second came down */
    pinch0?: [Pt, Pt];
    /** the second click of a double click on a title */
    second: boolean;
    /** it was already picked when this began */
    wasPicked: boolean;
  } | null = null;
  /** the last click on a title (for double clicks and taps) */
  let lastTap: { id: string; at: number; p: Pt } | null = null;
  /** the title being typed into on the picture */
  let editing = $state<string | null>(null);
  const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  const editingLayer = $derived.by(() => {
    const l = editing ? store.project.layers.find((x) => x.id === editing) : undefined;
    return l?.kind === 'text' ? l : undefined;
  });
  /** where the typing box goes: over the title (stage pixels), at least wide enough to type in */
  const editingBox = $derived.by(() => {
    const it = editing ? items.find((x) => x.id === editing) : undefined;
    if (!it) return null;
    const xs = it.quad.map((q) => q[0]);
    const ys = it.quad.map((q) => q[1]);
    const s = box.width / W;
    const width = Math.max(180, (Math.max(...xs) - Math.min(...xs)) * s);
    const cx = box.left + ((Math.min(...xs) + Math.max(...xs)) / 2) * s;
    return { left: cx - width / 2, top: box.top + ((Math.min(...ys) + Math.max(...ys)) / 2) * s - 18, width };
  });
  function focusAll(node: HTMLTextAreaElement) {
    node.focus();
    node.select();
  }
  let guides = $state<{ x: number | null; y: number | null }>({ x: null, y: null });

  function begin(e: PointerEvent, id: string, mode: 'move' | 'scale' | 'turn') {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey && mode === 'move') return store.selectClip(id, true);
    const wasPicked = store.ui.selectedClips.length === 1 && store.ui.selectedClips[0] === id;
    if (!wasPicked) store.selectClip(id);
    const p0 = at(id, e);
    // a second click or tap on a title, quickly and in the same place (and let go without
    // dragging, see onUp): type into it
    const now = performance.now();
    const second = mode === 'move' && store.project.layers.some((l) => l.id === id) && !!lastTap && lastTap.id === id && now - lastTap.at < 400 && Math.hypot(p0[0] - lastTap.p[0], p0[1] - lastTap.p[1]) < 12 * k;
    lastTap = mode === 'move' && !second ? { id, at: now, p: p0 } : null;
    const t = store.ui.time;
    const start = poseOf(store.project, id, t);
    if (!start) return;
    // move snaps the anchor to the middle of the frame and to the other things' anchors (in the same space)
    const others = items.filter((it) => it.id !== id && isLayer(it.id) === isLayer(id)).map((it) => poseOf(store.project, it.id, t)).filter((x): x is Pose => !!x);
    drag = { mode, id, t, p0, start, anchor: [start.x * W, start.y * H], snapX: [W / 2, ...others.map((o) => o.x * W)], snapY: [H / 2, ...others.map((o) => o.y * H)], moved: false, fingers: new Map(), second, wasPicked };
    if (e.pointerType === 'touch') drag.fingers.set(e.pointerId, p0);
    window.addEventListener('pointerdown', onSecondFinger, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  /** A second finger anywhere while one holds something: pinch and twist it from here on. */
  function onSecondFinger(e: PointerEvent) {
    const d = drag;
    if (!d || e.pointerType !== 'touch' || d.fingers.size !== 1 || d.mode !== 'move') return;
    e.stopPropagation();
    e.preventDefault();
    d.fingers.set(e.pointerId, at(d.id, e));
    const [a, b] = [...d.fingers.values()];
    d.mode = 'pinch';
    d.pinch0 = [a, b];
    d.start = poseOf(store.project, d.id, d.t) ?? d.start;
    d.moved = true;
    guides = { x: null, y: null };
  }

  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    const p = at(d.id, e);
    if (d.fingers.has(e.pointerId)) d.fingers.set(e.pointerId, p);
    if (!d.moved && Math.hypot(p[0] - d.p0[0], p[1] - d.p0[1]) < 3 * k) return;
    d.moved = true;
    const to = { ...d.start };
    const isText = store.project.layers.some((l) => l.id === d.id);
    const fit = (s: number) => Math.max(isText ? 0.01 : 0.05, Math.min(isText ? 3 : 8, s));
    if (d.mode === 'pinch') {
      if (d.fingers.size !== 2 || !d.pinch0) return;
      const [a1, b1] = [...d.fingers.values()];
      const g = pinch(d.pinch0[0], d.pinch0[1], a1, b1);
      to.x = d.start.x + g.move[0] / W;
      to.y = d.start.y + g.move[1] / H;
      to.scale = fit(d.start.scale * g.scale);
      to.turn = snapTurn(d.start.turn + g.turn, 0);
    } else if (d.mode === 'move') {
      let ax = d.anchor[0] + p[0] - d.p0[0];
      let ay = d.anchor[1] + p[1] - d.p0[1];
      if (e.altKey) guides = { x: null, y: null };
      else {
        const sx = snapTo(ax, d.snapX, 6 * k);
        const sy = snapTo(ay, d.snapY, 6 * k);
        ax = sx.v;
        ay = sy.v;
        // (a clip's guides are in the picture: shown where the picture is)
        guides = isLayer(d.id) || !card ? { x: sx.to, y: sy.to } : { x: sx.to === null ? null : toCard([sx.to, 0])[0], y: sy.to === null ? null : toCard([0, sy.to])[1] };
      }
      to.x = ax / W;
      to.y = ay / H;
    } else if (d.mode === 'scale') to.scale = fit(d.start.scale * scaleBy(d.anchor, d.p0, p));
    else to.turn = snapTurn(d.start.turn + turnBy(d.anchor, d.p0, p), e.shiftKey ? 15 : 0);
    // tidy numbers in the inspector (well below a pixel)
    setPose(store.project, d.id, d.t, { x: round(to.x, 4), y: round(to.y, 4), scale: round(to.scale, 4), turn: round(to.turn, 1) }, 0.5 / store.fps);
  }

  function onUp() {
    window.removeEventListener('pointerdown', onSecondFinger, true);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    if (drag?.moved) store.commit('gizmo' + Math.random());
    else if (drag?.second) editing = drag.id;
    // on a phone, tapping what's already picked plays and pauses as a tap on the picture does
    else if (drag && compact && drag.wasPicked && drag.mode === 'move') store.ui.playing = !store.ui.playing;
    drag = null;
    guides = { x: null, y: null };
  }
</script>

{#if items.length}
  <svg bind:this={svg} class="gizmo" style="left:{box.left}px;top:{box.top}px;width:{box.width}px;height:{box.height}px" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
    {#each items as it (it.id)}
      <polygon points={pts(it.quad)} class="hit" class:sel={it.id === sel?.id} data-gizmo={it.id} onpointerdown={(e) => begin(e, it.id, 'move')} />
    {/each}
    {#if guides.x !== null}<line x1={guides.x} y1="0" x2={guides.x} y2={H} class="guide" />{/if}
    {#if guides.y !== null}<line x1="0" y1={guides.y} x2={W} y2={guides.y} class="guide" />{/if}
    {#if sel && !editing}
      {@const th = turnHandle(sel.quad, 22 * k)}
      {@const top = [(sel.quad[0][0] + sel.quad[1][0]) / 2, (sel.quad[0][1] + sel.quad[1][1]) / 2]}
      <polygon points={pts(sel.quad)} class="outline" />
      <line x1={top[0]} y1={top[1]} x2={th[0]} y2={th[1]} class="stem" />
      {#each sel.quad as c, i (i)}
        <circle cx={c[0]} cy={c[1]} r={5 * k} class="handle corner" data-handle="scale" onpointerdown={(e) => begin(e, sel.id, 'scale')} />
      {/each}
      <circle cx={th[0]} cy={th[1]} r={6 * k} class="handle turn" data-handle="turn" onpointerdown={(e) => begin(e, sel.id, 'turn')} />
      {@const c = centre(sel.quad)}
      <circle cx={c[0]} cy={c[1]} r={2.5 * k} class="mid" />
    {/if}
  </svg>
{/if}
{#if editingLayer && editingBox}
  <textarea
    class="inplace"
    style="left:{editingBox.left}px;top:{editingBox.top}px;width:{editingBox.width}px"
    value={editingLayer.text}
    rows={Math.max(1, editingLayer.text.split('\n').length)}
    aria-label="Title text"
    use:focusAll
    oninput={(e) => {
      const v = (e.target as HTMLTextAreaElement).value;
      const id = editingLayer!.id;
      store.edit((p) => {
        const l = p.layers.find((x) => x.id === id);
        if (l?.kind === 'text') l.text = v;
      }, 'text' + id);
    }}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        editing = null;
      }
    }}
    onblur={() => (editing = null)}
  ></textarea>
{/if}

<style>
  .gizmo {
    position: absolute;
    overflow: visible;
    z-index: 3;
    pointer-events: none;
    touch-action: none;
  }
  .hit {
    fill: transparent;
    stroke: transparent;
    stroke-width: 1px;
    vector-effect: non-scaling-stroke;
    pointer-events: all;
    cursor: move;
  }
  .hit:hover:not(.sel) {
    stroke: rgba(255, 255, 255, 0.55);
    stroke-dasharray: 4 3;
  }
  .outline,
  .stem,
  .guide {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    pointer-events: none;
  }
  .guide {
    stroke: #ff3df0;
    stroke-width: 1px;
  }
  .handle {
    fill: #fff;
    stroke: var(--accent);
    stroke-width: 1.5px;
    vector-effect: non-scaling-stroke;
    pointer-events: all;
  }
  .corner {
    cursor: nwse-resize;
  }
  .turn {
    cursor: grab;
  }
  .mid {
    fill: var(--accent);
    pointer-events: none;
  }
  .inplace {
    position: absolute;
    z-index: 4;
    padding: 6px 8px;
    font-size: 16px;
    line-height: 1.3;
    text-align: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.72);
    border: 1.5px solid var(--accent);
    border-radius: 6px;
    resize: none;
  }
</style>
