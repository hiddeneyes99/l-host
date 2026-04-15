/**
 * Hevi Explorer — Local File Manager
 * ─────────────────────────────────────────────────────────────────────────
 *  Protocol 1 : Dynamic Path Handling   — auto-detects Termux / Kali / Linux
 *  Protocol 2 : Zero Heavy Dependencies — only Node built-ins + express
 *  Protocol 3 : Smart Port Allocation   — finds a free port automatically
 *  Protocol 4 : Graceful Permission     — skips unreadable files silently
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express     = require('express');
const compression = require('compression');
const fs          = require('fs');
const path        = require('path');
const os          = require('os');
const net         = require('net');
const crypto      = require('crypto');
const { execFile, spawn } = require('child_process');
const https = require('https');

const APP_VERSION = require('./package.json').version;

const app  = express();
const HOST = '0.0.0.0';
let ACTIVE_PORT = 5000;

// ── Gzip responses — skip video (already compressed; gzip wastes CPU for 0 gain)
const VIDEO_EXTS = new Set(['.mp4','.mkv','.avi','.mov','.webm','.flv','.m4v','.3gp','.ts','.wmv','.rmvb','.vob','.ogg','.ogv']);
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/file' && req.query && req.query.path) {
      const ext = path.extname(req.query.path).toLowerCase();
      if (VIDEO_EXTS.has(ext)) return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
}));

// ── Per-file concurrent reader limiter — protects mobile host from I/O overload
const FILE_READERS    = new Map(); // absPath → active reader count
const MAX_FILE_READERS = 4;

function acquireReader(absPath) {
  const n = FILE_READERS.get(absPath) || 0;
  if (n >= MAX_FILE_READERS) return false;
  FILE_READERS.set(absPath, n + 1);
  return true;
}
function releaseReader(absPath) {
  const n = FILE_READERS.get(absPath) || 0;
  if (n <= 1) FILE_READERS.delete(absPath);
  else FILE_READERS.set(absPath, n - 1);
}

// ══════════════════════════════════════════════════════════════════════════
//  PROTOCOL 1 — Dynamic Path Handling
//  Auto-detect the running environment and set the best ROOT_DIR.
//  Priority: ROOT_DIR env var  →  auto-detect  →  homedir fallback
// ══════════════════════════════════════════════════════════════════════════

function detectEnvironment() {
  // Explicit override always wins
  if (process.env.ROOT_DIR) {
    return { env: 'custom', root: process.env.ROOT_DIR };
  }

  if (process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG) {
    const replRoot = path.join(__dirname, 'files');
    fs.mkdirSync(replRoot, { recursive: true });
    return { env: 'replit', root: replRoot };
  }

  // ── Termux (Android) ──────────────────────────────────────────────────
  // TERMUX_VERSION is exported by Termux automatically
  if (process.env.TERMUX_VERSION || process.env.TERMUX_PREFIX) {
    // Prefer external/shared storage if available
    const candidates = [
      '/sdcard',
      '/storage/emulated/0',
      `${process.env.TERMUX_PREFIX || '/data/data/com.termux/files/usr'}/../home`,
      process.env.HOME || '/data/data/com.termux/files/home',
    ];
    for (const c of candidates) {
      try {
        fs.accessSync(c, fs.constants.R_OK);
        return { env: 'termux', root: path.resolve(c) };
      } catch (_) {}
    }
    return { env: 'termux', root: os.homedir() };
  }

  // ── Android (non-Termux fallback) ─────────────────────────────────────
  if (process.platform === 'android') {
    const sdcard = '/sdcard';
    try { fs.accessSync(sdcard, fs.constants.R_OK); return { env: 'android', root: sdcard }; } catch (_) {}
    return { env: 'android', root: os.homedir() };
  }

  // ── Kali Linux / any Linux distro ─────────────────────────────────────
  if (process.platform === 'linux') {
    // Use homedir — respects both root and normal users
    const home = os.homedir();
    // If running as root in Kali, also offer /root or /
    const isRoot = process.getuid && process.getuid() === 0;
    if (isRoot) {
      const rootHome = '/root';
      try { fs.accessSync(rootHome, fs.constants.R_OK); return { env: 'linux-root', root: rootHome }; } catch (_) {}
    }
    return { env: 'linux', root: home };
  }

  // ── macOS / Windows fallback ──────────────────────────────────────────
  return { env: process.platform, root: os.homedir() };
}

const { env: DETECTED_ENV, root: ROOT_DIR_RAW } = detectEnvironment();
const ROOT_DIR = path.resolve(ROOT_DIR_RAW);

// ══════════════════════════════════════════════════════════════════════════
//  PROTOCOL 3 — Smart Port Allocation
//  Scan for a free port instead of hard-crashing on EADDRINUSE.
// ══════════════════════════════════════════════════════════════════════════

const PREFERRED_PORT = parseInt(process.env.PORT || '5000', 10);
const PORT_CANDIDATES = [
  PREFERRED_PORT, 8000, 8080, 8888, 9000, 3000, 4000, 7000, 6000, 10000,
].filter((p, i, a) => a.indexOf(p) === i);  // deduplicate

function isPortFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, HOST);
  });
}

async function findFreePort() {
  for (const port of PORT_CANDIDATES) {
    if (await isPortFree(port)) return port;
  }
  // Last resort: OS assigns a random free port
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, HOST, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  PROTOCOL 4 — Graceful Permission Handling
//  All FS operations are wrapped; unreadable items are silently skipped.
// ══════════════════════════════════════════════════════════════════════════

function canRead(absPath) {
  try { fs.accessSync(absPath, fs.constants.R_OK); return true; } catch (_) { return false; }
}

function safeStatSync(absPath) {
  try { return fs.statSync(absPath); } catch (_) { return null; }
}

function safeReaddirSync(absPath) {
  try {
    if (!canRead(absPath)) return [];
    return fs.readdirSync(absPath);
  } catch (_) { return []; }
}

// ══════════════════════════════════════════════════════════════════════════
//  MIME / CATEGORY helpers
// ══════════════════════════════════════════════════════════════════════════

const MIME_MAP = {
  '.mp4':'video/mp4','.mkv':'video/x-matroska','.avi':'video/x-msvideo',
  '.mov':'video/quicktime','.webm':'video/webm','.flv':'video/x-flv',
  '.m4v':'video/mp4','.3gp':'video/3gpp',
  '.ts':'video/mp2t','.wmv':'video/x-ms-wmv','.rmvb':'video/x-pn-realvideo',
  '.vob':'video/dvd','.ogg':'video/ogg','.ogv':'video/ogg',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.flac':'audio/flac',
  '.aac':'audio/aac','.m4a':'audio/mp4','.wma':'audio/x-ms-wma','.opus':'audio/opus',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif',
  '.webp':'image/webp','.bmp':'image/bmp','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.avif':'image/avif','.apng':'image/apng',
  '.tiff':'image/tiff','.tif':'image/tiff',
  '.heic':'image/heic','.heif':'image/heif',
  '.raw':'image/x-raw','.cr2':'image/x-canon-cr2','.nef':'image/x-nikon-nef',
  '.arw':'image/x-sony-arw','.dng':'image/x-adobe-dng',
  '.psd':'image/vnd.adobe.photoshop','.ai':'image/vnd.adobe.illustrator',
  '.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown',
  '.log':'text/plain','.json':'application/json','.xml':'application/xml',
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.py':'text/plain','.sh':'text/plain',
  '.c':'text/plain','.cpp':'text/plain','.h':'text/plain','.java':'text/plain',
  '.zip':'application/zip','.tar':'application/x-tar','.gz':'application/gzip',
  '.tgz':'application/x-tar','.tar.gz':'application/gzip',
  '.rar':'application/x-rar-compressed','.7z':'application/x-7z-compressed',
  '.z7':'application/octet-stream','.bz2':'application/x-bzip2','.xz':'application/x-xz',
  '.lz':'application/x-lzip','.lzma':'application/x-lzma','.zst':'application/zstd',
  '.apk':'application/vnd.android.package-archive',
};

const getMime = p => MIME_MAP[path.extname(p).toLowerCase()] || 'application/octet-stream';
const IMAGE_EXTS = new Set([
  '.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp','.ico','.avif','.apng',
  '.heic','.heif',
  '.raw','.cr2','.nef','.arw','.dng','.psd','.ai','.tiff','.tif',
]);
const THUMBNAIL_IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp','.ico','.avif','.apng']);
function canGenerateServerImagePreview(filePath) {
  return THUMBNAIL_IMAGE_EXTS.has(path.extname(filePath || '').toLowerCase());
}

function getCategory(ext) {
  const e = ext.toLowerCase();
  if (['.mp4','.mkv','.avi','.mov','.webm','.flv','.m4v','.3gp',
       '.ts','.wmv','.rmvb','.vob','.ogg','.ogv'].includes(e)) return 'video';
  if (IMAGE_EXTS.has(e)) return 'image';
  if (['.mp3','.wav','.flac','.aac','.m4a','.wma','.opus'].includes(e)) return 'audio';
  if (['.zip','.tar','.gz','.tgz','.rar','.7z','.z7','.bz2','.xz','.lz','.lzma','.zst'].includes(e)) return 'archive';
  if (['.apk'].includes(e)) return 'apk';
  return 'file';
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Security: keep paths within ROOT_DIR
function safePath(requested) {
  try {
    const resolved = path.resolve(ROOT_DIR, requested || '');
    const root = path.resolve(ROOT_DIR);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return resolved;
  } catch (_) { return null; }
}

// Build a file-info object — returns null on any permission / stat failure
function buildFileInfo(absPath, relPath, name) {
  const stat = safeStatSync(absPath);
  if (!stat) return null;
  const isDir = stat.isDirectory();
  const ext   = path.extname(name);
  return {
    name,
    type:     isDir ? 'dir' : 'file',
    size:     isDir ? null  : stat.size,
    sizeStr:  isDir ? '--'  : formatSize(stat.size),
    ext:      ext.toLowerCase(),
    category: isDir ? 'dir' : getCategory(ext),
    mtime:    stat.mtime.getTime(),
    mtimeStr: stat.mtime.toLocaleDateString(),
    readable: canRead(absPath),
    path:     relPath.replace(/\\/g, '/'),
  };
}

// ══════════════════════════════════════════════════════════════════════════
//  FILE INDEX  — persistent on-disk index + in-memory lookup tables
//  Eliminates full filesystem re-scan on every API request.
//  Flow: startup → load data/index.json → serve instantly
//        background → rebuild / incremental update → save back to disk
//        fs.watch → detect changes → patch index in real-time
// ══════════════════════════════════════════════════════════════════════════

const INDEX_FILE    = path.join(__dirname, 'data', 'index.json');
const APP_DATA_DIR  = path.join(__dirname, 'data');   // excluded from index & watcher
const INDEX_VERSION = 5;

// ── In-memory index state ──────────────────────────────────────────────────
const idx = {
  ready:      false,        // true once first index is available
  all:        [],           // FileInfo[] — every entry (files + dirs)
  files:      [],           // FileInfo[] — files only (for search / category)
  byRelPath:  new Map(),    // relPath   → FileInfo  (O(1) lookup)
  byParent:   new Map(),    // parentRel → FileInfo[] (for /api/ls)
  byCategory: new Map(),    // category  → FileInfo[] (for /api/category)
  builtAt:    0,
  rootDir:    '',
};

// ── Rebuild in-memory lookup maps from idx.all ─────────────────────────────
function rebuildMaps() {
  idx.byRelPath.clear();
  idx.byParent.clear();
  idx.byCategory.clear();
  idx.files = [];

  for (const item of idx.all) {
    idx.byRelPath.set(item.path, item);
    if (item.type !== 'dir') idx.files.push(item);

    const raw       = item.path.includes('/') ? item.path.substring(0, item.path.lastIndexOf('/')) : '';
    const parentKey = raw === '.' ? '' : raw;
    if (!idx.byParent.has(parentKey)) idx.byParent.set(parentKey, []);
    idx.byParent.get(parentKey).push(item);

    if (item.type !== 'dir') {
      const cat = item.category;
      if (!idx.byCategory.has(cat)) idx.byCategory.set(cat, []);
      idx.byCategory.get(cat).push(item);
    }
  }
  idx.ready = true;
}

// ── Save index to disk (debounced 2 s) ────────────────────────────────────
let _idxSaveTimer = null;
function scheduleIndexSave() {
  clearTimeout(_idxSaveTimer);
  _idxSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
      // Master index — used for search + recent files
      fs.writeFileSync(INDEX_FILE, JSON.stringify({
        version: INDEX_VERSION,
        builtAt: idx.builtAt,
        rootDir: idx.rootDir,
        all:     idx.all,
      }));
      // Per-category indexes — smaller files loaded on demand
      for (const [cat, catDir] of Object.entries(CAT_DATA)) {
        const items = idx.byCategory.get(cat) || [];
        fs.writeFileSync(path.join(catDir, 'index.json'), JSON.stringify({
          version: INDEX_VERSION,
          builtAt: idx.builtAt,
          rootDir: idx.rootDir,
          count:   items.length,
          items,
        }));
      }
      console.log(`[index] saved ${idx.all.length} entries (master + ${Object.keys(CAT_DATA).length} categories)`);
    } catch (e) {
      console.error('[index] disk save failed:', e.message);
    }
  }, 2000);
}

// ── Load persisted index from disk ────────────────────────────────────────
function loadIndexFromDisk() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    if (data.version !== INDEX_VERSION) return false;
    if (data.rootDir  !== ROOT_DIR)     return false;
    if (!Array.isArray(data.all))       return false;
    idx.all     = data.all;
    idx.builtAt = data.builtAt || 0;
    idx.rootDir = data.rootDir;
    rebuildMaps();
    console.log(`[index] loaded ${idx.all.length} entries (built ${new Date(idx.builtAt).toLocaleTimeString()})`);
    return true;
  } catch (_) { return false; }
}

// ── Full async scan (runs in background, does NOT block requests) ──────────
async function buildFullIndex() {
  console.log(`[index] full scan starting: ${ROOT_DIR}`);
  const t0  = Date.now();
  const all = [];

  async function walk(absDir, relDir, depth) {
    if (depth > 15) return;
    if (absDir.startsWith(APP_DATA_DIR)) return;
    let entries;
    try { entries = await fs.promises.readdir(absDir); } catch (_) { return; }
    await Promise.all(entries.map(async name => {
      const absPath = path.join(absDir, name);
      const relPath = relDir ? relDir + '/' + name : name;
      let stat;
      try { stat = await fs.promises.stat(absPath); } catch (_) { return; }
      const isDir = stat.isDirectory();
      const ext   = path.extname(name);
      all.push({
        name,
        type:     isDir ? 'dir'  : 'file',
        size:     isDir ? null   : stat.size,
        sizeStr:  isDir ? '--'   : formatSize(stat.size),
        ext:      ext.toLowerCase(),
        category: isDir ? 'dir'  : getCategory(ext),
        mtime:    stat.mtime.getTime(),
        mtimeStr: stat.mtime.toLocaleDateString(),
        readable: canRead(absPath),
        path:     relPath.replace(/\\/g, '/'),
      });
      if (isDir) await walk(absPath, relPath, depth + 1);
    }));
  }

  await walk(ROOT_DIR, '', 0);
  idx.all     = all;
  idx.builtAt = Date.now();
  idx.rootDir = ROOT_DIR;
  rebuildMaps();
  scheduleIndexSave();
  console.log(`[index] full scan done — ${all.length} entries in ${Date.now() - t0} ms`);
  // Kick off background thumbnail pre-generation for all media files
  startThumbPregen();
}

// ── Incremental update for one directory (triggered by fs.watch) ───────────
async function incrementalUpdateDir(absDir) {
  if (!absDir.startsWith(ROOT_DIR)) return;
  // Never index the app's own data directory (thumbs, index files, etc.)
  if (absDir.startsWith(APP_DATA_DIR)) return;
  const relDir = path.relative(ROOT_DIR, absDir).replace(/\\/g, '/');
  const normDir = relDir === '.' ? '' : relDir;

  // Remove stale entries whose direct parent is this dir
  idx.all = idx.all.filter(item => {
    const p = item.path.includes('/') ? item.path.substring(0, item.path.lastIndexOf('/')) : '';
    return p !== normDir;
  });

  // Re-read this directory (single level — very fast)
  let entries;
  try { entries = await fs.promises.readdir(absDir); } catch (_) { return; }

  for (const name of entries) {
    const absPath = path.join(absDir, name);
    const relPath = normDir ? normDir + '/' + name : name;
    let stat;
    try { stat = await fs.promises.stat(absPath); } catch (_) { continue; }
    const isDir = stat.isDirectory();
    const ext   = path.extname(name);
    idx.all.push({
      name,
      type:     isDir ? 'dir'  : 'file',
      size:     isDir ? null   : stat.size,
      sizeStr:  isDir ? '--'   : formatSize(stat.size),
      ext:      ext.toLowerCase(),
      category: isDir ? 'dir'  : getCategory(ext),
      mtime:    stat.mtime.getTime(),
      mtimeStr: stat.mtime.toLocaleDateString(),
      readable: canRead(absPath),
      path:     relPath.replace(/\\/g, '/'),
    });
  }

  rebuildMaps();
  // Note: no disk save here — watcher updates are memory-only.
  // Disk is written by buildFullIndex() (every 5 min) or on delete.
}

// ── Remove a single entry from the index (on delete) ──────────────────────
function indexRemovePath(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  // Remove the item and all its descendants
  idx.all = idx.all.filter(item => item.path !== norm && !item.path.startsWith(norm + '/'));
  rebuildMaps();
  scheduleIndexSave();
}

// ── fs.watch: real-time change detection ──────────────────────────────────
function startWatcher() {
  try {
    const watcher  = fs.watch(ROOT_DIR, { recursive: true });
    const pending  = new Set();
    let   debounce = null;

    watcher.on('change', (_, filename) => {
      if (!filename) return;
      const abs = path.resolve(ROOT_DIR, filename);
      // Skip changes inside the app's own data directory (thumbs, index, etc.)
      if (abs.startsWith(APP_DATA_DIR)) return;
      const stat   = safeStatSync(abs);
      const absDir = stat?.isDirectory() ? abs : path.dirname(abs);
      pending.add(absDir);
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const dirs = [...pending]; pending.clear();
        for (const d of dirs) await incrementalUpdateDir(d);
      }, 1000);
    });
    watcher.on('error', () => {});
    console.log('[index] watching for file changes');
  } catch (_) {
    // Fallback: periodic full rebuild every 5 minutes
    setInterval(() => buildFullIndex().catch(() => {}), 5 * 60 * 1000);
    console.log('[index] fs.watch unavailable — periodic refresh every 5 min');
  }
}

// ── Bootstrap: load disk cache, then refresh in background ────────────────
async function initIndex() {
  const loaded = loadIndexFromDisk();
  if (!loaded) {
    // No cache yet — build in background (server still serves requests)
    buildFullIndex().catch(e => console.error('[index] initial build error:', e));
  } else {
    // Cache loaded — run a background refresh after 5 s to pick up new files
    setTimeout(() => buildFullIndex().catch(() => {}), 5000);
  }
  startWatcher();
}

// ══════════════════════════════════════════════════════════════════════════
//  EXPRESS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
//  SERVER-SIDE THUMBNAIL CACHE  (in-memory LRU + disk, WebP 480×360)
// ══════════════════════════════════════════════════════════════════════════

const THUMB_W         = 300;
const THUMB_H         = 225;
const THUMB_CACHE_MAX = 200;
const thumbMemCache   = new Map(); // etag → Buffer

function thumbCacheGet(key) {
  if (!thumbMemCache.has(key)) return null;
  const val = thumbMemCache.get(key);
  thumbMemCache.delete(key); thumbMemCache.set(key, val);
  return val;
}
function thumbCacheSet(key, buf) {
  if (thumbMemCache.has(key)) thumbMemCache.delete(key);
  thumbMemCache.set(key, buf);
  if (thumbMemCache.size > THUMB_CACHE_MAX) thumbMemCache.delete(thumbMemCache.keys().next().value);
}

// Serve frontend (with long-term cache for CSS/JS/images)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  etag:   true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      // HTML/JS/CSS must revalidate so app updates propagate immediately
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.use('/vendor/heic2any', express.static(path.dirname(require.resolve('heic2any'))));

// ── Category-organised data directories ────────────────────────────────────
//  data/image/  → image index.json + thumbs/
//  data/video/  → video index.json + thumbs/
//  data/audio/  → audio index.json  (no thumbs)
//  data/archive/→ archive index.json
//  data/apk/    → apk index.json
//  data/file/   → file index.json
const CAT_DATA = {
  image:   path.join(__dirname, 'data', 'image'),
  video:   path.join(__dirname, 'data', 'video'),
  audio:   path.join(__dirname, 'data', 'audio'),
  archive: path.join(__dirname, 'data', 'archive'),
  apk:     path.join(__dirname, 'data', 'apk'),
  file:    path.join(__dirname, 'data', 'file'),
};
// Only images and videos have thumbnails
const CAT_THUMB = {
  image: path.join(CAT_DATA.image, 'thumbs'),
  video: path.join(CAT_DATA.video, 'thumbs'),
};
// Preview dir — 1920px WebP for large images (view quality, not thumbnail quality)
const PREVIEW_DIR = path.join(CAT_DATA.image, 'preview');
const PREVIEW_W   = 1920;
const PREVIEW_H   = 1920;
const PREVIEW_Q   = '90';
const PREVIEW_MIN = 2 * 1024 * 1024; // only generate preview for images ≥ 2 MB
// Legacy flat thumb dir (kept for backward-compat reads; new writes go to CAT_THUMB)
const THUMB_DIR = path.join(__dirname, 'data', 'thumbs');

// Ensure all dirs exist at startup
Object.values(CAT_DATA).forEach(d => fs.mkdirSync(d, { recursive: true }));
Object.values(CAT_THUMB).forEach(d => fs.mkdirSync(d, { recursive: true }));
fs.mkdirSync(THUMB_DIR,   { recursive: true });
fs.mkdirSync(PREVIEW_DIR, { recursive: true });

// cat = 'image' | 'video' — writes to category-specific thumbs/
function thumbDiskKey(etag, cat) {
  const dir = CAT_THUMB[cat] || THUMB_DIR;
  return path.join(dir, crypto.createHash('md5').update(etag).digest('hex') + '.webp');
}

// ── FFmpeg path detection ──────────────────────────────────────────────────
const FFMPEG_PATH = (() => {
  const candidates = [
    process.env.FFMPEG_PATH,
    // Replit
    '/nix/store/s41bqqrym7dlk8m3nk74fx26kgrx0kv8-replit-runtime-path/bin/ffmpeg',
    // Termux (Android)
    '/data/data/com.termux/files/usr/bin/ffmpeg',
    '/data/data/com.termux/files/usr/local/bin/ffmpeg',
    // Standard Linux / macOS
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    // Kali / Debian
    '/usr/bin/avconv',
  ].filter(Boolean);
  for (const p of candidates) {
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) {}
  }
  return 'ffmpeg'; // last-resort: rely on PATH
})();

// ── Termux / mobile detection ──────────────────────────────────────────────
const IS_TERMUX = !!(process.env.TERMUX_VERSION || process.env.TERMUX_PREFIX
  || FFMPEG_PATH.includes('com.termux'));

// Log FFmpeg availability and environment at startup
setImmediate(() => {
  if (IS_TERMUX) console.log('[thumbs] Termux/Android detected — 2 workers, 25s timeout');
  const { execFile } = require('child_process');
  execFile(FFMPEG_PATH, ['-version'], { timeout: 5000 }, (err, stdout) => {
    if (err) {
      console.log('[thumbs] ⚠️  FFmpeg not found — video thumbnails disabled');
      if (IS_TERMUX) console.log('[thumbs]    Run: pkg install ffmpeg');
      else           console.log('[thumbs]    Run: apt install ffmpeg  (or brew install ffmpeg)');
    } else {
      const ver = (stdout || '').split('\n')[0].replace('ffmpeg version ', '').split(' ')[0];
      console.log(`[thumbs] ✓ FFmpeg ${ver} — video thumbnails enabled`);
    }
  });
});

// ── Unified FFmpeg thumbnail spawner (images + video frames → WebP) ─────────
//  seekSecs = null  → image input (no seek needed)
//  seekSecs = N     → video input, seek to N seconds before reading
//  Output: WebP buffer at the given w×h (aspect-ratio preserved, fits inside box)
const FFMPEG_TIMEOUT_MS = IS_TERMUX ? 25000 : 20000;

function spawnFFmpegThumb(absPath, w, h, timeoutMs, seekSecs = null, quality = '82') {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };

    const args = [];
    if (seekSecs !== null) {
      // Fast seek before -i (I-frame only, no full decode)
      const hh = String(Math.floor(seekSecs / 3600)).padStart(2, '0');
      const mm = String(Math.floor((seekSecs % 3600) / 60)).padStart(2, '0');
      const ss = String(seekSecs % 60).padStart(2, '0');
      args.push('-probesize', '5M', '-analyzeduration', '0', '-ss', `${hh}:${mm}:${ss}`);
    }
    args.push(
      '-i', absPath,
      '-frames:v', '1',
      // Fit within w×h box, keep aspect ratio, force even dimensions (codec safe)
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-compression_level', '4', // 0-6, balanced speed vs file size
      '-q:v', quality,           // WebP quality 0-100 (higher = sharper)
      '-f', 'webp',
      'pipe:1',
    );

    const chunks = [];
    const proc = require('child_process').spawn(FFMPEG_PATH, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    proc.stdout.on('data', c => chunks.push(c));
    proc.on('close', code => {
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < 100) return done(reject, new Error(`ffmpeg exit ${code}`));
      done(resolve, buf);
    });
    proc.on('error', err => done(reject, err));
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      done(reject, new Error('ffmpeg timeout'));
    }, timeoutMs);
  });
}

async function generateVideoThumbnail(absPath, w, h) {
  // Try progressively later timestamps to skip black title cards / fade-ins.
  // Heuristic: a mostly-black WebP frame compresses to < 3 KB; real frames are larger.
  const timestamps = [5, 10, 30, 60, 120];
  let lastBuf = null;

  for (const secs of timestamps) {
    try {
      const buf = await spawnFFmpegThumb(absPath, w, h, FFMPEG_TIMEOUT_MS, secs);
      lastBuf = buf;
      if (buf.length > 3000) return buf; // good, non-black frame
    } catch (_) {}
  }

  if (lastBuf) return lastBuf;

  // Last resort: start of file (0 s) with no seek overhead
  return spawnFFmpegThumb(absPath, w, h, FFMPEG_TIMEOUT_MS, 0);
}

// ── Thumbnail concurrency throttle — limits parallel FFmpeg spawns ──────────
const THUMB_MAX = IS_TERMUX ? 2 : 4;
let _thumbSlots = THUMB_MAX;
const _thumbWaiters = [];
async function thumbThrottle(fn) {
  if (_thumbSlots > 0) {
    _thumbSlots--;
    try { return await fn(); } finally {
      _thumbSlots++;
      if (_thumbWaiters.length) _thumbWaiters.shift()();
    }
  }
  await new Promise(r => _thumbWaiters.push(r));
  return thumbThrottle(fn);
}

// ── Core thumbnail generator (shared by API route + pre-gen queue) ─────────
//  Uses FFmpeg for both images and videos — no native sharp required.
async function generateThumbnail(absPath, w, h) {
  const mime    = getMime(absPath);
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  if (!isImage && !isVideo) return null;
  if (isImage && !canGenerateServerImagePreview(absPath)) return null;

  return thumbThrottle(async () => {
    if (isVideo) return generateVideoThumbnail(absPath, w, h);
    // Image: single FFmpeg pass → small WebP saved to data/thumbs/
    return spawnFFmpegThumb(absPath, w, h, FFMPEG_TIMEOUT_MS, null);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  BACKGROUND THUMBNAIL PRE-GENERATION QUEUE
//  Runs after index is built — 4 parallel workers, skip already-cached files
// ═══════════════════════════════════════════════════════════════════════════

// Termux/mobile: 2 workers to avoid overheating; desktop: 4
const thumbQueue = { jobs: [], running: 0, WORKERS: IS_TERMUX ? 2 : 4 };

async function thumbWorkerLoop() {
  while (thumbQueue.jobs.length > 0) {
    const item = thumbQueue.jobs.shift();
    if (!item) continue;
    try {
      const absPath = safePath(item.path);
      if (!absPath || !canRead(absPath)) continue;
      const stat = safeStatSync(absPath);
      if (!stat || !stat.isFile()) continue;
      const mime = getMime(absPath);
      const isMedia = mime.startsWith('image/');
      if (!isMedia) continue;
      if (!canGenerateServerImagePreview(absPath)) continue;
      const cat      = 'image';
      const typeTag  = 'i';
      const etag = `"th4-${typeTag}-${THUMB_W}x${THUMB_H}-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
      const diskPath = thumbDiskKey(etag, cat);
      if (fs.existsSync(diskPath)) continue; // already cached, skip
      const buf = await generateThumbnail(absPath, THUMB_W, THUMB_H);
      if (buf) {
        fs.writeFileSync(diskPath, buf);
        thumbCacheSet(etag, buf);
      }
    } catch (_) {}
  }
  thumbQueue.running--;
}

function startThumbPregen() {
  const mediaFiles = idx.files.filter(i => i.category === 'image');
  if (!mediaFiles.length) return;
  const images = mediaFiles.filter(i => i.category === 'image');
  thumbQueue.jobs.push(...images);
  const toStart = Math.min(thumbQueue.WORKERS, thumbQueue.WORKERS - thumbQueue.running);
  for (let i = 0; i < toStart; i++) {
    if (thumbQueue.running < thumbQueue.WORKERS) {
      thumbQueue.running++;
      thumbWorkerLoop().catch(() => { thumbQueue.running--; });
    }
  }
  console.log(`[thumbs] pre-generating ${images.length} images (${thumbQueue.WORKERS} workers)`);
}

// ── Queue specific paths on-demand (called by frontend lazy loader) ────────
function enqueueThumbOnDemand(relPath) {
  // Skip if already in queue
  if (thumbQueue.jobs.some(j => j.path === relPath)) return;
  const item = idx.byRelPath.get(relPath);
  if (!item || item.type === 'dir') return;
  const mime = getMime(item.name);
  if (!mime.startsWith('image/')) return;
  if (!canGenerateServerImagePreview(item.name)) return;
  // Push to front of queue so on-demand items are processed first
  thumbQueue.jobs.unshift(item);
  if (thumbQueue.running < thumbQueue.WORKERS) {
    thumbQueue.running++;
    thumbWorkerLoop().catch(() => { thumbQueue.running--; });
  }
}

// ── Image EXIF metadata API ───────────────────────────────────────────────
app.get('/api/imgmeta', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath || !canRead(absPath)) return res.json({});
  const stat = safeStatSync(absPath);
  if (!stat || !stat.isFile()) return res.json({});

  const folder = path.dirname(relPath).replace(/\\/g, '/') || '/';
  const base = { Path: relPath, Folder: folder };

  try {
    const exifr = require('exifr');
    const exif = await exifr.parse(absPath, {
      pick: ['Make','Model','ISOSpeedRatings','ISO','DateTimeOriginal',
             'GPSLatitude','GPSLongitude','GPSLatitudeRef','GPSLongitudeRef',
             'ExifImageWidth','ExifImageHeight','ImageWidth','ImageHeight']
    }).catch(() => null);

    if (!exif) return res.json(base);

    const camera = [exif.Make, exif.Model].filter(Boolean).join(' ') || null;
    const iso    = exif.ISOSpeedRatings || exif.ISO || null;
    let location = null;
    if (exif.GPSLatitude != null && exif.GPSLongitude != null) {
      const lat = typeof exif.GPSLatitude === 'number' ? exif.GPSLatitude : exif.GPSLatitude[0];
      const lon = typeof exif.GPSLongitude === 'number' ? exif.GPSLongitude : exif.GPSLongitude[0];
      location = `${Math.abs(lat).toFixed(5)}° ${exif.GPSLatitudeRef||'N'}, ${Math.abs(lon).toFixed(5)}° ${exif.GPSLongitudeRef||'E'}`;
    }
    const resolution = (exif.ExifImageWidth || exif.ImageWidth)
      ? `${exif.ExifImageWidth||exif.ImageWidth} × ${exif.ExifImageHeight||exif.ImageHeight}`
      : null;
    const date = exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toLocaleString() : null;

    const result = { ...base };
    if (camera)     result.Camera     = camera;
    if (iso)        result.ISO        = String(iso);
    if (date)       result.Date       = date;
    if (location)   result.Location   = location;
    if (resolution) result.Resolution = resolution;

    res.json(result);
  } catch (e) {
    res.json(base);
  }
});

// ── Thumbnail API — WebP 200×150, disk + memory cached ─────────────────────
app.get('/api/thumb', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).end();
  if (!canRead(absPath)) return res.status(403).end();

  const stat = safeStatSync(absPath);
  if (!stat || !stat.isFile()) return res.status(404).end();

  const mime    = getMime(absPath);
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  if (!isImage && !isVideo) return res.status(404).end();

  if (isVideo) {
    return res.status(404).json({ clientSide: true });
  }
  if (!canGenerateServerImagePreview(absPath)) {
    return res.status(404).json({ unsupportedPreview: true });
  }

  const w       = Math.min(600, Math.max(50, parseInt(req.query.w || String(THUMB_W), 10)));
  const h       = Math.min(480, Math.max(50, parseInt(req.query.h || String(THUMB_H), 10)));
  const cat     = 'image';
  const typeTag = 'i';
  const etag    = `"th4-${typeTag}-${w}x${h}-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;

  if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();

  // Memory cache hit
  const cached = thumbCacheGet(etag);
  if (cached) {
    return res.writeHead(200, {
      'Content-Type':   'image/webp',
      'Content-Length': cached.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
    }).end(cached);
  }

  // Disk cache hit — check category dir first, then legacy flat dir
  const diskPath = thumbDiskKey(etag, cat);
  const legacyPath = thumbDiskKey(etag, null);
  const diskHit = fs.existsSync(diskPath) ? diskPath
                : fs.existsSync(legacyPath) ? legacyPath : null;
  if (diskHit) {
    const buf = fs.readFileSync(diskHit);
    thumbCacheSet(etag, buf);
    return res.writeHead(200, {
      'Content-Type':   'image/webp',
      'Content-Length': buf.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
    }).end(buf);
  }

  try {
    const buf = await generateThumbnail(absPath, w, h);
    if (!buf) return res.status(404).end();
    fs.writeFileSync(diskPath, buf);
    thumbCacheSet(etag, buf);
    res.writeHead(200, {
      'Content-Type':   'image/webp',
      'Content-Length': buf.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
    });
    res.end(buf);
  } catch (err) {
    console.warn('[thumb] sharp failed for', relPath, err?.message || err);
    res.status(500).end();
  }
});

// ── On-demand thumbnail queue — frontend requests specific files ───────────
//  POST /api/thumb/queue  body: { paths: [relPath, ...] }
//  Returns immediately; background worker does the actual generation.
app.post('/api/thumb/queue', express.json(), (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  let queued = 0;
  for (const p of paths.slice(0, 50)) {
    enqueueThumbOnDemand(String(p));
    queued++;
  }
  res.json({ ok: true, queued });
});

// ── Thumbnail ready check — returns 200 {ready:true} if cached ────────────
app.get('/api/thumb/status', (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.json({ ready: false });
  const stat = safeStatSync(absPath);
  if (!stat) return res.json({ ready: false });
  const mime    = getMime(absPath);
  const cat     = mime.startsWith('video/') ? 'video' : 'image';
  const typeTag = cat === 'video' ? 'v' : 'i';
  const etag    = `"th4-${typeTag}-${THUMB_W}x${THUMB_H}-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
  const inMem   = thumbMemCache.has(etag);
  const onDisk  = fs.existsSync(thumbDiskKey(etag, cat)) || fs.existsSync(thumbDiskKey(etag, null));
  res.json({ ready: inMem || onDisk });
});

// ── Image Preview API — 1920px WebP, cached, for large images in viewer ─────
//  For images < PREVIEW_MIN: redirect to full file (fast enough).
//  For large images: generate+cache a 1920px WebP so the viewer doesn't have
//  to download 40 MB just to display it on a phone screen.
app.get('/api/preview', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath || !canRead(absPath)) return res.status(403).end();

  const stat = safeStatSync(absPath);
  if (!stat || !stat.isFile()) return res.status(404).end();

  const mime = getMime(absPath);
  if (!mime.startsWith('image/')) return res.status(404).end();
  if (!canGenerateServerImagePreview(absPath)) return res.status(415).end();

  // Small images → full original is fine, redirect directly
  if (stat.size < PREVIEW_MIN) {
    return res.redirect(`/file?path=${encodeURIComponent(relPath)}`);
  }

  const etag = `"pv1-${PREVIEW_W}x${PREVIEW_H}-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();

  const diskKey = path.join(PREVIEW_DIR,
    crypto.createHash('md5').update(etag).digest('hex') + '.webp');

  // Disk cache hit — instant response
  if (fs.existsSync(diskKey)) {
    const buf = fs.readFileSync(diskKey);
    return res.writeHead(200, {
      'Content-Type':   'image/webp',
      'Content-Length': buf.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
    }).end(buf);
  }

  // Generate preview (FFmpeg: decode + resize → WebP 90q)
  // Client already shows the thumbnail, so blocking here is acceptable.
  try {
    const buf = await thumbThrottle(() =>
      spawnFFmpegThumb(absPath, PREVIEW_W, PREVIEW_H, FFMPEG_TIMEOUT_MS * 3, null, PREVIEW_Q)
    );
    if (!buf) return res.status(500).end();
    fs.writeFileSync(diskKey, buf);
    res.writeHead(200, {
      'Content-Type':   'image/webp',
      'Content-Length': buf.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
    });
    res.end(buf);
    console.log(`[preview] generated ${relPath} (${(buf.length/1024).toFixed(0)} KB, was ${(stat.size/1024/1024).toFixed(1)} MB)`);
  } catch (err) {
    console.warn('[preview] failed for', relPath, err?.message);
    // Fallback: redirect to full file (user may have to wait, but it works)
    res.redirect(`/file?path=${encodeURIComponent(relPath)}`);
  }
});

// ── List directory / Sort + hidden helpers ────────────────────────────────
function applySort(items, sort, dir) {
  const d = dir === 'desc' ? -1 : 1;
  return items.slice().sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    switch (sort) {
      case 'size': return d * ((a.size || 0) - (b.size || 0));
      case 'date': return d * ((a.mtime || 0) - (b.mtime || 0));
      case 'type': {
        const ec = d * ((a.ext || '').localeCompare(b.ext || ''));
        return ec !== 0 ? ec : a.name.localeCompare(b.name);
      }
      default: return d * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    }
  });
}

function applyHidden(items, showHidden) {
  if (showHidden) return items;
  return items.filter(i => !i.name.startsWith('.'));
}

function walkCategoryFallback(startPath, cat, showHidden, maxItems = 20000) {
  const rawAll = [];
  function walk(dir, relDir, depth) {
    if (depth > 15 || rawAll.length >= maxItems) return;
    const entries = safeReaddirSync(dir);
    for (const name of entries) {
      if (rawAll.length >= maxItems) break;
      if (!showHidden && name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const rel = relDir ? relDir + '/' + name : name;
      const info = buildFileInfo(full, rel, name);
      if (!info) continue;
      if (info.type === 'dir') walk(full, rel, depth + 1);
      else if (info.category === cat) rawAll.push(info);
    }
  }
  walk(startPath, '', 0);
  return rawAll;
}

function walkSearchFallback(startPath, q, showHidden, maxItems = 20000) {
  const all = [];
  function walk(dir, relDir, depth) {
    if (depth > 15 || all.length >= maxItems) return;
    const entries = safeReaddirSync(dir);
    for (const name of entries) {
      if (all.length >= maxItems) break;
      if (!showHidden && name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const rel = relDir ? relDir + '/' + name : name;
      const info = buildFileInfo(full, rel, name);
      if (!info) continue;
      if (name.toLowerCase().includes(q)) all.push(info);
      if (info.type === 'dir') walk(full, rel, depth + 1);
    }
  }
  walk(startPath, '', 0);
  return all;
}

app.get('/api/ls', (req, res) => {
  const relPath    = decodeURIComponent(req.query.path || '');
  const absPath    = safePath(relPath);
  if (!absPath) return res.status(403).json({ error: 'Access denied' });
  if (!canRead(absPath)) return res.status(403).json({ error: 'Permission denied', items: [] });

  const stat = safeStatSync(absPath);
  if (!stat) return res.status(404).json({ error: 'Not found' });
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const page       = Math.max(0, parseInt(req.query.page  || '0',  10));
  const limit      = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const sort       = ['name','size','date','type'].includes(req.query.sort) ? req.query.sort : 'name';
  const sortDir    = req.query.sortDir === 'desc' ? 'desc' : 'asc';
  const showHidden = req.query.hidden !== '0';

  // ── Use in-memory index if ready (instant, no disk I/O) ─────────────────
  if (idx.ready) {
    const normRel = relPath.replace(/\\/g, '/');
    const raw     = idx.byParent.get(normRel) || [];
    const items   = applySort(applyHidden(raw, showHidden), sort, sortDir);
    const total   = items.length;
    const slice   = items.slice(page * limit, (page + 1) * limit);
    return res.json({
      path: relPath, absPath, items: slice, total, page, limit,
      hasMore: (page + 1) * limit < total,
      parent:  relPath ? path.dirname(relPath).replace(/\\/g, '/') : null,
    });
  }

  // ── Fallback: direct disk read (used only before index is ready) ─────────
  const entries = safeReaddirSync(absPath);
  const rawItems = [];
  for (const name of entries) {
    const info = buildFileInfo(path.join(absPath, name), path.join(relPath, name), name);
    if (info) rawItems.push(info);
  }
  const items = applySort(applyHidden(rawItems, showHidden), sort, sortDir);
  const total = items.length;
  const slice = items.slice(page * limit, (page + 1) * limit);
  res.json({
    path: relPath, absPath, items: slice, total, page, limit,
    hasMore: (page + 1) * limit < total,
    parent:  relPath ? path.dirname(relPath).replace(/\\/g, '/') : null,
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q          = (req.query.q || '').toLowerCase().trim();
  const startPath  = safePath(decodeURIComponent(req.query.path || ''));
  if (!q || !startPath) return res.json({ results: [], total: 0 });

  const page       = Math.max(0, parseInt(req.query.page  || '0',  10));
  const limit      = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const showHidden = req.query.hidden !== '0';

  // ── Index-powered search (instant, searches all files in memory) ─────────
  if (idx.ready) {
    const all   = applyHidden(idx.all.filter(item => item.name.toLowerCase().includes(q)), showHidden);
    const total = all.length;
    const slice = all.slice(page * limit, (page + 1) * limit);
    return res.json({ results: slice, total, page, limit, hasMore: (page + 1) * limit < total, query: q });
  }

  const all = walkSearchFallback(startPath, q, showHidden);
  const total = all.length;
  const slice = all.slice(page * limit, (page + 1) * limit);
  res.json({ results: slice, total, page, limit, hasMore: (page + 1) * limit < total, query: q });
});

// ── Category listing ────────────────────────────────────────────────────────
app.get('/api/category/:cat', (req, res) => {
  const cat        = req.params.cat;
  const page       = Math.max(0, parseInt(req.query.page  || '0',  10));
  const limit      = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const sort       = ['name','size','date','type'].includes(req.query.sort) ? req.query.sort : 'date';
  const sortDir    = req.query.sortDir === 'asc' ? 'asc' : 'desc';
  const showHidden = req.query.hidden !== '0';

  // ── Index-powered (instant O(1) lookup, no disk I/O) ─────────────────────
  if (idx.ready) {
    const raw   = applyHidden(idx.byCategory.get(cat) || [], showHidden);
    const all   = applySort(raw, sort, sortDir);
    const total = all.length;
    const slice = all.slice(page * limit, (page + 1) * limit);
    return res.json({ category: cat, results: slice, total, page, limit, hasMore: (page + 1) * limit < total });
  }

  const startPath = safePath('');
  if (!startPath) return res.status(403).json({ error: 'Access denied' });
  const rawAll = walkCategoryFallback(startPath, cat, showHidden);
  const all   = applySort(rawAll, sort, sortDir);
  const total = all.length;
  const slice = all.slice(page * limit, (page + 1) * limit);
  res.json({ category: cat, results: slice, total, page, limit, hasMore: (page + 1) * limit < total });
});

// ── Stream / download a file ───────────────────────────────────────────────
//  Chunk size tuning:
//   • 4 MB  — safe on mobile hosts (low RAM), fast enough for LAN
//   • Larger chunks = fewer HTTP round-trips but more RAM on host
const CHUNK_MAX = 4 * 1024 * 1024;

app.get('/file', (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).send('Access denied');
  if (!canRead(absPath)) return res.status(403).send('Permission denied');

  const stat = safeStatSync(absPath);
  if (!stat || !stat.isFile()) return res.status(404).send('Not found');

  const mime     = getMime(absPath);
  const size     = stat.size;
  const range    = req.headers.range;
  const download = req.query.dl === '1';

  const isVideo  = mime.startsWith('video/') && !download;
  const isStatic = mime.startsWith('image/') || mime.startsWith('audio/');
  const etag     = `"${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;

  // ── ETag conditional cache for static media (image / audio) ────────────
  if (isStatic && !download && req.headers['if-none-match'] === etag) {
    return res.writeHead(304).end();
  }

  // ── Per-file reader limit for video — protects mobile host ─────────────
  if (isVideo) {
    if (!acquireReader(absPath)) {
      return res.status(429)
        .set({ 'Retry-After': '2', 'Content-Type': 'text/plain' })
        .send('Server busy — too many concurrent streams on this file. Retry in 2 s.');
    }
    const release = () => releaseReader(absPath);
    res.on('close',  release);
    res.on('finish', release);
  }

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start        = parseInt(startStr, 10) || 0;
    const requestedEnd = endStr ? parseInt(endStr, 10) : size - 1;
    const end          = Math.min(requestedEnd, start + CHUNK_MAX - 1, size - 1);
    const chunkSize    = end - start + 1;
    try {
      const stream = fs.createReadStream(absPath, { start, end, highWaterMark: 256 * 1024 });
      const rangeHeaders = {
        'Content-Range':  `bytes ${start}-${end}/${size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   mime,
        'Last-Modified':  stat.mtime.toUTCString(),
        'ETag':           etag,
      };
      // Cache video chunks for 1 h — browser won't re-fetch the same byte range on re-seek
      if (isVideo)  rangeHeaders['Cache-Control'] = 'public, max-age=3600';
      if (isStatic) rangeHeaders['Cache-Control'] = 'public, max-age=86400';
      res.writeHead(206, rangeHeaders);
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch (_) { res.status(500).end(); }
  } else {
    const headers = {
      'Content-Length': size,
      'Content-Type':   mime,
      'Accept-Ranges':  'bytes',
      'Last-Modified':  stat.mtime.toUTCString(),
      'ETag':           etag,
    };
    if (isStatic && !download) {
      headers['Cache-Control'] = 'public, max-age=86400';
    } else if (!download) {
      headers['Cache-Control'] = 'no-cache';
    }
    if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(absPath)}"`;
    try {
      res.writeHead(200, headers);
      const stream = fs.createReadStream(absPath, { highWaterMark: CHUNK_MAX });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch (_) { res.status(500).end(); }
  }
});

// ── HEIC / HEIF → JPEG inline preview ─────────────────────────────────────
app.get('/api/heic-preview', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).send('Access denied');
  if (!canRead(absPath)) return res.status(403).send('Permission denied');
  const stat = safeStatSync(absPath);
  if (!stat || !stat.isFile()) return res.status(404).send('Not found');

  const etag = `"heicprev-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();

  try {
    const buf = await new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      const done = (fn, val) => { if (!settled) { settled = true; fn(val); } };
      const args = ['-i', absPath, '-f', 'image2', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'];
      const proc = require('child_process').spawn(FFMPEG_PATH, args, { stdio: ['ignore','pipe','ignore'] });
      proc.stdout.on('data', c => chunks.push(c));
      proc.on('close', code => {
        const b = Buffer.concat(chunks);
        if (code !== 0 || b.length < 100) return done(reject, new Error('ffmpeg failed'));
        done(resolve, b);
      });
      proc.on('error', err => done(reject, err));
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch(_) {} done(reject, new Error('timeout')); }, 20000);
    });
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400',
      'ETag': etag,
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(200, { 'Content-Type': 'image/heic', 'Content-Length': stat.size });
    fs.createReadStream(absPath).pipe(res);
  }
});

// ── Archive contents listing ────────────────────────────────────────────────
app.get('/api/archive-list', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).json({ error: 'Access denied' });
  if (!canRead(absPath)) return res.status(403).json({ error: 'Permission denied' });
  const stat = safeStatSync(absPath);
  if (!stat || !stat.isFile()) return res.status(404).json({ error: 'Not found' });

  const ext = path.extname(absPath).toLowerCase();
  const isZipLike = ['.zip', '.apk', '.jar', '.xlsx', '.docx', '.pptx'].includes(ext);
  const isTar = ['.tar', '.tgz'].includes(ext);
  const isGz = ext === '.gz';

  try {
    if (isZipLike) {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(absPath);
      const entries = zip.getEntries().map(e => ({
        name: e.name || path.basename(e.entryName),
        path: e.entryName.replace(/\\/g, '/'),
        size: e.header.size,
        compressedSize: e.header.compressedSize,
        isDir: e.isDirectory,
        modified: e.header.time ? new Date(e.header.time).toLocaleDateString() : '',
      }));
      return res.json({ type: 'zip', entries, total: entries.length });
    }

    if (isTar || isGz) {
      const tarArgs = isTar ? ['-tf', absPath] : (ext === '.gz' ? ['-tzf', absPath] : ['-tf', absPath]);
      const lines = await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn('tar', tarArgs, { stdio: ['ignore','pipe','ignore'] });
        const out = [];
        proc.stdout.on('data', d => out.push(d));
        proc.on('close', code => {
          if (code !== 0 && out.length === 0) return reject(new Error('tar failed'));
          resolve(Buffer.concat(out).toString().trim().split('\n').filter(Boolean));
        });
        proc.on('error', reject);
        setTimeout(() => { try { proc.kill(); } catch(_) {} reject(new Error('timeout')); }, 10000);
      });
      const entries = lines.map(l => ({
        name: path.basename(l) || l,
        path: l,
        size: null,
        isDir: l.endsWith('/'),
        modified: '',
      }));
      return res.json({ type: 'tar', entries, total: entries.length });
    }

    // Try 7z for rar/7z
    if (['.rar', '.7z'].includes(ext)) {
      const lines = await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const proc = spawn('7z', ['l', '-ba', absPath], { stdio: ['ignore','pipe','ignore'] });
        const out = [];
        proc.stdout.on('data', d => out.push(d));
        proc.on('close', code => {
          const raw = Buffer.concat(out).toString().trim();
          if (!raw) return reject(new Error('no output'));
          resolve(raw.split('\n').filter(Boolean));
        });
        proc.on('error', reject);
        setTimeout(() => { try { proc.kill(); } catch(_) {} reject(new Error('timeout')); }, 10000);
      });
      const entries = lines.map(l => {
        const parts = l.trim().split(/\s+/);
        const name = parts.slice(5).join(' ') || l;
        const attr = parts[4] || '';
        return { name: path.basename(name) || name, path: name, size: parseInt(parts[3]) || null, isDir: attr.startsWith('D'), modified: '' };
      });
      return res.json({ type: '7z', entries, total: entries.length });
    }

    return res.status(400).json({ error: 'Preview not supported for this compressed file. Download it and extract it with a file extractor.' });
  } catch (e) {
    return res.status(500).json({ error: 'Could not read archive. Download it and extract it with a file extractor. Details: ' + e.message });
  }
});

// ── Upload ─────────────────────────────────────────────────────────────────
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

app.post('/api/upload', (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const destDir = safePath(relPath);
  if (!destDir) return res.status(403).json({ error: 'Access denied' });
  if (!canRead(destDir)) return res.status(403).json({ error: 'Permission denied on destination' });

  const ct = req.headers['content-type'] || '';
  const bm = ct.match(/boundary=(.+)/);
  if (!bm) return res.status(400).json({ error: 'No boundary' });
  const boundary = bm[1];

  const chunks = [];
  let received = 0;
  let tooLarge = false;
  req.on('data', c => {
    received += c.length;
    if (received > MAX_UPLOAD_BYTES) {
      tooLarge = true;
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      const body   = Buffer.concat(chunks);
      const bBuf   = Buffer.from('--' + boundary);
      let   start  = 0;
      const saved  = [];
      while (start < body.length) {
        const bi = body.indexOf(bBuf, start);
        if (bi === -1) break;
        const cs = bi + bBuf.length;
        if (body[cs] === 45 && body[cs + 1] === 45) break;
        const le = body.indexOf('\r\n\r\n', cs);
        if (le === -1) break;
        const headers = body.slice(cs + 2, le).toString();
        const ce      = body.indexOf(Buffer.from('\r\n--' + boundary), le);
        if (ce === -1) break;
        const content = body.slice(le + 4, ce);
        const fnMatch = headers.match(/filename="([^"]+)"/);
        if (fnMatch) {
          const filename = path.basename(fnMatch[1]);
          try {
            fs.writeFileSync(path.join(destDir, filename), content);
            saved.push(filename);
          } catch (writeErr) { /* Protocol 4: skip unwritable */ }
        }
        start = ce;
      }
      res.json({ saved });
      // Update index for the destination directory
      incrementalUpdateDir(destDir).catch(() => {});
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  req.on('error', e => {
    if (tooLarge) return res.status(413).json({ error: 'Upload too large' });
    res.status(500).json({ error: e.message });
  });
});

