// The landing page: the right download for this computer, the before/after slider and the gallery.
// Kept small and separate from the editor (it never loads the video engine).
import { detectOs, pickAsset, type Os, type ReleaseAsset } from './os';

const REPO = 'furniture3k/Video-Datamosher';
// with reduced motion, videos don't play by themselves (they get controls instead)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- downloads

async function downloads() {
  const os = await detectOs();
  const main = document.getElementById('dl-main') as HTMLAnchorElement | null;
  const note = document.getElementById('dl-note');
  document.querySelector(`.dl[data-os="${os.os}"]`)?.classList.add('mine');
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
    /* offline or rate-limited: the buttons keep pointing at the Releases page */
  }
  const label: Record<Os, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: '', ios: '', web: '' };
  const best = pickAsset(assets, os);
  if (main && best && label[os.os]) {
    main.href = best.browser_download_url;
    main.textContent = `Download for ${label[os.os]}`;
    if (note) note.textContent = `${version} · ${best.name} · ${(best.size / 1048576).toFixed(0)} MB. Other systems below.`;
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

// ---------------------------------------------------------------- before / after

function beforeAfter() {
  const box = document.getElementById('ba');
  if (!box) return;
  const [before, after] = box.querySelectorAll('video');
  const range = box.querySelector('input') as HTMLInputElement;
  const set = (v: number) => box.style.setProperty('--split', `${Math.max(0, Math.min(100, v))}%`);
  range.addEventListener('input', () => set(+range.value));
  // play both while on screen, kept in step
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !reduced) {
      after.currentTime = before.currentTime;
      before.play().catch(() => {});
      after.play().catch(() => {});
    } else {
      before.pause();
      after.pause();
    }
  }, { threshold: 0.3 });
  io.observe(box);
  setInterval(() => {
    if (!before.paused && Math.abs(before.currentTime - after.currentTime) > 0.08) after.currentTime = before.currentTime;
  }, 1000);
}

// the hero video is autoplay in the page; stop it when motion should be reduced
function hero() {
  const v = document.querySelector<HTMLVideoElement>('.hero-media video');
  if (!v || !reduced) return;
  v.autoplay = false;
  v.pause();
  v.controls = true;
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
  const list = document.getElementById('gallery-list');
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
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'gcard';
    const isVideo = /\.(webm|mp4|mov)(\?|$)/i.test(it.media) || /user-attachments\/assets/.test(it.media);
    const m = document.createElement(isVideo ? 'video' : 'img') as HTMLVideoElement & HTMLImageElement;
    m.src = it.media;
    if (isVideo) {
      Object.assign(m, { muted: true, loop: true, playsInline: true, preload: 'none' });
      if (it.poster) m.poster = it.poster;
      if (reduced) m.controls = true;
      else new IntersectionObserver(([e]) => (e.isIntersecting ? m.play().catch(() => {}) : m.pause()), { threshold: 0.4 }).observe(m);
    } else m.alt = it.title;
    m.setAttribute('aria-label', it.title);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const b = document.createElement('b');
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
    card.append(m, meta);
    list.append(card);
  }
}

downloads();
hero();
beforeAfter();
gallery();
