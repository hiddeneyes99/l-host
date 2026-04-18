# AeroGrab Master Prompt — Handoff Document
## For AI Assistants Continuing This Project

**Project:** AeroGrab inside Hevi Explorer (TWH Eco System Technology)
**Author:** Technical White Hat (TWH)
**Date:** April 18, 2026
**Language to use with developer:** Hinglish (Hindi + English mixed, casual tone)
**Brand accent color:** `#25f4d0`

---

## PART 1: WHAT IS THIS PROJECT?

**Hevi Explorer** is a local-first file manager and media server built in Node.js. It runs on a device (phone, PC, Termux on Android) and serves a web interface on port 5000. Users can browse, view, upload, and manage their local files through a web browser.

**AeroGrab** is a feature built INSIDE Hevi Explorer. It allows users to transfer files between devices on the same Wi-Fi network using nothing but hand gestures:
- **Closed fist** = "I am grabbing this file" (Sender action)
- **Open palm** = "I will catch it" (Receiver action)
- File travels **directly device-to-device via WebRTC** — the server never touches file bytes

The system uses **Google MediaPipe Hands** running in the browser for on-device gesture detection. Camera feed never leaves the device. Privacy is a first-class requirement.

**Full engineering spec:** Read `AeroGrab_Blueprint.md` in the project root.

---

## PART 2: WHAT HAS ALREADY BEEN BUILT (v1 — COMPLETE)

All of the following is implemented and working in the codebase:

### Server Side (`server.js`, around line 3183+)
- Socket.io server running alongside the existing HTTP server
- `aeroSessions` Map — in-memory session storage (never written to disk)
- Event handlers:
  - `FILE_GRABBED` — stores session, broadcasts `WAKE_UP_CAMERAS` to all connected sockets
  - `DROP_HERE` — applies First-Confirmed-Receiver-Wins rule, initiates WebRTC signaling
  - `webrtc_signal` — pure relay (forwards SDP offers/answers/ICE between peers)
  - `SESSION_END` — clears session, stops timeout
- 60-second session timeout (auto-expires if no receiver responds)
- First-Confirmed-Receiver-Wins rule (millisecond-precision timestamp comparison)

### Client Side (`public/aerograb.js`) — Self-contained IIFE
- `toggleAeroGrab(bool)` — enable/disable with camera lifecycle management
- `showPermissionDialog()` — custom permission explanation before browser prompt (one-time, remembered in localStorage `'ag_cam_perm'`)
- `initMediaPipe()` — direct `getUserMedia` (NOT the MediaPipe Camera utility, which was replaced for reliability), `setInterval` at 12fps, `_processingHands` flag prevents concurrent `hands.send()` calls
- `classifyGesture(lm)` — **2D distance-based** algorithm (z-axis is deliberately ignored because MediaPipe z values are not on the same scale as normalized x,y). Uses `wrist(0)→middleMCP(9)` as `handSize`, then `tipToMCP/handSize` curl ratios for fingers 8,12,16,20. FIST = all ratios < 0.65, OPEN_PALM = all ratios > 0.65
- `processGestureResults(results)` — shows live debug in `#aeroGestureLbl`: `"👁 N | no hand"` when no hand, `"H:0.18 [0.32,0.28,0.30,0.25]"` when hand detected (curl ratios), `"✅ FIST"` when gesture confirmed
- `initiateGrab()` → `getAeroGrabPayload()` → `socket.emit('FILE_GRABBED', meta)`
- `getAeroGrabPayload()` — priority order: (1) open viewer file, (2) selected files, (3) targeted folder, (4) last opened file from localStorage
- `startFileTransfer()` — fetches file from OWN server (`/file?path=...`), streams via WebRTC
- `streamFileOverBridge(blob, name)` — 64KB chunking via FileReader, respects `_dataChannel.bufferedAmount`
- `finaliseReceivedFile()` — assembles ArrayBuffer chunks → Blob → `<a download>` click → browser download to device local storage
- WebRTC STUN servers: `stun:stun.l.google.com:19302` and `stun:stun1.l.google.com:19302`
- `zipFolder(payload)` — JSZip compression for folder transfers
- `deactivateAeroGrab()` — stops `setInterval`, stops all camera tracks, closes MediaPipe, resets all state

### UI (`public/index.html` + `public/style.css`)
- AeroGrab toggle in sidebar (checkbox `#aeroGrabToggle`)
- Green dot indicator `#aeroGreenDot` (top-right, shows when AeroGrab is ON)
- Permission overlay `#aeroPermOverlay` with Confirm/Cancel buttons
- Wake-up notification panel `#aeroWakePanel` (shown on receiver devices when someone grabs)
- Animation stage `#aeroAnimStage` (fullscreen overlay for rocket/box animations)
- Camera preview video `#aeroVideoEl` (150x112px, bottom-right corner, visible when AeroGrab ON)
- Camera overlay `#agCamOverlay` with:
  - `#aeroGestureLbl` — live gesture debug label
  - `#aeroManualGrab` — ✊ Grab button (manual fallback bypassing gesture detection)
