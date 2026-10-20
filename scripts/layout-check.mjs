// Layout checks run inside the page (a browser through Playwright, or the desktop app through
// WebDriver): each is a self-contained function to pass to page.evaluate / execute.

/** Everything wrong with the layout on screen: cut off, scrolling sideways, or overlapping. */
export function layoutProblems() {
  const out = [];
  const W = innerWidth;
  const H = innerHeight;
  const de = document.documentElement;
  if (de.scrollWidth > W + 1) out.push(`page scrolls sideways (${de.scrollWidth} > ${W})`);
  const name = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${t}"`;
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || +s.opacity === 0) return null;
    return r;
  };
  // the part of an element its scrolling or clipping ancestors let show
  const visibleRect = (el, r) => {
    let { left, top, right, bottom } = r;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint')) {
        const ar = a.getBoundingClientRect();
        if (s.overflowX !== 'visible') ((left = Math.max(left, ar.left)), (right = Math.min(right, ar.right)));
        if (s.overflowY !== 'visible') ((top = Math.max(top, ar.top)), (bottom = Math.min(bottom, ar.bottom)));
      }
      if (s.position === 'fixed') break;
    }
    return { left, top, right, bottom, scrolled: right - left < r.width - 1 || bottom - top < r.height - 1 };
  };
  // the website scrolls down: only its sides count; the editor fits its window both ways
  const scrolls = de.scrollHeight > H + 1 && getComputedStyle(document.body).overflowY !== 'hidden';
  // with a dialog open, only what's in it (the rest is behind its backdrop)
  const backdrops = [...document.querySelectorAll('.backdrop')];
  const scope = backdrops.length ? backdrops[backdrops.length - 1] : document;
  // a control on top where it is (not under another panel or a menu)
  const onTop = (el, r) => {
    const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  };
  const controls = [...scope.querySelectorAll('button, a[href], input, select, [role=button], [role=tab], [role=slider]')].filter((el) => !el.matches('.skip, [type=file], [type=hidden]'));
  const boxes = [];
  for (const el of controls) {
    const r = shown(el);
    if (!r) continue;
    // inside a panel that scrolls, a control past its edge is reachable by scrolling
    const v = visibleRect(el, r);
    if (v.right - v.left < 1 || v.bottom - v.top < 1) continue;
    const offY = !scrolls && (r.bottom > H + 1 || r.top < -1);
    if (r.right > W + 1 || r.left < -1 || offY) {
      if (!v.scrolled || v.right > W + 1 || (!scrolls && v.bottom > H + 1)) out.push(`off screen: ${name(el)} at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    if (!v.scrolled && r.bottom > 0 && r.top < H && el.matches('button, a[href], [role=button], [role=tab]') && onTop(el, r)) boxes.push([el, r]);
  }
  // controls drawn on top of each other (not one inside the other, not a deliberate overlay)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, ra] = boxes[i];
      const [b, rb] = boxes[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix < 4 || iy < 4) continue;
      // only when the overlap is a good part of the smaller one (not a 1px shared border)
      if (ix * iy < 0.25 * Math.min(ra.width * ra.height, rb.width * rb.height)) continue;
      // a button placed on another on purpose (a star on a card, a handle on a clip)
      const pos = (el) => ['absolute', 'fixed'].includes(getComputedStyle(el).position);
      if (pos(a) || pos(b)) continue;
      out.push(`overlap: ${name(a)} and ${name(b)}`);
    }
  // text cut off inside a button that doesn't mean to (no ellipsis)
  for (const el of scope.querySelectorAll('button')) {
    const r = shown(el);
    if (!r || el.scrollWidth <= el.clientWidth + 2) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' || s.overflow === 'visible') continue;
    out.push(`text cut off: ${name(el)} (${el.scrollWidth} > ${el.clientWidth})`);
  }
  return [...new Set(out)];
}

/** The player's picture: its shape on screen against the project's, and that it fits its stage. */
export function pictureProblem() {
  const s = window.__moshpit.store;
  const stage = document.querySelector('.stage');
  const cv = [...document.querySelectorAll('.stage canvas')].find((c) => !c.classList.contains('hidden') && c.width > 0 && c.getBoundingClientRect().width > 0);
  if (!stage || !cv) return 'no picture on the stage';
  const sr = stage.getBoundingClientRect();
  const r = cv.getBoundingClientRect();
  if (r.right > sr.right + 1 || r.bottom > sr.bottom + 1 || r.left < sr.left - 1 || r.top < sr.top - 1) return `canvas outside its stage (${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))} in ${JSON.stringify([sr.left, sr.top, sr.right, sr.bottom].map(Math.round))})`;
  // letterboxed (object-fit: contain): the drawn picture's shape is the canvas's own
  const ar = cv.width / cv.height;
  const k = Math.min(r.width / cv.width, r.height / cv.height);
  const pw = cv.width * k;
  const ph = cv.height * k;
  if (pw < 40 || ph < 40) return `picture too small to see (${Math.round(pw)}×${Math.round(ph)})`;
  const aspect = s.project.encoder.aspect;
  const target = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16, '4:5': 4 / 5, '21:9': 21 / 9 }[aspect];
  if (target && Math.abs(ar / target - 1) > 0.02) return `picture is ${ar.toFixed(3)}, project is ${aspect}`;
  return null;
}
