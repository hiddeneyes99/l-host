# AeroGrab Master Prompt — AI Handoff Document
## For Any AI Assistant Continuing This Project

**Project:** AeroGrab inside Hevi Explorer (TWH Eco System Technology)
**Author:** Technical White Hat (TWH)
**Last Updated:** April 20, 2026
**Language with developer:** Hinglish (Hindi + English mixed, casual tone — use "bhai", "yaar", "karo", "aaja", etc.)
**Brand accent color:** `#25f4d0` (CSS variable: `--accent`)

---

## PART 1: PROJECT OVERVIEW

**Hevi Explorer** is a local-first file manager and media server in Node.js.
- Runs on any device (Android Termux, PC, Mac, Replit) on port 5000
- Serves a full web UI: browse/view/upload/manage local files
- Stack: Node.js + Express + Socket.io + plain HTML/CSS/JS (no frontend framework)

**AeroGrab** is a gesture-controlled P2P file transfer feature BUILT INSIDE Hevi Explorer.
- **Closed fist ✊** = "Grab this file" (sender)
- **Open palm ✋** = "I'll catch it" (receiver)
- File travels **device-to-device via WebRTC DataChannel** — server never sees file bytes
- Gesture detection uses **Google MediaPipe Hands** running 100% on-device
- Camera feed NEVER leaves the device (privacy first-class requirement)
- Works on same WiFi LAN only (no TURN server yet, so no 4G/5G)

**Full technical spec:** Read `AeroGrab_Blueprint.md` in project root.

---

## PART 2: THE v1 → v2 EVOLUTION

### v1 Flaw (Why v1 Was Useless)
In v1, ALL devices connected to ONE shared Hevi Explorer server. So Device A and Device B were both browsing the SAME files from the SAME server. AeroGrab transferring a file was pointless — Device B could just download it directly from the shared server.

**v1 model: 1 kitchen, N waiters. Everyone eats from the same pot.**

### v2 Vision (Real Value)
Each device runs its OWN Hevi Explorer instance, serving its OWN local files.
- Phone A → `localhost:5000` → Phone A's files
- Phone B → `localhost:5000` → Phone B's files
- All connect to a **shared signaling server** (one Hevi instance, or Replit-deployed) for coordination only

When Phone A grabs a file:
1. Fetches from ITS OWN `/file?path=...` endpoint
2. Streams via WebRTC DataChannel to Phone B
3. Phone B's browser saves it as a download

**v2 model: N kitchens, 1 coordinator. Every chef owns their own food.**

**The WebRTC transfer logic was already correct for v2.** The missing piece was auto-discovery — devices needed to find each other automatically.

---

## PART 3: WHAT HAS BEEN BUILT (COMPLETE STATUS — April 20, 2026)

### ✅ Server Side (`server.js`, around line 3190+)

```
const heviDevices = new Map();  // socket.id → device info
```

Events implemented:
- `HEVI_ANNOUNCE` — device registers itself on connect; triggers `broadcastPeersUpdate()`
- `HEVI_HEARTBEAT` — keeps device `lastSeen` fresh (every 15s from client)
- `HEVI_PEERS_UPDATE` — server broadcasts full device list to ALL sockets on any join/leave
- `FILE_GRABBED` — creates session, broadcasts `WAKE_UP_CAMERAS`; supports `targetId` for targeted send (wake only one device)
- `DROP_HERE` — First-Confirmed-Receiver-Wins rule; initiates WebRTC signaling
- `webrtc_signal` — pure relay (forwards SDP offers/answers/ICE between peers)
- `SESSION_END` — clears session
- `disconnect` — removes device from `heviDevices`, broadcasts update; cleans up any active sessions

Session data is 100% in-memory. Never written to disk.

`broadcastPeersUpdate()` sends:
```javascript
{ devices: [...heviDevices.values()], total: heviDevices.size }
```

