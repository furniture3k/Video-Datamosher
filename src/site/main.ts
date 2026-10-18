// The landing page: the mosh pad, the frame diagram, the before/after slider, the effect rack, the
// editor tour, the gallery and the right download for this computer.
// Kept small and separate from the editor (it never loads the video engine).
import { detectOs, pickAsset, type Os, type ReleaseAsset } from './os';
import { createPad } from './pad';

const REPO = 'furniture3k/Video-Datamosher';
// with reduced motion, videos don't play by themselves (they get controls, or a play button)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** Runs `on` while the element is on screen and `off` when it leaves. */
function whileVisible(el: Element, on: () => void, off: () => void, threshold = 0.25) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? on() : off()), { threshold }).observe(el);
}

// ---------------------------------------------------------------- nav

function nav() {
  const btn = $('menu-btn');
  const links = $('nav-links');
  if (!btn || !links) return;
  const set = (open: boolean) => {
    btn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
  };
  btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  links.addEventListener('click', (e) => (e.target as HTMLElement).closest('a') && set(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && set(false));
  // the section on screen is marked in the bar
  const anchors = [...links.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of anchors) a.toggleAttribute('data-here', a.hash === '#' + e.target.id);
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  // every section, so the mark goes away over the ones that aren't in the bar
  for (const s of document.querySelectorAll('main > section')) io.observe(s);
}

// ---------------------------------------------------------------- mosh pad

function moshPad() {
  const box = $('pad');
  const canvas = $<HTMLCanvasElement>('pad-canvas');
  if (!box || !canvas) return;
  const screen = box.querySelector('.pad-screen') as HTMLElement;
  const ft = $('pad-ft')!;
  const tc = $('pad-tc')!;
  const flash = $('pad-flash')!;
  const mvEl = $('pad-mv')!;
  const framesEl = $('pad-frames')!;
  const hint = $('pad-hint')!;
  const play = $<HTMLButtonElement>('pad-play')!;

  // the footage the pad moshes; in the page (some browsers only decode a video that is), unseen
  const video = document.createElement('video');
  Object.assign(video, { src: './site/before.webm', muted: true, loop: true, playsInline: true, preload: 'auto', className: 'pad-src' });
  video.setAttribute('muted', '');
  video.setAttribute('aria-hidden', 'true');
  screen.append(video);

  let flashTimer = 0;
  // with reduced motion, the pad waits for its play button
  let allowed = !reduced;
  const pad = createPad(canvas, video, {
    frame(type, time, mv, since) {
      ft.textContent = type;
      ft.dataset.t = type[0] === 'I' ? 'i' : type === '—' ? 'gone' : type.includes('×') ? 'rep' : 'p';
      tc.textContent = time;
      mvEl.textContent = mv.toFixed(1);
      framesEl.textContent = String(since);
      box.classList.add('live');
    },
    melt() {
      flash.textContent = 'keyframe dropped · melting';
      flash.classList.remove('on');
      void flash.offsetWidth;
      flash.classList.add('on');
      clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => flash.classList.remove('on'), 1600);
    },
    blocked() {
      allowed = false;
      play.hidden = false;
    },
  });

  if (!pad) {
    // no WebGL 2: a moshed video made in moshpit instead
    video.remove();
    box.classList.add('nogl');
    const v = document.createElement('video');
    Object.assign(v, { src: './site/hero.webm', poster: './site/hero.jpg', muted: true, loop: true, playsInline: true, autoplay: !reduced, controls: reduced });
    v.setAttribute('aria-label', 'Colour bars melting into a Mandelbrot zoom, made in moshpit');
    canvas.replaceWith(v);
    return;
  }

  // ---- play only while on screen (and, with reduced motion, once asked to)
  let visible = false;
  const update = () => (allowed && visible && !document.hidden ? pad.start() : pad.stop());
  whileVisible(box, () => ((visible = true), update()), () => ((visible = false), update()), 0.15);
  document.addEventListener('visibilitychange', update);
  play.hidden = allowed;
  play.addEventListener('click', () => {
    allowed = true;
    play.hidden = true;
    pad.stop();
    update();
    canvas.focus();
  });

  // ---- buttons
  const key = $<HTMLButtonElement>('pk-key')!;
  key.addEventListener('click', () => {
    const on = key.getAttribute('aria-pressed') !== 'true';
    key.setAttribute('aria-pressed', String(on));
    pad.setKill(on);
  });
  const bloom = $<HTMLButtonElement>('pk-blm')!;
  const bloomOn = (on: boolean) => {
    bloom.classList.toggle('down', on);
    pad.setBloom(on);
  };
  bloom.addEventListener('pointerdown', (e) => {
    bloom.setPointerCapture(e.pointerId);
    bloomOn(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) bloom.addEventListener(ev, () => bloomOn(false));
  bloom.addEventListener('keydown', (e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && (e.preventDefault(), bloomOn(true)));
  bloom.addEventListener('keyup', (e) => (e.key === ' ' || e.key === 'Enter') && bloomOn(false));
  bloom.addEventListener('blur', () => bloomOn(false));
  bloom.addEventListener('contextmenu', (e) => e.preventDefault());
  const tap = (el: HTMLElement) => {
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  };
  const glt = $('pk-glt')!;
  glt.addEventListener('click', () => (pad.glitch(), tap(glt)));
  const ik = $('pk-i')!;
  ik.addEventListener('click', () => (pad.keyframe(), tap(ik)));

  // ---- dragging pushes pixels
  let last: { x: number; y: number } | null = null;
  const seen = () => hint.classList.add('gone');
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = at(e);
    last = { x: p.x, y: p.y };
    seen();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = at(e);
    // a mouse pushes just by moving over the picture (harder with the button down); a finger or
    // pen only while touching
    if (!last) {
      if (e.pointerType === 'mouse') last = { x: p.x, y: p.y };
      return;
    }
    const dx = (p.x - last.x) * 480;
    const dy = (p.y - last.y) * 270;
    last = { x: p.x, y: p.y };
    const k = e.buttons ? 1.6 : 0.7;
    if (dx || dy) pad.pushAt(p.x, p.y, dx * k, dy * k);
  });
  const up = (e: PointerEvent) => e.pointerType !== 'mouse' && (last = null);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => (last = null));
  canvas.addEventListener('pointerleave', () => (last = null));

  // ---- keyboard: arrows push from a point that wanders with them
  const kp = { x: 0.5, y: 0.5 };
  canvas.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    seen();
    kp.x = Math.min(0.95, Math.max(0.05, kp.x + d[0] * 0.04));
    kp.y = Math.min(0.95, Math.max(0.05, kp.y + d[1] * 0.07));
    pad.pushAt(kp.x, kp.y, d[0] * 14, d[1] * 14);
  });
  screen.addEventListener('contextmenu', (e) => e.target === canvas && e.preventDefault());
}

