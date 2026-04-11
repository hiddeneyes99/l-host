/* ─────────────────────────────────────────────
   l-host  ·  Frontend App
   ───────────────────────────────────────────── */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  currentPath: '',
  currentView: 'home',
  listMode: 'grid',
  searchOpen: false,
  imageList: [],
  imageIndex: 0,
  ctxItem: null,
  uploadPath: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function fileIcon(item) {
  if (item.type === 'dir') return '📁';
  const { category: cat, ext } = item;
  if (cat === 'video') return '🎬';
  if (cat === 'image') return '🖼️';
  if (cat === 'audio') return '🎵';
  if (cat === 'archive') return '🗜️';
  if (cat === 'apk') return '📱';
  if (ext === '.pdf') return '📄';
  if (['.txt','.md','.log'].includes(ext)) return '📝';
  if (['.json','.xml','.html','.css','.js'].includes(ext)) return '🔧';
  return '📂';
}

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`;
}

function toast(msg, type = '') {
  const c = $('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 2500);
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function updateBreadcrumb(p) {
  const el = $('breadcrumb');
  el.textContent = p ? '/ ' + p.replace(/\\/g, '/') : '/';
}

// ═══════════════════════════════════════════════════════════════════════════
//  VIDEO THUMBNAIL GENERATOR  (lazy, canvas-based)
// ═══════════════════════════════════════════════════════════════════════════

const thumbCache = new Map();

function generateThumb(url, thumbEl) {
  if (thumbCache.has(url)) {
    const cached = thumbCache.get(url);
    if (cached) applyThumb(thumbEl, cached);
    return;
  }
  thumbCache.set(url, null); // mark as loading

  const vid = document.createElement('video');
  vid.muted = true;
  vid.preload = 'metadata';
  vid.crossOrigin = 'anonymous';
  const cleanup = () => { try { vid.src = ''; } catch(_) {} };

  const timeout = setTimeout(cleanup, 10000);

  vid.addEventListener('loadedmetadata', () => {
    vid.currentTime = Math.min(vid.duration * 0.1, 4);
  });

  vid.addEventListener('seeked', () => {
    clearTimeout(timeout);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(vid, 0, 0, 320, 180);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      thumbCache.set(url, dataUrl);
      applyThumb(thumbEl, dataUrl);
    } catch(_) {}
    cleanup();
  });

  vid.addEventListener('error', () => { clearTimeout(timeout); cleanup(); });
  vid.src = url;
}

function applyThumb(thumbEl, dataUrl) {
  if (!thumbEl || !thumbEl.isConnected) return;
  const canvas = thumbEl.querySelector('.vt-canvas');
  const spinner = thumbEl.querySelector('.vt-loading');
  if (canvas) { canvas.src = dataUrl; canvas.style.display = 'block'; }
  if (spinner) spinner.remove();
}

// Intersection observer for lazy thumbnail loading
const thumbObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target;
          const url = el.dataset.thumbUrl;
          if (url) { thumbObserver.unobserve(el); generateThumb(url, el); }
        }
      });
    }, { rootMargin: '150px' })
  : null;

// Intersection observer for lazy audio album art in grid
const audioArtObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        const artUrl = el.dataset.audioArt;
        if (!artUrl) return;
        audioArtObserver.unobserve(el);
        const img = el.querySelector('.audio-art-img');
        if (!img) return;
        const probe = new Image();
        probe.crossOrigin = 'anonymous';
        probe.onload = () => {
          img.src = artUrl;
          img.style.display = 'block';
          const icon = el.querySelector('.at-icon');
          const eq = el.querySelector('.audio-eq');
          if (icon) icon.style.opacity = '0';
          if (eq) eq.style.opacity = '0';
        };
        probe.onerror = () => {};
        probe.src = artUrl;
      });
    }, { rootMargin: '200px' })
  : null;

// ═══════════════════════════════════════════════════════════════════════════
//  PAGINATION ENGINE  (infinite scroll for 100k+ files)
// ═══════════════════════════════════════════════════════════════════════════

const PG_LIMIT    = 50;  // items fetched per server page
const VDOM_WINDOW = 100; // max DOM nodes kept in grid at once

const pg = {
  view:     null,  // 'browser' | 'cat' | 'search'
  param:    null,  // relPath | cat | query string
  page:     0,     // NEXT page to fetch
  total:    0,     // total items on server
  loading:  false,
  imageSet: [],    // grows as pages load
  audioSet: [],
  grid:     null,
};

let _sentinelObserver = null;

function pgReset(view, param, grid) {
  if (_sentinelObserver) { _sentinelObserver.disconnect(); _sentinelObserver = null; }
  pg.view = view; pg.param = param; pg.grid = grid;
  pg.page = 0; pg.total = 0; pg.loading = false;
  pg.imageSet = []; pg.audioSet = [];
  vdomReset(grid);
}

function pgSentinelSetup() {
  const old = pg.grid ? pg.grid.querySelector('.pg-sentinel') : null;
  if (old) old.remove();
  if (!pg.grid) return;
  if (pg.page * PG_LIMIT >= pg.total) return; // all pages loaded

  const s = document.createElement('div');
  s.className = 'pg-sentinel';
  // Insert before bottomSpacer so sentinel sits inside the real content area
  if (vdom.bottomSpacer && vdom.bottomSpacer.parentNode === pg.grid) {
    pg.grid.insertBefore(s, vdom.bottomSpacer);
  } else {
    pg.grid.appendChild(s);
  }

  _sentinelObserver = new IntersectionObserver(async entries => {
    if (!entries[0].isIntersecting || pg.loading) return;
    if (pg.page * PG_LIMIT >= pg.total) { _sentinelObserver.disconnect(); return; }
    await pgNext();
  }, { rootMargin: '300px' });
  _sentinelObserver.observe(s);
}

function createSkeletons(count) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'file-item sk-card';
    el.innerHTML = '<div class="thumb sk-thumb"></div><div class="item-info"><div class="sk-line sk-name"></div><div class="sk-line sk-size"></div></div>';
    frag.appendChild(el);
  }
  return frag;
}

async function pgNext() {
  if (pg.loading || !pg.grid) return;
  pg.loading = true;

  // Show skeleton placeholders
  const remaining = pg.total - pg.page * PG_LIMIT;
  const skCount = Math.min(remaining, PG_LIMIT);
  const skEls = [];
  for (let i = 0; i < skCount; i++) {
    const sk = document.createElement('div');
    sk.className = 'file-item sk-card';
    sk.innerHTML = '<div class="thumb sk-thumb"></div><div class="item-info"><div class="sk-line sk-name"></div><div class="sk-line sk-size"></div></div>';
    pg.grid.appendChild(sk);
    skEls.push(sk);
  }

  try {
    let url;
    if      (pg.view === 'browser') url = `/api/ls?path=${encodeURIComponent(pg.param)}&page=${pg.page}&limit=${PG_LIMIT}`;
    else if (pg.view === 'cat')     url = `/api/category/${pg.param}?page=${pg.page}&limit=${PG_LIMIT}`;
    else if (pg.view === 'search')  url = `/api/search?q=${encodeURIComponent(pg.param)}&path=&page=${pg.page}&limit=${PG_LIMIT}`;

    const data = await fetchJson(url);
    const newItems = data.items || data.results || [];

    pg.imageSet.push(...newItems.filter(i => i.category === 'image'));
    pg.audioSet.push(...newItems.filter(i => i.category === 'audio'));
    pg.total = data.total;
    pg.page++;

    skEls.forEach(s => s.remove());
    vdomAppendItems(newItems);
  } catch (e) {
    skEls.forEach(s => s.remove());
    console.error('[pg] load error:', e);
  }

  pg.loading = false;
  pgSentinelSetup();
}

// ═══════════════════════════════════════════════════════════════════════════
//  DOM VIRTUALIZATION ENGINE  (sliding window of VDOM_WINDOW nodes)
//  Prevents RAM bloat in folders with 10k+ items by unmounting off-screen
//  elements and releasing their image blobs / observer handles.
// ═══════════════════════════════════════════════════════════════════════════

const vdom = {
  allItems:    [],   // ALL loaded item data (grows as pages arrive)
  domStart:    0,    // index of first item currently rendered in DOM
  domEnd:      0,    // index one past last item currently rendered in DOM
  grid:        null,
  topSpacer:   null,
  bottomSpacer:null,
  itemH:       200,  // estimated row height (px) — calibrated after first render
  cols:        2,    // grid columns — calibrated after first render
  measured:    false,
  upObserver:  null,
};

function vdomReset(grid) {
  if (vdom.upObserver) { vdom.upObserver.disconnect(); vdom.upObserver = null; }
  vdom.allItems = []; vdom.domStart = 0; vdom.domEnd = 0;
  vdom.grid = grid; vdom.measured = false;
  vdom.topSpacer = null; vdom.bottomSpacer = null;
}

function vdomMeasure() {
  if (vdom.measured || !vdom.grid) return;
  const firstItem = vdom.grid.querySelector('.file-item');
  if (!firstItem) return;
  const itemRect = firstItem.getBoundingClientRect();
  if (itemRect.height < 10) return;
  vdom.itemH = itemRect.height + 8;
  const gridRect = vdom.grid.getBoundingClientRect();
  vdom.cols = Math.max(1, Math.round(gridRect.width / (itemRect.width + 8)));
  vdom.measured = true;
}

function vdomEnsureSpacers() {
  const grid = vdom.grid;
  if (!grid) return;
  if (!vdom.topSpacer) {
    vdom.topSpacer = document.createElement('div');
    vdom.topSpacer.className = 'vdom-spacer';
    vdom.topSpacer.style.cssText = 'width:100%;height:0px;grid-column:1/-1;pointer-events:none;';
    grid.insertBefore(vdom.topSpacer, grid.firstChild);
  }
  if (!vdom.bottomSpacer) {
    vdom.bottomSpacer = document.createElement('div');
    vdom.bottomSpacer.className = 'vdom-spacer';
    vdom.bottomSpacer.style.cssText = 'width:100%;height:0px;grid-column:1/-1;pointer-events:none;';
    grid.appendChild(vdom.bottomSpacer);
  }
}

function vdomUpdateSpacers() {
  if (!vdom.topSpacer || !vdom.bottomSpacer) return;
  if (!vdom.measured) vdomMeasure();
  const rowsAbove = Math.floor(vdom.domStart / vdom.cols);
  const rowsBelow = Math.ceil(Math.max(0, vdom.allItems.length - vdom.domEnd) / vdom.cols);
  vdom.topSpacer.style.height    = (rowsAbove * vdom.itemH) + 'px';
  vdom.bottomSpacer.style.height = (rowsBelow * vdom.itemH) + 'px';
}

function vdomReleaseEl(el) {
  if (!el) return;
  const thumbEl = el.querySelector('[data-thumb-url]');
  if (thumbEl) {
    if (thumbObserver) thumbObserver.unobserve(thumbEl);
    const url = thumbEl.dataset.thumbUrl;
    if (url) thumbCache.delete(url); // free the dataUrl string
  }
  const artEl = el.querySelector('[data-audio-art]');
  if (artEl && audioArtObserver) audioArtObserver.unobserve(artEl);
  el.remove();
}

function vdomPruneTop() {
  const excess = (vdom.domEnd - vdom.domStart) - VDOM_WINDOW;
  if (excess <= 0 || !vdom.grid) return;
  const count = Math.min(excess, 50);
  for (let i = 0; i < count; i++) {
    vdomReleaseEl(vdom.grid.querySelector(`[data-vdom-idx="${vdom.domStart}"]`));
    vdom.domStart++;
  }
  vdomUpdateSpacers();
}

function vdomPruneBottom() {
  const excess = (vdom.domEnd - vdom.domStart) - VDOM_WINDOW;
  if (excess <= 0 || !vdom.grid) return;
  const count = Math.min(excess, 50);
  for (let i = 0; i < count; i++) {
    vdom.domEnd--;
    vdomReleaseEl(vdom.grid.querySelector(`[data-vdom-idx="${vdom.domEnd}"]`));
  }
  vdomUpdateSpacers();
}

function vdomAppendItems(items) {
  if (!vdom.grid || !items.length) return;
  vdomEnsureSpacers();

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const idx = vdom.allItems.length;
    vdom.allItems.push(item);
    const el = createItemEl(item, pg.imageSet, pg.audioSet);
    el.dataset.vdomIdx = String(idx);
    frag.appendChild(el);
    vdom.domEnd = idx + 1;
  }

  // Insert real items before the bottomSpacer
  vdom.grid.insertBefore(frag, vdom.bottomSpacer);

  // Calibrate spacer heights after first paint
  if (!vdom.measured) {
    requestAnimationFrame(() => { vdomMeasure(); vdomUpdateSpacers(); });
  } else {
    vdomUpdateSpacers();
  }

  // If over the window limit, evict from the top
  if (vdom.domEnd - vdom.domStart > VDOM_WINDOW) {
    vdomPruneTop();
  }

  vdomSetupUpObserver();
}

function vdomSetupUpObserver() {
  if (vdom.upObserver) { vdom.upObserver.disconnect(); vdom.upObserver = null; }
  if (!vdom.topSpacer || vdom.domStart === 0) return;

  vdom.upObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) vdomScrollUp();
  }, { rootMargin: '400px' });
  vdom.upObserver.observe(vdom.topSpacer);
}

function vdomScrollUp() {
  if (!vdom.grid || vdom.domStart === 0) return;
  const newStart = Math.max(0, vdom.domStart - 50);
  const toMount  = vdom.allItems.slice(newStart, vdom.domStart);

  const frag = document.createDocumentFragment();
  for (let i = 0; i < toMount.length; i++) {
    const el = createItemEl(toMount[i], pg.imageSet, pg.audioSet);
    el.dataset.vdomIdx = String(newStart + i);
    frag.appendChild(el);
  }

  // Preserve scroll position: measure current top before splice
  const firstVis = vdom.grid.querySelector(`[data-vdom-idx="${vdom.domStart}"]`);
  const prevTop  = firstVis ? firstVis.getBoundingClientRect().top : 0;

  // Insert the re-mounted items before the first currently-rendered item
  const firstRendered = vdom.grid.querySelector('[data-vdom-idx]');
  if (firstRendered) {
    vdom.grid.insertBefore(frag, firstRendered);
  } else if (vdom.topSpacer && vdom.topSpacer.nextSibling) {
    vdom.grid.insertBefore(frag, vdom.topSpacer.nextSibling);
  } else {
    vdom.grid.appendChild(frag);
  }
  vdom.domStart = newStart;

  // Restore scroll so viewport doesn't jump
  if (firstVis) {
    const newTop = firstVis.getBoundingClientRect().top;
    window.scrollBy(0, newTop - prevTop);
  }

  // Prune from the bottom to stay within window
  vdomPruneBottom();
  vdomUpdateSpacers();
  vdomSetupUpObserver();
}

// ═══════════════════════════════════════════════════════════════════════════
//  CUSTOM VIDEO PLAYER
// ═══════════════════════════════════════════════════════════════════════════

const VP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const ASPECTS   = ['fit','fill','stretch'];
const ASPECT_LABELS = { fit:'Fit', fill:'Fill', stretch:'Stretch' };

const vp = {
  item: null,
  url: '',
  speed: 1,
  aspectIdx: 0,
  theater: false,
  brightness: 1,     // 0.2 → 1
  volume: 1,
  muted: false,
  controlsTimer: null,
  progressDragging: false,
  // gesture tracking
  touch: {
    startX: 0, startY: 0, startVal: 0,
    type: null,         // 'vol' | 'bright' | null
    leftTap: 0, rightTap: 0, // timestamps for double-tap
    tapCount: 0,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  PREMIUM MUSIC PLAYER
// ═══════════════════════════════════════════════════════════════════════════

const AUDIO_PALETTES = [
  ['#00d4c8','#0091ff'],
  ['#f953c6','#b91d73'],
  ['#667eea','#764ba2'],
  ['#f7971e','#ffd200'],
  ['#11998e','#38ef7d'],
  ['#c94b4b','#4b134f'],
  ['#4776e6','#8e54e9'],
  ['#00b09b','#96c93d'],
];

function audioPalette(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AUDIO_PALETTES[Math.abs(h) % AUDIO_PALETTES.length];
}

function _hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}
function _rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h, s, l];
}
function _hslToHex(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = _hue2rgb(p, q, h + 1/3);
    g = _hue2rgb(p, q, h);
    b = _hue2rgb(p, q, h - 1/3);
  }
  const toH = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}
function extractColors(imgEl) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 100) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return null;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    let [h, s, l] = _rgbToHsl(r, g, b);
    s = Math.min(1, s * 1.5 + 0.25);
    l = Math.min(0.72, Math.max(0.38, l));
    const c1 = _hslToHex(h, s, l);
    const c2 = _hslToHex((h + 0.17) % 1, s, Math.max(0.25, l - 0.15));
    return [c1, c2];
  } catch (_) { return null; }
}

const mp = {
  queue: [],
  index: 0,
  shuffle: false,
  repeat: 'none',
  shuffleOrder: [],
  audioCtx: null,
  analyser: null,
  source: null,
  rafId: null,
  isPlaying: false,
  progressDragging: false,
  color1: '#00d4c8',
  color2: '#0091ff',
};

function mpGetAudio() { return $('audioPlayer'); }

function mpFisherYates(len) {
  const a = [...Array(len).keys()];
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function openAudio(item, url, queue = []) {
  mp.queue = queue.length ? queue : [item];
  mp.index = mp.queue.findIndex(i => i.path === item.path);
  if (mp.index < 0) mp.index = 0;
  if (mp.shuffle) mp.shuffleOrder = mpFisherYates(mp.queue.length);
  mpHideMini();
  openModal('audioModal');
  mpLoadTrack(mp.index);
}

function mpExpandFromMini() {
  mpHideMini();
  openModal('audioModal');
  // Restart visualizer since it was stopped when mini was shown
  if (!mp.rafId) mpStartVisualizer();
}

function mpLoadTrack(idx) {
  const item = mp.queue[idx];
  if (!item) return;
  mp.index = idx;

  const trackUrl = `/file?path=${encodeURIComponent(item.path)}`;
  const audio = mpGetAudio();

  const displayName = item.name.replace(/\.[^.]+$/, '');
  const ext = (item.ext || '').toUpperCase().replace('.', '');
  $('mpTitle').textContent = displayName;
  $('mpArtist').textContent = (ext ? ext + ' · ' : '') + (item.sizeStr || '');
  $('audioDl').href = trackUrl + '&dl=1';

  const [c1, c2] = audioPalette(item.name);

  // Helper: push color pair to all ambient elements
  function mpApplyColors(col1, col2) {
    mp.color1 = col1; mp.color2 = col2;
    $('mpArtGlow').style.background = col1;
    const container = $('mpContainer');
    container.style.setProperty('--mp-color1', col1);
    container.style.setProperty('--mp-color2', col2);
    $('mpAmbientBlur').style.setProperty('--mp-color1', col1);
    $('mpAmbientBlur').style.setProperty('--mp-color2', col2);
  }

  // Reset art to gradient placeholder, then try to load real album art
  const artEl = $('mpArt');
  artEl.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  const artIcon = artEl.querySelector('.mp-art-icon');
  if (artIcon) artIcon.style.display = '';
  let existingImg = artEl.querySelector('.mp-art-img');
  if (existingImg) existingImg.remove();

  const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
  const img = new Image();
  img.className = 'mp-art-img';
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    artEl.style.background = 'none';
    if (artIcon) artIcon.style.display = 'none';
    let old = artEl.querySelector('.mp-art-img');
    if (old) old.remove();
    artEl.appendChild(img);
    // Extract dominant color from real album art and update ambience
    const extracted = extractColors(img);
    if (extracted) mpApplyColors(extracted[0], extracted[1]);
  };
  img.onerror = () => { /* keep gradient */ };
  img.src = artUrl;

  mpApplyColors(c1, c2);

  audio.src = trackUrl;
  $('mpProgressFill').style.width = '0%';
  $('mpProgressDot').style.left = '0%';
  $('mpCurrentTime').textContent = '0:00';
  $('mpDuration').textContent = '0:00';

  mpInitAudioContext();
  audio.play().then(() => mpSetPlaying(true)).catch(() => {});
  mpRenderQueue();
  // Keep mini player in sync if it's currently visible
  if ($('miniPlayer').classList.contains('active')) {
    mpUpdateMiniInfo(mp.queue[mp.index]);
  }
  // Persist queue state so it survives server restarts
  memPush('musicQueue', { items: mp.queue, index: mp.index });
}

function mpInitAudioContext() {
  const audio = mpGetAudio();
  if (!mp.audioCtx) {
    try {
      mp.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      mp.source = mp.audioCtx.createMediaElementSource(audio);
      mp.analyser = mp.audioCtx.createAnalyser();
      mp.analyser.fftSize = 128;
      mp.analyser.smoothingTimeConstant = 0.8;
      mp.source.connect(mp.analyser);
      mp.analyser.connect(mp.audioCtx.destination);
    } catch(e) { console.warn('AudioContext unavailable:', e); }
  } else if (mp.audioCtx.state === 'suspended') {
    mp.audioCtx.resume();
  }
  if (!mp.rafId) mpStartVisualizer();
}

function mpSetPlaying(playing) {
  mp.isPlaying = playing;
  $('mpPlayIcon').innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none"/>'
    : '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
  mpUpdateMiniPlayIcon();
}

function mpTogglePlay() {
  const audio = mpGetAudio();
  const btn = $('mpPlayBtn');
  btn.classList.remove('pulse');
  void btn.offsetWidth;
  btn.classList.add('pulse');
  if (audio.paused) {
    if (mp.audioCtx && mp.audioCtx.state === 'suspended') mp.audioCtx.resume();
    audio.play().then(() => mpSetPlaying(true)).catch(() => {});
  } else {
    audio.pause();
    mpSetPlaying(false);
  }
}

function mpNext() {
  if (!mp.queue.length) return;
  let nextIdx;
  if (mp.shuffle) {
    const pos = mp.shuffleOrder.indexOf(mp.index);
    nextIdx = mp.shuffleOrder[(pos + 1) % mp.shuffleOrder.length];
  } else {
    nextIdx = (mp.index + 1) % mp.queue.length;
  }
  mpLoadTrack(nextIdx);
}

function mpPrev() {
  const audio = mpGetAudio();
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let prevIdx;
  if (mp.shuffle) {
    const pos = mp.shuffleOrder.indexOf(mp.index);
    prevIdx = mp.shuffleOrder[(pos - 1 + mp.shuffleOrder.length) % mp.shuffleOrder.length];
  } else {
    prevIdx = (mp.index - 1 + mp.queue.length) % mp.queue.length;
  }
  mpLoadTrack(prevIdx);
}

function mpToggleShuffle() {
  mp.shuffle = !mp.shuffle;
  if (mp.shuffle) mp.shuffleOrder = mpFisherYates(mp.queue.length);
  $('mpShuffleBtn').classList.toggle('active', mp.shuffle);
  mpRenderQueue();
}

function mpToggleRepeat() {
  const modes = ['none', 'all', 'one'];
  mp.repeat = modes[(modes.indexOf(mp.repeat) + 1) % modes.length];
  const btn = $('mpRepeatBtn');
  btn.classList.toggle('active', mp.repeat !== 'none');
  btn.title = mp.repeat === 'one' ? 'Repeat One' : mp.repeat === 'all' ? 'Repeat All' : 'Repeat';
  // Show "1" badge on the button when repeat-one is active
  let badge = btn.querySelector('.mp-repeat-badge');
  if (mp.repeat === 'one') {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mp-repeat-badge';
      btn.appendChild(badge);
    }
    badge.textContent = '1';
  } else {
    if (badge) badge.remove();
  }
}

function mpUpdateProgress() {
  if (mp.progressDragging) return;
  const audio = mpGetAudio();
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  $('mpProgressFill').style.width = pct + '%';
  $('mpProgressDot').style.left = pct + '%';
  $('mpCurrentTime').textContent = fmtTime(audio.currentTime);
  $('miniProgressFill').style.width = pct + '%';
}

function mpSeekFromEvent(e) {
  const bar = $('mpProgressBar');
  const rect = bar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const audio = mpGetAudio();
  if (audio.duration) {
    audio.currentTime = pct * audio.duration;
    $('mpProgressFill').style.width = (pct * 100) + '%';
    $('mpProgressDot').style.left = (pct * 100) + '%';
    $('mpCurrentTime').textContent = fmtTime(audio.currentTime);
  }
}

function mpRenderQueue() {
  const list = $('mpQueueList');
  list.innerHTML = '';
  const count = Math.min(mp.queue.length, 6);
  for (let i = 0; i < count; i++) {
    const idx = mp.shuffle ? mp.shuffleOrder[i] : (mp.index + i) % mp.queue.length;
    const item = mp.queue[idx];
    if (!item) continue;
    const [c1, c2] = audioPalette(item.name);
    const isCurr = idx === mp.index;
    const el = document.createElement('div');
    el.className = 'mp-queue-item' + (isCurr ? ' active' : '');
    el.innerHTML = `
      <div class="mp-queue-thumb" style="background:linear-gradient(135deg,${c1},${c2})">
        <img class="mp-queue-art" alt="">
        <svg viewBox="0 0 24 24" class="mp-queue-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div class="mp-queue-info">
        <div class="mp-queue-name">${item.name.replace(/\.[^.]+$/,'')}</div>
        <div class="mp-queue-size">${item.sizeStr || ''}</div>
      </div>`;
    // Lazy-load album art for this queue item
    const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
    const artImg = el.querySelector('.mp-queue-art');
    const artIcon = el.querySelector('.mp-queue-icon');
    const probe = new Image();
    probe.onload = () => {
      artImg.src = artUrl;
      artImg.style.display = 'block';
      if (artIcon) artIcon.style.opacity = '0';
    };
    probe.onerror = () => {};
    probe.src = artUrl;
    el.addEventListener('click', () => mpLoadTrack(idx));
    list.appendChild(el);
  }
}

function mpStartVisualizer() {
  const canvas = $('mpVisualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Pre-build a single reusable gradient (updated when colors change)
  let cachedGrad = null;
  let cachedC1 = '', cachedC2 = '', cachedH = 0;

  function draw() {
    mp.rafId = requestAnimationFrame(draw);

    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2x for perf
    const cssW = canvas.offsetWidth || 340;
    const cssH = canvas.offsetHeight || 64;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width  = targetW;
      canvas.height = targetH;
      canvas.style.width  = cssW + 'px';
      canvas.style.height = cssH + 'px';
      cachedGrad = null; // invalidate cache on resize
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.scale(dpr, dpr);

    const W = cssW, H = cssH;
    ctx.clearRect(0, 0, W, H);

    const c1 = mp.color1 || '#00d4c8';
    const c2 = mp.color2 || '#0091ff';

    if (!mp.analyser || !mp.isPlaying) {
      // Idle: single thin center line
      ctx.fillStyle = c1 + '66';
      ctx.fillRect(W * 0.1, H / 2 - 1, W * 0.8, 2);
      return;
    }

    const data = new Uint8Array(mp.analyser.frequencyBinCount);
    mp.analyser.getByteFrequencyData(data);

    // Rebuild shared gradient only when colors or height change
    if (!cachedGrad || cachedC1 !== c1 || cachedC2 !== c2 || cachedH !== H) {
      cachedGrad = ctx.createLinearGradient(0, 0, 0, H);
      cachedGrad.addColorStop(0, c1);
      cachedGrad.addColorStop(1, c2 + '33');
      cachedC1 = c1; cachedC2 = c2; cachedH = H;
    }
    ctx.fillStyle = cachedGrad;

    // Centered mirror visualization: bars grow from center outward
    const halfBars = 20; // 20 bars per side = 40 total
    const barW     = (W / 2) / halfBars;
    const gap      = Math.max(1, barW * 0.2);
    const bw       = barW - gap;
    const cx       = W / 2;

    for (let i = 0; i < halfBars; i++) {
      const di = Math.floor(i * (data.length * 0.6) / halfBars);
      const v  = data[di] / 255;
      const bh = Math.max(3, v * H * 0.92);
      const y  = H / 2 - bh / 2; // center vertically

      // Right side
      const xR = cx + i * barW + gap * 0.5;
      ctx.fillRect(xR, y, bw, bh);

      // Left side (mirror)
      const xL = cx - (i + 1) * barW + gap * 0.5;
      ctx.fillRect(xL, y, bw, bh);
    }
  }
  draw();
}

function mpStopVisualizer() {
  if (mp.rafId) { cancelAnimationFrame(mp.rafId); mp.rafId = null; }
}

// ── Mini Player ─────────────────────────────────────────────────────────────
function mpShowMini() {
  const item = mp.queue[mp.index];
  if (!item) return;
  mpUpdateMiniInfo(item);
  $('miniPlayer').classList.add('active');
  $('main').classList.add('mini-active');
}

function mpHideMini() {
  $('miniPlayer').classList.remove('active');
  $('main').classList.remove('mini-active');
}

function mpUpdateMiniInfo(item) {
  if (!item) return;
  const [c1, c2] = audioPalette(item.name);
  const miniArt = $('miniArt');
  miniArt.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  let miniImg = miniArt.querySelector('img');
  if (!miniImg) {
    miniImg = document.createElement('img');
    miniArt.appendChild(miniImg);
  }
  miniImg.style.opacity = '0';
  const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
  const probe = new Image();
  probe.onload = () => { miniImg.src = artUrl; miniImg.style.opacity = '1'; };
  probe.onerror = () => { miniImg.style.opacity = '0'; };
  probe.src = artUrl;
  $('miniTitle').textContent = item.name.replace(/\.[^.]+$/, '');
  mpUpdateMiniPlayIcon();
}

function mpUpdateMiniPlayIcon() {
  $('miniPlayIcon').innerHTML = mp.isPlaying
    ? '<rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none"/>'
    : '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
}

function mpInitEvents() {
  const audio = mpGetAudio();

  $('mpPlayBtn').addEventListener('click', mpTogglePlay);
  $('mpPrevBtn').addEventListener('click', mpPrev);
  $('mpNextBtn').addEventListener('click', mpNext);
  $('mpShuffleBtn').addEventListener('click', mpToggleShuffle);
  $('mpRepeatBtn').addEventListener('click', mpToggleRepeat);

  $('mpQueueToggle').addEventListener('click', () => {
    const list = $('mpQueueList');
    const toggle = $('mpQueueToggle');
    list.classList.toggle('hidden');
    toggle.classList.toggle('open');
  });

  audio.addEventListener('timeupdate', mpUpdateProgress);
  audio.addEventListener('loadedmetadata', () => {
    $('mpDuration').textContent = fmtTime(audio.duration);
  });
  audio.addEventListener('ended', () => {
    if (mp.repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (mp.repeat === 'all' || mp.index < mp.queue.length - 1) {
      mpNext();
    } else {
      mpSetPlaying(false);
      mpHideMini();
    }
  });
  audio.addEventListener('play',  () => mpSetPlaying(true));
  audio.addEventListener('pause', () => mpSetPlaying(false));

  const bar = $('mpProgressBar');
  bar.addEventListener('mousedown', e => { mp.progressDragging = true; mpSeekFromEvent(e); });
  bar.addEventListener('touchstart', e => { mp.progressDragging = true; mpSeekFromEvent(e); }, { passive: true });
  document.addEventListener('mousemove', e => { if (mp.progressDragging) mpSeekFromEvent(e); });
  document.addEventListener('touchmove', e => { if (mp.progressDragging) mpSeekFromEvent(e); }, { passive: true });
  document.addEventListener('mouseup',   () => { mp.progressDragging = false; });
  document.addEventListener('touchend',  () => { mp.progressDragging = false; });
}

// ═══════════════════════════════════════════════════════════════════════════
//  MEMORY CACHE  —  mirrors twh_memory.json on the server
//  Loaded once on startup; writes are fire-and-forget to /api/memory/save.
// ═══════════════════════════════════════════════════════════════════════════

const memCache = { recents: [], videoProgress: {}, musicQueue: null };

async function memInit() {
  try {
    const data = await fetchJson('/api/memory/load');
    if (data.recents)       memCache.recents       = data.recents;
    if (data.videoProgress) memCache.videoProgress = data.videoProgress;
    if (data.musicQueue)    memCache.musicQueue     = data.musicQueue;
  } catch (_) {}
}

function memPush(action, data) {
  // Optimistic local update so the UI feels instant
  if (action === 'recent') {
    memCache.recents = memCache.recents.filter(r => r.path !== data.path);
    memCache.recents.unshift({ ...data, openedAt: Date.now() });
    memCache.recents = memCache.recents.slice(0, 50);
  } else if (action === 'videoProgress') {
    if (data.time > 3) memCache.videoProgress[data.path] = { time: data.time };
    else delete memCache.videoProgress[data.path];
  } else if (action === 'clearVideoProgress') {
    delete memCache.videoProgress[data.path];
  } else if (action === 'musicQueue') {
    memCache.musicQueue = data;
  }
  // Persist to server (fire and forget)
  fetch('/api/memory/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, data }),
  }).catch(() => {});
}

// ── Resume storage (server-backed via memCache) ─────────────────────────────
function saveResume(path, time) {
  if (!path) return;
  memPush('videoProgress', { path, time });
}
function loadResume(path) {
  return memCache.videoProgress?.[path]?.time || 0;
}
function clearResume(path) {
  memPush('clearVideoProgress', { path });
}

// ── Open / Close ───────────────────────────────────────────────────────────
function openVideo(item) {
  vp.item = item;
  vp.url = `/file?path=${encodeURIComponent(item.path)}`;

  const vid = $('videoPlayer');
  $('vpTitle').textContent = item.name;
  $('vpDownloadBtn').href = vp.url + '&dl=1';
  $('vpDownloadBtn').download = item.name;

  vid.src = vp.url;
  vid.playbackRate = vp.speed;

  $('videoModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  vpShowControls();
  vpBuildSpeedMenu();
  vpSetAspect(0);

  // Auto-resume
  const resume = loadResume(item.path);
  vid.addEventListener('loadedmetadata', function onMeta() {
    vid.removeEventListener('loadedmetadata', onMeta);
    if (resume > 2 && resume < vid.duration - 3) {
      vid.currentTime = resume;
      toast(`▶ Resuming from ${fmtTime(resume)}`, '');
    }
    vid.play().catch(() => {});
  });
}

function closeVideo() {
  const vid = $('videoPlayer');
  if (vp.item) saveResume(vp.item.path, vid.currentTime);
  vid.pause(); vid.src = '';
  clearTimeout(vp.controlsTimer);
  $('videoModal').classList.add('hidden');
  document.body.style.overflow = '';
  // Exit fullscreen if needed
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('vpWrap').classList.remove('controls-hidden','theater');
}

// ── Controls auto-hide ─────────────────────────────────────────────────────
function vpShowControls() {
  $('vpWrap').classList.remove('controls-hidden');
  clearTimeout(vp.controlsTimer);
  const vid = $('videoPlayer');
  if (!vid.paused) {
    vp.controlsTimer = setTimeout(() => $('vpWrap').classList.add('controls-hidden'), 3500);
  }
}

// ── Play / Pause ───────────────────────────────────────────────────────────
function vpTogglePlay() {
  const vid = $('videoPlayer');
  if (vid.paused) { vid.play().catch(() => {}); vpFlash('play'); }
  else            { vid.pause();                  vpFlash('pause'); }
}

function vpFlash(type) {
  const el    = $('vpFlash');
  const icon  = $('vpFlashIcon');
  const PLAY  = '<polygon points="5 3 19 12 5 21 5 3" fill="white" stroke="none"/>';
  const PAUSE = '<rect x="6" y="4" width="4" height="16" fill="white" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="white" stroke="none"/>';
  icon.innerHTML = type === 'play' ? PLAY : PAUSE;
  el.classList.remove('fade');
  void el.offsetWidth;
  el.classList.add('show','fade');
  setTimeout(() => el.classList.remove('show','fade'), 700);
}

// ── Seek ───────────────────────────────────────────────────────────────────
function vpSeek(delta) {
  const vid = $('videoPlayer');
  vid.currentTime = Math.max(0, Math.min(vid.duration || 0, vid.currentTime + delta));
  if (delta < 0) vpShowSeekAnim('left', delta);
  else            vpShowSeekAnim('right', delta);
  vpShowControls();
}

function vpShowSeekAnim(side, delta) {
  const el = $(side === 'left' ? 'vpSeekLeft' : 'vpSeekRight');
  const lbl = $(side === 'left' ? 'vpSeekLeftTxt' : 'vpSeekRightTxt');
  lbl.textContent = (delta < 0 ? '' : '+') + delta + 's';
  el.classList.remove('active');
  void el.offsetWidth;
  el.classList.add('active');
}

// ── Volume ─────────────────────────────────────────────────────────────────
function vpSetVolume(v) {
  vp.volume = Math.max(0, Math.min(1, v));
  $('videoPlayer').volume = vp.volume;
  $('vpVolRange').value = vp.volume;
  vpUpdateVolIcon();
  // Update gradient
  $('vpVolRange').style.background =
    `linear-gradient(to right, var(--accent) ${vp.volume*100}%, rgba(255,255,255,0.2) ${vp.volume*100}%)`;
}

function vpToggleMute() {
  vp.muted = !vp.muted;
  $('videoPlayer').muted = vp.muted;
  vpUpdateVolIcon();
}

function vpUpdateVolIcon() {
  const muted = vp.muted || vp.volume === 0;
  const waves = $('vpVolWaves');
  if (waves) waves.style.display = muted ? 'none' : '';
}

// ── Progress bar ───────────────────────────────────────────────────────────
function vpUpdateProgress() {
  const vid = $('videoPlayer');
  if (!vid.duration) return;
  const pct = (vid.currentTime / vid.duration) * 100;
  $('vpProgressFill').style.width = pct + '%';
  $('vpProgressDot').style.left   = pct + '%';
  $('vpCurrentTime').textContent  = fmtTime(vid.currentTime);
  // Buffered
  if (vid.buffered.length) {
    const bpct = (vid.buffered.end(vid.buffered.length - 1) / vid.duration) * 100;
    $('vpProgressBuf').style.width = bpct + '%';
  }
  // Auto-save resume every 5s
  if (Math.round(vid.currentTime) % 5 === 0) saveResume(vp.item?.path, vid.currentTime);
}

function vpProgressFromEvent(e) {
  const track = $('vpProgressTrack');
  const rect  = track.getBoundingClientRect();
  const x     = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  return Math.max(0, Math.min(1, x / rect.width));
}

function vpInitProgress() {
  const track = $('vpProgressTrack');
  const tooltip = $('vpProgressTooltip');

  function startDrag(e) {
    e.preventDefault();
    vp.progressDragging = true;
    track.classList.add('dragging');
    updateDrag(e);
    document.addEventListener('mousemove', updateDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', updateDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
  }

  function updateDrag(e) {
    if (!vp.progressDragging) return;
    const ratio = vpProgressFromEvent(e);
    const vid   = $('videoPlayer');
    $('vpProgressFill').style.width = (ratio * 100) + '%';
    $('vpProgressDot').style.left   = (ratio * 100) + '%';
    // Tooltip
    const t = ratio * (vid.duration || 0);
    tooltip.textContent = fmtTime(t);
    tooltip.style.left  = (ratio * 100) + '%';
  }

  function endDrag(e) {
    if (!vp.progressDragging) return;
    vp.progressDragging = false;
    track.classList.remove('dragging');
    document.removeEventListener('mousemove', updateDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', updateDrag);
    document.removeEventListener('touchend', endDrag);
    const ratio = vpProgressFromEvent(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e);
    const vid   = $('videoPlayer');
    vid.currentTime = ratio * (vid.duration || 0);
  }

  track.addEventListener('mousedown', startDrag);
  track.addEventListener('touchstart', startDrag, { passive: false });

  // Hover tooltip
  track.addEventListener('mousemove', e => {
    const ratio = vpProgressFromEvent(e);
    const t = ratio * ($('videoPlayer').duration || 0);
    tooltip.textContent = fmtTime(t);
    tooltip.style.left  = (ratio * 100) + '%';
  });
}

// ── Speed ──────────────────────────────────────────────────────────────────
function vpBuildSpeedMenu() {
  const list = $('vpSpeedList');
  list.innerHTML = '';
  VP_SPEEDS.forEach(s => {
    const item = document.createElement('div');
    item.className = 'vp-speed-item' + (s === vp.speed ? ' active' : '');
    item.innerHTML = `<span>${s === 1 ? 'Normal' : s + '×'}</span>${s === vp.speed ? '<svg class="vp-speed-check" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>' : ''}`;
    item.addEventListener('click', () => {
      vp.speed = s;
      $('videoPlayer').playbackRate = s;
      $('vpSpeedBtn').textContent = s === 1 ? '1×' : s + '×';
      vpBuildSpeedMenu(); // rebuild to update active
      $('vpSpeedPopup').classList.add('hidden');
    });
    list.appendChild(item);
  });
}

// ── Aspect ratio ───────────────────────────────────────────────────────────
function vpSetAspect(idx) {
  vp.aspectIdx = idx % ASPECTS.length;
  const aspect = ASPECTS[vp.aspectIdx];
  const vid    = $('videoPlayer');
  vid.className = '';
  if (aspect === 'fill')    vid.classList.add('aspect-fill');
  if (aspect === 'stretch') vid.classList.add('aspect-stretch');
  toast('Aspect: ' + ASPECT_LABELS[aspect]);
}

// ── Theater / Fullscreen ───────────────────────────────────────────────────
function vpToggleTheater() {
  vp.theater = !vp.theater;
  $('vpWrap').classList.toggle('theater', vp.theater);
}

function vpToggleFullscreen() {
  const wrap = $('vpWrap');
  if (!document.fullscreenElement) {
    wrap.requestFullscreen?.() || wrap.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
  }
}

// ── Picture-in-Picture ─────────────────────────────────────────────────────
async function vpTogglePiP() {
  const vid = $('videoPlayer');
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else if (document.pictureInPictureEnabled) {
      await vid.requestPictureInPicture();
    } else {
      toast('PiP not supported in this browser', 'error');
    }
  } catch (e) { toast('PiP: ' + e.message, 'error'); }
}

// ── Gesture HUD ────────────────────────────────────────────────────────────
const VOL_SVG  = '<svg viewBox="0 0 24 24" stroke="white" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const MUTE_SVG = '<svg viewBox="0 0 24 24" stroke="white" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const SUN_SVG  = '<svg viewBox="0 0 24 24" stroke="white" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

let hudTimer;
function vpShowHud(type, value) {
  const hud  = $('vpGestureHud');
  const icon = $('vpHudIcon');
  const fill = $('vpHudFill');
  const val  = $('vpHudVal');
  hud.classList.remove('hidden');
  if (type === 'vol') {
    icon.innerHTML = value > 0 ? VOL_SVG : MUTE_SVG;
    fill.style.width = (value * 100) + '%';
    val.textContent  = Math.round(value * 100) + '%';
  } else {
    icon.innerHTML = SUN_SVG;
    fill.style.width = (value * 100) + '%';
    val.textContent  = Math.round(value * 100) + '%';
  }
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => hud.classList.add('hidden'), 1200);
}

function vpSetBrightness(v) {
  vp.brightness = Math.max(0.1, Math.min(1, v));
  $('vpBrightness').style.opacity = 1 - vp.brightness;
  vpShowHud('bright', vp.brightness);
}

// ── Gesture layer (touch) ──────────────────────────────────────────────────
function vpInitGestures() {
  const layer = $('vpGestureLayer');

  layer.addEventListener('touchstart', e => {
    vpShowControls();
    const t = e.changedTouches[0];
    vp.touch.startX   = t.clientX;
    vp.touch.startY   = t.clientY;
    vp.touch.startVal = null;
    vp.touch.type     = null;
  }, { passive: true });

  layer.addEventListener('touchmove', e => {
    if (e.touches.length !== 1) return;
    const t   = e.changedTouches[0];
    const dx  = t.clientX - vp.touch.startX;
    const dy  = t.clientY - vp.touch.startY;

    if (!vp.touch.type) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
        // Vertical gesture — vol or brightness
        const isLeft = vp.touch.startX < window.innerWidth / 2;
        vp.touch.type = isLeft ? 'bright' : 'vol';
        vp.touch.startVal = isLeft ? vp.brightness : vp.volume;
      }
    }

    if (vp.touch.type === 'vol') {
      const newVol = Math.max(0, Math.min(1, vp.touch.startVal - dy / 200));
      vpSetVolume(newVol);
      vpShowHud('vol', newVol);
    } else if (vp.touch.type === 'bright') {
      const newBr = Math.max(0.1, Math.min(1, vp.touch.startVal - dy / 200));
      vpSetBrightness(newBr);
    }
  }, { passive: true });

  layer.addEventListener('touchend', e => {
    const t    = e.changedTouches[0];
    const dx   = Math.abs(t.clientX - vp.touch.startX);
    const dy   = Math.abs(t.clientY - vp.touch.startY);
    const isLeft = t.clientX < window.innerWidth / 2;

    if (!vp.touch.type && dx < 15 && dy < 15) {
      // Simple tap → check for double-tap
      const now = Date.now();
      const side = isLeft ? 'left' : 'right';
      const lastKey = side === 'left' ? 'leftTap' : 'rightTap';
      if (now - vp.touch[lastKey] < 300) {
        // Double tap → seek
        vpSeek(isLeft ? -10 : 10);
        vp.touch[lastKey] = 0;
      } else {
        vp.touch[lastKey] = now;
        // Single tap: show/hide controls, or play/pause if controls already visible
        if ($('vpWrap').classList.contains('controls-hidden')) {
          vpShowControls();
        } else {
          vpTogglePlay();
        }
      }
    }
    vp.touch.type = null;
  });

  // Mouse click (desktop)
  layer.addEventListener('click', e => {
    vpTogglePlay();
    vpShowControls();
  });

  // Mouse move → show controls
  layer.addEventListener('mousemove', () => vpShowControls());
}

// ── Play/pause UI sync ─────────────────────────────────────────────────────
function vpSyncPlayIcon(playing) {
  const icon = $('vpPlayIcon');
  icon.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none"/>'
    : '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
}

// ── Wire up all player events ──────────────────────────────────────────────
function vpInit() {
  const vid = $('videoPlayer');

  // Video events
  vid.addEventListener('play',  () => { vpSyncPlayIcon(true);  vpShowControls(); });
  vid.addEventListener('pause', () => { vpSyncPlayIcon(false); vpShowControls(); });
  vid.addEventListener('timeupdate', vpUpdateProgress);
  vid.addEventListener('ended', () => {
    vpSyncPlayIcon(false);
    vpShowControls();
    if (vp.item) clearResume(vp.item.path);
  });
  vid.addEventListener('durationchange', () => {
    $('vpDuration').textContent = fmtTime(vid.duration);
  });
  vid.addEventListener('volumechange', () => {
    vpUpdateVolIcon();
    vpSetVolume(vid.volume);
  });

  // Controls
  $('vpClose').addEventListener('click', closeVideo);
  $('vpPlayBtn').addEventListener('click', e => { e.stopPropagation(); vpTogglePlay(); vpShowControls(); });
  $('vpRewindBtn').addEventListener('click', e => { e.stopPropagation(); vpSeek(-10); });
  $('vpForwardBtn').addEventListener('click', e => { e.stopPropagation(); vpSeek(10); });
  $('vpMuteBtn').addEventListener('click', e => { e.stopPropagation(); vpToggleMute(); vpShowControls(); });
  $('vpVolRange').addEventListener('input', e => { vpSetVolume(parseFloat(e.target.value)); });
  $('vpSpeedBtn').addEventListener('click', e => {
    e.stopPropagation();
    $('vpSpeedPopup').classList.toggle('hidden');
    vpShowControls();
  });
  $('vpAspectBtn').addEventListener('click', e => { e.stopPropagation(); vpSetAspect(vp.aspectIdx + 1); vpShowControls(); });
  $('vpTheaterBtn').addEventListener('click', e => { e.stopPropagation(); vpToggleTheater(); vpShowControls(); });
  $('vpPipBtn').addEventListener('click', e => { e.stopPropagation(); vpTogglePiP(); });
  $('vpFsBtn').addEventListener('click', e => { e.stopPropagation(); vpToggleFullscreen(); vpShowControls(); });

  // Fullscreen icon update
  document.addEventListener('fullscreenchange', () => {
    const icon = $('vpFsIcon');
    const isFS = !!document.fullscreenElement;
    icon.innerHTML = isFS
      ? '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>'
      : '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
  });

  // Close speed popup on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#vpSpeedPopup') && !e.target.closest('#vpSpeedBtn')) {
      $('vpSpeedPopup').classList.add('hidden');
    }
  });

  // Touch on controls should show controls, not hide
  $('vpControls').addEventListener('touchstart', () => vpShowControls(), { passive: true });
  $('vpControls').addEventListener('mousemove', () => vpShowControls());

  vpInitProgress();
  vpInitGestures();
}

// ═══════════════════════════════════════════════════════════════════════════
//  VIEWS
// ═══════════════════════════════════════════════════════════════════════════

function showView(name) {
  qsa('.view').forEach(v => v.classList.add('hidden'));
  $(`${name}View`).classList.remove('hidden');
  state.currentView = name;
}

// ── Home ───────────────────────────────────────────────────────────────────
async function loadHome() {
  showView('home');
  updateBreadcrumb('');
  setNavActive('navFiles');
  loadRecent();
  loadFolders();
}

function makeRecentCard(item) {
  const card = document.createElement('div');
  card.className = 'recent-card';
  if (item.category === 'image') {
    card.innerHTML = `<img src="/file?path=${encodeURIComponent(item.path)}" loading="lazy" alt="${item.name}">
      <div class="card-overlay"><span class="card-name">${item.name}</span></div>`;
  } else if (item.category === 'audio') {
    const [c1, c2] = audioPalette(item.name);
    card.innerHTML = `<div style="width:100%;height:100%;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;font-size:42px;">🎵</div>
      <div class="card-overlay"><span class="card-name">${item.name}</span></div>`;
  } else {
    card.innerHTML = `<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a0030,#3a1070);display:flex;align-items:center;justify-content:center;font-size:42px;">🎬</div>
      <div class="card-overlay"><span class="card-name">${item.name}</span></div>
      <div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg></div>`;
  }
  card.addEventListener('click', () => openFile(item));
  return card;
}

async function loadRecent() {
  const grid = $('recentGrid');
  grid.innerHTML = '<div class="loader-wrap"><div class="loader"></div></div>';

  // Prefer server-persisted recents (any media type)
  const recents = memCache.recents.filter(r =>
    r.category === 'image' || r.category === 'video' || r.category === 'audio'
  ).slice(0, 8);

  if (recents.length) {
    grid.innerHTML = '';
    recents.forEach(item => grid.appendChild(makeRecentCard(item)));
    return;
  }

  // Fallback: show media items from the root directory
  try {
    const data = await fetchJson('/api/ls?path=');
    const media = data.items.filter(i =>
      i.category === 'image' || i.category === 'video' || i.category === 'audio'
    ).slice(0, 8);
    if (!media.length) { grid.innerHTML = '<div class="empty-state"><p>No media files found</p></div>'; return; }
    grid.innerHTML = '';
    media.forEach(item => grid.appendChild(makeRecentCard(item)));
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

async function loadFolders() {
  const scroll = $('foldersScroll');
  scroll.innerHTML = '<div class="loader-wrap"><div class="loader"></div></div>';
  try {
    const data = await fetchJson('/api/ls?path=');
    const dirs = data.items.filter(i => i.type === 'dir').slice(0, 10);
    if (!dirs.length) { scroll.innerHTML = '<div style="color:var(--text3);padding:16px;font-size:13px;">No folders found</div>'; return; }
    scroll.innerHTML = '';
    for (const dir of dirs) {
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.innerHTML = `<span class="folder-icon">📁</span><div class="folder-name">${dir.name}</div><div class="folder-count">Folder</div>`;
      card.addEventListener('click', () => navigate(dir.path));
      scroll.appendChild(card);
    }
  } catch (e) { scroll.innerHTML = `<div style="color:var(--text3);padding:16px;font-size:13px;">${e.message}</div>`; }
}

// ── Browser ────────────────────────────────────────────────────────────────
async function navigate(relPath = '') {
  showView('browser');
  setNavActive('navBrowse');
  state.currentPath = relPath;
  updateBreadcrumb(relPath);
  state.uploadPath = relPath;

  const grid = $('fileGrid');
  pgReset('browser', relPath, grid);

  // Show skeleton cards immediately
  grid.innerHTML = '';
  grid.appendChild(createSkeletons(12));

  try {
    const data = await fetchJson(`/api/ls?path=${encodeURIComponent(relPath)}&page=0&limit=${PG_LIMIT}`);
    grid.innerHTML = '';

    if (!data.total) {
      grid.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><p>Empty folder</p></div>';
      return;
    }

    pg.total = data.total;
    pg.page  = 1;
    pg.imageSet = data.items.filter(i => i.category === 'image');
    pg.audioSet = data.items.filter(i => i.category === 'audio');

    // Show total count badge if large (insert directly, before vdom spacers)
    if (data.total > PG_LIMIT) {
      const badge = document.createElement('div');
      badge.className = 'pg-count-badge';
      badge.textContent = `${data.total.toLocaleString()} items`;
      grid.appendChild(badge);
    }

    vdomAppendItems(data.items);
    pgSentinelSetup();
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`; }
}

