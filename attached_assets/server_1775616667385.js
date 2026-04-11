/**
 * l-host — Local File Manager
 * ─────────────────────────────────────────────────────────────────────────
 *  Protocol 1 : Dynamic Path Handling   — auto-detects Termux / Kali / Linux
 *  Protocol 2 : Zero Heavy Dependencies — only Node built-ins + express
 *  Protocol 3 : Smart Port Allocation   — finds a free port automatically
 *  Protocol 4 : Graceful Permission     — skips unreadable files silently
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const net     = require('net');

const app  = express();
const HOST = '0.0.0.0';

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
  '.mp3':'audio/mpeg','.wav':'audio/wav','.flac':'audio/flac',
  '.aac':'audio/aac','.ogg':'audio/ogg','.m4a':'audio/mp4','.wma':'audio/x-ms-wma',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif',
  '.webp':'image/webp','.bmp':'image/bmp','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.tiff':'image/tiff',
  '.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown',
  '.log':'text/plain','.json':'application/json','.xml':'application/xml',
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.zip':'application/zip','.tar':'application/x-tar','.gz':'application/gzip',
  '.rar':'application/x-rar-compressed','.7z':'application/x-7z-compressed',
  '.apk':'application/vnd.android.package-archive',
};

const getMime = p => MIME_MAP[path.extname(p).toLowerCase()] || 'application/octet-stream';

function getCategory(ext) {
  const e = ext.toLowerCase();
  if (['.mp4','.mkv','.avi','.mov','.webm','.flv','.m4v','.3gp'].includes(e)) return 'video';
  if (['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg','.ico','.tiff'].includes(e)) return 'image';
  if (['.mp3','.wav','.flac','.aac','.ogg','.m4a','.wma'].includes(e)) return 'audio';
  if (['.zip','.tar','.gz','.rar','.7z'].includes(e)) return 'archive';
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
    if (!resolved.startsWith(path.resolve(ROOT_DIR))) return null;
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
//  EXPRESS ROUTES
// ══════════════════════════════════════════════════════════════════════════

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// ── List directory ─────────────────────────────────────────────────────────
app.get('/api/ls', (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).json({ error: 'Access denied' });
  if (!canRead(absPath)) return res.status(403).json({ error: 'Permission denied', items: [] });

  const stat = safeStatSync(absPath);
  if (!stat) return res.status(404).json({ error: 'Not found' });
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const entries = safeReaddirSync(absPath);
  const items = [];
  for (const name of entries) {
    const info = buildFileInfo(path.join(absPath, name), path.join(relPath, name), name);
    if (info) items.push(info);
    // Protocol 4: silently skip files that returned null (no access / broken symlink)
  }
  items.sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });

  const page  = Math.max(0, parseInt(req.query.page  || '0',  10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const total = items.length;
  const slice = items.slice(page * limit, (page + 1) * limit);

  res.json({
    path:    relPath,
    absPath,
    items:   slice,
    total,
    page,
    limit,
    hasMore: (page + 1) * limit < total,
    parent:  relPath ? path.dirname(relPath).replace(/\\/g, '/') : null,
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q         = (req.query.q || '').toLowerCase().trim();
  const startPath = safePath(decodeURIComponent(req.query.path || ''));
  if (!q || !startPath) return res.json({ results: [], total: 0 });

  const all = [];
  const MAX = 1000;

  function walk(dir, depth) {
    if (depth > 10 || all.length >= MAX) return;
    const entries = safeReaddirSync(dir);
    for (const name of entries) {
      if (all.length >= MAX) break;
      const full = path.join(dir, name);
      const info = buildFileInfo(full, path.relative(ROOT_DIR, full), name);
      if (!info) continue;
      if (name.toLowerCase().includes(q)) all.push(info);
      if (info.type === 'dir') walk(full, depth + 1);
    }
  }
  walk(startPath, 0);

  const page  = Math.max(0, parseInt(req.query.page  || '0',  10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const total = all.length;
  const slice = all.slice(page * limit, (page + 1) * limit);

  res.json({ results: slice, total, page, limit, hasMore: (page + 1) * limit < total, query: q });
});

// ── Category listing ────────────────────────────────────────────────────────
app.get('/api/category/:cat', (req, res) => {
  const cat       = req.params.cat;
  const startPath = safePath('');
  if (!startPath) return res.status(403).json({ error: 'Access denied' });

  const all = [];
  const MAX = 5000;

  function walk(dir, depth) {
    if (depth > 12 || all.length >= MAX) return;
    const entries = safeReaddirSync(dir);
    for (const name of entries) {
      if (all.length >= MAX) break;
      const full = path.join(dir, name);
      const info = buildFileInfo(full, path.relative(ROOT_DIR, full), name);
      if (!info) continue;
      if (info.type === 'dir') { walk(full, depth + 1); }
      else if (info.category === cat) all.push(info);
    }
  }
  walk(startPath, 0);
  all.sort((a, b) => b.mtime - a.mtime);

  const page  = Math.max(0, parseInt(req.query.page  || '0',  10));
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const total = all.length;
  const slice = all.slice(page * limit, (page + 1) * limit);

  res.json({ category: cat, results: slice, total, page, limit, hasMore: (page + 1) * limit < total });
});

// ── Stream / download a file ───────────────────────────────────────────────
const CHUNK_MAX = 4 * 1024 * 1024; // 4 MB max per chunk — keeps RAM low on mobile

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

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start        = parseInt(startStr, 10) || 0;
    const requestedEnd = endStr ? parseInt(endStr, 10) : size - 1;
    // Cap chunk to CHUNK_MAX — critical for instant playback & seek on large files
    const end          = Math.min(requestedEnd, start + CHUNK_MAX - 1, size - 1);
    const chunkSize    = end - start + 1;
    try {
      const stream = fs.createReadStream(absPath, { start, end });
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunkSize,
        'Content-Type':   mime,
      });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch (_) { res.status(500).end(); }
  } else {
    // Non-range: stream entire file (downloads), but set Accept-Ranges so player can seek
    const headers = {
      'Content-Length': size,
      'Content-Type':   mime,
      'Accept-Ranges':  'bytes',
    };
    if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(absPath)}"`;
    try {
      res.writeHead(200, headers);
      const stream = fs.createReadStream(absPath, { highWaterMark: CHUNK_MAX });
      stream.pipe(res);
      stream.on('error', () => res.end());
    } catch (_) { res.status(500).end(); }
  }
});

// ── Upload ─────────────────────────────────────────────────────────────────
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
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
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
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  req.on('error', e => res.status(500).json({ error: e.message }));
});

// ── Create folder ──────────────────────────────────────────────────────────
app.post('/api/mkdir', express.json(), (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const name    = (req.body?.name || '').replace(/[/\\<>:"|?*]/g, '').trim();
  if (!name) return res.status(400).json({ error: 'Invalid folder name' });
  const dest = safePath(path.join(relPath, name));
  if (!dest) return res.status(403).json({ error: 'Access denied' });
  try { fs.mkdirSync(dest, { recursive: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete ─────────────────────────────────────────────────────────────────
app.delete('/api/delete', express.json(), (req, res) => {
  const relPath = decodeURIComponent((req.query.path || req.body?.path) || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).json({ error: 'Access denied' });
  try {
    const stat = safeStatSync(absPath);
    if (!stat) return res.status(404).json({ error: 'Not found' });
    if (stat.isDirectory()) fs.rmSync(absPath, { recursive: true, force: true });
    else fs.unlinkSync(absPath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Album Art ──────────────────────────────────────────────────────────────
app.get('/api/art', async (req, res) => {
  const relPath = decodeURIComponent(req.query.path || '');
  const absPath = safePath(relPath);
  if (!absPath) return res.status(403).end();
  if (!canRead(absPath)) return res.status(403).end();

  try {
    const { parseFile } = await import('music-metadata');
    const meta = await parseFile(absPath, { skipCovers: false });
    const pics  = meta.common.picture;
    if (!pics || !pics.length) return res.status(404).end();
    const pic = pics[0];
    res.setHeader('Content-Type', pic.format || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(pic.data);
  } catch (_) {
    res.status(404).end();
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  MEMORY DB  —  lightweight JSON persistence (twh_memory.json)
// ══════════════════════════════════════════════════════════════════════════

const MEMORY_FILE = path.join(__dirname, 'twh_memory.json');
const MEMORY_DEFAULT = () => ({ recents: [], videoProgress: {}, musicQueue: null });

function memLoad() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
      return Object.assign(MEMORY_DEFAULT(), JSON.parse(raw));
    }
  } catch (_) {}
  return MEMORY_DEFAULT();
}

function memSave(data) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}

app.get('/api/memory/load', (req, res) => {
  res.json(memLoad());
});

app.post('/api/memory/save', express.json(), (req, res) => {
  const { action, data } = req.body || {};
  if (!action || !data) return res.status(400).json({ error: 'Missing action/data' });
  const mem = memLoad();

  if (action === 'recent') {
    mem.recents = (mem.recents || []).filter(r => r.path !== data.path);
    mem.recents.unshift({ ...data, openedAt: Date.now() });
    mem.recents = mem.recents.slice(0, 50);
  } else if (action === 'videoProgress') {
    if (typeof data.time === 'number' && data.time > 3) {
      if (!mem.videoProgress) mem.videoProgress = {};
      mem.videoProgress[data.path] = { time: data.time, ts: Date.now() };
    } else if (mem.videoProgress) {
      delete mem.videoProgress[data.path];
    }
  } else if (action === 'clearVideoProgress') {
    if (mem.videoProgress) delete mem.videoProgress[data.path];
  } else if (action === 'musicQueue') {
    mem.musicQueue = { ...data, ts: Date.now() };
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  memSave(mem);
  res.json({ ok: true });
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

  app.listen(PORT, HOST, () => {
    const ifaces     = os.networkInterfaces();
    const networkIPs = Object.values(ifaces)
      .flat()
      .filter(i => i && i.family === 'IPv4' && !i.internal);

    const line = '═'.repeat(48);
    console.log(`\n╔${line}╗`);
    console.log(`║${'  l-host  •  Local File Manager'.padEnd(48)}║`);
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
