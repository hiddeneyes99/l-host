# l-host — Local File Manager

A self-hosted file manager that runs on Replit and other Node.js environments, letting users browse and manage files through a browser.

## Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla JS + CSS, served from `public/`
- **Runtime port**: 5000
- **Replit workflow**: `Start application` runs `node server.js`
- **Replit default root**: `files/` inside the workspace unless `ROOT_DIR` is explicitly set

## Project Structure

```
server.js        - Express HTTP server, API routes, indexing, thumbnails, and file streaming
files/           - Default browseable file root on Replit, created automatically at startup
public/
  index.html     - SPA shell
  style.css      - UI styles
  app.js         - Frontend application logic
  iv.js          - Advanced image viewer module
  sw.js          - Service worker
data/            - Persistent index, category caches, thumbnails, and user state
package.json     - npm manifest
```

## Dependencies

- `express` for the HTTP server and API routes
- `compression` for gzip response compression
- `exifr` for image metadata extraction
- `music-metadata` for audio artwork and tag metadata

## Replit Compatibility

The app is configured for Replit with:

- Node.js 20 in `.replit`
- A web workflow on port 5000
- Server binding to `0.0.0.0`
- A safe Replit default file root at `files/`
- Path traversal protection via server-side path resolution under `ROOT_DIR`

## Running

```bash
npm start
```

Override root directory:

```bash
ROOT_DIR=/home/runner/workspace/files node server.js
ROOT_DIR=/sdcard node server.js
ROOT_DIR=/storage/emulated/0 node server.js
ROOT_DIR=/home node server.js
ROOT_DIR=/ node server.js
```

## Features

- Browse files and folders under the configured root directory
- Category filtering for videos, images, audio, files, archives, and APKs
- Video player with range streaming, capped chunks, seeking gestures, resume support, and preview thumbnails
- Advanced image viewer with zoom, pan, metadata, and filters
- Music player with queue, artwork extraction, and visualizer
- Text/code viewer
- File upload
- New folder creation
- File/folder deletion, with root deletion blocked
- Search across indexed files
- Grid/list view toggle
- Persistent recent files and favorites

## Performance

- Server-side pagination for listings, search, and categories
- Persistent file index stored in `data/index.json`
- Background index refresh and filesystem watcher when available
- Thumbnail caches for media previews
- 4 MB video chunk cap for safer streaming in constrained environments

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ls?path=&page=0&limit=50` | List directory contents |
| GET | `/api/search?q=&path=&page=0&limit=50` | Search indexed files |
| GET | `/api/category/:cat?page=0&limit=50` | List files by category |
| GET | `/file?path=` | Stream/serve a file |
| GET | `/file?path=&dl=1` | Download a file |
| POST | `/api/upload?path=` | Upload file(s) |
| POST | `/api/mkdir?path=` | Create folder |
| DELETE | `/api/delete?path=` | Delete file/folder |
| GET | `/api/info` | Server/runtime info |
| GET | `/api/index/status` | File index status |
| POST | `/api/index/rebuild` | Rebuild file index in the background |
| GET | `/api/userstate` | Read persistent user state |
| POST | `/api/userstate/recent` | Add a recent file |
| DELETE | `/api/userstate/recent` | Clear recent files |
| POST | `/api/userstate/favorite` | Toggle favorite file |