Device shape in registry:
```javascript
{
  socketId:   socket.id,
  deviceId:   'uuid-v4',           // from localStorage, stable per install
  deviceName: 'Rahul Ka Phone',    // UA-detected or user-set
  avatar:     '📱',               // emoji
  joinedAt:   Date.now(),
  lastSeen:   Date.now(),
}
```

### ✅ Client Side (`public/aerograb.js`) — Self-Contained IIFE

**Device Identity (localStorage-persisted):**
```javascript
getOrCreateDeviceId()  // crypto.randomUUID(), stored in 'ag_device_id'
getDeviceName()        // UA-detected: Android/iPhone/Mac/Windows, stored in 'ag_device_name'
getDeviceAvatar()      // 📱💻🖥📡, stored in 'ag_device_avatar'
```

**Socket Connection:**
```javascript
_socket = io(window.location.origin, {
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity,
});
```
- Socket connects on page BOOT (not just when AeroGrab toggle is ON)
- `connect` → `announceToNetwork()` + `startHeartbeat()`
- `reconnect` → re-announces to network
- `connect_error` → logged to console
- Heartbeat every 15 seconds

**IMPORTANT: Why `window.location.origin` and NOT `io()`?**
Using `io()` alone can fail on some proxy setups. Explicit origin is more reliable.

**IMPORTANT: Why NOT `transports: ['websocket']`?**
WebSocket-only mode fails on some browsers/proxies. Default (polling → WebSocket upgrade) is more reliable and was the fix for the v2 connection bug.

**Gesture Classification:**
```javascript
classifyGesture(lm):
  handSize = wrist(0) → middleMCP(9) distance (2D x,y ONLY — never z)
  curlRatio[i] = dist(tip[i], mcp[i]) / handSize
  FIST      = all curlRatios < 0.65
  OPEN_PALM = all curlRatios > 0.65
```
**NEVER use z-axis** — MediaPipe z is relative depth, not same scale as normalized x,y.

**MediaPipe setup:**
- `setInterval` at 12fps (NOT Camera utility — too slow)
- `_processingHands` flag prevents concurrent `hands.send()` calls
- `getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } })`

**Camera Permission guard (fixed in April 20 session):**
```javascript
if (!window.isSecureContext) → show HTTPS error, return false
if (!navigator.mediaDevices) → show browser error, return false
```
On HTTP origins (e.g., `http://192.168.x.x:5000`), browsers block camera access.
AeroGrab now shows a clear error: "Camera needs HTTPS. Use the Replit URL or localhost."

**File Transfer:**
- `getAeroGrabPayload()` priority: (1) open viewer file, (2) selected files, (3) targeted folder, (4) last opened (localStorage)
- `initiateGrab()` → `emit('FILE_GRABBED', { metadata, targetId })`
- `startFileTransfer()` → fetches file from OWN `/file?path=...`
- `streamFileOverBridge(blob)` → 64KB chunks via FileReader, respects bufferedAmount
- `finaliseReceivedFile()` → assembles chunks → Blob → `<a download>` → browser saves
- `zipFolder()` → JSZip for folder transfers

**Targeted Transfer:**
```javascript
window.aeroGrab.setTarget(socketId)  // set before grab
_targetSocketId = null               // auto-reset after use
```
When target is set, `FILE_GRABBED` includes `targetId`, server wakes only that device.

**Public API (window.aeroGrab):**
```javascript
window.aeroGrab = {
  toggle:    toggleAeroGrab,     // bool
  isOn:      () => _enabled,
  grab:      initiateGrab,
  catch:     signalReadyToReceive,
  setTarget: (socketId) => { _targetSocketId = socketId || null; },
  mySocketId: () => _socket ? _socket.id : null,
};
window.aeroGrabSetOpenFile = (fileMeta) => { _activeOpenFile = fileMeta; };
```

**Hooks from `app.js`:**
```javascript
window.aeroGrabSetOpenFile({ name, size, path, type })  // called when file opens
window._aeroCtxItem                                       // set by right-click menu handler
```

### ✅ UI (`public/index.html`)

