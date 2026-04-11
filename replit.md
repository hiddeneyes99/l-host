# l-host — Local File Manager

A beautiful, self-hosted file manager that runs on any device (Termux, Kali Linux, Linux, etc.) and lets all devices on the same network browse and manage files through a browser.

## Stack

- **Backend**: Node.js + Express (no heavy dependencies)
- **Frontend**: Vanilla JS + CSS (no framework, no build step)
- **Port**: 5000
- **Replit default root**: `files/` inside the workspace unless `ROOT_DIR` is explicitly set

## Project Structure

```
server.js        - Express HTTP server (API + file streaming)
files/           - Default browseable file root on Replit
public/
  index.html     - SPA shell
  style.css      - Dark UI styles
  app.js         - Frontend application logic
  iv.js          - Advanced Image Viewer module (gestures, Anime.js, Hindi UI)
package.json     - npm manifest (express only)
```

## JARVIS Protocols (Stability Features)

| Protocol | What it does |
|---|---|
| **1 · Dynamic Path** | Auto-detects Termux / Kali-root / Linux / macOS and sets the correct ROOT_DIR with no config |
| **2 · Zero Heavy Deps** | Only `express` — no native C modules, installs in one command on any machine |
| **3 · Smart Port** | Scans 5000 → 8000 → 8080 → ... and picks the first free port automatically |
| **4 · Graceful Perms** | Skips unreadable files silently (no crash on restricted Termux system paths) |

## Running

```bash
node server.js
# or
npm start
```

Override root directory:
```bash
ROOT_DIR=/home/runner/workspace/files node server.js  # Replit-safe default
ROOT_DIR=/sdcard node server.js              # Termux — browse SD card
ROOT_DIR=/storage/emulated/0 node server.js  # Termux — internal storage
ROOT_DIR=/home node server.js                # Kali Linux
ROOT_DIR=/ node server.js                    # Full filesystem (needs root)
```

## Features

- Browse the full filesystem (configurable root via ROOT_DIR env var)
- Category filtering: Videos, Images, Audio, Files, Archives, APKs
- Video player with mobile gestures, double-tap/double-click 10s seek, hover timestamp/preview thumbnails, resume support, and desktop shortcuts (Space/K, J/L, arrows, F, M, T, P, 0–9, Home/End)
-  **Advanced Image Viewer** (iv.js) — pinch-to-zoom (mobile), mouse-wheel zoom, pan, Anime.js transitions, glassmorphism Hindi metadata modal, Hindi filter chips (ग्रैस्केल / सेपिया / रीसेट), breathing-glow controls, teal pulse on every interaction, demo mode with 3 illustrative images (Kolkata / L-Host / Leh)
- **Premium Music Player** — Full-screen glassmorphism player with: per-track gradient palette art, lightweight Web Audio API canvas visualizer, custom scrub bar, shuffle/repeat modes, prev/next queue navigation, animated play/pause, Up Next collapsible queue, animated EQ thumbnails in the audio grid
- Text / code viewer
- File upload (drag-and-drop or browse)
- New folder creation
- File/folder deletion
- Search across the filesystem
- Grid / list view toggle
- Network accessible — all devices on the same WiFi can use it
- Works on Termux, Kali Linux, Ubuntu, any Node.js environment

## Performance

- **Infinite scroll / server-side pagination**: All listing endpoints accept `?page=N&limit=M` and return `{ total, hasMore, ... }`. Frontend loads 50 items at a time; an IntersectionObserver sentinel triggers the next page as the user scrolls.
- **Skeleton loaders**: Grid immediately shows shimmer placeholder cards while the first page fetches — no blank white flash.
- **4 MB video chunk cap** (`CHUNK_MAX`): Range requests are capped at 4 MB per chunk so seeking in large video files doesn't load the whole file into memory — critical for mobile/Termux.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ls?path=&page=0&limit=50` | List directory (paginated) |
| GET | `/api/search?q=&path=&page=0&limit=50` | Search files (paginated) |
| GET | `/api/category/:cat?page=0&limit=50` | Files by category (paginated) |
| GET | `/file?path=` | Stream/serve a file (4 MB chunk cap) |
| GET | `/file?path=&dl=1` | Download a file |
| POST | `/api/upload?path=` | Upload file(s) |
| POST | `/api/mkdir?path=` | Create folder |
| DELETE | `/api/delete?path=` | Delete file/folder |
| GET | `/api/info` | Server info |