- Context menu button "AeroGrab this file" (wired in `app.js`)

### Animation Layer (`public/aerograb-animation.js`)
- `aeroAnim.onGrabConfirmed(meta)` — Energy Squeeze animation (Phase 1)
- `aeroAnim.onRocketLaunch()` — Rocket Launch (Phase 2)
- `aeroAnim.onReceiverReady()` — Receiver Landing (Phase 3)
- `aeroAnim.updateReceiverProgress(pct)` — Progress Ring (Phase 4)
- `aeroAnim.onReceiverComplete(meta)` — complete animation
- `aeroAnim.onSenderComplete()` — sender done
- Uses anime.js from CDN for all animations

### Key Hooks Between `aerograb.js` and `app.js`
- `window.aeroGrabSetOpenFile({ name, size, path, type })` — called by `app.js` when user opens a file, so AeroGrab knows what to grab
- `window.aeroGrabFromCtxMenu(item)` — called by right-click context menu handler in `app.js`
- Toast function: `toast(msg, type)` — types: `'success'`, `'error'`, `'warn'`, `''`

### Privacy & Security
- `.gitignore` excludes: `files/`, `uploads/`, `thumbnails/`, `*.db`, `*.sqlite`, `.env`
- Server never writes AeroGrab session data to disk
- Server never receives file content (only signaling metadata)
- Camera feed processed entirely on-device

### CDN Scripts (loaded in `index.html`)
```html
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jszip/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/animejs/lib/anime.min.js"></script>
<script src="/aerograb.js"></script>
<script src="/aerograb-animation.js"></script>
```

---

## PART 3: THE ARCHITECTURAL PROBLEM THAT EXISTS IN v1

In v1, all devices connect to **one shared Hevi Explorer server**. This means:
- Device A and Device B both browse the **same files** (from the same host)
- When Device A grabs a file and Device B catches it → Device B gets a download of a file it could already access through the shared web interface
- This is redundant — AeroGrab adds no real value in this model

**The v1 model is: 1 chef, N waiters. Everyone eats from the same kitchen.**

---

## PART 4: WHAT NEEDS TO BE BUILT (v2 — THE REAL VISION)

### The New Vision: Distributed LAN Instances

Each device on the WiFi network runs its **OWN** Hevi Explorer instance, serving its **OWN** files from its own local storage.

- **Phone A** → `localhost:5000` → serves Phone A's files
- **Phone B** → `localhost:5000` → serves Phone B's files
- **Phone C** → `localhost:5000` → serves Phone C's files

All three connect to a **common signaling server** (could be one of their Hevi instances, or a deployed cloud instance) for coordination only.

**The new model is: N chefs, 1 coordinator. Each kitchen is independent.**

When Phone A grabs a file:
1. It fetches from ITS OWN `localhost:5000/file?path=...` (already works — no change needed to transfer logic)
2. Streams via WebRTC to Phone B
3. Phone B saves it to its local storage as a browser download

**The transfer code is already correct for v2** — the missing piece is **auto-discovery**: devices don't know each other exists yet.

### Feature: LAN Auto-Discovery (HEVI NETWORK)

Every Hevi Explorer instance, when it starts, must:
1. Connect to the signaling server
2. Announce itself: name, avatar, deviceId
3. Receive the live list of all other online Hevi instances
4. Show a "Network" tab with all discovered devices
5. Update in real-time as devices join and leave

**New "Network" tab shows:**
```
🌐 Hevi Network — 4 devices online
───────────────────────────────────
📱 Rahul Ka Phone     ● Online   [Send →]
💻 Laptop Ghar        ● Online   [Send →]
📱 Bhai Ka Phone      ● Online   [Send →]
📟 Tablet             ● Online   [Send →]
```

When a device joins or leaves, everyone's list updates instantly.

### New Socket Events to Implement

**Client → Server:**
```
HEVI_ANNOUNCE   { deviceId, deviceName, avatar }    // on every connect
HEVI_HEARTBEAT  { deviceId }                        // every 15 seconds
```

**Server → Client:**
```
HEVI_PEERS_UPDATE  { devices: [...], total: N }     // broadcast on any join/leave
```