**In sidebar (between AeroGrab toggle and sidebar-footer):**
```html
<div class="hevi-net-section" id="heviNetSection">
  <button class="hevi-net-header" id="heviNetHeader">
    🌐 Hevi Network
    <div id="heviNetCount">Searching...</div>
  </button>
  <div class="hevi-net-list hidden" id="heviNetList">
    <div id="heviNetEmpty">No other devices found</div>
    <!-- .hevi-peer-card elements injected dynamically -->
  </div>
</div>
```

**Wake-up panel (shown on receiver when someone grabs):**
```html
<div id="aeroWakePanel">
  <div id="aeroWakeSender">From: Device Name</div>  <!-- shows sender name -->
  <div id="aeroWakeFileName">filename.pdf</div>
  <button id="aeroWakeCatchBtn">✋ Catch</button>
  <button id="aeroWakeDismiss">Dismiss</button>
</div>
```

**Permission dialog:**
```html
<div class="modal hidden" id="aeroPermDialog">
  <!-- Shows before browser camera prompt — explains what AeroGrab does -->
  <button id="aeroPermEnable">Enable AeroGrab</button>
  <button id="aeroPermCancel">Not Now</button>
</div>
```

**Camera overlay (visible bottom-right when AeroGrab ON):**
```html
<video id="aeroVideoEl" .../>
<div id="agCamOverlay">
  <span id="aeroGestureLbl">—</span>  <!-- live debug: gesture + curl ratios -->
  <button id="aeroManualGrab">✊ Grab</button>  <!-- manual fallback -->
</div>
<div id="aeroGreenDot"></div>  <!-- top-right dot, green when ON -->
```

### ✅ Hevi Network Inline Script (`public/index.html` — at bottom, after aerograb.js)

```javascript
(function() {
  const _peerMap = new Map();          // socketId → deviceName
  let _prevOtherCount = 0;

  window._heviPeerName = function(socketId) { return _peerMap.get(socketId) || null; };

  window.onHeviPeersUpdate = function(devices, total, mySocketId) {
    // Called from aerograb.js when HEVI_PEERS_UPDATE arrives
    // Renders peer cards, updates count, auto-expands panel on first peer
    // Pulses section border with .hevi-net-pulse class when new peer joins
  };

  window.heviSendTo = function(socketId, deviceName) {
    // Called by "Send →" button on each peer card
    // Sets aeroGrab.setTarget(), closes sidebar, shows toast
  };
})();
```

**Count text behavior:**
- `total === 0` → "Connecting..."
- `n (others) === 0` → "Connected — waiting for other devices" (dim color)
- `n > 0` → "N device(s) nearby" (accent color)
- Auto-expands panel when first peer appears
- Pulses border animation (`.hevi-net-pulse`) on new peer

### ✅ Animation Layer (`public/aerograb-animation.js`)
- Rocket Launch animation (sender)
- Box Landing animation (receiver)
- Progress ring during transfer
- Uses anime.js from CDN

### ✅ Styles (`public/style.css` — all AeroGrab styles appended at end)
Classes: `.hevi-net-section`, `.hevi-net-header`, `.hevi-peer-card`, `.hevi-peer-send`, `.hevi-peer-dot`, `.ag-wake-panel`, `.ag-wake-sender`, `.ag-perm-card`, `.ag-toggle-switch`, `@keyframes heviNetPulse`

### ✅ Privacy
- `.gitignore` excludes: `files/`, `uploads/`, `thumbnails/`, `*.db`, `*.sqlite`, `.env`
- Server never writes session/device data to disk
- Server never touches file bytes (only signaling metadata)
- Camera processed entirely on-device

---

## PART 4: BUGS THAT WERE FIXED (April 20, 2026 Session)

### Bug 1: Socket WebSocket-Only Transport
**Was:** `io({ transports: ['websocket'] })`
**Fix:** `io(window.location.origin, { reconnectionDelay: 1000, reconnectionAttempts: Infinity })`
**Why:** WebSocket-only fails on some Replit proxy configs and mobile browsers. Default negotiation (polling → WebSocket upgrade) is more reliable.