function renderItems(container, items, imageSet, audioSet) {
  container.innerHTML = '';
  // Also update pg sets so click handlers always have fresh refs
  pg.imageSet = imageSet; pg.audioSet = audioSet;
  for (const item of items) { container.appendChild(createItemEl(item, imageSet, audioSet)); }
}

function createItemEl(item, imageSet = [], audioSet = []) {
  const el = document.createElement('div');
  const isImg   = item.category === 'image';
  const isVid   = item.category === 'video';
  const isAudio = item.category === 'audio';
  const isDir   = item.type === 'dir';
  el.className = 'file-item' + (isDir ? ' dir-item' : '') + (isVid ? ' video-item' : '');
  el.dataset.path = item.path;
  el.dataset.cat  = item.category;

  let thumbHtml;
  if (isImg) {
    thumbHtml = `<div class="thumb"><img src="/file?path=${encodeURIComponent(item.path)}" loading="lazy" alt="${item.name}"></div>`;
  } else if (isVid) {
    thumbHtml = `<div class="thumb" data-thumb-url="/file?path=${encodeURIComponent(item.path)}">
      <img class="vt-canvas" style="display:none;width:100%;height:100%;object-fit:cover" alt="">
      <div class="vt-loading"><div class="vt-spinner"></div></div>
      <div class="video-play-overlay"><div class="play-circle"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
    </div>`;
  } else if (isAudio) {
    const [c1, c2] = audioPalette(item.name);
    const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
    thumbHtml = `<div class="thumb">
      <div class="audio-thumb-art" style="background:linear-gradient(135deg,${c1},${c2})" data-audio-art="${artUrl}">
        <img class="audio-art-img" alt="">
        <svg viewBox="0 0 24 24" class="at-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <div class="audio-eq">
          <div class="audio-eq-bar" style="height:5px"></div>
          <div class="audio-eq-bar" style="height:11px"></div>
          <div class="audio-eq-bar" style="height:7px"></div>
          <div class="audio-eq-bar" style="height:13px"></div>
        </div>
      </div>
    </div>`;
  } else if (isDir) {
    thumbHtml = `<div class="thumb"><span class="dir-icon">📁</span></div>`;
  } else {
    thumbHtml = `<div class="thumb"><span class="file-icon-big">${fileIcon(item)}</span></div>`;
  }

  el.innerHTML = `${thumbHtml}
    <div class="item-info">
      <div class="item-name">${item.name}</div>
      <div class="item-size">${item.sizeStr}</div>
    </div>
    <button class="item-more" data-more>
      <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>`;

  if (isVid && thumbObserver) {
    const thumbEl = el.querySelector('.thumb');
    thumbEl.dataset.thumbUrl = `/file?path=${encodeURIComponent(item.path)}`;
    thumbObserver.observe(thumbEl);
  }
  if (isAudio && audioArtObserver) {
    const artEl = el.querySelector('.audio-thumb-art');
    if (artEl) audioArtObserver.observe(artEl);
  }

  el.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { showCtxMenu(e, item); return; }
    if (isDir) navigate(item.path);
    else {
      // Use live pg sets so items loaded later are included in swipe/queue nav
      const imgs = pg.imageSet.length ? pg.imageSet : imageSet;
      const auds = pg.audioSet.length ? pg.audioSet : audioSet;
      openFile(item, imgs, auds);
    }
  });
  el.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, item); });
  return el;
}

