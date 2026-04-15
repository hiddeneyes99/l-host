/* ─────────────────────────────────────────────
   Hevi Explorer  ·  Frontend App
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
  uploadFiles: [],
  uploadUploading: false,
  uploadCancelled: false,
  uploadXhr: null,
  uploadReader: null,
};

// ── Persistent preferences (localStorage) ──────────────────────────────────
const PREFS_KEY = 'lhost_prefs';
const prefs = (() => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch(_) { return {}; }
})();
if (!prefs.viewMode)   prefs.viewMode  = 'grid';
if (!prefs.sortBy)     prefs.sortBy    = 'date';
if (!prefs.sortDir)    prefs.sortDir   = 'desc';
if (prefs.showHidden === undefined) prefs.showHidden = true;

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch(_) {}
}

// ── Cookie helpers (video player preferences persist across sessions) ───────
function setCookie(name, value, days) {
  const expires = new Date(Date.now() + (days || 365) * 86400000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}
function getCookie(name) {
  const c = document.cookie.split(';').find(s => s.trim().startsWith(name + '='));
  return c ? decodeURIComponent(c.split('=').slice(1).join('=').trim()) : null;
}

// ── Video player persistent preferences (cookies) ──────────────────────────
const vpPrefs = {
  volume:     Math.max(0, Math.min(1, parseFloat(getCookie('vp_vol')    ?? '1'))),
  speed:      parseFloat(getCookie('vp_speed')  ?? '1'),
  brightness: Math.max(0.1, Math.min(1, parseFloat(getCookie('vp_bright') ?? '1'))),
  aspectIdx:  parseInt(getCookie('vp_aspect')  ?? '0', 10),
  muted:      getCookie('vp_muted') === '1',
};
function saveVpPrefs() {
  setCookie('vp_vol',    vpPrefs.volume);
  setCookie('vp_speed',  vpPrefs.speed);
  setCookie('vp_bright', vpPrefs.brightness);
  setCookie('vp_aspect', vpPrefs.aspectIdx);
  setCookie('vp_muted',  vpPrefs.muted ? '1' : '0');
}

function buildListParams() {
  return `sort=${prefs.sortBy}&sortDir=${prefs.sortDir}&hidden=${prefs.showHidden ? '1' : '0'}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function fileIcon(item) {
  return fileVisual(item).icon;
}

function fileVisual(item) {
  const ext = (item.ext || '').toLowerCase();
  const cat = item.category;
  if (item.type === 'dir') return { icon: '📁', label: '', className: 'file-type-folder' };
  if (cat === 'video') return { icon: '🎬', label: 'VID', className: 'file-type-video' };
  if (cat === 'image') return { icon: '🖼️', label: 'IMG', className: 'file-type-image' };
  if (cat === 'audio') {
    if (ext === '.opus') return { icon: '🎙️', label: 'OPUS', className: 'file-type-voice' };
    return { icon: '🎵', label: 'AUD', className: 'file-type-audio' };
  }
  if (cat === 'apk') return { icon: '📱', label: 'APK', className: 'file-type-apk', image: `/api/apk-icon?path=${encodeURIComponent(item.path)}` };
  if (ext === '.pdf') return { icon: '', label: '', className: 'file-type-pdf', fa: 'fa-file-pdf-o' };
  if (['.ttf','.otf','.woff','.woff2','.eot'].includes(ext)) return { icon: '🔤', label: ext.replace('.', '').toUpperCase(), className: 'file-type-font' };
  if (['.tmp','.temp','.cache','.bak','.old'].includes(ext)) return { icon: '⏱️', label: ext.replace('.', '').toUpperCase(), className: 'file-type-temp' };
  if (['.zip','.jar'].includes(ext)) return { icon: '📦', label: ext === '.jar' ? 'JAR' : 'ZIP', className: 'file-type-zip' };
  if (ext === '.rar') return { icon: '🧰', label: 'RAR', className: 'file-type-rar' };
  if (ext === '.7z' || ext === '.z7') return { icon: '🧊', label: ext.replace('.', '').toUpperCase(), className: 'file-type-7z' };
  if (['.tar','.gz','.tgz','.bz2','.xz','.lz','.lzma','.zst'].includes(ext) || cat === 'archive') return { icon: '🗜️', label: ext.replace('.', '').toUpperCase() || 'ARC', className: 'file-type-archive' };
  if (['.ppt','.pptx','.pps','.ppsx'].includes(ext)) return { icon: '📊', label: ext.replace('.', '').toUpperCase(), className: 'file-type-ppt' };
  if (['.doc','.docx','.rtf'].includes(ext)) return { icon: '📘', label: ext.replace('.', '').toUpperCase(), className: 'file-type-doc' };
  if (['.xls','.xlsx','.ods'].includes(ext)) return { icon: '📗', label: ext.replace('.', '').toUpperCase(), className: 'file-type-sheet' };
  if (['.txt','.md','.log'].includes(ext)) return { icon: '📝', label: ext.replace('.', '').toUpperCase(), className: 'file-type-text' };
  if (ext === '.py') return { icon: '🐍', label: 'PY', className: 'file-type-python' };
  if (ext === '.sh') return { icon: '⌨️', label: 'SH', className: 'file-type-shell' };
  if (ext === '.java') return { icon: '☕', label: 'JAVA', className: 'file-type-java' };
  if (ext === '.css') return { icon: '🎨', label: 'CSS', className: 'file-type-css' };
  if (ext === '.html' || ext === '.htm') return { icon: '🌐', label: 'HTML', className: 'file-type-html' };
  if (['.js','.ts','.jsx','.tsx','.json','.xml','.yaml','.yml','.ini','.conf','.csv','.sql','.bat','.ps1','.rb','.go','.rs','.c','.cpp','.h'].includes(ext)) return { icon: '🔧', label: ext.replace('.', '').toUpperCase(), className: 'file-type-code' };
  return { icon: '📄', label: ext ? ext.replace('.', '').toUpperCase() : 'FILE', className: 'file-type-default' };
}

function fileThumbHtml(item) {
  const visual = fileVisual(item);
  const label = visual.label ? `<span class="file-type-badge">${visual.label}</span>` : '';
  const mark = visual.fa
    ? '<span class="pdf-mega-icon"><span class="pdf-mega-fold"></span><span class="pdf-mega-mark">PDF</span><span class="pdf-mega-line pdf-mega-line-1"></span><span class="pdf-mega-line pdf-mega-line-2"></span><span class="pdf-mega-line pdf-mega-line-3"></span></span>'
    : visual.image
    ? `<img class="file-type-img" src="${visual.image}" alt="${visual.label || item.name}" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='')"><span class="file-icon-big" style="display:none">${visual.icon}</span>`
    : `<span class="file-icon-big">${visual.icon}</span>`;
  return `<div class="thumb file-type-thumb ${visual.className}">${mark}${label}</div>`;
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
  if (el) el.textContent = p ? '/ ' + p.replace(/\\/g, '/') : '/';
}

// ═══════════════════════════════════════════════════════════════════════════
//  LRU CACHE  — limits memory used by thumbnail data URLs
// ═══════════════════════════════════════════════════════════════════════════

class LRUCache {
  constructor(max) { this.max = max; this.map = new Map(); }
  has(k) { return this.map.has(k); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k); this.map.set(k, v); // move to end (most recently used)
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); // evict oldest
  }
}


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
    }, { rootMargin: '150px' })
  : null;

// ── EQ animation observer — pauses CSS animation when card is off-screen ───
// Keeps GPU compositor free during fast scrolling (200+ animated elements).
const eqObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        const eq = e.target.querySelector('.audio-eq');
        if (eq) eq.classList.toggle('eq-paused', !e.isIntersecting);
      });
    }, { rootMargin: '200px 0px' })
  : null;

// ═══════════════════════════════════════════════════════════════════════════
//  VIDEO THUMBNAIL GENERATOR  (canvas-based, lazy)
//  Works everywhere — no FFmpeg, no server-side processing.
//  Browser loads a tiny slice of the video, seeks to ~10%, draws to canvas.
// ═══════════════════════════════════════════════════════════════════════════

const thumbCache = new Map(); // url → dataUrl | null (loading)

// ── Concurrency queue — max 2 videos loading simultaneously ───────────────
// Lower concurrency keeps the main thread free for user interaction.
const THUMB_CONCURRENCY = 2;
let _thumbActive = 0;
const _thumbQueue = []; // [{url, thumbEl}]

function _thumbDequeue() {
  while (_thumbActive < THUMB_CONCURRENCY && _thumbQueue.length) {
    const { url, thumbEl } = _thumbQueue.shift();
    _thumbRunNow(url, thumbEl);
  }
}

function generateThumb(url, thumbEl) {
  if (thumbCache.has(url)) {
    const cached = thumbCache.get(url);
    if (cached) applyThumb(thumbEl, cached);
    return;
  }
  thumbCache.set(url, null); // mark as in-progress

  if (_thumbActive >= THUMB_CONCURRENCY) {
    _thumbQueue.push({ url, thumbEl });
    return;
  }
  _thumbRunNow(url, thumbEl);
}

// Check brightness on a tiny canvas — much faster than full-res getImageData
function _isBitmapBlack(smallCtx, w, h) {
  try {
    const data = smallCtx.getImageData(0, 0, w, h).data;
    let total = 0;
    // Sample every pixel on the tiny canvas (only ~576 pixels for 32×18)
    for (let i = 0; i < data.length; i += 4) {
      total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    return (total / (data.length / 4)) < 12;
  } catch(_) { return false; }
}

function _thumbRunNow(url, thumbEl) {
  _thumbActive++;

  const vid = document.createElement('video');
  vid.muted = true;
  vid.preload = 'metadata';
  vid.crossOrigin = 'anonymous';
  let done = false;

  // Try these timestamps; stop at first non-black frame
  const seekSteps = [2, 5, 10, 30, 60];
  let stepIdx = 0;

  const finish  = () => { _thumbActive--; _thumbDequeue(); };
  const cleanup = () => { try { vid.src = ''; vid.load(); } catch(_) {} };
  const timeout = setTimeout(() => {
    if (!done) { done = true; cleanup(); finish(); }
  }, 20000);

  vid.addEventListener('loadedmetadata', () => { vid.currentTime = seekSteps[0]; });

  vid.addEventListener('seeked', async () => {
    if (done) return;

    // Yield to the browser event loop first so UI stays responsive
    await new Promise(r => setTimeout(r, 0));
    if (done) return;

    try {
      let isBlack = false;

      // Use createImageBitmap for async, non-blocking frame capture
      if (typeof createImageBitmap === 'function') {
        // Capture a tiny 32×18 version just for the brightness check
        const small = await createImageBitmap(vid, { resizeWidth: 32, resizeHeight: 18 });
        const sc = document.createElement('canvas');
        sc.width = 32; sc.height = 18;
        sc.getContext('2d').drawImage(small, 0, 0);
        small.close();
        isBlack = _isBitmapBlack(sc.getContext('2d'), 32, 18);

        if (isBlack && stepIdx < seekSteps.length - 1) {
          stepIdx++;
          vid.currentTime = seekSteps[stepIdx];
          return;
        }

        // Good frame — capture full-res asynchronously
        const full = await createImageBitmap(vid, { resizeWidth: 320, resizeHeight: 180 });
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        canvas.getContext('2d').drawImage(full, 0, 0);
        full.close();

        done = true;
        clearTimeout(timeout);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        thumbCache.set(url, dataUrl);
        applyThumb(thumbEl, dataUrl);
      } else {
        // Fallback for browsers without createImageBitmap
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        canvas.getContext('2d').drawImage(vid, 0, 0, 320, 180);
        done = true;
        clearTimeout(timeout);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        thumbCache.set(url, dataUrl);
        applyThumb(thumbEl, dataUrl);
      }
    } catch(_) { done = true; clearTimeout(timeout); }

    if (done) { cleanup(); finish(); }
  });

  vid.addEventListener('error', () => {
    if (!done) { done = true; clearTimeout(timeout); cleanup(); finish(); }
  });
  vid.src = url;
}

function applyThumb(thumbEl, dataUrl) {
  if (!thumbEl || !thumbEl.isConnected) return;
  const canvas = thumbEl.querySelector('.vt-canvas');
  const spinner = thumbEl.querySelector('.vt-loading');
  const overlay = thumbEl.querySelector('.video-play-overlay');
  if (canvas) { canvas.src = dataUrl; canvas.style.display = 'block'; }
  if (spinner) spinner.style.display = 'none';
  if (overlay) overlay.style.opacity = '1';
}

// Lazy: only generate thumbnails when card enters viewport.
// rootMargin: 0px — don't preload until card is actually visible.
// A 250ms debounce lets the user scroll freely without triggering loads for every card.
const thumbObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        const el = e.target;
        if (!e.isIntersecting) {
          // Card left viewport — cancel any pending debounce
          if (el._thumbTimer) { clearTimeout(el._thumbTimer); el._thumbTimer = null; }
          return;
        }
        const url = el.dataset.thumbUrl;
        if (!url) return;
        // Debounce: only start loading if card stays visible for 250ms
        el._thumbTimer = setTimeout(() => {
          el._thumbTimer = null;
          thumbObserver.unobserve(el);
          generateThumb(url, el);
        }, 250);
      });
    }, { rootMargin: '0px' })
  : null;

// ── Image thumbnail lazy loader — debounced IntersectionObserver ───────────
//  Uses a concurrency limit so the server isn't hammered with 50+ sharp calls.
//  Replaces native loading="lazy" which has no debounce or concurrency limit.
const IMG_CONCURRENCY = 6;
let _imgActive = 0;
const _imgQueue = []; // {img, src}

function _imgDequeue() {
  while (_imgActive < IMG_CONCURRENCY && _imgQueue.length) {
    const { img, src } = _imgQueue.shift();
    _imgLoad(img, src);
  }
}
function _imgLoad(img, src) {
  _imgActive++;
  const done = () => { _imgActive--; _imgDequeue(); };
  img.onload = img.onerror = done;
  img.src = src;
}
function _imgEnqueue(img, src) {
  if (_imgActive < IMG_CONCURRENCY) { _imgLoad(img, src); return; }
  _imgQueue.push({ img, src });
}

const imgObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        const img = e.target;
        if (!e.isIntersecting) {
          if (img._imgTimer) { clearTimeout(img._imgTimer); img._imgTimer = null; }
          return;
        }
        const src = img.dataset.src;
        if (!src || img.src) return;
        img._imgTimer = setTimeout(() => {
          img._imgTimer = null;
          imgObserver.unobserve(img);
          _imgEnqueue(img, src);
        }, 150);
      });
    }, { rootMargin: '200px' })
  : null;

// ═══════════════════════════════════════════════════════════════════════════
//  MEMORY OBSERVER  — evicts audio-art-img src when 5+ screens away.
//  Browser handles regular lazy-loaded images itself; we only touch
//  the fetched audio art images which stay in memory after load.
// ═══════════════════════════════════════════════════════════════════════════

const memObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        const el       = e.target;
        const audioArt = el.querySelector('.audio-art-img');
        if (!audioArt) return;
        if (!e.isIntersecting) {
          if (audioArt.complete && audioArt.naturalWidth > 0 && audioArt.src && !audioArt.dataset.memSrc) {
            audioArt.dataset.memSrc = audioArt.src;
            audioArt.src = '';
          }
        } else {
          if (audioArt.dataset.memSrc) {
            audioArt.src = audioArt.dataset.memSrc;
            delete audioArt.dataset.memSrc;
          }
        }
      });
    }, { rootMargin: '500% 0px' })
  : null;

// ═══════════════════════════════════════════════════════════════════════════
//  PAGINATION ENGINE  (infinite scroll for 100k+ files)
// ═══════════════════════════════════════════════════════════════════════════

const PG_LIMIT = 125; // items per page — larger batch = fewer API calls
const VP_PREVIEW_BUCKET_SECONDS = 5;

const pg = {
  view:     null,  // 'browser' | 'cat' | 'search'
  param:    null,  // relPath | cat | query string
  page:     0,     // NEXT page to fetch
  total:    0,     // total items on server
  loading:  false,
  imageSet: [],    // grows as pages load
  audioSet: [],
  videoSet: [],
  grid:     null,
};

let _sentinelObserver = null;

function pgReset(view, param, grid) {
  if (_sentinelObserver) { _sentinelObserver.disconnect(); _sentinelObserver = null; }
  pg.view = view; pg.param = param; pg.grid = grid;
  pg.page = 0; pg.total = 0; pg.loading = false;
  pg.imageSet = []; pg.audioSet = []; pg.videoSet = [];
}

function pgSentinelSetup() {
  const old = pg.grid ? pg.grid.querySelector('.pg-sentinel') : null;
  if (old) old.remove();
  if (!pg.grid) return;
  if (pg.page * PG_LIMIT >= pg.total) return; // all pages loaded

  const s = document.createElement('div');
  s.className = 'pg-sentinel';
  pg.grid.appendChild(s);

  _sentinelObserver = new IntersectionObserver(async entries => {
    if (!entries[0].isIntersecting || pg.loading) return;
    if (pg.page * PG_LIMIT >= pg.total) { _sentinelObserver.disconnect(); return; }
    await pgNext();
  }, { rootMargin: '800px' }); // load next page well before user reaches bottom
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
  const skCount = Math.min(remaining, 30);
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
    if      (pg.view === 'browser') url = `/api/ls?path=${encodeURIComponent(pg.param)}&page=${pg.page}&limit=${PG_LIMIT}&${buildListParams()}`;
    else if (pg.view === 'cat')     url = `/api/category/${pg.param}?page=${pg.page}&limit=${PG_LIMIT}&${buildListParams()}`;
    else if (pg.view === 'search')  url = `/api/search?q=${encodeURIComponent(pg.param)}&path=&page=${pg.page}&limit=${PG_LIMIT}&hidden=${prefs.showHidden ? '1' : '0'}`;

    const data = await fetchJson(url);
    const newItems = data.items || data.results || [];

    pg.imageSet.push(...newItems.filter(i => i.category === 'image'));
    pg.audioSet.push(...newItems.filter(i => i.category === 'audio'));
    pg.videoSet.push(...newItems.filter(i => i.category === 'video'));
    pg.total = data.total;
    pg.page++;

    skEls.forEach(s => s.remove());
    for (const item of newItems) {
      pg.grid.appendChild(createItemEl(item, pg.imageSet, pg.audioSet, pg.videoSet));
    }
  } catch (e) {
    skEls.forEach(s => s.remove());
    console.error('[pg] load error:', e);
  }

  pg.loading = false;
  pgSentinelSetup();
}

// ═══════════════════════════════════════════════════════════════════════════
//  CUSTOM VIDEO PLAYER
// ═══════════════════════════════════════════════════════════════════════════

const VP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const ASPECTS   = ['fit','fill','stretch'];
const ASPECT_LABELS = { fit:'Fit', fill:'Fill', stretch:'Stretch' };

// Extensions that the HTML5 <video> element can reliably play in modern browsers
const NATIVE_VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.ogv', '.m4v']);
function isNativeVideo(item) { return NATIVE_VIDEO_EXTS.has((item.ext || '').toLowerCase()); }

const NATIVE_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.apng']);
const HEIC_IMAGE_EXTS = new Set(['.heic', '.heif']);
const PRO_IMAGE_EXTS = new Set(['.raw', '.cr2', '.nef', '.arw', '.dng', '.psd', '.ai', '.tiff', '.tif']);
function imageFormatInfo(item) {
  const ext = (item.ext || '').toLowerCase();
  if (NATIVE_IMAGE_EXTS.has(ext)) return { native: true, badge: '', className: '' };
  if (HEIC_IMAGE_EXTS.has(ext)) return { native: false, badge: 'HEIC', className: 'format-thumb-heic' };
  if (PRO_IMAGE_EXTS.has(ext)) {
    const raw = ['.raw', '.cr2', '.nef', '.arw', '.dng'].includes(ext);
    return { native: false, badge: raw ? 'RAW' : ext.replace('.', '').toUpperCase(), className: raw ? 'format-thumb-raw' : 'format-thumb-pro' };
  }
  return { native: false, badge: (ext || '.IMG').replace('.', '').toUpperCase(), className: 'format-thumb-pro' };
}

const vp = {
  item: null,
  url: '',
  videoSet: [],    // all videos in current context (for prev/next)
  videoIdx: -1,    // index of current video in videoSet
  // Restored from cookies on every session
  speed:      vpPrefs.speed,
  aspectIdx:  vpPrefs.aspectIdx,
  theater: false,
  brightness: vpPrefs.brightness,
  volume:     vpPrefs.volume,
  muted:      vpPrefs.muted,
  controlsTimer: null,
  controlsLocked: false,
  lockTimer: null,
  progressDragging: false,
  previewTimer: null,
  previewVideo: null,
  previewVideoUrl: '',
  previewBusy: false,
  previewPendingTime: null,
  previewCache: new LRUCache(24),
  clickTimer: null,
  suppressClickUntil: 0,
  // gesture tracking
  touch: {
    startX: 0, startY: 0, startVal: 0,
    type: null,         // 'vol' | 'bright' | null
    leftTap: 0, rightTap: 0,
    tapCount: 0,
    controlsWereHidden: false,
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
  volume: 1,
  speed: 1,
  muted: false,
  sleepTimer: null,
  sleepEnd: 0,
  vizMode: 'circle',
  metaCache: {},
  trackChanging: false,
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
  // Apply circle mode class immediately so CSS transitions and vinyl overlay are ready
  if (mp.vizMode === 'circle') {
    $('mpArtSection')?.classList.add('circle-mode');
    const vizWrap = document.querySelector('.mp-viz-wrap');
    if (vizWrap) vizWrap.style.display = 'none';
  }
  mpLoadTrack(mp.index);
}

function mpExpandFromMini() {
  mpHideMini();
  openModal('audioModal');
  if (mp.vizMode === 'circle') {
    $('mpArtSection')?.classList.add('circle-mode');
    const vizWrap = document.querySelector('.mp-viz-wrap');
    if (vizWrap) vizWrap.style.display = 'none';
  }
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

  function mpApplyColors(col1, col2) {
    mp.color1 = col1; mp.color2 = col2;
    $('mpArtGlow').style.background = col1;
    const container = $('mpContainer');
    container.style.setProperty('--mp-color1', col1);
    container.style.setProperty('--mp-color2', col2);
    $('mpAmbientBlur').style.setProperty('--mp-color1', col1);
    $('mpAmbientBlur').style.setProperty('--mp-color2', col2);
    // Update vol slider gradient color
    mpUpdateVolDisplay();
  }

  // Art pop-in animation
  const artEl = $('mpArt');
  artEl.classList.remove('mp-art-pop');
  void artEl.offsetWidth;
  artEl.classList.add('mp-art-pop');
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
    const extracted = extractColors(img);
    if (extracted) mpApplyColors(extracted[0], extracted[1]);
    mpUpdateMediaSession(item);
  };
  img.onerror = () => { mpUpdateMediaSession(item); };
  img.src = artUrl;

  mpApplyColors(c1, c2);

  mp.trackChanging = true;
  mpUpdateMediaSession(item);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';

  audio.src = trackUrl;
  audio.playbackRate = mp.speed;
  audio.volume = mp.muted ? 0 : mp.volume;
  $('mpProgressFill').style.width = '0%';
  $('mpProgressDot').style.left = '0%';
  $('mpCurrentTime').textContent = '0:00';
  $('mpDuration').textContent = '0:00';

  mpInitAudioContext();
  audio.play().then(() => { mp.trackChanging = false; mpSetPlaying(true); }).catch(() => { mp.trackChanging = false; });
  mpRenderQueue();

  // Apply marquee for long titles
  setTimeout(() => mpApplyMarquee($('mpTitle')), 60);

  // Fetch real ID3 metadata
  mpLoadMeta(item);
  mpUpdateMediaSession(item);

  if ($('miniPlayer').classList.contains('active')) {
    mpUpdateMiniInfo(mp.queue[mp.index]);
  }
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

  // ── Vinyl spin: play → spin, pause/stop → slow-down then stop ───────────
  const artEl = $('mpArt');
  if (artEl && mp.vizMode === 'circle') {
    if (playing) {
      // Remove pop animation to avoid conflict with vinyl spin transform
      artEl.classList.remove('vinyl-slowing', 'mp-art-pop');
      void artEl.offsetWidth;
      artEl.classList.add('vinyl-playing');
    } else {
      artEl.classList.remove('vinyl-playing');
      artEl.classList.add('vinyl-slowing');
      artEl.addEventListener('animationend', function _end() {
        artEl.classList.remove('vinyl-slowing');
        artEl.removeEventListener('animationend', _end);
      }, { once: true });
    }
  }
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
  const total = mp.queue.length;

  // Update both the toggle bar label and the panel header label
  const panelLabel = $('mpQueuePanelLabel');
  if (panelLabel) panelLabel.textContent = `Up Next (${total})`;
  const toggleLabel = $('mpQueueLabel');
  if (toggleLabel) toggleLabel.textContent = `Up Next${total > 1 ? ` (${total})` : ''}`;

  for (let i = 0; i < total; i++) {
    const idx = mp.shuffle ? mp.shuffleOrder[i] : (mp.index + i) % total;
    const item = mp.queue[idx];
    if (!item) continue;
    const [c1, c2] = audioPalette(item.name);
    const isCurr = idx === mp.index;
    const el = document.createElement('div');
    el.className = 'mp-queue-item' + (isCurr ? ' active' : '');
    el.setAttribute('draggable', 'true');
    el.dataset.queuePos = String(i);
    const badgeHtml = isCurr
      ? `<div class="mp-queue-playing"><span></span><span></span><span></span></div>`
      : `<span class="mp-queue-num">${i + 1}</span>`;
    el.innerHTML = `
      <div class="mp-queue-thumb" style="background:linear-gradient(135deg,${c1},${c2})">
        <img class="mp-queue-art" alt="">
        <svg viewBox="0 0 24 24" class="mp-queue-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div class="mp-queue-info">
        <div class="mp-queue-name">${item.name.replace(/\.[^.]+$/,'')}</div>
        <div class="mp-queue-size">${item.sizeStr || ''}</div>
      </div>
      ${badgeHtml}
      <div class="mp-queue-drag-handle" title="Drag to reorder">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="15" x2="16" y2="15"/></svg>
      </div>`;
    const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
    const artImg = el.querySelector('.mp-queue-art');
    const artIcon = el.querySelector('.mp-queue-icon');
    const probe = new Image();
    probe.onload = () => { artImg.src = artUrl; artImg.style.display = 'block'; if (artIcon) artIcon.style.opacity = '0'; };
    probe.onerror = () => {};
    probe.src = artUrl;
    el.addEventListener('click', e => {
      if (e.target.closest('.mp-queue-drag-handle')) return;
      mpLoadTrack(idx);
      setTimeout(mpCloseQueue, 280);
    });
    list.appendChild(el);
  }

  mpSetupQueueDrag(list);
}

function mpReorderQueue(fromPos, toPos) {
  if (fromPos === toPos || fromPos < 0 || toPos < 0) return;
  const total = mp.queue.length;
  const currentItem = mp.queue[mp.index];

  if (mp.shuffle) {
    const moved = mp.shuffleOrder.splice(fromPos, 1)[0];
    mp.shuffleOrder.splice(toPos, 0, moved);
  } else {
    const actualFrom = (mp.index + fromPos) % total;
    const actualTo   = (mp.index + toPos)   % total;
    const [moved] = mp.queue.splice(actualFrom, 1);
    mp.queue.splice(actualTo, 0, moved);
    mp.index = mp.queue.indexOf(currentItem);
    if (mp.index < 0) mp.index = 0;
  }
  mpRenderQueue();
}

function mpSetupQueueDrag(list) {
  let dragSrcPos = -1;

  // ── Desktop drag-and-drop ──────────────────────────────────────────────────
  list.addEventListener('dragstart', e => {
    const item = e.target.closest('.mp-queue-item');
    if (!item) return;
    dragSrcPos = parseInt(item.dataset.queuePos);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.classList.add('mp-q-dragging'), 0);
  });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.mp-queue-item');
    if (!target) return;
    qsa('.mp-queue-item', list).forEach(el => el.classList.remove('mp-q-dragover'));
    if (parseInt(target.dataset.queuePos) !== dragSrcPos) target.classList.add('mp-q-dragover');
  });
  list.addEventListener('dragleave', e => {
    if (!e.relatedTarget || !list.contains(e.relatedTarget)) {
      qsa('.mp-queue-item', list).forEach(el => el.classList.remove('mp-q-dragover'));
    }
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    const target = e.target.closest('.mp-queue-item');
    qsa('.mp-queue-item', list).forEach(el => { el.classList.remove('mp-q-dragging', 'mp-q-dragover'); });
    if (!target) return;
    const destPos = parseInt(target.dataset.queuePos);
    mpReorderQueue(dragSrcPos, destPos);
    dragSrcPos = -1;
  });
  list.addEventListener('dragend', () => {
    qsa('.mp-queue-item', list).forEach(el => { el.classList.remove('mp-q-dragging', 'mp-q-dragover'); });
    dragSrcPos = -1;
  });

  // ── Mobile touch long-press drag ──────────────────────────────────────────
  let touchSrcPos = -1, touchSrcEl = null;
  let holdTimer = null, dragActive = false;
  let startY = 0, ghost = null;

  list.addEventListener('touchstart', e => {
    const item = e.target.closest('.mp-queue-item');
    if (!item) return;
    touchSrcEl  = item;
    touchSrcPos = parseInt(item.dataset.queuePos);
    startY = e.touches[0].clientY;
    holdTimer = setTimeout(() => {
      dragActive = true;
      item.classList.add('mp-q-dragging');
      const r = item.getBoundingClientRect();
      ghost = item.cloneNode(true);
      ghost.classList.add('mp-q-ghost');
      ghost.style.top    = r.top + 'px';
      ghost.style.width  = r.width + 'px';
      document.body.appendChild(ghost);
    }, 380);
  }, { passive: true });

  list.addEventListener('touchmove', e => {
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (!dragActive && dy > 10) { clearTimeout(holdTimer); return; }
    if (!dragActive || !ghost) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    ghost.style.top = (y - 28) + 'px';
    qsa('.mp-queue-item:not(.mp-q-dragging)', list).forEach(el => {
      const r = el.getBoundingClientRect();
      el.classList.toggle('mp-q-dragover', y >= r.top && y <= r.bottom);
    });
  }, { passive: false });

  list.addEventListener('touchend', e => {
    clearTimeout(holdTimer);
    if (ghost) { ghost.remove(); ghost = null; }
    if (touchSrcEl) touchSrcEl.classList.remove('mp-q-dragging');
    if (!dragActive) { touchSrcPos = -1; touchSrcEl = null; return; }
    dragActive = false;
    const y = e.changedTouches[0].clientY;
    let destPos = touchSrcPos;
    qsa('.mp-queue-item:not(.mp-q-dragging)', list).forEach(el => {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) destPos = parseInt(el.dataset.queuePos);
      el.classList.remove('mp-q-dragover');
    });
    if (destPos !== touchSrcPos) mpReorderQueue(touchSrcPos, destPos);
    touchSrcPos = -1; touchSrcEl = null;
  }, { passive: true });
}

function mpStartVisualizer() {
  if (mp.vizMode === 'off') return;

  // ── Circle mode: draws on the overlay canvas around album art ──────────────
  if (mp.vizMode === 'circle') {
    const canvas = $('mpCircleCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    const frameInterval = isMobile ? 66 : 33; // ~15fps mobile, ~30fps desktop — balanced
    let lastTs = 0;
    let sizeDirty = true;
    let dpr = 1, CX = 160, CY = 160, ART_R = 110, INNER_R = 118, MAX_EXT = 52;

    function vcResize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const par = canvas.parentElement;
      const SW = par ? par.offsetWidth : 320;
      const SH = par ? par.offsetHeight : 320;
      canvas.width  = SW * dpr;
      canvas.height = SH * dpr;
      canvas.style.width  = SW + 'px';
      canvas.style.height = SH + 'px';

      // Compute center from actual art element position for pixel-perfect alignment
      const artEl = $('mpArt');
      if (artEl) {
        const cr = canvas.getBoundingClientRect();
        const ar = artEl.getBoundingClientRect();
        if (cr.width > 0) {
          CX = ar.left - cr.left + ar.width  / 2;
          CY = ar.top  - cr.top  + ar.height / 2;
          ART_R = ar.width / 2;
        } else {
          CX = SW / 2; CY = SH / 2;
          ART_R = artEl.offsetWidth / 2 || 110;
        }
      } else {
        CX = SW / 2; CY = SH / 2; ART_R = 110;
      }
      INNER_R = ART_R + 7;
      const room = Math.min(CX, CY, SW - CX, SH - CY) - INNER_R - 6;
      MAX_EXT = Math.max(10, Math.min(isMobile ? 48 : 62, room));
      sizeDirty = false;
    }

    const _ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { sizeDirty = true; }) : null;
    if (_ro) { _ro.observe(canvas.parentElement); }

    // Defer first resize to next paint so modal is fully laid out
    requestAnimationFrame(() => { vcResize(); });

    const NUM_BARS    = isMobile ? 64 : 128;  // fewer bars on mobile — halves stroke calls
    const QUARTER     = NUM_BARS / 4;
    const HALF        = NUM_BARS / 2;
    const ACTIVE_BINS = 29;  // use bins 0-29 (~0-10kHz) so every quadrant maps to musical range

    // Parse hex → [r,g,b] — called once outside drawCircle, re-called when colors change
    function _hx(h) {
      h = (h || '#00d4c8').replace('#','');
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      return [parseInt(h.slice(0,2),16)||0, parseInt(h.slice(2,4),16)||0, parseInt(h.slice(4,6),16)||0];
    }
    let _cachedC1 = '', _cachedC2 = '';
    let _rgb1 = [0,212,200], _rgb2 = [0,145,255];

    // Pre-allocate frequency buffer — never reallocated per frame
    let _freqBuf = null;

    // Pre-compute per-bar colors into typed arrays — recomputed only on color change
    const _barR = new Uint8Array(NUM_BARS);
    const _barG = new Uint8Array(NUM_BARS);
    const _barB = new Uint8Array(NUM_BARS);

    function _rebuildBarColors(r1,g1,b1,r2,g2,b2) {
      for (let i = 0; i < NUM_BARS; i++) {
        const t = (Math.sin((i / NUM_BARS) * Math.PI * 4 - Math.PI / 2) + 1) / 2;
        _barR[i] = Math.round(r1 + (r2 - r1) * t);
        _barG[i] = Math.round(g1 + (g2 - g1) * t);
        _barB[i] = Math.round(b1 + (b2 - b1) * t);
      }
    }
    _rebuildBarColors(0,212,200,0,145,255);

    function drawCircle(ts) {
      if (mp.vizMode !== 'circle') { mp.rafId = null; if (_ro) _ro.disconnect(); return; }
      mp.rafId = requestAnimationFrame(drawCircle);
      if (document.hidden) return;
      if (frameInterval && ts - lastTs < frameInterval) return;
      lastTs = ts;
      if (sizeDirty) vcResize();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      const c1 = mp.color1 || '#00d4c8';
      const c2 = mp.color2 || '#0091ff';

      // Re-parse + rebuild bar colors only when album changes
      if (c1 !== _cachedC1 || c2 !== _cachedC2) {
        _rgb1 = _hx(c1); _rgb2 = _hx(c2);
        _cachedC1 = c1; _cachedC2 = c2;
        _rebuildBarColors(_rgb1[0],_rgb1[1],_rgb1[2], _rgb2[0],_rgb2[1],_rgb2[2]);
      }
      const [r1,g1,b1] = _rgb1;

      if (!mp.analyser || !mp.isPlaying) {
        // Idle: single glowing ring — skip shadowBlur on mobile
        ctx.beginPath();
        ctx.arc(CX, CY, INNER_R, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r1},${g1},${b1},0.35)`;
        ctx.lineWidth = 1.5;
        if (!isMobile) { ctx.shadowBlur = 10; ctx.shadowColor = c1; }
        ctx.stroke();
        ctx.shadowBlur = 0;
        return;
      }

      // Reuse pre-allocated buffer — zero GC pressure
      const binCount = mp.analyser.frequencyBinCount;
      if (!_freqBuf || _freqBuf.length !== binCount) _freqBuf = new Uint8Array(binCount);
      mp.analyser.getByteFrequencyData(_freqBuf);
      const bins = binCount; // 64 for fftSize=128

      // Average energy (integer math only)
      let avgSum = 0;
      for (let i = 0; i < bins; i++) avgSum += _freqBuf[i];
      const avg = avgSum / (bins * 255);

      // Cheap aura: one semi-transparent wide arc — no radial gradient
      if (avg > 0.05) {
        ctx.beginPath();
        ctx.arc(CX, CY, INNER_R + MAX_EXT * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r1},${g1},${b1},${(avg * 0.18).toFixed(2)})`;
        ctx.lineWidth = MAX_EXT * avg * 2.5;
        ctx.stroke();
      }

      // ── Bars: NO shadowBlur per bar — massive perf win ──────────────────
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0;

      // 4-fold symmetry: bass at top, right, bottom, left
      for (let i = 0; i < NUM_BARS; i++) {
        const posInQ = i % QUARTER;
        const fi     = Math.round(posInQ * ACTIVE_BINS / (QUARTER - 1));
        const v      = _freqBuf[fi < bins ? fi : bins - 1] / 255;
        const barLen = v > 0.01 ? Math.max(2, v * MAX_EXT) : 2;

        const angle = (i / NUM_BARS) * Math.PI * 2 - Math.PI * 0.5;
        const cosA  = Math.cos(angle);
        const sinA  = Math.sin(angle);

        ctx.beginPath();
        ctx.moveTo(CX + cosA * INNER_R,            CY + sinA * INNER_R);
        ctx.lineTo(CX + cosA * (INNER_R + barLen), CY + sinA * (INNER_R + barLen));
        ctx.strokeStyle = `rgba(${_barR[i]},${_barG[i]},${_barB[i]},${0.55 + v * 0.45})`;
        ctx.lineWidth   = 1.6 + v * 2.2;
        ctx.stroke();
      }

      // Inner border ring — pulses with energy; skip shadowBlur on mobile (expensive GPU op)
      ctx.beginPath();
      ctx.arc(CX, CY, INNER_R, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r1},${g1},${b1},${(0.2 + avg * 0.6).toFixed(2)})`;
      ctx.lineWidth   = 1.2;
      if (!isMobile) {
        ctx.shadowBlur  = avg > 0.08 ? Math.round(avg * 12) : 0;
        ctx.shadowColor = c1;
      }
      ctx.stroke();
      ctx.shadowBlur  = 0;
    }

    mp.rafId = requestAnimationFrame(drawCircle);
    return;
  }

  // ── Regular (bars / wave) — draws on mpVisualizer ─────────────────────────
  const canvas = $('mpVisualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let cachedGrad = null;
  let cachedC1 = '', cachedC2 = '', cachedH = 0, cachedMode = '';
  const isMobile = window.matchMedia('(max-width: 600px)').matches;
  let lastTs = 0;
  const frameInterval = isMobile ? 40 : 0;

  let cachedCssW = canvas.offsetWidth  || 340;
  let cachedCssH = canvas.offsetHeight || 64;
  let sizeDirty = false;
  const _ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { sizeDirty = true; }) : null;
  if (_ro) _ro.observe(canvas);

  function draw(ts) {
    if (mp.vizMode === 'off' || mp.vizMode === 'circle') { mp.rafId = null; if (_ro) _ro.disconnect(); return; }
    mp.rafId = requestAnimationFrame(draw);
    if (document.hidden) return;
    if (frameInterval && ts - lastTs < frameInterval) return;
    lastTs = ts;

    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    if (sizeDirty) {
      cachedCssW = canvas.offsetWidth  || 340;
      cachedCssH = canvas.offsetHeight || 64;
      sizeDirty = false;
    }
    const cssW = cachedCssW;
    const cssH = cachedCssH;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width  = targetW;
      canvas.height = targetH;
      canvas.style.width  = cssW + 'px';
      canvas.style.height = cssH + 'px';
      cachedGrad = null;
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.scale(dpr, dpr);

    const W = cssW, H = cssH;
    ctx.clearRect(0, 0, W, H);

    const c1   = mp.color1 || '#00d4c8';
    const c2   = mp.color2 || '#0091ff';
    const mode = mp.vizMode || 'bars';

    if (!mp.analyser || !mp.isPlaying) {
      if (!cachedGrad || cachedC1 !== c1 || cachedMode !== 'idle') {
        cachedGrad = ctx.createLinearGradient(0, 0, W, 0);
        cachedGrad.addColorStop(0, 'transparent');
        cachedGrad.addColorStop(0.3, c1 + '44');
        cachedGrad.addColorStop(0.7, c1 + '44');
        cachedGrad.addColorStop(1, 'transparent');
        cachedC1 = c1; cachedMode = 'idle';
      }
      ctx.fillStyle = cachedGrad;
      ctx.fillRect(0, H / 2 - 1, W, 2);
      return;
    }

    if (mode === 'wave') {
      const data = new Uint8Array(mp.analyser.fftSize);
      mp.analyser.getByteTimeDomainData(data);

      if (!cachedGrad || cachedC1 !== c1 || cachedC2 !== c2 || cachedMode !== 'wave') {
        cachedGrad = ctx.createLinearGradient(0, 0, W, 0);
        cachedGrad.addColorStop(0,    c2 + '00');
        cachedGrad.addColorStop(0.12, c1);
        cachedGrad.addColorStop(0.88, c2);
        cachedGrad.addColorStop(1,    c2 + '00');
        cachedC1 = c1; cachedC2 = c2; cachedMode = 'wave';
      }

      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';

      ctx.beginPath();
      const step = W / (data.length - 1);
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = ((data[i] / 255) * H * 0.85) + (H * 0.075);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = c1 + '28';
      ctx.lineWidth = 7;
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = ((data[i] / 255) * H * 0.85) + (H * 0.075);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = cachedGrad;
      ctx.lineWidth = 2.5;
      ctx.stroke();

    } else {
      // ── Bars — centered mirror (default) ─────────────────────────
      const data = new Uint8Array(mp.analyser.frequencyBinCount);
      mp.analyser.getByteFrequencyData(data);

      if (!cachedGrad || cachedC1 !== c1 || cachedC2 !== c2 || cachedH !== H || cachedMode !== 'bars') {
        cachedGrad = ctx.createLinearGradient(0, 0, 0, H);
        cachedGrad.addColorStop(0, c1);
        cachedGrad.addColorStop(1, c2 + '33');
        cachedC1 = c1; cachedC2 = c2; cachedH = H; cachedMode = 'bars';
      }
      ctx.fillStyle = cachedGrad;

      const halfBars = 20;
      const barW = (W / 2) / halfBars;
      const gap  = Math.max(1, barW * 0.2);
      const bw   = barW - gap;
      const cx   = W / 2;

      for (let i = 0; i < halfBars; i++) {
        const di = Math.floor(i * (data.length * 0.6) / halfBars);
        const v  = data[di] / 255;
        const bh = Math.max(3, v * H * 0.92);
        const y  = H / 2 - bh / 2;
        ctx.fillRect(cx + i * barW + gap * 0.5, y, bw, bh);
        ctx.fillRect(cx - (i + 1) * barW + gap * 0.5, y, bw, bh);
      }
    }
  }
  requestAnimationFrame(draw);
}

function mpStopVisualizer() {
  if (mp.rafId) { cancelAnimationFrame(mp.rafId); mp.rafId = null; }
}

// ── Volume control ─────────────────────────────────────────────────────────
function mpSetVolume(v) {
  mp.volume = Math.max(0, Math.min(1, v));
  if (!mp.muted) mpGetAudio().volume = mp.volume;
  const slider = $('mpVolSlider');
  if (slider) slider.value = mp.volume;
  mpUpdateVolDisplay();
  try { localStorage.setItem('lhost_mp_vol', mp.volume); } catch(_) {}
}

function mpToggleMuteAudio() {
  mp.muted = !mp.muted;
  mpGetAudio().volume = mp.muted ? 0 : mp.volume;
  mpUpdateVolDisplay();
}

function mpUpdateVolDisplay() {
  const v = mp.muted ? 0 : mp.volume;
  const pct = Math.round(v * 100);
  const pctEl = $('mpVolPct');
  if (pctEl) pctEl.textContent = pct + '%';
  const slider = $('mpVolSlider');
  if (slider) slider.value = v;
  const icon = $('mpVolIcon');
  if (!icon) return;
  if (v === 0) {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
  } else if (v < 0.4) {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
  } else {
    icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
  }
}

function mpToggleVolPopup(e) {
  e && e.stopPropagation();
  const popup = $('mpVolPopup');
  if (!popup) return;
  if (!popup.classList.contains('open')) {
    const btn = $('mpVolMute');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      // Vertical popup is 48px wide — align right edge with button right edge
      let right = window.innerWidth - rect.right;
      right = Math.max(8, right);
      popup.style.top   = (rect.bottom + 6) + 'px';
      popup.style.right = right + 'px';
      popup.style.left  = 'auto';
    }
  }
  popup.classList.toggle('open');
}

function mpCloseVolPopup() {
  $('mpVolPopup') && $('mpVolPopup').classList.remove('open');
}

// ── Playback speed ─────────────────────────────────────────────────────────
const MP_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function mpCycleSpeed() {
  const i = MP_SPEEDS.indexOf(mp.speed);
  mp.speed = MP_SPEEDS[(i + 1) % MP_SPEEDS.length];
  mpGetAudio().playbackRate = mp.speed;
  const btn = $('mpSpeedBtn');
  if (btn) {
    btn.textContent = mp.speed === 1 ? '1×' : mp.speed + '×';
    btn.classList.toggle('active-speed', mp.speed !== 1);
  }
  try { localStorage.setItem('lhost_mp_speed', mp.speed); } catch(_) {}
}

// ── Visualizer mode ────────────────────────────────────────────────────────
function mpSetVizMode(mode) {
  mp.vizMode = mode;
  qsa('.mp-viz-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  try { localStorage.setItem('lhost_mp_viz', mode); } catch(_) {}

  const artSection = $('mpArtSection');
  const vizWrap    = document.querySelector('.mp-viz-wrap');
  const circleCanvas = $('mpCircleCanvas');

  const artEl = $('mpArt');

  if (mode === 'circle') {
    artSection?.classList.add('circle-mode');
    if (vizWrap) vizWrap.style.display = 'none';
    // Activate vinyl spin if already playing
    if (artEl && mp.isPlaying) {
      artEl.classList.remove('vinyl-slowing');
      artEl.classList.add('vinyl-playing');
    }
  } else {
    artSection?.classList.remove('circle-mode');
    if (vizWrap) vizWrap.style.display = '';
    if (circleCanvas) { const c = circleCanvas.getContext('2d'); c.clearRect(0, 0, circleCanvas.width, circleCanvas.height); }
    // Remove vinyl spin when leaving circle mode
    if (artEl) { artEl.classList.remove('vinyl-playing', 'vinyl-slowing'); }
  }

  if (mp.rafId) { cancelAnimationFrame(mp.rafId); mp.rafId = null; }

  if (mode === 'off') {
    const canvas = $('mpVisualizer');
    if (canvas) { const c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height); }
  } else {
    mpStartVisualizer();
  }
}

// ── Sleep timer ────────────────────────────────────────────────────────────
function mpToggleSleepOpts(e) {
  e && e.stopPropagation();
  const opts = $('mpSleepOpts');
  if (!opts) return;
  opts.classList.toggle('open');
}

function mpCloseSleepOpts() {
  $('mpSleepOpts') && $('mpSleepOpts').classList.remove('open');
}

function mpSelectSleepOpt(minutes) {
  mpClearSleepTimer();
  mpCloseSleepOpts();

  const btn = $('mpSleepBtn');
  const lbl = $('mpSleepLabel');

  // Reset active state on all opts
  qsa('.mp-sleep-opt').forEach(o => o.classList.toggle('active', parseInt(o.dataset.min) === minutes));

  if (minutes === 0) {
    btn && btn.classList.remove('active');
    if (lbl) lbl.textContent = 'Sleep';
    toast('Sleep timer off');
    return;
  }
  if (minutes === -1) {
    mp.sleepTimer = 'eot';
    btn && btn.classList.add('active');
    if (lbl) lbl.textContent = 'End of track';
    toast('Sleep: end of track');
    return;
  }
  mp.sleepEnd = Date.now() + minutes * 60 * 1000;
  mp.sleepTimer = setInterval(() => mpUpdateSleepDisplay(), 1000);
  btn && btn.classList.add('active');
  mpUpdateSleepDisplay();
  toast(`Sleep timer: ${minutes} min`);
}

function mpUpdateSleepDisplay() {
  const lbl = $('mpSleepLabel');
  if (!lbl || !mp.sleepEnd) return;
  const rem = Math.max(0, mp.sleepEnd - Date.now());
  if (rem <= 0) {
    mpGetAudio().pause();
    mpSetPlaying(false);
    mpClearSleepTimer();
    const btn = $('mpSleepBtn');
    btn && btn.classList.remove('active');
    if (lbl) lbl.textContent = 'Sleep';
    qsa('.mp-sleep-opt').forEach(o => o.classList.remove('active'));
    return;
  }
  const m = Math.floor(rem / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  lbl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
}

function mpClearSleepTimer() {
  if (mp.sleepTimer && mp.sleepTimer !== 'eot') clearInterval(mp.sleepTimer);
  mp.sleepTimer = null;
  mp.sleepEnd = 0;
}

// ── ID3 Metadata loading ───────────────────────────────────────────────────
async function mpLoadMeta(item) {
  const cached = mp.metaCache[item.path];
  if (cached) { _mpApplyMeta(cached, item.path); return; }
  try {
    const data = await fetchJson(`/api/meta?path=${encodeURIComponent(item.path)}`);
    mp.metaCache[item.path] = data;
    if (mp.queue[mp.index] && mp.queue[mp.index].path === item.path) {
      _mpApplyMeta(data, item.path);
      mpUpdateMediaSession(mp.queue[mp.index]);
    }
  } catch (_) {}
}

function _mpApplyMeta(data, forPath) {
  if (!data) return;
  // Safety: don't apply if track changed since request was made
  if (mp.queue[mp.index] && mp.queue[mp.index].path !== forPath) return;
  const artistEl = $('mpArtist');
  if (artistEl) {
    const parts = [];
    if (data.artist) parts.push(data.artist);
    if (data.album)  parts.push(data.album);
    if (data.year)   parts.push(String(data.year));
    if (parts.length) artistEl.textContent = parts.join(' · ');
  }
  if (data.title) {
    const titleEl = $('mpTitle');
    if (titleEl) {
      titleEl.textContent = data.title;
      setTimeout(() => mpApplyMarquee(titleEl), 60);
    }
  }
}

// ── MediaSession API ───────────────────────────────────────────────────────
// Only updates metadata — action handlers are registered once in mpInitEvents.
function mpUpdateMediaSession(item) {
  if (!item || !('mediaSession' in navigator)) return;
  const cached = mp.metaCache[item.path];
  const title  = cached?.title  || item.name.replace(/\.[^.]+$/, '');
  const artist = cached?.artist || '';
  const album  = cached?.album  || '';
  const artUrl = location.origin + '/api/art?path=' + encodeURIComponent(item.path);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist, album,
      artwork: [
        { src: artUrl, sizes: '96x96',   type: 'image/jpeg' },
        { src: artUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: artUrl, sizes: '512x512', type: 'image/jpeg' },
      ],
    });
  } catch(_) {}
}

// ── Register MediaSession action handlers once at startup ──────────────────
// Registering on every track change creates a window where handlers are unset,
// causing the OS notification to briefly disappear (≈2 s flicker).
function mpInitMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const audio = mpGetAudio();
  try {
    navigator.mediaSession.setActionHandler('play', () => {
      if (mp.audioCtx && mp.audioCtx.state === 'suspended') mp.audioCtx.resume();
      audio.play().then(() => mpSetPlaying(true)).catch(() => {});
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
      mpSetPlaying(false);
    });
    // Stop — collapses to mini player (keeps audio alive, like Spotify minimize)
    try {
      navigator.mediaSession.setActionHandler('stop', () => {
        audio.pause();
        mpSetPlaying(false);
        mpHideMini();
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
      });
    } catch(_) {}
    navigator.mediaSession.setActionHandler('previoustrack', mpPrev);
    navigator.mediaSession.setActionHandler('nexttrack',     mpNext);
    navigator.mediaSession.setActionHandler('seekbackward', d => {
      audio.currentTime = Math.max(0, audio.currentTime - (d?.seekOffset || 10));
      mpUpdateProgress();
      mpSyncPositionState(audio);
    });
    navigator.mediaSession.setActionHandler('seekforward', d => {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d?.seekOffset || 10));
      mpUpdateProgress();
      mpSyncPositionState(audio);
    });
    try {
      navigator.mediaSession.setActionHandler('seekto', d => {
        if (d?.seekTime !== undefined && audio.duration) {
          audio.currentTime = Math.min(audio.duration, Math.max(0, d.seekTime));
          mpUpdateProgress();
          mpSyncPositionState(audio);
        }
      });
    } catch(_) {}
  } catch(_) {}
}

function mpSyncPositionState(audio) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!audio.duration) return;
  try {
    navigator.mediaSession.setPositionState({
      duration:     audio.duration,
      playbackRate: audio.playbackRate,
      position:     Math.min(audio.currentTime, audio.duration),
    });
  } catch(_) {}
}

// ── Album art swipe (mobile) ───────────────────────────────────────────────
function mpSetupArtSwipe() {
  const art = $('mpArt');
  if (!art) return;
  let tx = 0, ty = 0;
  art.addEventListener('touchstart', e => {
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
  }, { passive: true });
  art.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      if (dx < 0) mpNext(); else mpPrev();
    }
  }, { passive: true });
}

// ── Marquee for long titles ────────────────────────────────────────────────
function mpApplyMarquee(el) {
  if (!el) return;
  el.style.animation = 'none';
  el.style.paddingRight = '';
  void el.offsetWidth;
  const wrap = el.parentElement;
  if (!wrap) return;
  const overflow = el.scrollWidth - wrap.clientWidth;
  if (overflow > 6) {
    el.style.setProperty('--marquee-dist', `-${overflow + 14}px`);
    el.style.paddingRight = '14px';
    el.style.animation = `mp-marquee-scroll ${Math.max(6, overflow / 18)}s linear 1.8s infinite`;
  }
}

// ── Queue panel ────────────────────────────────────────────────────────────
function mpOpenQueue() {
  const panel = $('mpQueuePanel');
  if (!panel) return;
  panel.classList.add('open');
  const chevron = document.querySelector('.mp-queue-chevron');
  if (chevron) chevron.style.transform = 'rotate(180deg)';
  // Scroll the active item into view
  setTimeout(() => {
    const active = panel.querySelector('.mp-queue-item.active');
    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 360);
}

function mpCloseQueue() {
  const panel = $('mpQueuePanel');
  if (!panel) return;
  panel.classList.remove('open');
  const chevron = document.querySelector('.mp-queue-chevron');
  if (chevron) chevron.style.transform = '';
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

  // ── Escape parent stacking contexts ──────────────────────────────────────
  // Move vol/more popups to <body> so they escape any stacking-context trap
  // inside .mp-container (overflow:hidden, z-index:1). mpSleepOpts is kept in
  // its original DOM position but uses position:fixed (set below) so it also
  // escapes the overflow clip.
  ['mpVolPopup', 'mpMorePopup'].forEach(id => {
    const el = $(id);
    if (el && el.parentNode !== document.body) document.body.appendChild(el);
  });

  $('mpPlayBtn').addEventListener('click', mpTogglePlay);
  $('mpPrevBtn').addEventListener('click', mpPrev);
  $('mpNextBtn').addEventListener('click', mpNext);
  $('mpShuffleBtn').addEventListener('click', mpToggleShuffle);
  $('mpRepeatBtn').addEventListener('click', mpToggleRepeat);

  // Volume popup (desktop) - click icon to open/close
  $('mpVolMute') && $('mpVolMute').addEventListener('click', mpToggleVolPopup);
  const volSlider = $('mpVolSlider');
  if (volSlider) {
    volSlider.addEventListener('input', () => mpSetVolume(parseFloat(volSlider.value)));
    // Prevent popup closing when interacting with slider
    volSlider.addEventListener('click', e => e.stopPropagation());
  }
  $('mpVolPopup') && $('mpVolPopup').addEventListener('click', e => e.stopPropagation());

  // Sleep timer popup — position it above the button via fixed coords
  $('mpSleepBtn') && $('mpSleepBtn').addEventListener('click', e => {
    e.stopPropagation();
    const opts = $('mpSleepOpts');
    if (!opts) return;
    if (!opts.classList.contains('open')) {
      const rect = e.currentTarget.getBoundingClientRect();
      opts.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
      opts.style.left   = Math.max(8, rect.left + rect.width / 2 - 80) + 'px';
      opts.style.right  = 'auto';
      opts.style.transform = 'none';
    }
    opts.classList.toggle('open');
  });
  qsa('.mp-sleep-opt').forEach(btn => {
    btn.addEventListener('click', () => mpSelectSleepOpt(parseInt(btn.dataset.min)));
  });
  $('mpSleepOpts') && $('mpSleepOpts').addEventListener('click', e => e.stopPropagation());

  // More menu toggle
  $('mpMoreBtn') && $('mpMoreBtn').addEventListener('click', e => {
    e.stopPropagation();
    const popup = $('mpMorePopup');
    if (!popup) return;
    if (!popup.classList.contains('open')) {
      const rect = e.currentTarget.getBoundingClientRect();
      popup.style.top   = (rect.bottom + 8) + 'px';
      popup.style.right = (window.innerWidth - rect.right) + 'px';
      popup.style.left  = 'auto';
    }
    popup.classList.toggle('open');
    if (popup.classList.contains('open')) {
      clearTimeout(mp._vizAutoClose);
      mp._vizAutoClose = setTimeout(() => {
        popup.classList.remove('open');
      }, 6000);
    } else {
      clearTimeout(mp._vizAutoClose);
    }
  });
  $('mpMorePopup') && $('mpMorePopup').addEventListener('click', e => e.stopPropagation());

  // Visualizer mode buttons — stay open, reset 6-second auto-close on each pick
  qsa('.mp-viz-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mpSetVizMode(btn.dataset.mode);
      clearTimeout(mp._vizAutoClose);
      mp._vizAutoClose = setTimeout(() => {
        $('mpMorePopup') && $('mpMorePopup').classList.remove('open');
      }, 6000);
    });
  });

  // Queue panel: open on toggle, close on X or down-swipe
  $('mpQueueToggle') && $('mpQueueToggle').addEventListener('click', mpOpenQueue);
  $('mpQueueClose') && $('mpQueueClose').addEventListener('click', mpCloseQueue);

  // Close queue on swipe down — only when list is at the top or touch started in header
  const qPanel = $('mpQueuePanel');
  const qPanelHdr = qPanel && qPanel.querySelector('.mp-queue-panel-hdr');
  if (qPanel) {
    let qTy = 0, qTouchInHdr = false;
    qPanel.addEventListener('touchstart', e => {
      qTy = e.touches[0].clientY;
      qTouchInHdr = qPanelHdr ? qPanelHdr.contains(e.target) : false;
    }, { passive: true });
    qPanel.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - qTy;
      const list = $('mpQueueList');
      const atTop = !list || list.scrollTop <= 2;
      if (dy > 80 && (qTouchInHdr || atTop)) mpCloseQueue();
    }, { passive: true });
  }

  audio.addEventListener('timeupdate', () => {
    mpUpdateProgress();
    mpSyncPositionState(audio);
  });
  audio.addEventListener('loadedmetadata', () => {
    $('mpDuration').textContent = fmtTime(audio.duration);
    // Set position state immediately so the OS notification shows the progress bar right away
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration:     audio.duration,
          playbackRate: audio.playbackRate,
          position:     0,
        });
      } catch(_) {}
    }
  });
  audio.addEventListener('ended', () => {
    // Sleep: end of track
    if (mp.sleepTimer === 'eot') {
      mpSetPlaying(false);
      mpClearSleepTimer();
      const btn = $('mpSleepBtn');
      btn && btn.classList.remove('active');
      const lbl = $('mpSleepLabel');
      if (lbl) lbl.textContent = 'Sleep';
      qsa('.mp-sleep-opt').forEach(o => o.classList.remove('active'));
      mpHideMini();
      return;
    }
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
  audio.addEventListener('play',  () => {
    mpSetPlaying(true);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  audio.addEventListener('pause', () => {
    mpSetPlaying(false);
    if (!mp.trackChanging && 'mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });

  const bar = $('mpProgressBar');
  bar.addEventListener('mousedown', e => { mp.progressDragging = true; mpSeekFromEvent(e); });
  bar.addEventListener('touchstart', e => { mp.progressDragging = true; mpSeekFromEvent(e); }, { passive: true });
  document.addEventListener('mousemove', e => { if (mp.progressDragging) mpSeekFromEvent(e); });
  document.addEventListener('touchmove', e => { if (mp.progressDragging) mpSeekFromEvent(e); }, { passive: true });
  document.addEventListener('mouseup',   () => { mp.progressDragging = false; });
  document.addEventListener('touchend',  () => { mp.progressDragging = false; });

  // Restore saved preferences
  const savedVol = parseFloat(localStorage.getItem('lhost_mp_vol') ?? '1');
  mp.volume = isNaN(savedVol) ? 1 : Math.max(0, Math.min(1, savedVol));
  const savedSpeed = parseFloat(localStorage.getItem('lhost_mp_speed') ?? '1');
  mp.speed = MP_SPEEDS.includes(savedSpeed) ? savedSpeed : 1;
  const savedViz = localStorage.getItem('lhost_mp_viz') || 'circle';
  mpSetVizMode(savedViz);
  mpUpdateVolDisplay();

  // Global click → close all floating popups
  document.addEventListener('click', () => {
    mpCloseVolPopup();
    mpCloseSleepOpts();
    const morePopup = $('mpMorePopup');
    if (morePopup && morePopup.classList.contains('open')) {
      morePopup.classList.remove('open');
      clearTimeout(mp._vizAutoClose);
    }
  });

  // Album art swipe gesture
  mpSetupArtSwipe();

  // Register MediaSession action handlers once — prevents notification flicker
  mpInitMediaSession();
}

// ── Resume storage ─────────────────────────────────────────────────────────
function resumeKey(path) { return `lhost_resume_${path}`; }
function saveResume(path, time) {
  try { if (time > 3) localStorage.setItem(resumeKey(path), String(time)); } catch(_) {}
}
function loadResume(path) {
  try { return parseFloat(localStorage.getItem(resumeKey(path)) || '0') || 0; } catch(_) { return 0; }
}
function clearResume(path) {
  try { localStorage.removeItem(resumeKey(path)); } catch(_) {}
}

// ── Open / Close ───────────────────────────────────────────────────────────
function vpUpdateNavButtons() {
  const hasPrev = vp.videoIdx > 0;
  const hasNext = vp.videoIdx >= 0 && vp.videoIdx < vp.videoSet.length - 1;
  const prevBtn = $('vpPrevBtn');
  const nextBtn = $('vpNextBtn');
  if (prevBtn) prevBtn.style.opacity = hasPrev ? '1' : '0.3';
  if (prevBtn) prevBtn.disabled = !hasPrev;
  if (nextBtn) nextBtn.style.opacity = hasNext ? '1' : '0.3';
  if (nextBtn) nextBtn.disabled = !hasNext;
}

function vpPrev() {
  if (vp.videoIdx <= 0 || !vp.videoSet.length) return;
  vp.videoIdx--;
  openVideo(vp.videoSet[vp.videoIdx], vp.videoSet, vp.videoIdx);
}

function vpNext() {
  if (vp.videoIdx < 0 || vp.videoIdx >= vp.videoSet.length - 1) return;
  vp.videoIdx++;
  openVideo(vp.videoSet[vp.videoIdx], vp.videoSet, vp.videoIdx);
}

function openVideo(item, videoSet, videoIdx) {
  if (videoSet && Array.isArray(videoSet)) {
    vp.videoSet = videoSet;
    vp.videoIdx = (videoIdx !== undefined) ? videoIdx : videoSet.findIndex(v => v.path === item.path);
    if (vp.videoIdx === -1) { vp.videoSet = [item]; vp.videoIdx = 0; }
  } else if (!videoSet) {
    vp.videoSet = [item];
    vp.videoIdx = 0;
  }
  vpUpdateNavButtons();

  const newUrl  = `/file?path=${encodeURIComponent(item.path)}`;
  const vid     = $('videoPlayer');
  const native  = isNativeVideo(item);
  const fallback = $('vpFormatFallback');

  $('vpTitle').textContent    = item.name;
  $('vpDownloadBtn').href     = newUrl + '&dl=1';
  $('vpDownloadBtn').download = item.name;
  $('videoModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  history.pushState({ lhost: true }, '');
  vpShowControls();
  vpBuildSpeedMenu();

  if (!native) {
    // ── Unsupported / legacy format — show fallback panel ───────────────
    vp.item = item;
    vp.url  = '';
    vid.pause();
    vid.removeAttribute('src');
    vid.load();
    vid.style.display = 'none';
    $('vpControls').style.visibility = 'hidden';
    $('vpGestureLayer').style.pointerEvents = 'none';
    fallback.classList.remove('hidden');
    const dlBtn = $('vpFallbackDlBtn');
    if (dlBtn) { dlBtn.href = newUrl + '&dl=1'; dlBtn.download = item.name; }
    return;
  }

  // ── Native format — restore player, hide fallback ───────────────────
  vid.style.display = '';
  $('vpControls').style.visibility = '';
  $('vpGestureLayer').style.pointerEvents = '';
  fallback.classList.add('hidden');

  if (vp.url === newUrl && vid.readyState >= 1) {
    // ── Same video already loaded — no re-download ──────────────────────
    vp.item = item;
    vid.volume = vp.volume;
    vid.muted  = vp.muted;
    $('vpBrightness').style.opacity = 1 - vp.brightness;
    const resume = loadResume(item.path);
    if (resume > 2 && vid.duration && resume < vid.duration - 3) {
      vid.currentTime = resume;
    }
    vid.play().catch(() => {});
  } else {
    // ── Different (or first) video — load it ────────────────────────────
    vp.item = item;
    vp.url  = newUrl;
    vid.volume      = vp.volume;
    vid.muted       = vp.muted;
    vpSetAspect(vp.aspectIdx);
    $('vpBrightness').style.opacity = 1 - vp.brightness;
    vid.preload      = 'auto';
    vid.src          = newUrl;
    vid.playbackRate = vp.speed;

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
}

function closeVideo() {
  const vid = $('videoPlayer');
  if (vp.item) saveResume(vp.item.path, vid.currentTime);
  vid.pause();
  // Reset fallback state
  $('vpFormatFallback').classList.add('hidden');
  vid.style.display = '';
  $('vpControls').style.visibility = '';
  $('vpGestureLayer').style.pointerEvents = '';
  // Keep vid.src — so re-opening the same video is instant (no re-download).
  // Just reduce buffering by setting preload to none while hidden.
  vid.preload = 'none';
  clearTimeout(vp.controlsTimer);
  clearTimeout(vp.previewTimer);
  clearTimeout(vp.clickTimer);
  if (vp.previewVideo) {
    try { vp.previewVideo.pause(); vp.previewVideo.removeAttribute('src'); vp.previewVideo.load(); } catch(_) {}
    vp.previewVideo = null;
  }
  vp.previewVideoUrl = '';
  vp.previewBusy = false;
  vp.previewPendingTime = null;
    vp.previewCache = new LRUCache(24);
  const _thumb = $('vpProgressThumb');
  if (_thumb && _thumb._blobUrl) { URL.revokeObjectURL(_thumb._blobUrl); _thumb._blobUrl = null; }
  $('videoModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $('vpWrap').classList.remove('controls-hidden','theater');
}

function _vpEnsurePreload() {
  $('videoPlayer').preload = 'auto';
}

// ── Controls auto-hide ─────────────────────────────────────────────────────
function vpShowControls() {
  $('vpWrap').classList.remove('controls-hidden');
  clearTimeout(vp.controlsTimer);
  if (vp.controlsLocked) return;
  const vid = $('videoPlayer');
  if (!vid.paused) {
    vp.controlsTimer = setTimeout(() => $('vpWrap').classList.add('controls-hidden'), 5000);
  }
}

function vpLockControls(ms) {
  vp.controlsLocked = true;
  clearTimeout(vp.controlsTimer);
  $('vpWrap').classList.remove('controls-hidden');
  clearTimeout(vp.lockTimer);
  vp.lockTimer = setTimeout(() => {
    vp.controlsLocked = false;
    vpShowControls();
  }, ms || 8000);
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

function vpHasVideoOpen() {
  return !$('videoModal').classList.contains('hidden');
}

// ── Volume ─────────────────────────────────────────────────────────────────
function vpSetVolume(v) {
  vp.volume = Math.max(0, Math.min(1, v));
  $('videoPlayer').volume = vp.volume;
  const range = $('vpVolRange');
  range.value = vp.volume;
  range.style.setProperty('--vol-pct', (vp.volume * 100) + '%');
  const pct = $('vpVolPct');
  if (pct) pct.textContent = Math.round(vp.volume * 100) + '%';
  vpUpdateVolIcon();
  vpPrefs.volume = vp.volume;
  saveVpPrefs();
}

function vpToggleMute() {
  vp.muted = !vp.muted;
  $('videoPlayer').muted = vp.muted;
  vpUpdateVolIcon();
  vpPrefs.muted = vp.muted;
  saveVpPrefs();
}

function vpUpdateVolIcon() {
  const muted = vp.muted || vp.volume === 0;
  const w1 = $('vpVolWave1'); if (w1) w1.style.display = muted ? 'none' : '';
  const w2 = $('vpVolWave2'); if (w2) w2.style.display = muted ? 'none' : '';
}

// ── Progress bar ───────────────────────────────────────────────────────────
function vpUpdateProgress() {
  const vid = $('videoPlayer');
  if (!vid.duration) return;
  if (vp.progressDragging) return; // Don't fight with drag handler
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
  const tooltipTime = $('vpProgressTooltipTime');
  const thumb = $('vpProgressThumb');

  function updateTooltip(ratio) {
    const vid = $('videoPlayer');
    const t = ratio * (vid.duration || 0);
    tooltipTime.textContent = fmtTime(t);
    tooltip.style.left = (ratio * 100) + '%';
    vpSchedulePreview(t);
  }

  function startDrag(e) {
    e.preventDefault();
    vp.progressDragging = true;
    vp.controlsLocked = true;
    clearTimeout(vp.controlsTimer);
    $('vpWrap').classList.remove('controls-hidden');
    track.classList.add('dragging');
    updateDrag(e);
    document.addEventListener('mousemove', updateDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', updateDrag, { passive: false });
    document.addEventListener('touchend', endDrag);
  }

  function updateDrag(e) {
    if (!vp.progressDragging) return;
    e.preventDefault && e.preventDefault();
    const ratio = vpProgressFromEvent(e);
    const vid   = $('videoPlayer');
    $('vpProgressFill').style.width = (ratio * 100) + '%';
    $('vpProgressDot').style.left   = (ratio * 100) + '%';
    $('vpCurrentTime').textContent  = fmtTime(ratio * (vid.duration || 0));
    updateTooltip(ratio);
  }

  function endDrag(e) {
    if (!vp.progressDragging) return;
    vp.progressDragging = false;
    vp.controlsLocked = false;
    track.classList.remove('dragging');
    document.removeEventListener('mousemove', updateDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', updateDrag);
    document.removeEventListener('touchend', endDrag);
    const ratio = vpProgressFromEvent(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e);
    const vid   = $('videoPlayer');
    vid.currentTime = ratio * (vid.duration || 0);
    vpShowControls();
  }

  track.addEventListener('mousedown', startDrag);
  track.addEventListener('touchstart', startDrag, { passive: false });

  track.addEventListener('mousemove', e => {
    const ratio = vpProgressFromEvent(e);
    updateTooltip(ratio);
  });

  track.addEventListener('mouseleave', () => {
    clearTimeout(vp.previewTimer);
    tooltip.classList.remove('has-thumb');
    thumb.removeAttribute('src');
  });
}

function vpSchedulePreview(time) {
  const vid     = $('videoPlayer');
  const tooltip = $('vpProgressTooltip');
  const thumb   = $('vpProgressThumb');

  if (!vp.url || !vid.duration || !Number.isFinite(time)) {
    tooltip.classList.remove('has-thumb');
    return;
  }

  clearTimeout(vp.previewTimer);

  vp.previewTimer = setTimeout(() => {
    const maxT = Math.max(0, (vid.duration || 0) - 0.25);
    const t = Math.max(0, Math.min(maxT, time));
    vpRenderClientPreview(t, tooltip, thumb);
  }, 220);
}

function vpGetPreviewVideo() {
  if (vp.previewVideo && vp.previewVideoUrl === vp.url) return vp.previewVideo;

  if (vp.previewVideo) {
    try { vp.previewVideo.pause(); vp.previewVideo.removeAttribute('src'); vp.previewVideo.load(); } catch(_) {}
  }

  const pv = document.createElement('video');
  pv.muted = true;
  pv.preload = 'metadata';
  pv.playsInline = true;
  pv.src = vp.url;
  try { pv.load(); } catch (_) {}

  vp.previewVideo = pv;
  vp.previewVideoUrl = vp.url;
  return pv;
}

function vpRenderClientPreview(time, tooltip, thumb) {
  const previewTime = Math.max(0, Math.round(time / VP_PREVIEW_BUCKET_SECONDS) * VP_PREVIEW_BUCKET_SECONDS);
  const cacheKey = `${vp.url}::${previewTime}`;
  const cached = vp.previewCache.get(cacheKey);
  if (cached) {
    thumb.src = cached;
    tooltip.classList.add('has-thumb');
    return;
  }

  if (vp.previewBusy) {
    vp.previewPendingTime = time;
    return;
  }

  const pv = vpGetPreviewVideo();
  vp.previewBusy = true;
  vp.previewPendingTime = null;

  let done = false;
  const cleanup = () => {
    pv.removeEventListener('seeked', onSeeked);
    pv.removeEventListener('error', onError);
    clearTimeout(timeout);
  };
  const finish = () => {
    cleanup();
    vp.previewBusy = false;
    if (vp.previewPendingTime !== null && !$('videoModal').classList.contains('hidden')) {
      const nextTime = vp.previewPendingTime;
      vp.previewPendingTime = null;
      vpRenderClientPreview(nextTime, tooltip, thumb);
    }
  };
  const fail = () => {
    if (done) return;
    done = true;
    tooltip.classList.remove('has-thumb');
    finish();
  };
  const timeout = setTimeout(fail, 3500);

  function onError() { fail(); }

  function captureFrame() {
    if (done) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      canvas.getContext('2d').drawImage(pv, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      vp.previewCache.set(cacheKey, dataUrl);
      thumb.src = dataUrl;
      tooltip.classList.add('has-thumb');
      done = true;
      finish();
    } catch (_) {
      fail();
    }
  }

  function onSeeked() { captureFrame(); }
  function onLoadedData() {
    if (Math.abs((pv.currentTime || 0) - previewTime) < 0.2) captureFrame();
  }

  pv.addEventListener('seeked', onSeeked, { once: true });
  pv.addEventListener('loadeddata', onLoadedData, { once: true });
  pv.addEventListener('error', onError, { once: true });

  try {
    if (pv.readyState < 1) {
      pv.addEventListener('loadedmetadata', () => {
        try {
          pv.currentTime = Math.min(Math.max(0, previewTime), Math.max(0, (pv.duration || previewTime) - 0.25));
        } catch (_) {
          fail();
        }
      }, { once: true });
    } else {
      pv.currentTime = Math.min(Math.max(0, previewTime), Math.max(0, (pv.duration || previewTime) - 0.25));
    }
  } catch (_) {
    fail();
  }
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
      vpBuildSpeedMenu();
      $('vpSpeedPopup').classList.add('hidden');
      vpPrefs.speed = s;
      saveVpPrefs();
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
  vpPrefs.aspectIdx = vp.aspectIdx;
  saveVpPrefs();
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
  vpPrefs.brightness = vp.brightness;
  saveVpPrefs();
}

// ── Gesture layer (touch) ──────────────────────────────────────────────────
function vpInitGestures() {
  const layer = $('vpGestureLayer');

  layer.addEventListener('touchstart', e => {
    vp.touch.controlsWereHidden = $('vpWrap').classList.contains('controls-hidden');
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
      const now = Date.now();
      const side = isLeft ? 'left' : 'right';
      const lastKey = side === 'left' ? 'leftTap' : 'rightTap';
      vp.suppressClickUntil = now + 500;
      if (now - vp.touch[lastKey] < 300) {
        // Double-tap: seek
        clearTimeout(vp.clickTimer);
        vpSeek(isLeft ? -10 : 10);
        vp.touch[lastKey] = 0;
      } else {
        vp.touch[lastKey] = now;
        clearTimeout(vp.clickTimer);
        // Detect if tap is in center zone (middle 40% of width, middle 50% of height)
        const rect = layer.getBoundingClientRect();
        const relX = (t.clientX - rect.left) / rect.width;
        const relY = (t.clientY - rect.top)  / rect.height;
        const isCenter = relX > 0.3 && relX < 0.7 && relY > 0.25 && relY < 0.75;
        vp.clickTimer = setTimeout(() => {
          if (vp.touch.controlsWereHidden) {
            vpShowControls();
          } else {
            // Hide controls
            clearTimeout(vp.controlsTimer);
            $('vpWrap').classList.add('controls-hidden');
          }
          // Center tap also toggles play/pause
          if (isCenter) vpTogglePlay();
        }, 260);
      }
    }
    vp.touch.type = null;
  });

  // Desktop click: center = play/pause, edges = toggle controls
  layer.addEventListener('click', e => {
    if (Date.now() < vp.suppressClickUntil) return;
    clearTimeout(vp.clickTimer);
    const rect = layer.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top)  / rect.height;
    const isCenter = relX > 0.3 && relX < 0.7 && relY > 0.25 && relY < 0.75;
    vp.clickTimer = setTimeout(() => {
      if (isCenter) {
        vpTogglePlay();
        vpShowControls();
      } else {
        const controlsHidden = $('vpWrap').classList.contains('controls-hidden');
        if (controlsHidden) vpShowControls();
        else {
          clearTimeout(vp.controlsTimer);
          $('vpWrap').classList.add('controls-hidden');
        }
      }
    }, 210);
  });

  layer.addEventListener('dblclick', e => {
    clearTimeout(vp.clickTimer);
    const rect = layer.getBoundingClientRect();
    const isLeft = e.clientX - rect.left < rect.width / 2;
    vpSeek(isLeft ? -10 : 10);
  });

  layer.addEventListener('mousemove', () => vpShowControls());
}

// ── Play/pause UI sync ─────────────────────────────────────────────────────
function vpSyncPlayIcon(playing) {
  const icon = $('vpPlayIcon');
  icon.innerHTML = playing
    ? '<rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none"/>'
    : '<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>';
}

// ── Info Panel ─────────────────────────────────────────────────────────────
function vpShowInfo() {
  const vid  = $('videoPlayer');
  const body = $('vpInfoBody');
  const item = vp.item;
  body.innerHTML = '';
  const rows = [
    ['Name',       item?.name || '—'],
    ['Duration',   vid.duration ? fmtTime(vid.duration) : '—'],
    ['Resolution', (vid.videoWidth && vid.videoHeight) ? `${vid.videoWidth} × ${vid.videoHeight}` : '—'],
    ['Size',       item?.sizeStr || '—'],
    ['Speed',      vp.speed + '×'],
    ['Path',       item?.path || '—'],
  ];
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'vp-info-row';
    row.innerHTML = `<span class="vp-info-key">${k}</span><span class="vp-info-val">${v}</span>`;
    body.appendChild(row);
  });
  $('vpInfoPanel').classList.remove('hidden');
  $('vpInfoBtn').classList.add('active');
  vpLockControls(8000);
}

function vpHideInfo() {
  $('vpInfoPanel').classList.add('hidden');
  $('vpInfoBtn').classList.remove('active');
  vp.controlsLocked = false;
  vpShowControls();
}

function vpToggleInfo() {
  $('vpInfoPanel').classList.contains('hidden') ? vpShowInfo() : vpHideInfo();
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
  $('vpPrevBtn').addEventListener('click', e => { e.stopPropagation(); vpPrev(); vpShowControls(); });
  $('vpNextBtn').addEventListener('click', e => { e.stopPropagation(); vpNext(); vpShowControls(); });
  $('vpPlayBtn').addEventListener('click', e => { e.stopPropagation(); vpTogglePlay(); vpShowControls(); });
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
  $('vpInfoBtn').addEventListener('click', e => { e.stopPropagation(); vpToggleInfo(); });
  $('vpInfoClose').addEventListener('click', e => { e.stopPropagation(); vpHideInfo(); });
  $('vpInfoPanel').addEventListener('click', e => e.stopPropagation());

  // Screencast / Remote Playback (Cast to TV)
  $('vpCastBtn').addEventListener('click', e => {
    e.stopPropagation();
    vpLockControls(10000);
    const vid = $('videoPlayer');
    if (vid.remote) {
      vid.remote.prompt()
        .then(() => { vpLockControls(3000); })
        .catch(() => {
          vpShowCastTip('No cast device found. Connect Chromecast to the same Wi-Fi.');
        });
    } else {
      vpShowCastTip('Open browser menu → Cast… to screen-cast this video.');
    }
  });

  function vpShowCastTip(msg) {
    let tip = $('vpCastTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'vpCastTip';
      tip.style.cssText = 'position:absolute;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(10,15,28,0.92);backdrop-filter:blur(8px);color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;z-index:50;pointer-events:none;white-space:nowrap;border:1px solid rgba(255,255,255,0.12);';
      $('vpWrap').appendChild(tip);
    }
    tip.textContent = msg;
    tip.style.opacity = '1';
    clearTimeout(tip._t);
    tip._t = setTimeout(() => { tip.style.opacity = '0'; }, 3500);
  }

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
  const isHome = name === 'home';
  $('viewMenuBtn')?.classList.toggle('hidden', isHome);
  if (isHome) {
    $('viewMenu')?.classList.add('hidden');
    $('viewMenuBtn')?.classList.remove('active');
  }
}

// ── Home ───────────────────────────────────────────────────────────────────
async function loadHome() {
  showView('home');
  updateBreadcrumb('');
  setNavActive('navFiles');
  loadRecent();
  loadFolders();
  loadFavorites();
}

function renderRecentCards(grid, items) {
  grid.innerHTML = '';
  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'recent-card';
    if (item.category === 'image') {
      card.innerHTML = `<img class="lazy-img" data-src="/api/thumb?path=${encodeURIComponent(item.path)}&w=300&h=225" decoding="async" alt="${item.name}">
        <div class="card-overlay"><span class="card-name">${item.name}</span></div>`;
    } else if (item.category === 'video') {
      const videoUrl = `/file?path=${encodeURIComponent(item.path)}`;
      if (isNativeVideo(item)) {
        card.innerHTML = `<div class="vt-thumb" data-thumb-url="${videoUrl}" style="width:100%;height:100%;position:relative;overflow:hidden;">
            <img class="vt-canvas" style="display:none;width:100%;height:100%;object-fit:cover;" alt="${item.name}">
            <div class="vt-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a0030,#3a1070);font-size:42px;">🎬</div>
          </div>
          <div class="card-overlay"><span class="card-name">${item.name}</span></div>
          <div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg></div>`;
      } else {
        card.innerHTML = `<div class="vt-static-thumb">
            <div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg></div>
          </div>
          <div class="card-overlay"><span class="card-name">${item.name}</span></div>`;
      }
    } else if (item.category === 'audio') {
      const [c1, c2] = audioPalette(item.name);
      const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
      const audioIcon = item.ext === '.opus' ? '🎙️' : '🎵';
      card.innerHTML = `<div style="width:100%;height:100%;position:relative;overflow:hidden;background:linear-gradient(135deg,${c1},${c2});">
          <img src="${artUrl}" decoding="async" style="width:100%;height:100%;object-fit:cover;display:block;"
            onerror="this.style.display='none';">
          <div class="music-fallback" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:42px;pointer-events:none;opacity:0.4;">${audioIcon}</div>
        </div>
        <div class="card-overlay"><span class="card-name">${item.name}</span></div>`;
    } else {
      card.innerHTML = `<div class="recent-file-thumb">${fileThumbHtml(item)}</div>
        <div class="card-overlay"><span class="card-name">${item.name}</span></div>`;
    }
    card.addEventListener('click', () => openFile(item));
    if (item.category === 'image' && imgObserver) {
      const li = card.querySelector('.lazy-img');
      if (li) imgObserver.observe(li);
    }
    if (item.category === 'video' && isNativeVideo(item) && thumbObserver) {
      const vtThumb = card.querySelector('.vt-thumb');
      if (vtThumb) thumbObserver.observe(vtThumb);
    }
    grid.appendChild(card);
  }
}

async function loadRecent() {
  const grid = $('recentGrid');
  grid.innerHTML = '<div class="loader-wrap"><div class="loader"></div></div>';
  try {
    const data = await fetchJson('/api/recent?limit=8');
    const recents = data.items || [];
    if (recents.length) {
      renderRecentCards(grid, recents);
      return;
    }
    grid.innerHTML = '<div class="empty-state"><p>No recent files</p></div>';
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

async function loadFolders() {
  const scroll = $('foldersScroll');
  scroll.innerHTML = '<div class="loader-wrap"><div class="loader"></div></div>';
  try {
    const data = await fetchJson(`/api/ls?path=&page=0&limit=50&${buildListParams()}`);
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
  history.pushState({ lhost: true }, '');
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
    const data = await fetchJson(`/api/ls?path=${encodeURIComponent(relPath)}&page=0&limit=${PG_LIMIT}&${buildListParams()}`);
    grid.innerHTML = '';

    if (!data.total) {
      grid.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><p>Empty folder</p></div>';
      return;
    }

    pg.total = data.total;
    pg.page  = 1;
    pg.imageSet = data.items.filter(i => i.category === 'image');
    pg.audioSet = data.items.filter(i => i.category === 'audio');
    pg.videoSet = data.items.filter(i => i.category === 'video');

    // Show total count badge if large
    if (data.total > PG_LIMIT) {
      const badge = document.createElement('div');
      badge.className = 'pg-count-badge';
      badge.textContent = `${data.total.toLocaleString()} items`;
      grid.appendChild(badge);
    }

    for (const item of data.items) {
      grid.appendChild(createItemEl(item, pg.imageSet, pg.audioSet, pg.videoSet));
    }
    pgSentinelSetup();
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`; }
}

function renderItems(container, items, imageSet, audioSet, videoSet = []) {
  container.innerHTML = '';
  // Also update pg sets so click handlers always have fresh refs
  pg.imageSet = imageSet; pg.audioSet = audioSet; pg.videoSet = videoSet;
  for (const item of items) { container.appendChild(createItemEl(item, imageSet, audioSet, videoSet)); }
}

function createItemEl(item, imageSet = [], audioSet = [], videoSet = []) {
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
    const fmt = imageFormatInfo(item);
    if (fmt.native) {
      thumbHtml = `<div class="thumb"><img class="lazy-img" data-src="/api/thumb?path=${encodeURIComponent(item.path)}&w=300&h=225" decoding="async" alt="${item.name}"></div>`;
    } else {
      thumbHtml = `<div class="thumb format-thumb ${fmt.className}">
        <div class="format-thumb-mark">${fmt.badge.slice(0, 1)}</div>
        <span class="format-thumb-badge">${fmt.badge}</span>
      </div>`;
    }
  } else if (isVid) {
    const videoUrl = `/file?path=${encodeURIComponent(item.path)}`;
    if (isNativeVideo(item)) {
      thumbHtml = `<div class="thumb vt-thumb" data-thumb-url="${videoUrl}">
        <img class="vt-canvas" style="display:none;width:100%;height:100%;object-fit:cover;" alt="${item.name}">
        <div class="vt-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a0030,#3a1070);"><span style="font-size:28px;opacity:0.5;">🎬</span></div>
        <div class="video-play-overlay" style="opacity:0;transition:opacity 0.3s;"><div class="play-circle"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
      </div>`;
    } else {
      thumbHtml = `<div class="thumb vt-static-thumb">
        <div class="play-circle"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
      </div>`;
    }
  } else if (isAudio) {
    const [c1, c2] = audioPalette(item.name);
    const artUrl = `/api/art?path=${encodeURIComponent(item.path)}`;
    const isVoice = item.ext === '.opus';
    const audioMark = isVoice
      ? '<span class="at-icon at-voice-icon">🎙️</span>'
      : '<svg viewBox="0 0 24 24" class="at-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    thumbHtml = `<div class="thumb">
      <div class="audio-thumb-art" style="background:linear-gradient(135deg,${c1},${c2})" data-audio-art="${artUrl}">
        <img class="audio-art-img" alt="">
        ${audioMark}
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
    thumbHtml = fileThumbHtml(item);
  }

  el.innerHTML = `${thumbHtml}
    <div class="item-info">
      <div class="item-name">${item.name}</div>
      <div class="item-size">${item.sizeStr}</div>
    </div>
    <button class="item-more" data-more>
      <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
    </button>`;

  if (isImg && imgObserver && imageFormatInfo(item).native) {
    const lazyImg = el.querySelector('.lazy-img');
    if (lazyImg) imgObserver.observe(lazyImg);
  }

  if (isAudio && audioArtObserver) {
    const artEl = el.querySelector('.audio-thumb-art');
    if (artEl) audioArtObserver.observe(artEl);
  }

  if (isAudio && eqObserver) eqObserver.observe(el);

  if (isVid && isNativeVideo(item) && thumbObserver) {
    const vtThumb = el.querySelector('.vt-thumb');
    if (vtThumb) thumbObserver.observe(vtThumb);
  }

  // Register with memory observer so media is unloaded when far off-screen
  if (memObserver) memObserver.observe(el);

  el.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { showCtxMenu(e, item); return; }
    if (isDir) navigate(item.path);
    else {
      // Use live pg sets so items loaded later are included in swipe/queue nav
      const imgs  = pg.imageSet.length ? pg.imageSet : imageSet;
      const auds  = pg.audioSet.length ? pg.audioSet : audioSet;
      const vids  = pg.videoSet.length ? pg.videoSet : videoSet;
      openFile(item, imgs, auds, vids);
    }
  });
  el.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, item); });
  return el;
}

// ── Category View ──────────────────────────────────────────────────────────
async function loadCategory(cat) {
  history.pushState({ lhost: true }, '');
  showView('cat');
  $('catViewTitle').textContent = cat + 's';
  const grid = $('catGrid');
  pgReset('cat', cat, grid);

  grid.innerHTML = '';
  grid.appendChild(createSkeletons(12));

  try {
    const data = await fetchJson(`/api/category/${cat}?page=0&limit=${PG_LIMIT}&${buildListParams()}`);
    grid.innerHTML = '';
    if (!data.total) { grid.innerHTML = `<div class="empty-state"><p>No ${cat} files found</p></div>`; return; }

    pg.total = data.total;
    pg.page  = 1;
    pg.imageSet = data.results.filter(i => i.category === 'image');
    pg.audioSet = data.results.filter(i => i.category === 'audio');
    pg.videoSet = data.results.filter(i => i.category === 'video');

    if (data.total > PG_LIMIT) {
      const badge = document.createElement('div');
      badge.className = 'pg-count-badge';
      badge.textContent = `${data.total.toLocaleString()} ${cat}s found`;
      grid.appendChild(badge);
    }

    for (const item of data.results) {
      grid.appendChild(createItemEl(item, pg.imageSet, pg.audioSet, pg.videoSet));
    }
    pgSentinelSetup();
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`; }
}

// ── Recent All View ────────────────────────────────────────────────────────
async function loadRecentAll() {
  history.pushState({ lhost: true }, '');
  showView('recentAll');
  const grid = $('recentAllGrid');
  grid.innerHTML = '';
  grid.appendChild(createSkeletons(12));

  try {
    const data = await fetchJson('/api/recent?limit=50');
    const items = data.items || [];
    grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state"><p>No recent files yet</p></div>';
      return;
    }
    const badge = document.createElement('div');
    badge.className = 'pg-count-badge';
    badge.textContent = `${items.length} recent file${items.length !== 1 ? 's' : ''}`;
    grid.appendChild(badge);

    const imageSet = items.filter(i => i.category === 'image');
    const audioSet = items.filter(i => i.category === 'audio');
    const videoSet = items.filter(i => i.category === 'video');
    pg.videoSet = videoSet;
    for (const item of items) {
      grid.appendChild(createItemEl(item, imageSet, audioSet, videoSet));
    }
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
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}&path=&page=0&limit=${PG_LIMIT}&hidden=${prefs.showHidden ? '1' : '0'}`);
    const total = data.total || 0;
    $('searchResultsLabel').textContent = `${total.toLocaleString()} result${total !== 1 ? 's' : ''} for "${q}"`;
    grid.innerHTML = '';
    if (!total) { grid.innerHTML = '<div class="empty-state"><p>No files found</p></div>'; return; }

    pg.total = total;
    pg.page  = 1;
    pg.imageSet = data.results.filter(i => i.category === 'image');
    pg.audioSet = data.results.filter(i => i.category === 'audio');
    pg.videoSet = data.results.filter(i => i.category === 'video');

    for (const item of data.results) {
      grid.appendChild(createItemEl(item, pg.imageSet, pg.audioSet, pg.videoSet));
    }
    pgSentinelSetup();
  } catch (e) { grid.innerHTML = `<div class="empty-state"><p>Error: ${e.message}</p></div>`; }
}

// ── Open file ──────────────────────────────────────────────────────────────
function openFile(item, imageSet = [], audioSet = [], videoSet = []) {
  // Persist to recent.json via dedicated endpoint
  fetch('/api/recent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  }).catch(() => {});

  const cat = item.category;
  const url = `/file?path=${encodeURIComponent(item.path)}`;
  if (cat === 'video') {
    const vids = videoSet.length ? videoSet : [item];
    openVideo(item, vids);
  } else if (cat === 'image') {
    if (['.heic', '.heif'].includes(item.ext)) {
      openHeic(item, imageSet);
    } else {
      openImage(item, imageSet, url);
    }
  } else if (cat === 'audio') {
    openAudio(item, url, audioSet);
  } else if (item.ext === '.pdf') {
    openPdf(item, url);
  } else if (cat === 'archive' || cat === 'apk' || ['.zip','.tar','.gz','.tgz','.rar','.7z','.z7','.bz2','.xz','.lz','.lzma','.zst','.apk','.jar'].includes(item.ext)) {
    openArchive(item, url);
  } else if (['.txt','.md','.log','.json','.xml','.html','.css','.js','.ts','.py','.sh','.c','.cpp','.h','.java','.yaml','.yml','.ini','.conf','.csv','.sql','.bat','.ps1','.rb','.go','.rs'].includes(item.ext)) {
    openText(item, url);
  } else {
    const a = document.createElement('a');
    a.href = url + '&dl=1';
    a.download = item.name;
    a.click();
  }
}

// ── PDF Viewer (PDF.js canvas renderer — works on mobile) ──────────────────
let _pdfLoadTask = null;
function _cancelPdf() {
  if (_pdfLoadTask) { try { _pdfLoadTask.destroy(); } catch(_) {} _pdfLoadTask = null; }
  $('pdfCanvasWrap').innerHTML = '';
}

async function openPdf(item, url) {
  $('pdfTitle').textContent = item.name;
  $('pdfDl').href = url + '&dl=1';
  $('pdfDl').download = item.name;
  openModal('pdfModal');
  await _renderPdfPages(url);
}

async function _renderPdfPages(url) {
  const wrap = $('pdfCanvasWrap');
  wrap.innerHTML = `<div class="pdf-loading"><div class="pdf-spinner"></div><span>Loading PDF…</span></div>`;

  // Cancel any previous load
  if (_pdfLoadTask) { try { _pdfLoadTask.destroy(); } catch(_) {} _pdfLoadTask = null; }

  // Fallback if PDF.js didn't load (no internet)
  if (typeof pdfjsLib === 'undefined') {
    wrap.innerHTML = `<div class="pdf-error">⚠️ PDF renderer unavailable.<br>
      <a class="vp-fallback-dl-btn" href="${url}&dl=1" download>Download PDF</a></div>`;
    return;
  }

  const task = pdfjsLib.getDocument(url);
  _pdfLoadTask = task;

  try {
    const pdf = await task.promise;
    wrap.innerHTML = '';

    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2× for memory
    const containerW = wrap.clientWidth || window.innerWidth;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseVP  = page.getViewport({ scale: 1 });
      const scale   = (containerW / baseVP.width) * dpr;
      const viewport = page.getViewport({ scale });

      const pageWrap = document.createElement('div');
      pageWrap.className = 'pdf-page-wrap';

      const canvas = document.createElement('canvas');
      canvas.width  = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width  = '100%';
      canvas.style.display = 'block';

      pageWrap.appendChild(canvas);

      if (pdf.numPages > 1) {
        const lbl = document.createElement('div');
        lbl.className = 'pdf-page-label';
        lbl.textContent = `${pageNum} / ${pdf.numPages}`;
        pageWrap.appendChild(lbl);
      }

      wrap.appendChild(pageWrap);

      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch (err) {
    if (err?.name === 'TaskCancelled' || err?.message?.includes('cancelled')) return;
    wrap.innerHTML = `<div class="pdf-error">⚠️ Could not render PDF.<br><small>${err.message}</small><br>
      <a class="vp-fallback-dl-btn" href="${url}&dl=1" download style="margin-top:12px;">Download PDF</a></div>`;
  }
}

// ── HEIC / HEIF viewer — server converts to JPEG ──────────────────────────
async function openHeic(item, imageSet) {
  const previewUrl = `/api/heic-preview?path=${encodeURIComponent(item.path)}`;
  const fakeItem = Object.assign({}, item, { _heicPreview: previewUrl });
  const list = (imageSet && imageSet.length) ? imageSet.map(i =>
    ['.heic', '.heif'].includes(i.ext) ? Object.assign({}, i, { _heicPreview: `/api/heic-preview?path=${encodeURIComponent(i.path)}` }) : i
  ) : [fakeItem];
  const startIdx = Math.max(0, list.findIndex(i => i.path === item.path));
  document.body.style.overflow = 'hidden';
  history.pushState({ lhost: true }, '');
  ivOpen(list, startIdx, false);
}

// ── Archive / ZIP viewer ───────────────────────────────────────────────────
let _archiveAllEntries = [];

async function openArchive(item, url) {
  $('archiveTitle').textContent = item.name;
  $('archiveDl').href = url + '&dl=1';
  $('archiveDl').download = item.name;
  $('archiveSearchInput').value = '';
  $('archiveBody').innerHTML = '<div class="loader-wrap"><div class="loader"></div></div>';
  openModal('archiveModal');

  try {
    const data = await fetchJson(`/api/archive-list?path=${encodeURIComponent(item.path)}`);
    _archiveAllEntries = data.entries || [];
    renderArchiveEntries(_archiveAllEntries, data.total);
  } catch (e) {
    $('archiveBody').innerHTML = `<div class="archive-error"><div class="archive-error-icon">🗜️</div><strong>Preview not available</strong><br><span>${archiveErrorMessage(e)}</span><br><small>Is file ko download karke ZIP/RAR/7z extractor se extract karein.</small><br><a class="vp-fallback-dl-btn" href="${url}&dl=1" download="${item.name}">Download archive</a></div>`;
  }
}

function archiveErrorMessage(e) {
  try {
    const parsed = JSON.parse(e.message);
    return parsed.error || e.message;
  } catch (_) {
    return e.message || 'Could not read this compressed file.';
  }
}

function archiveIcon(entry) {
  if (entry.isDir) return '📁';
  const ext = (entry.name.match(/\.([^.]+)$/) || [])[1];
  if (!ext) return '📄';
  const e = '.' + ext.toLowerCase();
  if (['.mp4','.mkv','.avi','.mov','.webm'].includes(e)) return '🎬';
  if (['.jpg','.jpeg','.png','.gif','.webp','.heic'].includes(e)) return '🖼️';
  if (['.mp3','.wav','.flac','.aac','.ogg'].includes(e)) return '🎵';
  if (e === '.opus') return '🎙️';
  if (['.pdf'].includes(e)) return 'PDF';
  if (e === '.zip') return '📦';
  if (e === '.rar') return '🧰';
  if (e === '.7z' || e === '.z7') return '🧊';
  if (['.tar','.gz','.tgz','.bz2','.xz','.lz','.lzma','.zst'].includes(e)) return '🗜️';
  if (['.ttf','.otf','.woff','.woff2','.eot'].includes(e)) return '🔤';
  if (['.tmp','.temp','.cache','.bak','.old'].includes(e)) return '⏱️';
  if (['.ppt','.pptx','.pps','.ppsx'].includes(e)) return '📊';
  if (['.txt','.md','.log'].includes(e)) return '📝';
  if (['.html','.htm'].includes(e)) return '🌐';
  if (e === '.css') return '🎨';
  if (e === '.py') return '🐍';
  if (e === '.sh') return '⌨️';
  if (e === '.java') return '☕';
  if (['.js','.ts','.c','.cpp','.json','.xml'].includes(e)) return '🔧';
  return '📄';
}

function formatArchiveSize(bytes) {
  if (bytes == null || bytes === 0) return '';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(Math.max(bytes,1)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[Math.min(i, s.length-1)];
}

function renderArchiveEntries(entries, total) {
  if (!entries.length) {
    $('archiveBody').innerHTML = '<div class="archive-empty">Archive is empty</div>';
    return;
  }
  const html = [`<div class="archive-stats">${total} items</div>`];
  for (const e of entries) {
    const parentPath = e.path.includes('/') ? e.path.substring(0, e.path.lastIndexOf('/')) : '';
    html.push(`<div class="archive-entry">
      <span class="archive-entry-icon">${archiveIcon(e)}</span>
      <div class="archive-entry-info">
        <div class="archive-entry-name" title="${e.path}">${e.name || e.path}</div>
        ${parentPath ? `<div class="archive-entry-path">${parentPath}/</div>` : ''}
      </div>
      <span class="archive-entry-size">${formatArchiveSize(e.size)}</span>
    </div>`);
  }
  $('archiveBody').innerHTML = html.join('');
}

$('archiveSearchInput').addEventListener('input', () => {
  const q = $('archiveSearchInput').value.toLowerCase();
  if (!q) { renderArchiveEntries(_archiveAllEntries, _archiveAllEntries.length); return; }
  const filtered = _archiveAllEntries.filter(e => (e.path || '').toLowerCase().includes(q));
  renderArchiveEntries(filtered, filtered.length);
});

// ── Image viewer (delegates to iv.js) ─────────────────────────────────────
function openImage(item, imageSet, url) {
  const list = (imageSet && imageSet.length) ? imageSet : [item];
  const idx  = list.findIndex(i => i.path === item.path);
  const startIdx = idx >= 0 ? idx : 0;
  document.body.style.overflow = 'hidden';
  history.pushState({ lhost: true }, '');
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
let _cachedFavorites = [];

async function toggleFavorite(item) {
  try {
    const r = await fetch('/api/userstate/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const d = await r.json();
    toast(d.favorited ? '⭐ Added to Favorites' : 'Removed from Favorites');
    // Refresh cached favorites
    const st = await fetchJson('/api/userstate');
    _cachedFavorites = st.favorites || [];
    // Refresh home if visible
    if (state.currentView === 'home') loadFavorites();
  } catch (e) { toast(e.message, 'error'); }
}

function showCtxMenu(e, item) {
  state.ctxItem = item;
  const menu = $('ctxMenu');
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 180) + 'px';
  $('ctxDownload').style.display = item.type === 'file' ? 'flex' : 'none';
  const isFav = _cachedFavorites.some(f => f.path === item.path);
  const favBtn = $('ctxFavorite');
  favBtn.querySelector('.ctx-fav-label').textContent = isFav ? 'Unfavorite' : 'Favorite';
  favBtn.querySelector('.ctx-fav-star').textContent   = isFav ? '★' : '☆';
}
function hideCtxMenu() { $('ctxMenu').classList.add('hidden'); state.ctxItem = null; }

// ── Favorites section on home ───────────────────────────────────────────────
async function loadFavorites() {
  const section = $('favSection');
  if (!section) return;
  try {
    const st = await fetchJson('/api/userstate');
    _cachedFavorites = st.favorites || [];
    if (!_cachedFavorites.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    const grid = $('favGrid');
    renderRecentCards(grid, _cachedFavorites.slice(0, 8));
  } catch (_) { if (section) section.style.display = 'none'; }
}

// ── Upload ─────────────────────────────────────────────────────────────────
function uploadFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx ? 1 : 0)} ${units[idx]}`;
}

function renderUploadFiles() {
  const list = $('uploadList');
  const files = state.uploadFiles;
  if (!files.length) {
    list.innerHTML = '<div class="upload-empty">No files selected yet</div>';
    return;
  }
  list.innerHTML = files.map(f => `
    <div class="upload-file-row">
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</span>
      <span style="color:var(--text2);font-variant-numeric:tabular-nums">${uploadFileSize(f.size)}</span>
    </div>
  `).join('');
}

function setUploadBusy(isBusy) {
  state.uploadUploading = isBusy;
  $('startUploadBtn').disabled = isBusy;
  $('startUploadBtn').textContent = isBusy ? 'Uploading...' : 'Upload';
  $('cancelUploadBtn').classList.toggle('hidden', !isBusy);
  $('dropZone').classList.toggle('uploading', isBusy);
}

function normalizeUploadFiles(fileList) {
  if (!fileList) return [];
  if (Array.isArray(fileList)) return fileList.filter(f => f && f.name);
  if (typeof FileList !== 'undefined' && fileList instanceof FileList) return Array.from(fileList).filter(f => f && f.name);
  if (typeof DataTransferItemList !== 'undefined' && fileList instanceof DataTransferItemList) {
    return Array.from(fileList).map(item => item.getAsFile?.()).filter(f => f && f.name);
  }
  if (typeof fileList.length === 'number' && fileList[0] && fileList[0].name) {
    return Array.from(fileList).filter(f => f && f.name);
  }
  return [];
}

function setUploadFiles(fileList) {
  const files = normalizeUploadFiles(fileList);
  state.uploadFiles = files;
  const input = $('fileInput');
  try {
    const dt = new DataTransfer();
    files.forEach(file => dt.items.add(file));
    input.files = dt.files;
  } catch (_) {}
  renderUploadFiles();
  if (files.length) toast(`${files.length} file(s) ready to upload`);
}

function openUploadModal(files) {
  state.uploadPath = state.currentPath || '';
  state.uploadCancelled = false;
  setUploadBusy(false);
  openModal('uploadModal');
  const selectedFiles = normalizeUploadFiles(files);
  if (selectedFiles.length) setUploadFiles(selectedFiles);
  else {
    state.uploadFiles = [];
    $('fileInput').value = '';
    renderUploadFiles();
  }
}

function cancelUpload() {
  if (!state.uploadUploading) return;
  state.uploadCancelled = true;
  try { state.uploadReader?.abort?.(); } catch (_) {}
  try { state.uploadXhr?.abort?.(); } catch (_) {}
  state.uploadReader = null;
  state.uploadXhr = null;
  setUploadBusy(false);
  qsa('.upload-progress-bar', $('uploadList')).forEach(bar => {
    if (bar.style.background !== 'var(--success)') {
      bar.style.width = bar.style.width || '0%';
      bar.style.background = 'var(--danger)';
    }
  });
  toast('Upload cancelled', 'error');
}

async function handleUpload() {
  const input = $('fileInput');
  const files = state.uploadFiles.length ? state.uploadFiles : [...input.files];
  if (!files.length) { toast('Select files first', 'error'); return; }
  if (state.uploadUploading) return;
  state.uploadCancelled = false;
  setUploadBusy(true);
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
    if (state.uploadCancelled) break;
    const file = files[i];
    const bar  = list.children[i].querySelector('.upload-progress-bar');
    await new Promise(resolve => {
      if (state.uploadCancelled) { resolve(); return; }
      const xhr = new XMLHttpRequest();
      state.uploadXhr = xhr;
      xhr.open('POST', `/api/upload?path=${encodeURIComponent(state.uploadPath)}`);
      xhr.upload.onprogress = e => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%'; };
      xhr.onload  = () => {
        if (!state.uploadCancelled) {
          bar.style.width = '100%';
          bar.style.background = xhr.status >= 200 && xhr.status < 300 ? 'var(--success)' : 'var(--danger)';
        }
        state.uploadXhr = null;
        resolve();
      };
      xhr.onerror = () => { bar.style.background = 'var(--danger)'; state.uploadXhr = null; resolve(); };
      xhr.onabort = () => { bar.style.background = 'var(--danger)'; state.uploadXhr = null; resolve(); };
      const reader = new FileReader();
      state.uploadReader = reader;
      reader.onload = () => {
        if (state.uploadCancelled) { resolve(); return; }
        const boundary = '----lhostboundary' + Math.random().toString(16).slice(2);
        const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
        const tail = `\r\n--${boundary}--\r\n`;
        const hb = new TextEncoder().encode(head), tb = new TextEncoder().encode(tail);
        const body = new Uint8Array(hb.length + reader.result.byteLength + tb.length);
        body.set(hb, 0); body.set(new Uint8Array(reader.result), hb.length); body.set(tb, hb.length + reader.result.byteLength);
        xhr.setRequestHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
        xhr.send(body.buffer);
      };
      reader.onerror = () => { bar.style.background = 'var(--danger)'; state.uploadReader = null; resolve(); };
      reader.onabort = () => { bar.style.background = 'var(--danger)'; state.uploadReader = null; resolve(); };
      reader.readAsArrayBuffer(file);
    });
  }
  state.uploadReader = null;
  state.uploadXhr = null;
  setUploadBusy(false);
  if (state.uploadCancelled) return;
  toast(`${files.length} file(s) uploaded!`, 'success');
  setTimeout(() => { closeModal('uploadModal'); if (state.currentView === 'browser') navigate(state.uploadPath); else loadHome(); }, 800);
}

// ── Nav ────────────────────────────────────────────────────────────────────
function setNavActive(id) { qsa('.nav-item').forEach(b => b.classList.remove('active')); $(id)?.classList.add('active'); }

// ── Info ───────────────────────────────────────────────────────────────────
async function showSettings() {
  openModal('settingsModal');
  syncThemeButtons();
  try {
    const cfg = await fetchJson('/api/settings');
    const tog = $('pwToggle');
    tog.checked = !!cfg.passwordEnabled;
    $('pwFields').classList.toggle('hidden', !cfg.passwordEnabled);
    $('pwCurrentWrap').classList.toggle('hidden', !cfg.passwordEnabled);
  } catch (_) {}
  try {
    const data = await fetchJson('/api/info');
    const envLabels = { termux:'🤖 Termux (Android)', android:'📱 Android', 'linux-root':'🔴 Linux (root)', linux:'🐧 Linux', darwin:'🍎 macOS', win32:'🪟 Windows', custom:'⚙️ Custom (ROOT_DIR)' };
    $('infoBody').innerHTML = `
      <div class="info-row"><span class="info-label">Environment</span><span class="info-val">${envLabels[data.env] || data.env}</span></div>
      <div class="info-row"><span class="info-label">Hostname</span><span class="info-val">${data.hostname}</span></div>
      <div class="info-row"><span class="info-label">Platform</span><span class="info-val">${data.platform} · Node ${data.nodeVersion}</span></div>
      <div class="info-row"><span class="info-label">Root Dir</span><span class="info-val">${data.root}</span></div>
      <div class="info-row"><span class="info-label">Tip</span><span class="info-val"><code style="background:var(--bg4);padding:2px 6px;border-radius:4px;font-size:11px">ROOT_DIR=/sdcard node server.js</code></span></div>`;
    const port = location.port;
    $('lanIPs').innerHTML = (data.networkIPs || []).length
      ? (data.networkIPs.map(ip =>
          `<div class="lan-ip-row"><span class="lan-ip-label">Network</span><span class="lan-ip-val">http://${ip}${port ? ':'+port : ''}</span></div>`).join(''))
      : '<div style="color:var(--text2);font-size:13px">No network interfaces found</div>';
  } catch (e) { toast(e.message, 'error'); }
  wanSyncUI();
  try {
    const v = await fetchJson('/api/version');
    const ver = 'v' + v.version;
    const el1 = $('updateCurrentVer'); if (el1) el1.textContent = ver;
    const el2 = $('updateVerSub'); if (el2) el2.textContent = ver + ' installed';
  } catch (_) {}
}
function showInfo() { showSettings(); }

// ── WAN Tunnel ─────────────────────────────────────────────────────────────
let _wanPollTimer = null;

function wanSyncUI() {
  fetch('/api/wan/status').then(r => r.json()).then(d => {
    _wanApplyState(d);
    if (d.status === 'stopped' || d.status === 'error') wanCheck();
  }).catch(() => {});
}

function _wanApplyState(d) {
  const dot      = $('wanDot');
  const txt      = $('wanStatusTxt');
  const urlBox   = $('wanUrlBox');
  const startBtn = $('wanStartBtn');
  const stopBtn  = $('wanStopBtn');
  const iconWrap = $('wanIconWrap');
  if (!dot) return;

  dot.className = 'wan-dot wan-dot-' + d.status;

  const iconColors = { stopped:'s-icon-green', starting:'s-icon-teal', running:'s-icon-green', error:'s-icon-red' };
  if (iconWrap) {
    iconWrap.className = 's-row-icon ' + (iconColors[d.status] || 's-icon-green');
  }

  if (d.status === 'stopped') {
    txt.textContent = 'Not running';
    if (urlBox) urlBox.classList.add('hidden');
    if (startBtn) { startBtn.classList.remove('hidden'); startBtn.disabled = false; }
    if (stopBtn) stopBtn.classList.add('hidden');
    clearInterval(_wanPollTimer); _wanPollTimer = null;
  } else if (d.status === 'starting') {
    txt.textContent = 'Starting tunnel…';
    if (urlBox) urlBox.classList.add('hidden');
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
  } else if (d.status === 'running') {
    txt.textContent = 'Active — tunnel is live';
    const urlVal = $('wanUrlVal');
    if (urlVal) urlVal.textContent = d.url;
    if (urlBox) {
      urlBox.classList.remove('hidden');
      anime({ targets: '#wanUrlBox', opacity: [0,1], translateY: [-6,0], duration: 400, easing: 'easeOutQuad' });
    }
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    clearInterval(_wanPollTimer); _wanPollTimer = null;
  } else if (d.status === 'error') {
    txt.textContent = '⚠️ ' + (d.error || 'Error starting tunnel');
    if (urlBox) urlBox.classList.add('hidden');
    if (startBtn) { startBtn.classList.remove('hidden'); startBtn.disabled = false; }
    if (stopBtn) stopBtn.classList.add('hidden');
    clearInterval(_wanPollTimer); _wanPollTimer = null;
    toast(d.error || 'Tunnel error', 'error');
  }
}

async function wanCheck() {
  try {
    const d = await fetchJson('/api/wan/check');
    const noInstall = $('wanNoInstall');
    const noInternet = $('wanNoInternet');
    const startBtn = $('wanStartBtn');
    if (noInstall) noInstall.classList.toggle('hidden', d.cloudflaredInstalled);
    if (noInternet) noInternet.classList.toggle('hidden', !d.cloudflaredInstalled || d.internetAvailable);
    if (startBtn) startBtn.disabled = !d.cloudflaredInstalled || !d.internetAvailable;
    return d;
  } catch (_) { return { cloudflaredInstalled: false, internetAvailable: false }; }
}

async function wanStart() {
  const btn = $('wanStartBtn');
  btn.disabled = true;
  const chk = await wanCheck();
  if (!chk.cloudflaredInstalled) {
    toast('cloudflared not installed. Install via: pkg install cloudflared', 'error');
    btn.disabled = false; return;
  }
  if (!chk.internetAvailable) {
    toast('No internet connection. Please connect to the internet first.', 'error');
    btn.disabled = false; return;
  }
  try {
    const r = await fetch('/api/wan/start', { method: 'POST' });
    const d = await r.json();
    if (!d.ok) { toast(d.error || 'Failed to start tunnel', 'error'); btn.disabled = false; return; }
    _wanApplyState({ status: 'starting' });
    _wanPollTimer = setInterval(() => {
      fetch('/api/wan/status').then(r => r.json()).then(d => {
        if (d.status !== 'starting') { clearInterval(_wanPollTimer); _wanPollTimer = null; _wanApplyState(d); }
      }).catch(() => {});
    }, 1500);
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false;
}

async function wanStop() {
  const btn = $('wanStopBtn');
  btn.disabled = true;
  try {
    await fetch('/api/wan/stop', { method: 'POST' });
    anime({ targets: ['#wanUrlBox','#wanQrWrap'], opacity: [1,0], translateY: [0,-8], duration: 300, easing: 'easeInQuad',
      complete: () => { _wanApplyState({ status: 'stopped' }); } });
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false;
}

// ── Update Checker ─────────────────────────────────────────────────────────
async function checkForUpdates() {
  const btn  = $('updateCheckBtn');
  const icon = $('updateCheckIcon');
  btn.disabled = true;
  anime({ targets: '#updateCheckIcon', rotate: '1turn', duration: 800, loop: true, easing: 'linear' });
  try {
    const d = await fetchJson('/api/update/check');
    anime.remove('#updateCheckIcon');
    icon.style.transform = '';
    $('updateCurrentVer').textContent = 'v' + d.currentVersion;
    const badge    = $('updateBadge');
    const changelog= $('updateChangelog');
    const dlBtn    = $('updateDlBtn');
    const latestRow= $('updateLatestRow');

    if (d.noReleases) {
      badge.className = 'update-badge update-badge-ok';
      badge.textContent = '✓ No releases yet on GitHub';
      badge.classList.remove('hidden');
      anime({ targets: '#updateBadge', opacity:[0,1], translateY:[-6,0], duration:400, easing:'easeOutQuad' });
    } else if (d.upToDate) {
      badge.className = 'update-badge update-badge-ok';
      badge.textContent = '✓ You are on the latest version';
      badge.classList.remove('hidden');
      anime({ targets: '#updateBadge', opacity:[0,1], translateY:[-6,0], duration:400, easing:'easeOutQuad' });
    } else {
      $('updateLatestVer').textContent = d.latestVersion || '';
      latestRow.classList.remove('hidden');
      badge.className = 'update-badge update-badge-new';
      badge.textContent = `🎉 New version available: ${d.latestVersion}`;
      badge.classList.remove('hidden');
      anime({ targets: '#updateBadge', opacity:[0,1], scale:[0.9,1], duration:500, easing:'easeOutBack' });
      if (d.changelog) {
        changelog.innerHTML = '<div class="update-changelog-title">What\'s new:</div>' +
          d.changelog.split('\n').filter(Boolean).map(l =>
            `<div class="update-changelog-line">${l.replace(/^[-*]\s*/,'')}</div>`
          ).join('');
        changelog.classList.remove('hidden');
        anime({ targets: '#updateChangelog', opacity:[0,1], translateY:[8,0], duration:400, easing:'easeOutQuad' });
      }
      if (d.htmlUrl) {
        const dlBtn = $('updateDlBtn');
        const dlWrap = $('updateDlWrap');
        if (dlBtn) dlBtn.href = d.htmlUrl;
        if (dlWrap) dlWrap.classList.remove('hidden');
      }
    }
    const verSub = $('updateVerSub');
    if (verSub && d.latestVersion && !d.upToDate) verSub.textContent = d.currentVersion ? 'v' + d.currentVersion + ' installed' : '';
  } catch (e) {
    anime.remove('#updateCheckIcon');
    icon.style.transform = '';
    toast('Could not check updates: ' + e.message, 'error');
  }
  btn.disabled = false;
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

// ── Rename ─────────────────────────────────────────────────────────────────
function renameItem(item) {
  $('renameInput').value = item.name;
  openModal('renameModal');
  setTimeout(() => { $('renameInput').focus(); $('renameInput').select(); }, 80);
  $('renameConfirmBtn')._handler = async () => {
    const newName = $('renameInput').value.trim();
    if (!newName || newName === item.name) { closeModal('renameModal'); return; }
    closeModal('renameModal');
    try {
      const r = await fetch('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: item.path, name: newName }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast('Renamed!', 'success');
      if (state.currentView === 'browser') navigate(state.currentPath);
      else if (state.currentView === 'cat') loadCategory(item.category);
      else loadHome();
    } catch (e) { toast(e.message, 'error'); }
  };
}

// ── Folder Picker (for Copy / Move) ─────────────────────────────────────────
const _fp = { mode: 'copy', item: null, path: '' };

function copyItem(item) { _openFolderPicker(item, 'copy'); }
function moveItem(item) { _openFolderPicker(item, 'move'); }

function _openFolderPicker(item, mode) {
  _fp.mode = mode;
  _fp.item = item;
  _fp.path = '';
  $('fpTitle').textContent = mode === 'copy' ? 'Copy to…' : 'Move to…';
  $('fpSelectBtn').textContent = mode === 'copy' ? '📋 Copy here' : '✂️ Move here';
  openModal('folderPickerModal');
  _fpNavigate('');
}

async function _fpNavigate(relPath) {
  _fp.path = relPath;
  const breadcrumb = relPath ? '/ ' + relPath.replace(/\//g, ' / ') : '/ root';
  $('fpBreadcrumb').textContent = breadcrumb;
  $('fpBack').classList.toggle('active', !!relPath);
  const list = $('fpList');
  list.innerHTML = '<div class="loader-wrap"><div class="loader"></div></div>';
  try {
    const data = await fetchJson(`/api/ls?path=${encodeURIComponent(relPath)}&page=0&limit=200&sort=name&dir=asc&hidden=0`);
    const dirs = (data.items || []).filter(i => i.type === 'dir');
    if (!dirs.length) {
      list.innerHTML = '<div class="fp-empty">No folders here</div>';
      return;
    }
    list.innerHTML = '';
    dirs.forEach(dir => {
      const el = document.createElement('div');
      el.className = 'fp-item';
      el.innerHTML = `
        <span class="fp-item-icon">📁</span>
        <span class="fp-item-name">${dir.name}</span>
        <span class="fp-item-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>`;
      el.addEventListener('click', () => _fpNavigate(dir.path));
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = `<div class="fp-empty">Failed to load folders</div>`;
  }
}