### Bug 2: Camera Blocked on HTTP Origins
**Was:** `getUserMedia` called without checking `isSecureContext`
**Fix:** Added `if (!window.isSecureContext) { showCameraHttpsError(); return null; }`
**Why:** Browsers block camera access on `http://` origins except `localhost`. When a device accesses via LAN IP (`http://192.168.x.x:5000`), camera is blocked. Now shows clear error: "Camera needs HTTPS. Access via your Replit URL (https://...)."

### Bug 3: Camera Denied Error Not Specific
**Was:** Generic toast "AeroGrab needs camera access."
**Fix:** Named error handling:
- `NotAllowedError` → "Camera access denied. Go to browser Settings → Site permissions → Camera → Allow."
- `NotFoundError` → "No camera found on this device."
- `NotReadableError` → "Camera is being used by another app. Close it and try again."
- `OverconstrainedError` → Auto-retry without `facingMode` constraint (desktop cameras may not support 'user' facing mode)
- Other → "Camera error: [message]"
- Also: `localStorage.removeItem(PERM_KEY)` on error so next time dialog shows again

### Bug 4: Socket Reconnect Didn't Re-Announce
**Was:** No reconnect handler
**Fix:** `_socket.on('reconnect', () => announceToNetwork())`

### Bug 5: `onHeviPeersUpdate` Count Text Was Confusing
**Was:** "1 device online (you)" when alone — user thought nothing was working
**Fix:** "Connected — waiting for other devices" when no peers, "N device(s) nearby" when peers exist

### Bug 6: No Auto-Expand on Peer Discovery
**Was:** User had to manually click to expand the Hevi Network panel
**Fix:** Panel auto-expands + border pulse animation when first peer joins

---

## PART 4B: ADDITIONAL BUGS FIXED (April 20, 2026 — Second Session)

### Bug 7: Double `getUserMedia` Call — "Device In Use" Error
**Was:** `requestCameraPermission()` called `getUserMedia({ video: true })` → immediately stopped the stream → returned `true` (boolean). Then `initMediaPipe()` called `getUserMedia` AGAIN with actual constraints.
**Fix:** `requestCameraPermission()` now returns the `MediaStream` directly (or `null` on failure). The stream is passed to `initMediaPipe(stream)` which reuses it — only ONE `getUserMedia` call total.
**Why:** Two rapid `getUserMedia` calls can cause `NotReadableError` on some mobile browsers ("device in use"). Also wastes resources by starting camera twice.

### Bug 8: `Permissions-Policy` Header Missing on Server
**Was:** Server responses had no `Permissions-Policy` header.
**Fix:** Added `app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'camera=*, microphone=()'); next(); });` in `server.js` before static file serving.
**Why:** Modern Chrome may block camera access silently on some proxy/iframe setups without explicit `Permissions-Policy: camera=*` header from the server.

### Bug 9: HTTPS Error Message Useless for LAN Users (SUPERSEDED by Feature 11)
**Was:** `showCameraHttpsError()` showed `https://192.168.x.x:5000` (no SSL cert = useless URL).
**Original Fix:** Detects LAN IP pattern, shows: "Camera needs HTTPS. Access via your Replit URL..."
**Superseded by Feature 11:** Server now runs HTTPS on `httpPort + 443`, so the error now shows the actual working HTTPS URL.

### Feature 11: LAN HTTPS Server (AeroGrab Camera on Any LAN Device) ✅
**Problem:** Browsers block `getUserMedia` (camera) on HTTP origins, except localhost. Users accessing via LAN IP (`http://192.168.x.x:5000`) could not use AeroGrab camera.
**Fix:** Added automatic self-signed SSL certificate generation at startup + HTTPS server on `PORT + 443` (e.g. 5443 when HTTP is on 5000).

**Files changed:**
- `server.js` — added `selfsigned` require, `ensureSslCert()` async function, HTTPS server startup, banner update
- `public/aerograb.js` — updated `showCameraHttpsError()` to compute `https://${hostname}:${httpPort + 443}` and copy it to clipboard

