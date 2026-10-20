<script lang="ts">
  // A drop shadow and an outer stroke for any title or shape, whatever it is.
  import { store } from '../lib/store.svelte';
  import Field from './Field.svelte';
  import type { Layer } from '../engine/layers';

  let { layer }: { layer: Layer } = $props();
  const fx = $derived(layer.fx ?? {});

  type Shadow = NonNullable<NonNullable<Layer['fx']>['shadow']>;
  type Outline = NonNullable<NonNullable<Layer['fx']>['outline']>;
  function edit(fn: (f: NonNullable<Layer['fx']>) => void, key: string) {
    const id = layer.id;
    store.edit(
      (p) => {
        const l = p.layers.find((x) => x.id === id);
        if (!l) return;
        const f = { ...(l.fx ?? {}) };
        fn(f);
        if (!f.shadow && !f.outline) delete l.fx;
        else l.fx = f;
      },
      'fx' + key + id,
    );
  }
  const setShadow = (c: Partial<Shadow> | null) => edit((f) => (f.shadow = c ? { dx: 0, dy: 0.006, blur: 0.01, color: 'rgba(0,0,0,0.55)', ...(f.shadow ?? {}), ...c } : undefined), 'shadow' + JSON.stringify(Object.keys(c ?? {})));
  const setOutline = (c: Partial<Outline> | null) => edit((f) => (f.outline = c ? { width: 0.006, color: '#111111', ...(f.outline ?? {}), ...c } : undefined), 'outline' + JSON.stringify(Object.keys(c ?? {})));
  /** a colour input wants #rrggbb: the shadow's own colour may have an alpha */
  const hexOf = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#000000');
</script>

<div class="label">Shadow and outline</div>
<Field type="bool" label="Drop shadow" value={!!fx.shadow} help="A soft shadow under the whole layer." onchange={(v: boolean) => setShadow(v ? {} : null)} />
{#if fx.shadow}
  <Field label="Across" min={-0.05} max={0.05} step={0.001} value={fx.shadow.dx} help="How far the shadow goes right (+) or left (−), as a share of the frame height." onchange={(v: number) => setShadow({ dx: v })} />
  <Field label="Down" min={-0.05} max={0.05} step={0.001} value={fx.shadow.dy} help="How far the shadow goes down (+) or up (−)." onchange={(v: number) => setShadow({ dy: v })} />
  <Field label="Soft" min={0} max={0.06} step={0.001} value={fx.shadow.blur} help="How soft the edge of the shadow is." onchange={(v: number) => setShadow({ blur: v })} />
  <label class="row small">Shadow colour <input type="color" value={hexOf(fx.shadow.color)} oninput={(e) => setShadow({ color: (e.target as HTMLInputElement).value })} aria-label="Shadow colour" /></label>
{/if}
<Field type="bool" label="Outer stroke" value={!!fx.outline} help="A line all the way round the layer, outside it." onchange={(v: boolean) => setOutline(v ? {} : null)} />
{#if fx.outline}
  <Field label="Stroke width" min={0.001} max={0.04} step={0.001} value={fx.outline.width} help="How thick the outer stroke is, as a share of the frame height." onchange={(v: number) => setOutline({ width: v })} />
  <label class="row small">Stroke colour <input type="color" value={hexOf(fx.outline.color)} oninput={(e) => setOutline({ color: (e.target as HTMLInputElement).value })} aria-label="Stroke colour" /></label>
{/if}