// ── File Info ───────────────────────────────────────────────────────────────
function showFileInfo(item) {
  $('fileInfoTitle').textContent = item.name;
  const rows = [];
  const typeLabel = item.type === 'dir' ? 'Folder' : (item.ext ? item.ext.replace('.', '').toUpperCase() : 'File');
  rows.push(['Type', typeLabel]);
  rows.push(['Path', '/' + (item.path || '')]);
  if (item.sizeStr && item.type !== 'dir') rows.push(['Size', item.sizeStr]);
  if (item.mtime) rows.push(['Modified', new Date(item.mtime).toLocaleString()]);
  if (item.category && item.category !== 'file') rows.push(['Category', item.category.charAt(0).toUpperCase() + item.category.slice(1)]);
  $('fileInfoBody').innerHTML = rows.map(([k, v]) =>
    `<div style="display:flex;gap:8px;border-bottom:1px solid var(--border);padding:4px 0">
      <span style="color:var(--text2);min-width:80px;flex-shrink:0">${k}</span>
      <span style="word-break:break-all">${v}</span>
    </div>`
  ).join('');
  openModal('fileInfoModal');
}

// ── View toggle ────────────────────────────────────────────────────────────
function setListMode(mode) {
  state.listMode = mode;
  prefs.viewMode = mode;
  savePrefs();
  ['fileGrid','catGrid','searchGrid'].forEach(id => {
    $(id).classList.toggle('list-view', mode === 'list');
  });
  $('gridViewBtn')?.classList.toggle('active', mode === 'grid');
  $('listViewBtn')?.classList.toggle('active', mode === 'list');
  $('vmGrid')?.classList.toggle('active', mode === 'grid');
  $('vmList')?.classList.toggle('active', mode === 'list');
}