// ── Category View ──────────────────────────────────────────────────────────
async function loadCategory(cat) {
  showView('cat');
  $('catViewTitle').textContent = cat + 's';
  const grid = $('catGrid');
  pgReset('cat', cat, grid);

  grid.innerHTML = '';
  grid.appendChild(createSkeletons(12));

  try {
    const data = await fetchJson(`/api/category/${cat}?page=0&limit=${PG_LIMIT}`);
    grid.innerHTML = '';
    if (!data.total) { grid.innerHTML = `<div class="empty-state"><p>No ${cat} files found</p></div>`; return; }

    pg.total = data.total;
    pg.page  = 1;
    pg.imageSet = data.results.filter(i => i.category === 'image');
    pg.audioSet = data.results.filter(i => i.category === 'audio');

    if (data.total > PG_LIMIT) {
      const badge = document.createElement('div');
      badge.className = 'pg-count-badge';
      badge.textContent = `${data.total.toLocaleString()} ${cat}s found`;
      grid.appendChild(badge);
    }

    vdomAppendItems(data.results);
    pgSentinelSetup();
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`; }
}

// ── Search ─────────────────────────────────────────────────────────────────
let searchTimeout;
async function doSearch(q) {
  if (!q.trim()) { showView('home'); return; }
  showView('search');
  $('searchResultsLabel').textContent = `Searching for "${q}"…`;
  const grid = $('searchGrid');
  pgReset('search', q, grid);

  grid.innerHTML = '';
  grid.appendChild(createSkeletons(8));

  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}&path=&page=0&limit=${PG_LIMIT}`);
    const total = data.total || 0;
    $('searchResultsLabel').textContent = `${total.toLocaleString()} result${total !== 1 ? 's' : ''} for "${q}"`;
    grid.innerHTML = '';
    if (!total) { grid.innerHTML = '<div class="empty-state"><p>No files found</p></div>'; return; }

    pg.total = total;
    pg.page  = 1;
    pg.imageSet = data.results.filter(i => i.category === 'image');
    pg.audioSet = data.results.filter(i => i.category === 'audio');

    vdomAppendItems(data.results);
    pgSentinelSetup();
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`; }
}

// ── Open file ──────────────────────────────────────────────────────────────
function openFile(item, imageSet = [], audioSet = []) {
  // Persist to server-side recents
  memPush('recent', item);

  const cat = item.category;
  const url = `/file?path=${encodeURIComponent(item.path)}`;
  if (cat === 'video') {
    openVideo(item);
  } else if (cat === 'image') {
    openImage(item, imageSet, url);
  } else if (cat === 'audio') {
    openAudio(item, url, audioSet);
  } else if (['.txt','.md','.log','.json','.xml','.html','.css','.js','.py','.sh','.c','.cpp','.h'].includes(item.ext)) {
    openText(item, url);
  } else {
    const a = document.createElement('a');
    a.href = url + '&dl=1';
    a.download = item.name;
    a.click();
  }
}

// ── Image viewer (delegates to iv.js) ─────────────────────────────────────
function openImage(item, imageSet, url) {
  const list = (imageSet && imageSet.length) ? imageSet : [item];
  const idx  = list.findIndex(i => i.path === item.path);
  const startIdx = idx >= 0 ? idx : 0;
  document.body.style.overflow = 'hidden';
  ivOpen(list, startIdx, false);
}

function showImageAt(idx) {
  if (typeof ivShowAt === 'function') ivShowAt(idx);
}

// ── Text viewer ────────────────────────────────────────────────────────────
async function openText(item, url) {
  $('textTitle').textContent = item.name;
  $('textDl').href = url + '&dl=1';
  $('textContent').textContent = 'Loading…';
  openModal('textModal');
  try {
    const r = await fetch(url);
    $('textContent').textContent = await r.text();
  } catch (e) { $('textContent').textContent = 'Failed to load: ' + e.message; }
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function openModal(id)  { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) {
  $(id).classList.add('hidden');
  document.body.style.overflow = '';
  if (id === 'audioModal') {
    mpStopVisualizer();
    // Don't stop audio — collapse to mini player if something is loaded
    if (mp.queue.length && mpGetAudio().src) {
      mpShowMini();
    }
  }
}

// ── Context Menu ───────────────────────────────────────────────────────────
function showCtxMenu(e, item) {
  state.ctxItem = item;
  const menu = $('ctxMenu');
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 140) + 'px';
  $('ctxDownload').style.display = item.type === 'file' ? 'flex' : 'none';
}
function hideCtxMenu() { $('ctxMenu').classList.add('hidden'); state.ctxItem = null; }

// ── Upload ─────────────────────────────────────────────────────────────────
function openUploadModal() { $('uploadList').innerHTML = ''; openModal('uploadModal'); }

async function handleUpload() {
  const input = $('fileInput');
  const files = [...input.files];
  if (!files.length) { toast('Select files first', 'error'); return; }
  const list = $('uploadList');
  list.innerHTML = '';
  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'upload-file-row';
    row.innerHTML = `<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${file.name}</span>
      <div style="width:80px"><div class="upload-progress"><div class="upload-progress-bar" style="width:0%"></div></div></div>`;
    list.appendChild(row);
  }
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const bar  = list.children[i].querySelector('.upload-progress-bar');
    await new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?path=${encodeURIComponent(state.uploadPath)}`);
      xhr.upload.onprogress = e => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%'; };
      xhr.onload  = () => { bar.style.width = '100%'; bar.style.background = 'var(--success)'; resolve(); };
      xhr.onerror = () => { bar.style.background = 'var(--danger)'; resolve(); };
      const reader = new FileReader();
      reader.onload = () => {
        const boundary = '----lhostboundary' + Math.random().toString(16).slice(2);
        const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const hb = new TextEncoder().encode(head), tb = new TextEncoder().encode(tail);
        const body = new Uint8Array(hb.length + reader.result.byteLength + tb.length);
        body.set(hb, 0); body.set(new Uint8Array(reader.result), hb.length); body.set(tb, hb.length + reader.result.byteLength);
        xhr.setRequestHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
        xhr.send(body.buffer);
      };
      reader.readAsArrayBuffer(file);
    });
  }
  toast(`${files.length} file(s) uploaded!`, 'success');
  setTimeout(() => { closeModal('uploadModal'); if (state.currentView === 'browser') navigate(state.uploadPath); else loadHome(); }, 800);
}