// ── Create folder ──────────────────────────────────────────────────────────
app.post('/api/mkdir', express.json(), (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const name    = (req.body?.name || '').replace(/[/\\<>:"|?*]/g, '').trim();
  if (!name) return res.status(400).json({ error: 'Invalid folder name' });
  const dest = safePath(path.join(relPath, name));
  if (!dest) return res.status(403).json({ error: 'Access denied' });
  try {
    fs.mkdirSync(dest, { recursive: true });
    res.json({ ok: true });
    // Update the parent directory in the index
    incrementalUpdateDir(path.dirname(dest)).catch(() => {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete ─────────────────────────────────────────────────────────────────
app.delete('/api/delete', express.json(), (req, res) => {
  const relPath = decodeURIComponent((req.query.path || req.body?.path) || '');
  if (!relPath.trim()) return res.status(400).json({ error: 'Refusing to delete root directory' });
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).json({ error: 'Access denied' });
  try {
    const stat = safeStatSync(absPath);
    if (!stat) return res.status(404).json({ error: 'Not found' });
    const parentDir = path.dirname(absPath);
    if (stat.isDirectory()) fs.rmSync(absPath, { recursive: true, force: true });
    else fs.unlinkSync(absPath);
    res.json({ ok: true });
    // Remove from index immediately, then refresh parent
    indexRemovePath(relPath);
    incrementalUpdateDir(parentDir).catch(() => {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Rename ─────────────────────────────────────────────────────────────────
app.post('/api/rename', express.json(), (req, res) => {
  const relPath = decodeURIComponent(req.body?.path || req.query.path || '');
  const newName = (req.body?.name || '').replace(/[/\\<>:"|?*\x00-\x1f]/g, '').trim();
  if (!newName) return res.status(400).json({ error: 'Invalid name' });
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).json({ error: 'Access denied' });
  const stat = safeStatSync(absPath);
  if (!stat) return res.status(404).json({ error: 'Not found' });
  const destAbs = path.join(path.dirname(absPath), newName);
  if (fs.existsSync(destAbs)) return res.status(409).json({ error: 'A file with that name already exists' });
  try {
    fs.renameSync(absPath, destAbs);
    indexRemovePath(relPath);
    incrementalUpdateDir(path.dirname(absPath)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Copy ────────────────────────────────────────────────────────────────────
app.post('/api/copy', express.json(), (req, res) => {
  const src  = decodeURIComponent(req.body?.src  || '');
  const dest = decodeURIComponent(req.body?.dest || '');
  if (!src || !dest) return res.status(400).json({ error: 'src and dest required' });
  const absSrc  = safePath(src);
  const absDest = safePath(dest);
  if (!absSrc || !absDest) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(absSrc))  return res.status(404).json({ error: 'Source not found' });
  if (fs.existsSync(absDest))  return res.status(409).json({ error: 'Destination already exists' });
  try {
    const srcStat = safeStatSync(absSrc);
    if (srcStat && srcStat.isDirectory()) fs.cpSync(absSrc, absDest, { recursive: true });
    else { fs.mkdirSync(path.dirname(absDest), { recursive: true }); fs.copyFileSync(absSrc, absDest); }
    incrementalUpdateDir(path.dirname(absDest)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Move ─────────────────────────────────────────────────────────────────
app.post('/api/move', express.json(), (req, res) => {
  const src  = decodeURIComponent(req.body?.src  || '');
  const dest = decodeURIComponent(req.body?.dest || '');
  if (!src || !dest) return res.status(400).json({ error: 'src and dest required' });
  const absSrc  = safePath(src);
  const absDest = safePath(dest);
  if (!absSrc || !absDest) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(absSrc))  return res.status(404).json({ error: 'Source not found' });
  if (fs.existsSync(absDest))  return res.status(409).json({ error: 'Destination already exists' });
  try {
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    try {
      fs.renameSync(absSrc, absDest);
    } catch (_) {
      // Cross-device: copy then delete
      const srcStat = safeStatSync(absSrc);
      if (srcStat && srcStat.isDirectory()) { fs.cpSync(absSrc, absDest, { recursive: true }); fs.rmSync(absSrc, { recursive: true, force: true }); }
      else { fs.copyFileSync(absSrc, absDest); fs.unlinkSync(absSrc); }
    }
    indexRemovePath(src);
    incrementalUpdateDir(path.dirname(absSrc)).catch(() => {});
    incrementalUpdateDir(path.dirname(absDest)).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Album Art ──────────────────────────────────────────────────────────────
app.get('/api/art', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).end();
  if (!canRead(absPath)) return res.status(403).end();

  const stat = safeStatSync(absPath);
  if (!stat) return res.status(404).end();

  const etag     = `"art-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();

  // Check disk cache first — art extraction is slow on first run
  const diskPath = path.join(THUMB_DIR, 'art_' + crypto.createHash('md5').update(absPath + etag).digest('hex') + '.jpg');
  if (fs.existsSync(diskPath)) {
    const buf = fs.readFileSync(diskPath);
    res.writeHead(200, {
      'Content-Type':   'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(buf);
  }

  try {
    const { parseFile } = await import('music-metadata');
    // duration: false = skip full scan, read only tags at start of file
    const meta = await parseFile(absPath, { skipCovers: false, duration: false });
    const pics  = meta.common.picture;
    if (!pics || !pics.length) return res.status(404).end();
    const pic = pics[0];
    const buf = pic.data;

    try { fs.writeFileSync(diskPath, buf); } catch (_) {}

    res.writeHead(200, {
      'Content-Type':   pic.format || 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control':  'public, max-age=604800',
      'ETag':           etag,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  } catch (_) {
    res.status(404).end();
  }
});

// ── APK Icon Extraction ─────────────────────────────────────────────────────
app.get('/api/apk-icon', (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).end();
  if (!canRead(absPath)) return res.status(403).end();

  const stat = safeStatSync(absPath);
  if (!stat) return res.status(404).end();

  const etag = `"apkicon-${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();

  const cacheDir = path.join(APP_DATA_DIR, 'apk-icons');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  const diskPath = path.join(cacheDir, crypto.createHash('md5').update(absPath + etag).digest('hex') + '.png');
  if (fs.existsSync(diskPath)) {
    const buf = fs.readFileSync(diskPath);
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=604800',
      'ETag': etag,
    });
    return res.end(buf);
  }

  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(absPath);
    const entries = zip.getEntries();

    const DPI_ORDER = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi', 'ldpi'];
    const ICON_NAMES = ['ic_launcher_round', 'ic_launcher', 'ic_launcher_foreground', 'icon', 'app_icon'];
    let best = null;
    let bestScore = -1;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const ep = entry.entryName.replace(/\\/g, '/').toLowerCase();
      if (!ep.endsWith('.png') && !ep.endsWith('.webp')) continue;

      const parts = ep.split('/');
      if (parts.length < 2) continue;
      const dir  = parts[parts.length - 2];
      const file = parts[parts.length - 1].replace(/\.(png|webp)$/, '');

      const isMipmap  = dir.startsWith('mipmap');
      const isDrawable = dir.startsWith('drawable');
      if (!isMipmap && !isDrawable) continue;

      const iconIdx = ICON_NAMES.indexOf(file);
      if (iconIdx === -1) continue;

      const dpiIdx   = DPI_ORDER.findIndex(d => dir.includes(d));
      const dpiScore  = dpiIdx === -1 ? 0 : DPI_ORDER.length - dpiIdx;
      const typeScore = isMipmap ? 100 : 0;
      const nameScore = (ICON_NAMES.length - iconIdx) * 10;
      const score = typeScore + dpiScore + nameScore;

      if (score > bestScore) { bestScore = score; best = entry; }
    }

    if (!best) return res.status(404).end();
    const buf = best.getData();
    if (!buf || buf.length === 0) return res.status(404).end();

    try { fs.writeFileSync(diskPath, buf); } catch (_) {}

    const mime = best.entryName.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/png';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=604800',
      'ETag': etag,
    });
    res.end(buf);
  } catch (_) {
    res.status(404).end();
  }
});

// ── Audio metadata (ID3 tags) ───────────────────────────────────────────────
app.get('/api/meta', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).end();
  if (!canRead(absPath)) return res.status(403).end();
  try {
    const { parseFile } = await import('music-metadata');
    const meta = await parseFile(absPath, { skipCovers: true, duration: true });
    const c = meta.common, f = meta.format;
    res.json({
      title:      c.title        || null,
      artist:     c.artist       || null,
      albumartist:c.albumartist  || null,
      album:      c.album        || null,
      year:       c.year         || null,
      track:      c.track?.no    || null,
      genre:      c.genre?.[0]   || null,
      duration:   f.duration     || null,
      bitrate:    f.bitrate      ? Math.round(f.bitrate / 1000) : null,
      sampleRate: f.sampleRate   || null,
      codec:      f.codec        || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Index status & manual rebuild ──────────────────────────────────────────
app.get('/api/index/status', (req, res) => {
  res.json({
    ready:    idx.ready,
    total:    idx.all.length,
    files:    idx.files.length,
    builtAt:  idx.builtAt,
    builtStr: idx.builtAt ? new Date(idx.builtAt).toLocaleString() : 'not built',
    rootDir:  idx.rootDir,
  });
});

app.post('/api/index/rebuild', (req, res) => {
  res.json({ ok: true, message: 'Index rebuild started in background' });
  buildFullIndex().catch(e => console.error('[index] rebuild error:', e));
});

// ── Server info ────────────────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  const ifaces = os.networkInterfaces();
  const networkIPs = Object.values(ifaces)
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  res.json({
    root:       ROOT_DIR,
    hostname:   os.hostname(),
    platform:   os.platform(),
    home:       os.homedir(),
    env:        DETECTED_ENV,
    networkIPs,
    nodeVersion: process.version,
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  APP SETTINGS  — password lock, stored in data/settings.json
// ══════════════════════════════════════════════════════════════════════════

const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

function loadAppSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {}
  return { passwordEnabled: false, passwordHash: '' };
}
function saveAppSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s));
}

app.get('/api/settings', (req, res) => {
  const s = loadAppSettings();
  res.json({ passwordEnabled: !!s.passwordEnabled });
});

app.post('/api/settings', express.json(), (req, res) => {
  const s = loadAppSettings();
  const { passwordEnabled, password, currentPassword } = req.body || {};
  if (s.passwordEnabled && currentPassword !== undefined) {
    const h = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (h !== s.passwordHash) return res.json({ error: 'Current password is incorrect' });
  }
  if (typeof passwordEnabled === 'boolean') s.passwordEnabled = passwordEnabled;
  if (password && password.length >= 4) s.passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  saveAppSettings(s);
  res.json({ ok: true });
});

app.post('/api/verify-password', express.json(), (req, res) => {
  const s = loadAppSettings();
  if (!s.passwordEnabled) return res.json({ ok: true });
  const h = crypto.createHash('sha256').update(req.body.password || '').digest('hex');
  res.json({ ok: h === s.passwordHash });
});

app.get('/api/qr', async (req, res) => {
  const port = req.socket.localPort;
  const ifaces = os.networkInterfaces();
  const ips = Object.values(ifaces).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  const url = ips.length ? `http://${ips[0]}:${port}` : `http://localhost:${port}`;
  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2,
      color: { dark: '#00d4c8', light: '#00000000' } });
    res.set('Content-Type', 'image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  WAN TUNNEL — Cloudflare tunnel via cloudflared
// ══════════════════════════════════════════════════════════════════════════

let wanProc   = null;
let wanUrl    = null;
let wanStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
let wanError  = '';

app.get('/api/wan/status', (req, res) => {
  res.json({ status: wanStatus, url: wanUrl, error: wanError });
});

app.get('/api/wan/check', async (req, res) => {
  let cloudflaredInstalled = false;
  let internetAvailable    = false;

  try {
    await new Promise((resolve, reject) => {
      execFile('cloudflared', ['--version'], { timeout: 4000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });
    cloudflaredInstalled = true;
  } catch (_) {}

  try {
    await new Promise((resolve, reject) => {
      const req2 = https.get({ hostname: '1.1.1.1', path: '/', timeout: 4000 }, (r) => {
        r.destroy(); resolve();
      });
      req2.on('error', reject);
      req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
    });
    internetAvailable = true;
  } catch (_) {}

  // Detect platform for install instructions
  const isTermux = !!process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux');
  let platform = 'unknown';
  if (isTermux) {
    platform = 'termux';
  } else if (process.platform === 'linux') {
    try {
      const rel = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
      if (rel.includes('kali')) platform = 'kali';
      else if (rel.includes('debian') || rel.includes('ubuntu')) platform = 'debian';
      else platform = 'linux';
    } catch (_) { platform = 'linux'; }
  } else if (process.platform === 'darwin') {
    platform = 'darwin';
  } else if (process.platform === 'win32') {
    platform = 'win32';
  }

  res.json({ cloudflaredInstalled, internetAvailable, platform });
});

// ── WAN cloudflared install ─────────────────────────────────────────────────
let _cfInstallStatus = { state: 'idle', log: '', error: '' }; // idle | running | done | error

app.get('/api/wan/install-status', (req, res) => {
  res.json(_cfInstallStatus);
});

app.post('/api/wan/install', (req, res) => {
  if (_cfInstallStatus.state === 'running') return res.json({ ok: false, error: 'Already installing' });

  const isTermux = !!process.env.TERMUX_VERSION || fs.existsSync('/data/data/com.termux');
  let cmd, args, platform;

  if (isTermux) {
    cmd = 'pkg'; args = ['install', '-y', 'cloudflared']; platform = 'termux';
  } else if (process.platform === 'linux') {
    try {
      const rel = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
      if (rel.includes('kali') || rel.includes('debian') || rel.includes('ubuntu')) {
        cmd = 'apt-get'; args = ['install', '-y', 'cloudflared']; platform = 'kali';
      } else {
        cmd = 'bash';
        args = ['-c', 'curl -L --output /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /tmp/cloudflared && mv /tmp/cloudflared /usr/local/bin/cloudflared'];
        platform = 'linux';
      }
    } catch (_) {
      cmd = 'bash';
      args = ['-c', 'curl -L --output /tmp/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /tmp/cloudflared && mv /tmp/cloudflared /usr/local/bin/cloudflared'];
      platform = 'linux';
    }
  } else {
    return res.json({ ok: false, error: 'Automatic install not supported on this platform. Download from: https://github.com/cloudflare/cloudflared/releases' });
  }

  _cfInstallStatus = { state: 'running', log: `Installing cloudflared (${platform})...\n`, error: '' };
  res.json({ ok: true, platform });

  const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => { _cfInstallStatus.log += d.toString(); });
  proc.stderr.on('data', d => { _cfInstallStatus.log += d.toString(); });
  proc.on('error', e => {
    _cfInstallStatus.state = 'error';
    _cfInstallStatus.error = e.message;
    _cfInstallStatus.log  += '\nError: ' + e.message;
  });
  proc.on('close', (code) => {
    if (code === 0) {
      _cfInstallStatus.state = 'done';
      _cfInstallStatus.log  += '\n✓ cloudflared installed successfully!';
    } else {
      _cfInstallStatus.state = 'error';
      _cfInstallStatus.error = 'Install failed with code ' + code;
      _cfInstallStatus.log  += '\n✗ Install failed (exit code ' + code + ')';
    }
  });
});

app.post('/api/wan/start', (req, res) => {
  if (wanProc) return res.json({ ok: false, error: 'Tunnel already running' });
  wanStatus = 'starting';
  wanUrl    = null;
  wanError  = '';

  wanProc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${ACTIVE_PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onData = (chunk) => {
    const str = chunk.toString();
    const m = str.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !wanUrl) {
      wanUrl    = m[0];
      wanStatus = 'running';
      console.log('[wan] tunnel URL:', wanUrl);
    }
  };
  wanProc.stdout.on('data', onData);
  wanProc.stderr.on('data', onData);

  wanProc.on('error', (e) => {
    wanStatus = 'error';
    wanError  = e.code === 'ENOENT'
      ? 'cloudflared not found — install it via: pkg install cloudflared'
      : e.message;
    wanProc = null;
    console.error('[wan] error:', wanError);
  });

  wanProc.on('close', (code) => {
    if (wanStatus !== 'error') wanStatus = 'stopped';
    wanProc = null;
    wanUrl  = null;
    console.log('[wan] tunnel closed (code ' + code + ')');
  });

  res.json({ ok: true });
});

app.post('/api/wan/stop', (req, res) => {
  if (!wanProc) return res.json({ ok: false, error: 'No tunnel running' });
  wanProc.kill('SIGTERM');
  wanProc   = null;
  wanUrl    = null;
  wanStatus = 'stopped';
  wanError  = '';
  res.json({ ok: true });
});

app.get('/api/wan/qr', async (req, res) => {
  if (!wanUrl) return res.status(404).json({ error: 'No active tunnel' });
  try {
    const QRCode = require('qrcode');
    const svg = await QRCode.toString(wanUrl, { type: 'svg', margin: 2,
      color: { dark: '#00d4c8', light: '#00000000' } });
    res.set('Content-Type', 'image/svg+xml').send(svg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
//  UPDATE CHECKER — GitHub Releases
// ══════════════════════════════════════════════════════════════════════════

const GITHUB_REPO = 'technicalwhitehat-yt/hevi-explorer';

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      headers: { 'User-Agent': 'hevi-explorer', 'Accept': 'application/vnd.github.v3+json' },
    };
    https.get(options, (r) => {
      let body = '';
      r.on('data', c => body += c);
      r.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from GitHub')); }
      });
    }).on('error', reject);
  });
}

app.get('/api/update/check', async (req, res) => {
  try {
    const data = await githubGet(`/repos/${GITHUB_REPO}/releases/latest`);
    if (data.message === 'Not Found') {
      return res.json({ currentVersion: APP_VERSION, latestVersion: null, upToDate: true, noReleases: true });
    }
    const latestVersion = (data.tag_name || '').replace(/^v/, '') || null;
    const upToDate = latestVersion ? (latestVersion === APP_VERSION) : true;
    res.json({
      currentVersion:  APP_VERSION,
      latestVersion:   latestVersion ? `v${latestVersion}` : null,
      upToDate,
      changelog:       data.body  || '',
      publishedAt:     data.published_at || null,
      htmlUrl:         data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// ══════════════════════════════════════════════════════════════════════════
//  USER STATE — Persistent favourites
//  Survives server restarts; stored in data/userstate.json
// ══════════════════════════════════════════════════════════════════════════

const STATE_FILE  = path.join(__dirname, 'data', 'userstate.json');
const RECENT_FILE = path.join(__dirname, 'data', 'recent.json');
const RECENT_MAX  = 50;

// ── Recent files — fast separate file ────────────────────────────────────
function loadRecent() {
  try {
    if (fs.existsSync(RECENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(RECENT_FILE, 'utf8'));
      if (Array.isArray(data.items)) return data.items;
    }
  } catch (_) {}
  // Migration: pull from old userstate.json if it exists
  try {
    if (fs.existsSync(STATE_FILE)) {
      const old = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (Array.isArray(old.recent) && old.recent.length) return old.recent.slice(0, RECENT_MAX);
    }
  } catch (_) {}
  return [];
}

let recentItems = loadRecent();
let _recentSaveTimer = null;

function saveRecent() {
  clearTimeout(_recentSaveTimer);
  _recentSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(RECENT_FILE), { recursive: true });
      fs.writeFileSync(RECENT_FILE, JSON.stringify({ updatedAt: Date.now(), items: recentItems }));
    } catch (_) {}
  }, 400);
}

// GET /api/recent — return all recent files (fast, tiny file)
app.get('/api/recent', (req, res) => {
  const limit = Math.min(RECENT_MAX, Math.max(1, parseInt(req.query.limit || String(RECENT_MAX), 10)));
  res.json({ items: recentItems.slice(0, limit), total: recentItems.length });
});

// POST /api/recent — add / bump an item to top
app.post('/api/recent', express.json(), (req, res) => {
  const item = req.body;
  if (!item || !item.path) return res.status(400).json({ error: 'Missing path' });
  recentItems = recentItems.filter(r => r.path !== item.path);
  recentItems.unshift({ ...item, openedAt: Date.now() });
  if (recentItems.length > RECENT_MAX) recentItems = recentItems.slice(0, RECENT_MAX);
  saveRecent();
  res.json({ ok: true, total: recentItems.length });
});

// DELETE /api/recent — clear history
app.delete('/api/recent', (req, res) => {
  recentItems = [];
  saveRecent();
  res.json({ ok: true });
});

// ── Userstate — favorites only ────────────────────────────────────────────
function loadUserState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { favorites: data.favorites || [] };
    }
  } catch (_) {}
  return { favorites: [] };
}

let userState = loadUserState();
let _saveTimer = null;

function saveUserState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(userState, null, 2));
    } catch (_) {}
  }, 500);
}

// GET /api/userstate — kept for backward compat (favorites + recent merged)
app.get('/api/userstate', (req, res) => res.json({ ...userState, recent: recentItems }));

// POST /api/userstate/recent — backward compat alias → delegates to /api/recent
app.post('/api/userstate/recent', express.json(), (req, res) => {
  const item = req.body;
  if (!item || !item.path) return res.status(400).json({ error: 'Missing path' });
  recentItems = recentItems.filter(r => r.path !== item.path);
  recentItems.unshift({ ...item, openedAt: Date.now() });
  if (recentItems.length > RECENT_MAX) recentItems = recentItems.slice(0, RECENT_MAX);
  saveRecent();
  res.json({ ok: true });
});

// DELETE /api/userstate/recent — backward compat alias
app.delete('/api/userstate/recent', (req, res) => {
  recentItems = [];
  saveRecent();
  res.json({ ok: true });
});

// POST /api/userstate/favorite — toggle favorite on/off
app.post('/api/userstate/favorite', express.json(), (req, res) => {
  const item = req.body;
  if (!item || !item.path) return res.status(400).json({ error: 'Missing path' });
  const idx = userState.favorites.findIndex(f => f.path === item.path);
  if (idx >= 0) {
    userState.favorites.splice(idx, 1);
    saveUserState();
    res.json({ ok: true, favorited: false });
  } else {
    userState.favorites.unshift({ ...item, addedAt: Date.now() });
    if (userState.favorites.length > 100) userState.favorites = userState.favorites.slice(0, 100);
    saveUserState();
    res.json({ ok: true, favorited: true });
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  STARTUP — Protocol 3: Smart Port Allocation
// ══════════════════════════════════════════════════════════════════════════

(async () => {
  let PORT;
  try {
    PORT = await findFreePort();
  } catch (e) {
    console.error('Could not find a free port:', e.message);
    process.exit(1);
  }

  // Bootstrap the file index (load from disk or build in background)
  initIndex().catch(e => console.error('[index] init error:', e));

  app.listen(PORT, HOST, () => {
    ACTIVE_PORT = PORT;
    const ifaces     = os.networkInterfaces();
    const networkIPs = Object.values(ifaces)
      .flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal);

    const line = '═'.repeat(48);
    console.log(`\n╔${line}╗`);
    console.log(`║${'  Hevi Explorer  •  File Manager'.padEnd(48)}║`);
    console.log(`╠${line}╣`);
    console.log(`║  Environment : ${DETECTED_ENV.padEnd(31)}║`);
    console.log(`║  Root Dir    : ${ROOT_DIR.substring(0, 31).padEnd(31)}║`);
    console.log(`╠${line}╣`);
    console.log(`║  Local  → http://localhost:${PORT}`.padEnd(49) + '║');
    for (const iface of networkIPs) {
      console.log(`║  Network→ http://${iface.address}:${PORT}`.padEnd(49) + '║');
    }
    if (PORT !== PREFERRED_PORT) {
      console.log(`╠${line}╣`);
      console.log(`║  ⚠  Port ${PREFERRED_PORT} was busy — using ${PORT} instead`.padEnd(49) + '║');
    }
    console.log(`╚${line}╝\n`);
    console.log('  Tip: set ROOT_DIR=/sdcard to browse a specific folder.\n');
  });
})();