// ---------------------------------------------------------------- frame diagram

function frameDiagram() {
  const box = $('frames');
  const btn = $<HTMLButtonElement>('frames-btn');
  const say = $('frames-say');
  if (!box || !btn || !say) return;
  const plain = say.innerHTML;
  btn.addEventListener('click', () => {
    const removed = box.dataset.removed !== 'true';
    box.dataset.removed = String(removed);
    btn.setAttribute('aria-pressed', String(removed));
    say.innerHTML = removed ? 'The keyframe is gone, so the next shot never arrives as a picture: only its <b>movement</b> does, and it drags the old one along.' : plain;
  });
}

// ---------------------------------------------------------------- before / after

function beforeAfter() {
  const box = $('ba');
  if (!box) return;
  const [before, after] = box.querySelectorAll('video');
  const range = box.querySelector('input') as HTMLInputElement;
  const set = (v: number) => box.style.setProperty('--split', `${Math.max(0, Math.min(100, v))}%`);
  range.addEventListener('input', () => set(+range.value));
  if (reduced) {
    // no autoplay: the posters stay
    return;
  }
  let timer = 0;
  // play both while on screen, kept in step
  whileVisible(
    box,
    () => {
      before.preload = after.preload = 'auto';
      after.currentTime = before.currentTime;
      before.play().catch(() => {});
      after.play().catch(() => {});
      timer = window.setInterval(() => {
        if (!before.paused && Math.abs(before.currentTime - after.currentTime) > 0.08) after.currentTime = before.currentTime;
      }, 1000);
    },
    () => {
      before.pause();
      after.pause();
      clearInterval(timer);
    },
    0.3,
  );
}

// ---------------------------------------------------------------- effect rack