**`devices` array item shape:**
```javascript
{
  socketId:   'abc123',
  deviceId:   'uuid-v4',         // unique per install, localStorage persisted
  deviceName: 'Rahul Ka Phone',  // hostname-based or user-set
  avatar:     '📱',              // emoji or 1-2 letter initials
  joinedAt:   1713433200000,     // timestamp
}
```

**Device ID generation (client, one-time):**
```javascript
function getOrCreateDeviceId() {
  let id = localStorage.getItem('ag_device_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ag_device_id', id); }
  return id;
}
```

**Device Name (client, auto-generated):**
```javascript
function getDeviceName() {
  return localStorage.getItem('ag_device_name') || navigator.platform || 'Hevi Device';
}
```

### Server-Side: Device Registry

```javascript
// In server.js, inside the Socket.io block
const heviDevices = new Map(); // key: socket.id, value: device info

socket.on('HEVI_ANNOUNCE', ({ deviceId, deviceName, avatar }) => {
  heviDevices.set(socket.id, { socketId: socket.id, deviceId, deviceName, avatar, joinedAt: Date.now() });
  broadcastPeersUpdate();
});

socket.on('HEVI_HEARTBEAT', ({ deviceId }) => {
  const d = heviDevices.get(socket.id);
  if (d) d.lastSeen = Date.now();
});

socket.on('disconnect', () => {
  if (heviDevices.has(socket.id)) {
    heviDevices.delete(socket.id);
    broadcastPeersUpdate();
  }
  // ... existing session cleanup ...
});

function broadcastPeersUpdate() {
  io.emit('HEVI_PEERS_UPDATE', {
    devices: [...heviDevices.values()],
    total:   heviDevices.size,
  });
}
```

### Client-Side: Announce + Heartbeat (in `aerograb.js`)

Add to `initSocket()`:
```javascript
function initSocket() {
  _socket = io();
  // ... existing listeners ...
  _socket.on('connect', () => {
    announceToNetwork();
    startHeartbeat();
  });
  _socket.on('HEVI_PEERS_UPDATE', ({ devices, total }) => {
    if (typeof window.onHeviPeersUpdate === 'function') {
      window.onHeviPeersUpdate(devices, total);
    }
  });
}

function announceToNetwork() {
  _socket.emit('HEVI_ANNOUNCE', {
    deviceId:   getOrCreateDeviceId(),
    deviceName: getDeviceName(),
    avatar:     getDeviceAvatar(),
  });
}

let _heartbeatInterval = null;
function startHeartbeat() {
  clearInterval(_heartbeatInterval);
  _heartbeatInterval = setInterval(() => {
    _socket.emit('HEVI_HEARTBEAT', { deviceId: getOrCreateDeviceId() });
  }, 15000);
}
```

### Client-Side: Network Tab (in `app.js` or new `hevi-network.js`)

```javascript
window.onHeviPeersUpdate = function(devices, total) {
  const container = document.getElementById('heviNetworkList');
  const counter   = document.getElementById('heviNetworkCount');
  if (!container) return;
  counter.textContent = `${total} device${total !== 1 ? 's' : ''} online`;
  container.innerHTML = devices.map(d => `
    <div class="hevi-peer-card" data-socket-id="${d.socketId}">
      <span class="hevi-peer-avatar">${d.avatar}</span>
      <span class="hevi-peer-name">${d.deviceName}</span>
      <span class="hevi-peer-status">● Online</span>
      <button class="hevi-peer-send" onclick="aeroGrabTargeted('${d.socketId}')">Send →</button>
    </div>
  `).join('');
};

function aeroGrabTargeted(targetSocketId) {
  // Set target, then trigger grab
  window.aeroGrabSetTarget && window.aeroGrabSetTarget(targetSocketId);
  // Then user makes fist, or click triggers initiateGrab()
}
```

### Targeted Transfer (optional in Phase 5)

Modify `FILE_GRABBED` emit to include optional `targetId`:
```javascript
socket.emit('FILE_GRABBED', { ...meta, targetId: _targetSocketId || null });
```

Server uses `targetId` to send wake-up only to that device:
```javascript
socket.on('FILE_GRABBED', ({ targetId, ...meta }) => {
  // ...existing session setup...
  if (targetId) {
    io.to(targetId).emit('WAKE_UP_CAMERAS', { senderId: socket.id, senderName, meta, sessionId });
  } else {
    io.emit('WAKE_UP_CAMERAS', { senderId: socket.id, senderName, meta, sessionId });
  }
});
```

---

## PART 5: IMPORTANT CONSTRAINTS & RULES

1. **NEVER break existing Hevi Explorer functionality.** AeroGrab is an overlay — if it breaks, the file manager must still work perfectly.

2. **`aerograb.js` must remain a self-contained IIFE:** `(function AeroGrab() { ... })()`. No global variable pollution except explicitly exported `window.aeroGrab*` hooks.