// ── View menu ──────────────────────────────────────────────────────────────
function syncViewMenu() {
  $('vmGrid')?.classList.toggle('active', prefs.viewMode === 'grid');
  $('vmList')?.classList.toggle('active', prefs.viewMode === 'list');
  qsa('.vm-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === prefs.sortBy);
  });
  $('vmAsc')?.classList.toggle('active', prefs.sortDir === 'asc');
  $('vmDesc')?.classList.toggle('active', prefs.sortDir === 'desc');
  const tog = $('vmHiddenToggle');
  if (tog) tog.checked = prefs.showHidden;
}

function refreshCurrentView() {
  if (state.currentView === 'browser') navigate(state.currentPath);
  else if (state.currentView === 'cat') loadCategory(pg.param);
  else if (state.currentView === 'search') doSearch(pg.param);
  else if (state.currentView === 'recentAll') loadRecentAll();
}

// ═══════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════

// ── Theme ───────────────────────────────────────────────────────────────────
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('lhost_theme', t);
  syncThemeButtons();
}
function syncThemeButtons() {
  const t = localStorage.getItem('lhost_theme') || 'dark';
  qsa('.s-theme-pill').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === t));
  qsa('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.theme === t));
}

document.addEventListener('DOMContentLoaded', () => {

  // Apply saved theme immediately
  applyTheme(localStorage.getItem('lhost_theme') || 'dark');

  vpInit();
  ivInit();
  mpInitEvents();

  // Apply saved view mode on startup
  setListMode(prefs.viewMode);
  syncViewMenu();

  // ── Lock screen ──────────────────────────────────────────────────────────
  (async () => {
    try {
      const cfg = await fetchJson('/api/settings');
      if (cfg.passwordEnabled && !sessionStorage.getItem('lhost_unlocked')) {
        $('lockScreen').classList.remove('hidden');
        $('lockInput').focus();
      }
    } catch (_) {}
  })();

  async function tryUnlock() {
    const pw = $('lockInput').value;
    if (!pw) return;
    try {
      const r = await fetch('/api/verify-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw })
      });
      const d = await r.json();
      if (d.ok) {
        sessionStorage.setItem('lhost_unlocked', '1');
        $('lockScreen').classList.add('hidden');
        $('lockError').classList.add('hidden');
        $('lockInput').value = '';
      } else {
        $('lockError').classList.remove('hidden');
        $('lockInput').value = '';
        $('lockInput').focus();
      }
    } catch (e) { toast(e.message, 'error'); }
  }
  $('lockUnlockBtn').addEventListener('click', tryUnlock);
  $('lockInput').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

  // ── Theme buttons ────────────────────────────────────────────────────────
  qsa('.theme-btn, .s-theme-pill').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  // ── Password settings ────────────────────────────────────────────────────
  $('pwToggle').addEventListener('change', () => {
    const en = $('pwToggle').checked;
    $('pwFields').classList.toggle('hidden', !en);
    $('pwCurrentWrap').classList.toggle('hidden', true);
    $('pwNewInput').value = '';
    $('pwConfirmInput').value = '';
    $('pwError').classList.add('hidden');
    if (!en) {
      fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordEnabled: false })
      }).then(r => r.json()).then(d => {
        if (d.error) toast(d.error, 'error');
        else { toast('Password lock disabled', 'success'); sessionStorage.removeItem('lhost_unlocked'); }
      });
    }
  });

  $('pwSaveBtn').addEventListener('click', async () => {
    const current = $('pwCurrentInput').value;
    const nw = $('pwNewInput').value;
    const conf = $('pwConfirmInput').value;
    const pwErr = $('pwError');
    if (nw.length < 4) { pwErr.textContent = 'Password must be at least 4 characters'; pwErr.classList.remove('hidden'); return; }
    if (nw !== conf) { pwErr.textContent = 'Passwords do not match'; pwErr.classList.remove('hidden'); return; }
    pwErr.classList.add('hidden');
    try {
      const body = { passwordEnabled: true, password: nw };
      if (current) body.currentPassword = current;
      const d = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(r => r.json());
      if (d.error) { pwErr.textContent = d.error; pwErr.classList.remove('hidden'); }
      else { toast('Password saved!', 'success'); $('pwNewInput').value = ''; $('pwConfirmInput').value = ''; $('pwCurrentInput').value = ''; }
    } catch (e) { toast(e.message, 'error'); }
  });

  // ── WAN Tunnel ─────────────────────────────────────────────────────────
  $('wanStartBtn').addEventListener('click', wanStart);
  $('wanStopBtn').addEventListener('click', wanStop);
  $('wanRefreshBtn').addEventListener('click', () => {
    anime({ targets: '#wanRefreshIcon', rotate: '360deg', duration: 600, easing: 'easeInOutQuad' });
    setTimeout(() => { if ($('wanRefreshIcon')) $('wanRefreshIcon').style.transform = ''; }, 700);
    wanSyncUI();
  });
  $('wanCopyBtn').addEventListener('click', () => {
    const url = ($('wanUrlVal') || {}).textContent || '';
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => toast('Link copied!', 'success')).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      toast('Link copied!', 'success');
    });
  });
  $('wanQrBtn') && $('wanQrBtn').addEventListener('click', () => {
    const collapse = $('wanQrCollapse');
    const isHidden = collapse.classList.contains('hidden');
    if (isHidden) {
      $('wanQrImg').src = '/api/wan/qr?' + Date.now();
      collapse.classList.remove('hidden');
      anime({ targets: '#wanQrCollapse', opacity:[0,1], translateY:[-10,0], duration:400, easing:'easeOutQuad' });
      $('wanQrBtn').textContent = '🔼 Hide QR Code';
    } else {
      anime({ targets: '#wanQrCollapse', opacity:[1,0], translateY:[0,-10], duration:300, easing:'easeInQuad',
        complete: () => collapse.classList.add('hidden') });
      $('wanQrBtn').innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Show QR Code';
    }
  });

  // ── LAN QR Toggle ───────────────────────────────────────────────────────
  $('lanQrBtn') && $('lanQrBtn').addEventListener('click', () => {
    const collapse = $('lanQrCollapse');
    const isHidden = collapse.classList.contains('hidden');
    if (isHidden) {
      collapse.classList.remove('hidden');
      anime({ targets: '#lanQrCollapse', opacity:[0,1], translateY:[-10,0], duration:400, easing:'easeOutQuad' });
      $('lanQrBtn').textContent = '🔼 Hide QR';
    } else {
      anime({ targets: '#lanQrCollapse', opacity:[1,0], translateY:[0,-10], duration:300, easing:'easeInQuad',
        complete: () => collapse.classList.add('hidden') });
      $('lanQrBtn').innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> QR Code';
    }
  });

  // ── Update Checker ──────────────────────────────────────────────────────
  $('updateCheckBtn').addEventListener('click', checkForUpdates);

  // ── History-based back navigation ──────────────────────────────────────
  history.replaceState({ lhost: true }, '');
  window.addEventListener('popstate', () => {
    if (!$('imageModal').classList.contains('hidden')) {
      ivClose();
      history.replaceState({ lhost: true }, '');
      return;
    }
    if (!$('videoModal').classList.contains('hidden')) {
      closeVideo();
      history.replaceState({ lhost: true }, '');
      return;
    }
    if (!$('audioModal').classList.contains('hidden')) {
      closeModal('audioModal');
      history.replaceState({ lhost: true }, '');
      return;
    }
    const modals = ['textModal','settingsModal','uploadModal','folderModal','pdfModal','archiveModal'];
    for (const id of modals) {
      if (!$(id).classList.contains('hidden')) {
        closeModal(id);
        history.replaceState({ lhost: true }, '');
        return;
      }
    }
    if (state.currentView !== 'home') {
      loadHome();
      history.replaceState({ lhost: true }, '');
      return;
    }
    history.replaceState({ lhost: true }, '');
  });

  loadHome();

  // Category icons
  qsa('[data-cat]').forEach(el => el.addEventListener('click', () => loadCategory(el.dataset.cat)));
  qsa('[data-browse]').forEach(el => el.addEventListener('click', () => navigate('')));
  $('recentViewAllBtn').addEventListener('click', () => loadRecentAll());
  $('recentAllBackBtn').addEventListener('click', () => loadHome());
  $('uploadCatBtn').addEventListener('click', openUploadModal);

  // ── View menu button ────────────────────────────────────────────────────
  $('viewMenuBtn').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('viewMenu');
    const open = !menu.classList.contains('hidden');
    menu.classList.toggle('hidden', open);
    $('viewMenuBtn').classList.toggle('active', !open);
  });
  $('vmGrid').addEventListener('click', () => { setListMode('grid'); syncViewMenu(); });
  $('vmList').addEventListener('click', () => { setListMode('list'); syncViewMenu(); });
  qsa('.vm-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      prefs.sortBy = btn.dataset.sort;
      savePrefs(); syncViewMenu(); refreshCurrentView();
    });
  });
  $('vmAsc').addEventListener('click', () => {
    prefs.sortDir = 'asc'; savePrefs(); syncViewMenu(); refreshCurrentView();
  });
  $('vmDesc').addEventListener('click', () => {
    prefs.sortDir = 'desc'; savePrefs(); syncViewMenu(); refreshCurrentView();
  });
  $('vmHiddenToggle').addEventListener('change', () => {
    prefs.showHidden = $('vmHiddenToggle').checked;
    savePrefs(); refreshCurrentView();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#viewMenu') && !e.target.closest('#viewMenuBtn')) {
      $('viewMenu').classList.add('hidden');
      $('viewMenuBtn').classList.remove('active');
    }
  });

  // ── Sidebar drawer ──────────────────────────────────────────────────────
  function openSidebar() {
    $('sidebarDrawer').classList.add('open');
    $('sidebarOverlay').classList.add('open');
  }
  function closeSidebar() {
    $('sidebarDrawer').classList.remove('open');
    $('sidebarOverlay').classList.remove('open');
  }

  $('menuBtn').addEventListener('click', openSidebar);
  $('sidebarClose').addEventListener('click', closeSidebar);
  $('sidebarOverlay').addEventListener('click', closeSidebar);

  // Sidebar navigation items
  $('sbHome').addEventListener('click', () => { closeSidebar(); loadHome(); });
  $('sbBrowse').addEventListener('click', () => { closeSidebar(); navigate(''); });
  qsa('[data-sidebar-cat]').forEach(el => {
    el.addEventListener('click', () => { closeSidebar(); loadCategory(el.dataset.sidebarCat); });
  });
  $('sbSettings').addEventListener('click', () => { closeSidebar(); showSettings(); });

  // Swipe-right to open sidebar from left edge
  let _sbTx = 0;
  document.addEventListener('touchstart', e => { _sbTx = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _sbTx;
    if (_sbTx < 24 && dx > 60) openSidebar();
    if ($('sidebarDrawer').classList.contains('open') && dx < -60) closeSidebar();
  }, { passive: true });

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
  $('navSettings').addEventListener('click', showSettings);

   // Non-video modals close (image viewer handled by ivInit)
  ['audio','text','settings','upload','pdf','archive'].forEach(name => {
    $(`${name}Close`).addEventListener('click', () => {
      if (name === 'pdf') _cancelPdf();
      closeModal(`${name}Modal`);
    });
    const bd = $(`${name}Backdrop`);
    if (bd) bd.addEventListener('click', () => {
      if (name === 'pdf') _cancelPdf();
      closeModal(`${name}Modal`);
    });
  });

  // Mini player controls
  $('miniPlayer').addEventListener('click', e => {
    if (e.target.closest('#miniPlayBtn') || e.target.closest('#miniNextBtn') || e.target.closest('#miniCloseBtn')) return;
    mpExpandFromMini();
  });
  $('miniPlayBtn').addEventListener('click', e => {
    e.stopPropagation();
    mpTogglePlay();
  });
  $('miniNextBtn') && $('miniNextBtn').addEventListener('click', e => {
    e.stopPropagation();
    mpNext();
  });
  $('miniCloseBtn').addEventListener('click', e => {
    e.stopPropagation();
    const audio = mpGetAudio();
    audio.pause();
    audio.src = '';
    mpSetPlaying(false);
    mp.queue = [];
    mpClearSleepTimer();
    mpHideMini();
  });

  // Upload
  $('startUploadBtn').addEventListener('click', handleUpload);
  $('cancelUploadBtn').addEventListener('click', cancelUpload);
  const dz = $('dropZone');
  const fileInput = $('fileInput');
  const onUploadDrag = e => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add('dragging');
  };
  const onUploadDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove('dragging');
    setUploadFiles(e.dataTransfer?.files);
  };
  dz.addEventListener('dragenter', onUploadDrag);
  dz.addEventListener('dragover', onUploadDrag);
  dz.addEventListener('dragleave', e => {
    if (!dz.contains(e.relatedTarget)) dz.classList.remove('dragging');
  });
  dz.addEventListener('drop', onUploadDrop);
  fileInput.addEventListener('drop', onUploadDrop);
  fileInput.addEventListener('change', () => setUploadFiles(fileInput.files));
  document.addEventListener('dragover', e => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    if ($('uploadModal').classList.contains('hidden')) openUploadModal();
    dz.classList.add('dragging');
  });
  document.addEventListener('drop', e => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    openUploadModal(e.dataTransfer.files);
    dz.classList.remove('dragging');
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
  $('ctxFavorite').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) toggleFavorite(i); });
  $('ctxRename').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) renameItem(i); });
  $('ctxCopy').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) copyItem(i); });
  $('ctxMove').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) moveItem(i); });
  $('ctxInfo').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) showFileInfo(i); });
  $('ctxDelete').addEventListener('click', () => { const i = state.ctxItem; hideCtxMenu(); if (i) deleteItem(i); });
  document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu') && !e.target.closest('[data-more]')) hideCtxMenu(); });

  // Rename modal
  $('renameCancelBtn').addEventListener('click', () => closeModal('renameModal'));
  $('renameBackdrop').addEventListener('click', () => closeModal('renameModal'));
  $('renameConfirmBtn').addEventListener('click', () => { if ($('renameConfirmBtn')._handler) $('renameConfirmBtn')._handler(); });
  $('renameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { if ($('renameConfirmBtn')._handler) $('renameConfirmBtn')._handler(); } });

  // Folder Picker (copy/move)
  const _fpClose = () => closeModal('folderPickerModal');
  $('fpCancelBtn').addEventListener('click', _fpClose);
  $('fpClose').addEventListener('click', _fpClose);
  $('folderPickerBackdrop').addEventListener('click', _fpClose);
  $('fpBack').addEventListener('click', () => {
    if (!_fp.path) return;
    const parent = _fp.path.includes('/') ? _fp.path.substring(0, _fp.path.lastIndexOf('/')) : '';
    _fpNavigate(parent);
  });
  $('fpSelectBtn').addEventListener('click', async () => {
    const item = _fp.item;
    if (!item) return;
    const destPath = (_fp.path ? _fp.path + '/' : '') + item.name;
    closeModal('folderPickerModal');
    try {
      const endpoint = _fp.mode === 'copy' ? '/api/copy' : '/api/move';
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: item.path, dest: destPath }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      toast(_fp.mode === 'copy' ? 'Copied!' : 'Moved!', 'success');
      if (state.currentView === 'browser') navigate(state.currentPath);
      else if (state.currentView === 'cat') loadCategory(item.category);
      else loadHome();
    } catch (e) { toast(e.message, 'error'); }
  });

  // File Info modal
  $('fileInfoCloseBtn').addEventListener('click', () => closeModal('fileInfoModal'));
  $('fileInfoBackdrop').addEventListener('click', () => closeModal('fileInfoModal'));

  // Pre-load favorites cache
  fetchJson('/api/userstate').then(st => { _cachedFavorites = st.favorites || []; }).catch(() => {});

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    const videoOpen = vpHasVideoOpen();
    const audioOpen = !$('audioModal').classList.contains('hidden');
    const typing = e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);
    if (typing) return;

    // ── Audio player shortcuts ──
    if (audioOpen && !videoOpen) {
      const audio = mpGetAudio();
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); mpTogglePlay(); return; }
      if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); return; }
      if (e.key === 'ArrowLeft'  && !e.shiftKey) { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); return; }
      if (e.key === 'ArrowRight' && e.shiftKey)  { e.preventDefault(); mpNext(); return; }
      if (e.key === 'ArrowLeft'  && e.shiftKey)  { e.preventDefault(); mpPrev(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); mpSetVolume(mp.volume + 0.05); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); mpSetVolume(mp.volume - 0.05); return; }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); mpToggleMuteAudio(); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); mpNext(); return; }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); mpPrev(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); mpToggleShuffle(); return; }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); mpToggleRepeat(); return; }
      if (e.key === '.') { e.preventDefault(); mpCycleSpeed(); return; }
    }

    if (e.key === 'Escape') {
      if (videoOpen) { closeVideo(); return; }
      ['audioModal','textModal','settingsModal','uploadModal','folderModal','pdfModal','archiveModal'].forEach(id => {
        if (!$(id).classList.contains('hidden')) {
          if (id === 'pdfModal') _cancelPdf();
          closeModal(id);
        }
      });
      if (state.searchOpen) $('searchToggleBtn').click();
    }

    if (videoOpen) {
      const vid = $('videoPlayer');
      if (e.key === ' ' || e.code === 'Space' || e.key === 'k' || e.key === 'K') { e.preventDefault(); vpTogglePlay(); vpShowControls(); }
      if ((e.key === 'ArrowLeft'  || e.key === 'j' || e.key === 'J') && !e.shiftKey) { e.preventDefault(); vpSeek(-10); }
      if ((e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') && !e.shiftKey) { e.preventDefault(); vpSeek(10); }
      if (e.key === 'ArrowLeft'  && e.shiftKey) { e.preventDefault(); vpPrev(); vpShowControls(); }
      if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); vpNext(); vpShowControls(); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); vpSetVolume(vp.volume + 0.1); vpShowHud('vol', vp.volume); vpShowControls(); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); vpSetVolume(vp.volume - 0.1); vpShowHud('vol', vp.volume); vpShowControls(); }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); vpToggleMute(); vpShowHud('vol', vp.muted ? 0 : vp.volume); vpShowControls(); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); vpToggleFullscreen(); vpShowControls(); }
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); vpToggleTheater(); vpShowControls(); }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); vpTogglePiP(); vpShowControls(); }
      if (e.key === 'Home') { e.preventDefault(); vid.currentTime = 0; vpShowControls(); }
      if (e.key === 'End' && vid.duration) { e.preventDefault(); vid.currentTime = Math.max(0, vid.duration - 0.1); vpShowControls(); }
      if (/^[0-9]$/.test(e.key) && vid.duration) { e.preventDefault(); vid.currentTime = (Number(e.key) / 10) * vid.duration; vpShowControls(); }
      if ((e.key === '.' || e.key === ',') && vid.paused && vid.duration) {
        e.preventDefault();
        vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + (e.key === '.' ? 1 / 30 : -1 / 30)));
        vpShowControls();
      }
    }

  });

});