interface Fx {
  type: string;
  code: string;
  name: string;
  color: string;
  family: string;
  looks: string;
  description: string;
  diagram: string;
}

function rack() {
  const box = $('rack');
  const data = $('fx-data');
  if (!box || !data) return;
  const fx: Fx[] = JSON.parse(data.textContent ?? '[]');
  const d = box.querySelector('.display') as HTMLElement;
  const code = d.querySelector('.display-code') as HTMLElement;
  const fam = d.querySelector('.display-family') as HTMLElement;
  const name = d.querySelector('.display-name') as HTMLElement;
  const looks = d.querySelector('.display-looks') as HTMLElement;
  const desc = d.querySelector('.display-desc') as HTMLElement;
  const diagram = d.querySelector('.display-diagram') as HTMLElement;
  const strip = diagram.querySelector('.strip') as HTMLElement;
  const keys = [...box.querySelectorAll<HTMLButtonElement>('.key')];
  const pick = (k: HTMLButtonElement) => {
    const f = fx.find((x) => x.type === k.dataset.fx);
    if (!f) return;
    for (const o of keys) o.setAttribute('aria-pressed', String(o === k));
    code.textContent = f.code;
    code.style.setProperty('--led', f.color);
    fam.textContent = f.family;
    name.textContent = f.name;
    looks.textContent = f.looks;
    desc.textContent = f.description;
    strip.innerHTML = f.diagram;
    diagram.hidden = !f.diagram;
    d.classList.remove('swap');
    void d.offsetWidth;
    d.classList.add('swap');
  };
  for (const k of keys) {
    k.addEventListener('click', () => pick(k));
    // with a mouse, pointing at a key is enough
    k.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && pick(k));
  }
  // arrow keys move between the keys
  box.addEventListener('keydown', (e) => {
    const i = keys.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const k = keys[(i + step + keys.length) % keys.length];
    k.focus();
    pick(k);
  });
}

// ---------------------------------------------------------------- editor tour

function tour() {
  const box = $('tour');
  if (!box) return;
  const all = [...box.querySelectorAll<HTMLElement>('[data-spot]')];
  const mark = (n: string | null) => {
    for (const el of all) el.classList.toggle('on', el.dataset.spot === n);
  };
  for (const el of all) {
    el.addEventListener('pointerenter', () => mark(el.dataset.spot!));
    el.addEventListener('pointerleave', () => mark(null));
    el.addEventListener('focus', () => mark(el.dataset.spot!));
    el.addEventListener('blur', () => mark(null));
  }
  // a tapped spot points at its line in the list
  for (const spot of box.querySelectorAll<HTMLButtonElement>('button.spot')) {
    spot.addEventListener('click', () => {
      mark(spot.dataset.spot!);
      const li = box.querySelector<HTMLElement>(`li[data-spot="${spot.dataset.spot}"]`);
      if (li && matchMedia('(max-width: 900px)').matches) li.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    });
  }
}

// ---------------------------------------------------------------- downloads

async function downloads() {
  const os = await detectOs();
  const main = $<HTMLAnchorElement>('dl-main');
  const note = $('dl-note');
  document.querySelector(`.dl[data-os="${os.os === 'android' || os.os === 'ios' ? 'web' : os.os}"]`)?.classList.add('mine');
  let assets: ReleaseAsset[] = [];
  let version = '';
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
    if (r.ok) {
      const j = await r.json();
      assets = j.assets ?? [];
      version = j.tag_name ?? '';
    }
  } catch {
    /* offline or rate-limited: the buttons keep pointing at the downloads section */
  }
  const label: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: '', ios: '', web: '' };
  const best = pickAsset(assets, os);
  if (main && best && label[os.os]) {
    main.href = best.browser_download_url;
    main.textContent = `Download for ${label[os.os]}`;
    if (note) note.textContent = `${version} · ${best.name} · ${(best.size / 1048576).toFixed(0)} MB. Free and open source; other systems below.`;
  } else if (main && (os.os === 'android' || os.os === 'ios')) {
    // phones: the installed web app is the app
    main.href = '#download';
    main.textContent = os.os === 'ios' ? 'Add to Home Screen' : 'Install the app';
    if (note) note.textContent = os.os === 'ios' ? 'Open moshpit, then Share → Add to Home Screen. It works offline after that.' : 'Open moshpit, then menu → Install app. It works offline after that.';
  }
  // each platform card links straight to its file(s)
  for (const card of document.querySelectorAll<HTMLElement>('.dl[data-os]')) {
    const want = card.dataset.os as Os;
    if (want === 'web' || !assets.length) continue;
    const files = assets.filter((a) => pickAsset([a], { os: want }, true));
    const link = card.querySelector('a');
    if (!files.length || !link) continue;
    link.remove();
    for (const f of files) {
      const a = document.createElement('a');
      a.href = f.browser_download_url;
      a.textContent = `${f.name} (${(f.size / 1048576).toFixed(0)} MB)`;
      card.appendChild(a);
    }
  }
}