3. **Server data is always in-memory only.** Never write session or device data to disk.

4. **File bytes never pass through the server.** Any implementation that buffers file content on the server violates the core architecture.

5. **Camera is controlled entirely by `aerograb.js`.** No other code should access the camera.

6. **The existing file manager's performance must not be affected.** AeroGrab loads lazily; MediaPipe only runs when toggle is ON.

7. **Termux compatibility:** No native modules, no binary dependencies beyond Node.js built-ins. Pure JS, WebRTC, Socket.io only.

8. **Gesture detection uses 2D distances only (x, y).** Never include z-axis in landmark distance calculations — MediaPipe z is relative depth and breaks the math.

9. **Toast notifications** always use: `toast(message, 'success' | 'error' | 'warn' | '')` — this function is global in `app.js`.

10. **Accent color** is `#25f4d0` (CSS variable `--accent`). All new AeroGrab UI elements use this color.

---

## PART 6: TERMUX (ANDROID) SPECIFIC NOTES

- Termux is a terminal emulator on Android that can run Node.js
- Users run `node server.js` in Termux → Hevi Explorer serves on `localhost:5000`
- Other devices on same WiFi access via the Termux device's LAN IP (e.g., `192.168.1.5:5000`)
- **For LAN discovery to work:** all devices must connect to the same signaling server URL. Two options:
  - Option A: One Termux device runs the server, others connect to its LAN IP
  - Option B: Server deployed to Replit/cloud — all devices connect to that URL regardless of network
- WebRTC STUN works fine on local WiFi. For 4G/5G, TURN is needed (Phase 6).
- No cameras on typical Termux/PC setup — AeroGrab gracefully falls back to the Manual Grab button.

---

## PART 7: TESTING CHECKLIST

Before declaring v2 implementation complete, verify:

- [ ] Device A opens Hevi Explorer → appears in its own Network tab
- [ ] Device B opens Hevi Explorer → both A and B appear in each other's Network tabs
- [ ] Device C joins → all three see each other, counter shows "3 devices online"
- [ ] Device C disconnects → counter updates to "2 devices online" within 15-30 seconds
- [ ] Device A grabs a file → Device B and C get wake-up notification showing "Device A is sending: filename"
- [ ] Device B opens palm → gets the file as browser download from Device A's storage
- [ ] File received on Device B is identical to file on Device A (no corruption)
- [ ] Targeted grab: Device A targets Device B → only Device B gets wake-up (Device C does not)
- [ ] Existing Hevi Explorer functionality unaffected (browse, upload, view, etc.)
- [ ] Toggle AeroGrab OFF → camera stops, network tab still works (network discovery is independent of AeroGrab toggle)

---

## PART 8: KEY FILES AND LINE NUMBERS

| File | What's In It | Key Line Numbers |
|---|---|---|
| `server.js` | AeroGrab signaling handlers | ~3183+ |
| `public/aerograb.js` | All AeroGrab client logic | Entire file (~674 lines) |
| `public/aerograb-animation.js` | Rocket/Box/Particle animations | Entire file |
| `public/index.html` | UI markup, CDN scripts | Camera overlay ~2424, CDN scripts ~2433 |
| `public/style.css` | All styles incl. AeroGrab | AeroGrab styles appended at end ~6785+ |
| `public/app.js` | Hevi Explorer main app | openFile hook ~3581, ctxMenu ~3974 |
| `AeroGrab_Blueprint.md` | Full engineering spec v2 | Entire file |
| `.gitignore` | Privacy protection | Entire file |

---

## PART 9: SUMMARY OF NEXT STEPS (IN ORDER)

1. **Add `HEVI_ANNOUNCE` + `HEVI_HEARTBEAT` to `aerograb.js`** inside `initSocket()`
2. **Add device registry + `broadcastPeersUpdate()` to `server.js`** in the Socket.io section
3. **Handle `disconnect` cleanup** in server.js device registry
4. **Add Network tab HTML** to `index.html` (new tab in the navigation or as a section)
5. **Add `window.onHeviPeersUpdate` handler** in `app.js` that renders device cards
6. **Style the device list** in `style.css` using `--accent: #25f4d0`
7. **Add `aeroGrabSetTarget(socketId)` to `aerograb.js`** for targeted transfers
8. **Update `FILE_GRABBED` handler in `server.js`** to support optional `targetId`
9. **Test with two real devices** on same WiFi

---

*This document was written by TWH for AI-assisted continuation of the AeroGrab project.*
*Always read `AeroGrab_Blueprint.md` for the full technical specification.*
*Always communicate with the developer in Hinglish (casual Hindi + English mix).*