**Certificate details:**
- Generated once at `data/ssl/{cert,key,ips}.pem/json`
- 10-year validity (`notAfterDate` = now + 10 years)
- RSA 2048-bit, SHA-256 signed
- SAN includes: `DNS:localhost`, `IP:127.0.0.1`, all current LAN IPs
- Regenerated automatically when LAN IPs change (detected via `data/ssl/ips.json`)
- Uses `selfsigned` npm package v5 (`generate()` is async/Promise-based)

**User setup (one-time per device):**
1. Server prints the HTTPS URL in startup banner: `https://192.168.x.x:5443`
2. User opens that URL in browser
3. Browser shows security warning (self-signed cert) → click "Advanced" → "Proceed"
4. Camera permission prompt appears → allow → AeroGrab works!
5. Next visits: no warning (cert cached by browser)

**Socket.io:** HTTPS server uses `io.attach(httpsServer)` so HTTP and HTTPS clients share the same device registry and can AeroGrab with each other.

### Bug 10: No Stale Device Cleanup Timer on Server
**Was:** `heviDevices` Map was only cleared on `socket.disconnect` events. If a browser crashed or network cut without clean disconnect, device stayed in registry forever.
**Fix:** Added `setInterval` sweep every 15 seconds that removes devices with `lastSeen > 45s` and calls `broadcastPeersUpdate()` if any were removed.
**Why:** Devices that crash or lose network don't always fire a clean socket disconnect. Without the sweep, ghost devices accumulate in the Hevi Network panel.

---

## PART 5: ARCHITECTURE — HOW NETWORK DISCOVERY WORKS

```
Device A (Replit URL)          Server (Replit)          Device B (same Replit URL)
        |                           |                           |
        |-- HEVI_ANNOUNCE --------->|                           |
        |<-- HEVI_PEERS_UPDATE {A} -|                           |
        |                           |<-- HEVI_ANNOUNCE ---------
        |<-- HEVI_PEERS_UPDATE{A,B}-|-- HEVI_PEERS_UPDATE{A,B}->|
        |                           |                           |
        | [sees Device B in list]   |        [sees Device A in list]
```

**CRITICAL REQUIREMENT FOR LAN DISCOVERY:**
Both devices MUST open the SAME URL to connect to the SAME server.
- ✅ Both devices open `https://your-repl.replit.dev` → SAME server → can see each other
- ❌ Device A on Replit URL, Device B on `http://192.168.x.x:5000` → DIFFERENT server instances → CANNOT see each other
- ❌ Both on LAN IP with HTTP → camera blocked (no HTTPS)

**For Termux/LAN deployment:**
One device runs the server. Others access via that device's LAN IP. But they need HTTPS for camera — this requires either:
- A self-signed cert (complex setup)
- Deploy to Replit (recommended for now) and ALL devices use the Replit URL

---

## PART 6: IMPORTANT RULES (Do NOT Violate These)

1. **Never break Hevi Explorer** — AeroGrab is an overlay. If AeroGrab crashes, file manager must still work.
2. **`aerograb.js` must stay a self-contained IIFE** — `(function AeroGrab() { ... })()`
3. **No file bytes on server** — Server is pure signaling relay. WebRTC DataChannel handles actual bytes.
4. **2D gesture math only** — Never use z-axis in landmark distance calculations.
5. **Camera controlled only by `aerograb.js`** — No other code touches camera.
6. **Socket.io on server has `cors: { origin: '*' }`** — Do not restrict to specific origins.
7. **All device/session data in-memory only** — Never write to disk.
8. **Toast function:** `toast(message, 'success' | 'error' | 'warn' | '')` — available globally in `app.js`.
9. **CSS var `--accent: #25f4d0`** — All AeroGrab UI elements use this color.

---

## PART 7: CDN SCRIPTS (in `index.html`)

```html
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
<script src="/iv.js?v=11"></script>
<script src="/app.js?v=12"></script>
<script src="/aerograb-animation.js?v=1"></script>
<script src="/aerograb.js?v=1"></script>
<script>
  // service worker + Hevi Network inline IIFE (onHeviPeersUpdate, heviSendTo, etc.)
</script>
```