// ── Nav ────────────────────────────────────────────────────────────────────
function setNavActive(id) { qsa('.nav-item').forEach(b => b.classList.remove('active')); $(id)?.classList.add('active'); }

// ── Info ───────────────────────────────────────────────────────────────────
async function showInfo() {
  try {
    const data = await fetchJson('/api/info');
    const envLabels = { termux:'🤖 Termux (Android)', android:'📱 Android', 'linux-root':'🔴 Linux (root)', linux:'🐧 Linux', darwin:'🍎 macOS', win32:'🪟 Windows', custom:'⚙️ Custom (ROOT_DIR)' };
    const networkRows = (data.networkIPs || []).map(ip =>
      `<div class="info-row"><span class="info-label">Network IP</span><span class="info-val" style="color:var(--accent);font-weight:600">http://${ip}:${location.port}</span></div>`).join('');
    $('infoBody').innerHTML = `
      <div class="info-row"><span class="info-label">Environment</span><span class="info-val">${envLabels[data.env] || data.env}</span></div>
      <div class="info-row"><span class="info-label">Hostname</span><span class="info-val">${data.hostname}</span></div>
      <div class="info-row"><span class="info-label">Platform</span><span class="info-val">${data.platform} · Node ${data.nodeVersion}</span></div>
      <div class="info-row"><span class="info-label">Root Dir</span><span class="info-val">${data.root}</span></div>
      ${networkRows}
      <div class="info-row"><span class="info-label">Override root</span><span class="info-val"><code style="background:var(--bg4);padding:2px 6px;border-radius:4px;font-size:11px">ROOT_DIR=/sdcard node server.js</code></span></div>`;
    openModal('infoModal');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Folder ─────────────────────────────────────────────────────────────────
async function createFolder(name) {
  try {
    const r = await fetch(`/api/mkdir?path=${encodeURIComponent(state.currentPath)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    toast('Folder created!', 'success');
    navigate(state.currentPath);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Delete ─────────────────────────────────────────────────────────────────
async function deleteItem(item) {
  if (!confirm(`Delete "${item.name}"?`)) return;
  try {
    const r = await fetch(`/api/delete?path=${encodeURIComponent(item.path)}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    toast('Deleted!', 'success');
    if (state.currentView === 'browser') navigate(state.currentPath);
    else if (state.currentView === 'cat') loadCategory(item.category);
    else loadHome();
  } catch (e) { toast(e.message, 'error'); }
}

// ── View toggle ────────────────────────────────────────────────────────────
function setListMode(mode) {
  state.listMode = mode;
  ['fileGrid','catGrid'].forEach(id => {
    $(id).classList.toggle('list-view', mode === 'list');
  });
  $('gridViewBtn').classList.toggle('active', mode === 'grid');
  $('listViewBtn').classList.toggle('active', mode === 'list');
}

// ═══════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {

  // Load server-side memory before rendering so recents/resume are available
  await memInit();

  vpInit();
  ivInit();
  mpInitEvents();
  loadHome();

  // Category icons
  qsa('[data-cat]').forEach(el => el.addEventListener('click', () => loadCategory(el.dataset.cat)));
  qsa('[data-browse]').forEach(el => el.addEventListener('click', () => navigate('')));
  $('uploadCatBtn').addEventListener('click', openUploadModal);

  // Search bar
  $('searchToggleBtn').addEventListener('click', () => {
    state.searchOpen = !state.searchOpen;
    $('searchBar').classList.toggle('open', state.searchOpen);
    $('main').classList.toggle('search-open', state.searchOpen);
    if (state.searchOpen) $('searchInput').focus();
    else { $('searchInput').value = ''; if (state.currentView === 'search') showView('home'); }
  });
  $('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (!q) { showView('home'); return; }
    searchTimeout = setTimeout(() => doSearch(q), 350);
  });
  $('searchClearBtn').addEventListener('click', () => { $('searchInput').value = ''; showView('home'); });

  // Browser actions
  $('backBtn').addEventListener('click', () => {
    const parent = state.currentPath ? state.currentPath.split('/').slice(0,-1).join('/') : null;
    if (parent !== null) navigate(parent); else loadHome();
  });
  $('catBackBtn').addEventListener('click', loadHome);
  $('newFolderBtn').addEventListener('click', () => { $('folderNameInput').value = ''; openModal('folderModal'); $('folderNameInput').focus(); });
  $('uploadBtn').addEventListener('click', openUploadModal);
  $('gridViewBtn').addEventListener('click', () => setListMode('grid'));
  $('listViewBtn').addEventListener('click', () => setListMode('list'));

  // Bottom nav
  $('navFiles').addEventListener('click', loadHome);
  $('navBrowse').addEventListener('click', () => navigate(state.currentPath || ''));
  $('navUpload').addEventListener('click', openUploadModal);
  $('navInfo').addEventListener('click', showInfo);

   // Non-video modals close (image viewer handled by ivInit)
  ['audio','text','info','upload'].forEach(name => {
    $(`${name}Close`).addEventListener('click', () => closeModal(`${name}Modal`));
    const bd = $(`${name}Backdrop`);
    if (bd) bd.addEventListener('click', () => closeModal(`${name}Modal`));
  });

  // Mini player controls
  $('miniPlayer').addEventListener('click', e => {
    if (e.target.closest('#miniPlayBtn') || e.target.closest('#miniCloseBtn')) return;
    mpExpandFromMini();
  });
  $('miniPlayBtn').addEventListener('click', e => {
    e.stopPropagation();
    mpTogglePlay();
  });
  $('miniCloseBtn').addEventListener('click', e => {
    e.stopPropagation();
    const audio = mpGetAudio();
    audio.pause();
    audio.src = '';
    mpSetPlaying(false);
    mp.queue = [];
    mpHideMini();
  });

  // Upload
  $('startUploadBtn').addEventListener('click', handleUpload);
  const dz = $('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragging'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragging'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragging'); $('fileInput').files = e.dataTransfer.files; });
  $('fileInput').addEventListener('change', () => {
    const files = [...$('fileInput').files];
    $('uploadList').innerHTML = files.map(f => `<div class="upload-file-row"><span style="flex:1">${f.name}</span><span style="color:var(--text2)">${(f.size/1024).toFixed(0)} KB</span></div>`).join('');
  });
  $('uploadBackdrop').addEventListener('click', () => closeModal('uploadModal'));

  // Folder modal
  $('folderCancelBtn').addEventListener('click', () => closeModal('folderModal'));
  $('folderBackdrop').addEventListener('click', () => closeModal('folderModal'));
  $('folderCreateBtn').addEventListener('click', () => { const n = $('folderNameInput').value.trim(); if (n) { closeModal('folderModal'); createFolder(n); } });
  $('folderNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { const n = e.target.value.trim(); if (n) { closeModal('folderModal'); createFolder(n); } } });

  // Context menu
  $('ctxOpen').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (!i) return; if (i.type === 'dir') navigate(i.path); else openFile(i); });
  $('ctxDownload').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (!i) return; const a = document.createElement('a'); a.href = `/file?path=${encodeURIComponent(i.path)}&dl=1`; a.download = i.name; a.click(); });
  $('ctxDelete').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) deleteItem(i); });
  document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu') && !e.target.closest('[data-more]')) hideCtxMenu(); });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    const videoOpen  = !$('videoModal').classList.contains('hidden');


    if (e.key === 'Escape') {
      if (videoOpen) { closeVideo(); return; }
      ['audioModal','textModal','infoModal','uploadModal','folderModal'].forEach(id => {
        if (!$(id).classList.contains('hidden')) closeModal(id);
      });
      if (state.searchOpen) $('searchToggleBtn').click();
    }

    if (videoOpen) {
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); vpTogglePlay(); vpShowControls(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); vpSeek(-10); }
      if (e.key === 'ArrowRight') { e.preventDefault(); vpSeek(10); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); vpSetVolume(vp.volume + 0.1); vpShowHud('vol', vp.volume); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); vpSetVolume(vp.volume - 0.1); vpShowHud('vol', vp.volume); }
      if (e.key === 'm' || e.key === 'M') vpToggleMute();
      if (e.key === 'f' || e.key === 'F') vpToggleFullscreen();
    }

  });

});