// ---------------------------------------------------------------- gallery

interface GalleryItem {
  title: string;
  author: string;
  /** a looping video (or image) of the result */
  media: string;
  poster?: string;
  /** share code (MOSH:…) to open the same mosh in moshpit */
  recipe?: string;
  link?: string;
}

async function gallery() {
  const list = $('gallery-list');
  if (!list) return;
  let items: GalleryItem[] = [];
  try {
    items = await (await fetch('./site/gallery.json')).json();
  } catch {
    /* no gallery file */
  }
  list.textContent = '';
  if (!items.length) {
    list.innerHTML = '<p class="faint">Nothing here yet. Be the first to share one.</p>';
    return;
  }
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  for (const it of items) {
    const card = document.createElement('article');
    card.className = 'gcard';
    const frame = document.createElement('div');
    frame.className = 'gmedia';
    const isVideo = /\.(webm|mp4|mov)(\?|$)/i.test(it.media) || /user-attachments\/assets/.test(it.media);
    const m = document.createElement(isVideo ? 'video' : 'img') as HTMLVideoElement & HTMLImageElement;
    m.src = it.media;
    if (isVideo) {
      Object.assign(m, { muted: true, loop: true, playsInline: true, preload: 'none' });
      if (it.poster) m.poster = it.poster;
      if (reduced) m.controls = true;
      else if (hover) {
        // with a mouse: plays while pointed at
        card.addEventListener('pointerenter', () => m.play().catch(() => {}));
        card.addEventListener('pointerleave', () => m.pause());
        card.addEventListener('focusin', () => m.play().catch(() => {}));
        card.addEventListener('focusout', () => m.pause());
      } else whileVisible(m, () => m.play().catch(() => {}), () => m.pause(), 0.6);
    } else {
      m.alt = it.title;
      m.loading = 'lazy';
    }
    m.setAttribute('aria-label', it.title);
    frame.append(m);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const b = document.createElement('h3');
    b.textContent = it.title;
    const by = document.createElement('span');
    by.textContent = 'by ' + it.author;
    meta.append(b, by);
    if (it.recipe) {
      const a = document.createElement('a');
      a.href = './app/#recipe=' + encodeURIComponent(it.recipe);
      a.textContent = 'Open this recipe in moshpit →';
      meta.append(a);
    } else if (it.link) {
      const a = document.createElement('a');
      a.href = it.link;
      a.textContent = 'See how it was made →';
      meta.append(a);
    }
    card.append(frame, meta);
    list.append(card);
  }
}

// ---------------------------------------------------------------- bits of motion

/** Sections ease in the first time they come on screen. */
function reveal() {
  const els = document.querySelectorAll('.block .head, .frames, .ba, .rack, .tour, .specs, .gallery, .private-grid, .downloads, .faq, .outro .wrap');
  if (reduced || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of els) {
    // already on screen: no animation
    if (el.getBoundingClientRect().top < innerHeight) continue;
    el.classList.add('pre');
    io.observe(el);
  }
}

/** The footer's big wordmark tears along the pointer. */
function wordmark() {
  const w = $('wordmark');
  if (!w || reduced) return;
  w.addEventListener('pointermove', (e) => {
    const r = w.getBoundingClientRect();
    w.style.setProperty('--tx', String((e.clientX - r.left) / r.width - 0.5));
    w.style.setProperty('--ty', String((e.clientY - r.top) / r.height));
    w.classList.add('torn');
  });
  w.addEventListener('pointerleave', () => w.classList.remove('torn'));
}

nav();
moshPad();
frameDiagram();
beforeAfter();
rack();
tour();
downloads();
gallery();
reveal();
wordmark();