Server socket.io version: `^4.8.3`

---

## PART 8: KEY FILE MAP

| File | Purpose | Important Lines |
|---|---|---|
| `server.js` | AeroGrab signaling + Hevi Network | ~3190–3285 |
| `public/aerograb.js` | All AeroGrab client logic | Full file (~780 lines) |
| `public/aerograb-animation.js` | Rocket/box animations | Full file |
| `public/index.html` | UI markup + inline Hevi Network script | Wake panel ~2424, Network section ~168–183, inline script ~2466+ |
| `public/style.css` | All styles | AeroGrab styles appended at end |
| `public/app.js` | Hevi Explorer main app | openFile hook ~3581, ctxMenu ~3974 |
| `AeroGrab_Blueprint.md` | Full engineering spec | Full file |

---

## PART 9: WHAT IS STILL REMAINING / KNOWN GAPS

### ❌ NOT YET DONE — Next AI Should Tackle These

1. **Real multi-device test** — Need two physical devices on same WiFi, both opening Replit URL, to verify end-to-end: see each other → send file → receive file.

2. **~~Stale device cleanup~~** — ✅ FIXED (April 20, second session). `setInterval` sweep runs every 15s, removes devices with `lastSeen > 45s`.

3. **Device Name Customization** — Currently auto-detected from userAgent. User should be able to set a custom name. Add a small input field in the Network section or Settings.

4. **WebRTC TURN server** — For devices NOT on same WiFi (4G/5G cross-network). Not needed for LAN use case but required for full P2P. Use free TURN from `openrelay.metered.ca` or deploy coturn.

5. **Transfer Progress UI** — `aeroAnim.updateReceiverProgress(pct)` exists in animation layer but progress % is not wired to the actual DataChannel receive tracking. Wire `_recvReceived / _recvMeta.size` to the animation progress.

6. **Multiple File Select** — `getAeroGrabPayload()` supports selected files but currently only grabs first selected file if multiple are selected. Add zip for multi-select.

7. **Receive History** — No log of received files. Add a simple received-files list in the AeroGrab UI showing last N transfers.

8. **Offline/HTTPS on LAN** — For Termux deployment with camera working on LAN without Replit, need HTTPS. Could add a `--https` flag to `server.js` that generates a self-signed cert on first run.

9. **AeroGrab Device Name Display** — In the "🌐 Hevi Network" panel, the user's OWN device name/avatar is not displayed anywhere. Show "This device: 📱 Android Device" at top of the panel.

---

## PART 10: TESTING CHECKLIST

When two devices are available, verify ALL of these:

- [ ] Device A opens Replit URL → Network panel shows "Connected — waiting for other devices"
- [ ] Device B opens same Replit URL → both A and B see each other in Network panel
- [ ] Network panel on A shows Device B's name + avatar + green dot
- [ ] "Send →" button on Device B's card in A's sidebar → toast shows "Targeted: [B name]"
- [ ] AeroGrab toggle ON → permission dialog appears → click Enable → browser camera prompt appears
- [ ] Camera shows in bottom-right → gesture label shows live curl ratios
- [ ] Make fist → FIST detected → WAKE_UP_CAMERAS sent to B
- [ ] Device B shows wake-up notification with "From: [A name]" + filename
- [ ] Device B opens palm OR clicks Catch → file transfer starts → file downloads on B
- [ ] AeroGrab toggle OFF → camera stops → Hevi Network panel still works
- [ ] Device C joins → counter updates → all three see each other
- [ ] Device C closes browser → counter updates within seconds (socket disconnect)
- [ ] Existing Hevi Explorer works perfectly (browse/upload/view/etc.)

---

*Document maintained by Technical White Hat (TWH).*
*Communicate with developer in casual Hinglish — bhai, yaar, chill tone.*
*Always read `AeroGrab_Blueprint.md` for detailed engineering spec.*
