
<br/>
<br/>

---

<div align="center">

# AeroGrab Technology Blueprint

## Touchless Gesture-Controlled P2P File Transfer System
### with LAN-Aware Distributed Hevi Network

### by Technical White Hat (TWH)

**Document Version:** 2.0 — Distributed Architecture Release
**Classification:** Internal Engineering Blueprint
**Author:** Technical White Hat (TWH), Independent Developer
**Created:** April 18, 2026 | **Updated:** April 18, 2026
**Platform:** TWH Eco System Technology (Hevi Explorer)
**Status:** 🟢 v1 Implemented — v2 (LAN Discovery) In Design

</div>

---

<br/>

> *"The future of file transfer is not about cables, not about clouds — it's about intention. You grab, you throw, someone catches."*
> — Technical White Hat (TWH), Creator of AeroGrab

<br/>

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Vision & Motivation](#2-vision--motivation)
3. [The Problem AeroGrab v2 Solves](#3-the-problem-aerograb-v2-solves)
4. [How AeroGrab Works — Plain English (v2 Model)](#4-how-aerograb-works--plain-english-v2-model)
5. [Core Technical Architecture — Distributed LAN Model](#5-core-technical-architecture--distributed-lan-model)
6. [LAN Discovery & Device Registry System](#6-lan-discovery--device-registry-system)
7. [The P2P Bridge System — No Server File Routing](#7-the-p2p-bridge-system--no-server-file-routing)
8. [Intelligent File Selection Matrix](#8-intelligent-file-selection-matrix)
9. [Gesture Recognition Engine](#9-gesture-recognition-engine)
10. [Privacy & Permission Model](#10-privacy--permission-model)
11. [AeroGrab Fly — UI Animation Strategy](#11-aerograb-fly--ui-animation-strategy)
12. [Session Lifecycle & State Management](#12-session-lifecycle--state-management)
13. [Folder Transfer & Auto-Zip Protocol](#13-folder-transfer--auto-zip-protocol)
14. [Error Handling & Edge Cases](#14-error-handling--edge-cases)
15. [Developer Implementation Guide](#15-developer-implementation-guide)
16. [Function Reference](#16-function-reference)
17. [Phased Rollout Plan](#17-phased-rollout-plan)
18. [Technology Stack Summary](#18-technology-stack-summary)

---

<br/>

## 1. Executive Summary

AeroGrab is a gesture-controlled, peer-to-peer file transfer system built for the TWH Eco System Technology (Hevi Explorer). Users on the same Wi-Fi/LAN each run their **own** Hevi Explorer instance — serving their own files from their own device. AeroGrab connects these independent instances, lets them discover each other automatically, and enables file transfer by physical gesture: close your fist to grab a file, open your palm to catch it.

**v1 (Implemented):** Single-server model. AeroGrab built as an overlay on a centralized Hevi Explorer — gesture detection, WebRTC P2P data channel, animations, socket signaling all working.

**v2 (This Document):** Distributed model. Each device runs its own Hevi Explorer. Instances auto-discover each other on the LAN. AeroGrab transfers files between genuinely separate devices with separate file stores.

The system is engineered around three non-negotiable principles:

**Speed** — File data travels directly between devices via a WebRTC P2P Bridge. The signaling server handles only the "who is who" handshake — never the file bytes.

**Privacy** — Camera feed never leaves the device. MediaPipe runs entirely in-browser, on-device. Server receives only gesture event strings, never video or file content.

**Simplicity** — Despite sophisticated internals, AeroGrab has zero learning curve. Each device on the network sees all other devices. You pick, you grab, someone catches. Done.

---

<br/>

## 2. Vision & Motivation

### Why AeroGrab?

File transfer on local networks today is either clunky (USB cables, SMB shares, AirDrop menus) or requires cloud intermediaries (WhatsApp, Google Drive) that are unnecessary when devices are sitting in the same room.

AeroGrab v2 is the answer for **Hevi Explorer's natural use case**: you have 10 phones in a family, a classroom, or an office — all on the same Wi-Fi. Every person runs Hevi Explorer on their own phone. They can see each other's devices on the network, and sending a file is as natural as physically handing it to someone.

### Who Built This?

AeroGrab was conceived and architected by **Technical White Hat (TWH)**, the developer behind Hevi Explorer — TWH Eco System Technology. The technology was designed from scratch, inspired by the concept of physical intuition: transferring a file should feel as natural as handing someone a physical object.

---

<br/>

## 3. The Problem AeroGrab v2 Solves

### The v1 Architectural Flaw

In v1, all devices browsed **one shared** Hevi Explorer server. If Device A grabbed a file and Device B caught it:
- Both devices were looking at the **same files** (from the same server)
- "Receiving" a file meant getting a browser download of something already on the server
- This was redundant — Device B could already just click download

```
v1 Problem:
  Device A ──sees──→ [Host Server's Files]
  Device B ──sees──→ [Host Server's Files]   ← same files!
  AeroGrab: transfers file from host to... device B browser download
  But device B already had access. Redundant.
```

### The v2 Solution: Separate Instances, LAN-Aware

```
v2 Solution:
  Device A → runs Hevi Explorer → serves ITS OWN files (phone A's storage)
  Device B → runs Hevi Explorer → serves ITS OWN files (phone B's storage)
  Device C → runs Hevi Explorer → serves ITS OWN files (phone C's storage)

  All three discover each other automatically on the same WiFi.
  Device A grabs a file → it fetches from ITS OWN server (localhost:5000)
  Device B catches it → gets the file as a download to ITS LOCAL storage
  Genuinely P2P. Files are truly transferred between different devices.
```

---

<br/>

## 4. How AeroGrab Works — Plain English (v2 Model)

Imagine 20 phones in a classroom. Each phone is running Hevi Explorer. They are all on the same school Wi-Fi.

**When any phone joins the network:**
Hevi Explorer automatically announces itself — *"I am Phone 7, I am online."* Every other phone's Hevi Explorer immediately updates: *"20 devices on this network."* A device list appears in a new "Network" tab showing all 20 phones — their names, avatars, and online status.

**Sending a file (Phone A → Phone B):**
1. Phone A opens a photo in Hevi Explorer
2. Phone A enables AeroGrab, makes a fist — *"I am grabbing this photo"*
3. All 20 phones receive a wake-up signal: *"Phone A is sending something!"*
4. Phone B opens its palm — *"I will catch it"*
5. Server applies **First Confirmed Receiver Wins** — Phone B gets the transfer
6. Direct P2P WebRTC connection opens between Phone A and Phone B
7. Photo travels directly A→B at full Wi-Fi speed — no server in the middle
8. Phone B's browser downloads the photo to its local storage

**The server's role in v2:** Only coordination. It maintains the device registry (who is online), brokers WebRTC handshakes, and enforces session rules. It never touches a single byte of file content.

---

<br/>

## 5. Core Technical Architecture — Distributed LAN Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                AeroGrab v2 — Distributed LAN Architecture                │
└─────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────┐    Heartbeat + Signal    ┌──────────────────────────┐
  │   DEVICE A       │ ←──────────────────────→ │   SIGNALING SERVER       │
  │  Hevi Explorer   │                          │  (Central Coordinator)   │
  │  localhost:5000  │                          │  ─────────────────────── │
  │  Own files only  │ ←──────────────────────→ │  • Device Registry       │
  │  MediaPipe ON    │    Heartbeat + Signal    │  • Session Management    │
  └────────┬─────────┘                          │  • WebRTC Relay Only     │
           │                                    │  • NEVER sees file bytes │
           │  Direct WebRTC File Transfer       └──────────┬───────────────┘
           │  (P2P Data Channel)                           │
           │  Device A's file → Device B's download        │ Heartbeat + Signal
           │                                               │
  ┌────────▼─────────┐                          ┌──────────▼───────────────┐
  │   DEVICE B       │                          │   DEVICES C, D, E...     │
  │  Hevi Explorer   │                          │  Hevi Explorer each      │
  │  localhost:5000  │                          │  localhost:5000 each     │
  │  Own files only  │                          │  Own files, own storage  │
  │  MediaPipe ON    │                          │  Online, awaiting signal │
  └──────────────────┘                          └──────────────────────────┘

  KEY PRINCIPLES:
  1. Each device has its own Hevi Explorer instance and its own file storage
  2. File bytes NEVER pass through the signaling server
  3. Server only knows: who is online, who grabbed, who caught
  4. LAN discovery is automatic — no manual IP entry
```

### Architecture Layers

| Layer | Technology | Purpose |
|---|---|---|
| LAN Discovery | Socket.io rooms + Heartbeat | Devices find each other automatically on same network |
| Device Registry | Server-side Map + broadcast | Maintain live list of all online Hevi instances |
| Gesture Detection | Google MediaPipe Hands (JS) | On-device, 12fps hand landmark tracking |
| Signaling | Socket.io (WebSocket) | Lightweight coordination between devices and server |
| File Transfer | WebRTC Data Channel | Direct P2P encrypted file streaming |
| File Serving | Each device's own Node.js | Each device serves its own files from own storage |
| Animation | CSS Keyframes + anime.js | Latency-masking UI animations |

---

<br/>

## 6. LAN Discovery & Device Registry System

This is the **core new feature of v2**. It is what makes AeroGrab genuinely useful.

### The Problem with Manual Discovery

Older tools require users to manually enter IP addresses or scan QR codes. This creates friction and breaks the "just works" promise. AeroGrab v2 uses automatic LAN discovery.

### How Discovery Works

Every Hevi Explorer instance, when it starts, connects to the signaling server and registers itself:

```javascript
// On startup (client side)
socket.emit('HEVI_ANNOUNCE', {
  deviceId:   'uuid-unique-per-install',   // generated once, stored in localStorage
  deviceName: 'Rahul Ka Phone',            // from device hostname or user-set
  avatar:     '📱',                        // emoji or initials
  version:    '1.0.0',
});
```

The server maintains a **Device Registry**:

```javascript
// Server side — in-memory Map
const heviDevices = new Map();
// Key: socket.id
// Value: { deviceId, deviceName, avatar, joinedAt, lastSeen }
```

When any device registers, the server broadcasts the updated device list to ALL connected devices:

```javascript
// Server broadcasts to everyone
io.emit('HEVI_PEERS_UPDATE', {
  devices: [...heviDevices.values()],
  total:   heviDevices.size,
});
```

### Heartbeat System

Every device sends a heartbeat every 15 seconds. If a device misses 2 consecutive heartbeats (30 seconds), it is removed from the registry and all other devices are notified.

```
Client → Server: HEVI_HEARTBEAT (every 15s)
Server → All:    HEVI_PEERS_UPDATE (when any device joins, leaves, or times out)
```

### Network Tab in Hevi Explorer

A new **"Network"** section appears in Hevi Explorer showing:

```
┌────────────────────────────────────────────────┐
│  🌐 Hevi Network — 4 devices online           │
│  ────────────────────────────────────────────  │
│  📱 Rahul Ka Phone        ● Online   [Send →]  │
│  💻 Laptop Ghar           ● Online   [Send →]  │
│  📱 Bhai Ka Phone         ● Online   [Send →]  │
│  📟 Tablet                ● Online   [Send →]  │
└────────────────────────────────────────────────┘
```

### Targeted vs Broadcast Transfer

**v1 Behavior:** Grab → everyone wakes up → first palm wins
**v2 Behavior (two modes):**

| Mode | Trigger | Behavior |
|---|---|---|
| **Broadcast** | Fist gesture (no target) | Everyone gets wake-up, first palm wins |
| **Targeted** | Tap device in Network tab → then fist | Only that specific device gets the wake-up |

Targeted mode is more private and more precise — like pointing at someone before throwing.

### LAN vs WAN

In v2, the signaling server can be:
- **Deployed on Replit** (accessible from internet) — works over 4G/5G too, as long as both devices connect to same signaling server
- **Running on local device** (one phone runs the server, others connect via LAN IP) — fully offline, zero internet dependency

For Termux users: one device runs `node server.js` on port 5000. All other devices connect to `http://[that-device-ip]:5000`. They all auto-discover each other.

---

<br/>

## 7. The P2P Bridge System — No Server File Routing

### The AeroGrab Solution: P2P Bridge

AeroGrab uses **WebRTC Data Channels** for actual file transfer. WebRTC creates a direct, encrypted, peer-to-peer connection between two browsers.

```
Traditional (BAD):    Sender → Server RAM → Receiver  (2x bandwidth, bottleneck)

AeroGrab P2P (GOOD):  Sender ─────────────────────────→ Receiver (direct, full LAN speed)
                                    ↑
                      Server only handles "who connects to whom" (WebRTC signaling)
```

### WebRTC Signaling Flow

```
Step 1: Sender creates WebRTC Offer → sends to Signaling Server
Step 2: Server forwards Offer to Receiver
Step 3: Receiver creates WebRTC Answer → sends to Server
Step 4: Server forwards Answer to Sender
Step 5: P2P connection established — Server steps out completely
Step 6: File streams directly Sender → Receiver at full LAN/WiFi speed
```

### How Sender Reads the File in v2

In v2, the sender fetches the file from **its own local Hevi Explorer server** (`/file?path=...`). Since each device's browser is pointed at its own `localhost:5000`, this naturally reads from the sender's own storage:

```javascript
// Sender's browser fetches from THEIR OWN Hevi Explorer
const resp = await fetch(`/file?path=${encodeURIComponent(payload.path)}`);
// This hits localhost:5000 on the SENDER's device — their own files
const blob = await resp.blob();
// Blob is then streamed via WebRTC to the receiver
```

The receiver gets the file as a browser download — saved to their device's local storage. **No shared filesystem. Genuinely separate devices.**

### Performance Comparison

| Metric | Cloud Transfer | Server-Buffered | AeroGrab P2P |
|---|---|---|---|
| Max file size | Cloud plan limits | Server RAM limit | Unlimited |
| Speed | Internet speed | LAN speed ÷ 2 | Full LAN speed |
| Privacy | Files on cloud | Files on local server | Files never leave devices |
| Server load | High | High | Near zero |
| Works offline | No | Yes | Yes |
| Multiple transfers simultaneous | Limited | Very limited | Yes (independent P2P sessions) |

---

<br/>

## 8. Intelligent File Selection Matrix

AeroGrab uses a context-aware system to determine exactly what gets transferred when the user makes the grab gesture.

| User's Current State | What AeroGrab Grabs | Transfer Type |
|---|---|---|
| File open in viewer | That specific open file | Single Object (Priority Override) |
| Files selected (select mode) | All selected files | Batch Array |
| Folder highlighted/targeted | Entire folder contents | Zipped Archive |
| Nothing active | Last opened/viewed file | Single Object (Fallback) |

### Priority Override Rule

If the user has 5 files selected but then opens an image in the viewer — AeroGrab grabs the **currently viewed image**. What you're looking at = what you want to share. This mirrors natural human intuition.

---

<br/>

## 9. Gesture Recognition Engine

### Technology: Google MediaPipe Hands

MediaPipe Hands tracks 21 key landmarks on the human hand in real time, running entirely inside the browser — no data sent to any server.

```
Hand Landmark Map (21 Points):
        8   12  16  20      ← Fingertips
        |   |   |   |
    7   11  15  19
    |   |   |   |
    6   10  14  18
        |   |   |
    5───9───13──17          ← MCP Knuckles
        \           |
     4   \          |
     |    2─────────0       ← Wrist (landmark 0)
```

### Gesture Classification — Distance-Based (v2 Algorithm)

The v2 gesture engine uses **2D distance-based classification** — ignoring z-axis (depth) because MediaPipe z values are not on the same scale as normalized x,y coordinates.

```javascript
// Hand size = wrist(0) to middle-MCP(9) in 2D normalized space
const handSize = dist2D(lm[0], lm[9]);

// Curl ratio for each finger: tipToMCP / handSize
// Small ratio (< 0.65) = finger is curled → FIST
// Large ratio (> 0.65) = finger is extended → OPEN PALM
```

| Gesture | Condition | Meaning |
|---|---|---|
| **FIST** | All 4 curl ratios < 0.65 | Grab trigger |
| **OPEN_PALM** | All 4 curl ratios > 0.65 | Catch trigger |
| **null** | Mixed/ambiguous | Ignored |

### Why NOT Y-coordinate comparison (the v1 mistake)

The original algorithm compared fingertip.y to knuckle.y. This only works when the hand is held in one specific orientation (horizontal, facing up). A hand held sideways, rotated, or at an angle will produce incorrect y-coordinate relationships. The distance-based approach works for any hand orientation.

### Performance Configuration

| Parameter | Value | Reason |
|---|---|---|
| FPS | 12 | Battery-efficient, sufficient for gesture detection |
| maxNumHands | 1 | Lower compute, single-user per device |
| modelComplexity | 0 | Lite model — best for mobile performance |
| minDetectionConfidence | 0.6 | Lenient enough to work on mid-range phones |
| minTrackingConfidence | 0.5 | Allows detection in varied lighting |

### Debug Mode

The gesture label in the camera preview shows live debug data:
- `👁 42 | no hand` — model running but no hand detected (shows frame count)
- `H:0.18 [0.32,0.28,0.30,0.25]` — hand detected, showing curl ratios per finger
- `✅ FIST` or `✅ OPEN_PALM` — gesture confirmed, action triggering

This lets developers and users diagnose detection issues in real time.

### Manual Override

A `✊ Grab` button appears below the camera preview when AeroGrab is active. This bypasses gesture detection entirely — useful when camera conditions are poor or for users who prefer UI interaction.

---

<br/>

## 10. Privacy & Permission Model

### One-Time Permission Request

On first enable, AeroGrab shows a custom explanation dialog before the browser's native prompt:

```
┌───────────────────────────────────────────────────┐
│  🎯 AeroGrab needs your camera                    │
│                                                   │
│  AeroGrab uses your camera to detect hand          │
│  gestures (fist to grab, open palm to catch).     │
│                                                   │
│  ✅ Your camera feed NEVER leaves this device     │
│  ✅ No video is recorded or stored                │
│  ✅ No data is sent to any server                 │
│  ✅ Only gesture events ("fist detected") are     │
│     transmitted — never images or video           │
│                                                   │
│  [Enable AeroGrab]        [Not Now]               │
└───────────────────────────────────────────────────┘
```

### What the Server Sees

The server receives only these events — never any media or file content:

```
HEVI_ANNOUNCE         → { deviceId, deviceName, avatar }
HEVI_HEARTBEAT        → { deviceId }
FILE_GRABBED          → { sessionId, metadata: { name, size, type } }
DROP_HERE             → { sessionId }
webrtc_signal         → { to, signal } (encrypted WebRTC SDP/ICE — not file content)
SESSION_END           → { sessionId }
```

**Zero bytes of actual file content ever reach the server.**

### What Stays Local Forever

- Camera video frames
- Actual file bytes
- File content
- User's file paths (only metadata like filename and size are signaled)

### .gitignore Privacy

The `.gitignore` excludes all user data so personal files are never accidentally committed to version control:

```
files/          ← User's personal files
uploads/
thumbnails/
*.db            ← Local database / index files
*.sqlite
.env            ← Secrets
```

---

<br/>

## 11. AeroGrab Fly — UI Animation Strategy

The "AeroGrab Fly" is the visual experience layer. Its primary engineering purpose is **latency masking**.

### Phase 1: Energy Squeeze (Sender, 0s–1.5s)
Particle effect intensifies around the file thumbnail as fist closes. Masks WebRTC signaling setup time (~500ms).

### Phase 2: Rocket Launch (Sender, 1.5s–4s)
File thumbnail is packed into a glowing box, loaded into a rocket, and launches off-screen. Screen shows: *"File in air — waiting for receiver..."* Masks P2P connection and file chunking preparation.

### Phase 3: Receiver Landing (Receiver, on palm detection)
Rocket descends, box opens revealing the file thumbnail. Masks first chunks arriving.

### Phase 4: Progress Ring (Large files)
Box transforms into a circular progress ring filling clockwise. Fills with real percentage from WebRTC transfer progress. At 100%, bursts open. Provides accurate feedback for any file size.

---

<br/>

## 12. Session Lifecycle & State Management

### Session States

```
IDLE → ENABLED → GRAB_TRIGGERED → BROADCASTING → RECEIVING → COMPLETE → IDLE
                                        ↓
                                 TIMEOUT (60s) → CANCELLED → IDLE
```

### First Confirmed Receiver Wins

When multiple devices show open palm simultaneously:
- Server timestamps each `DROP_HERE` with millisecond precision
- Earliest timestamp wins
- All others get: *"File was caught by another device"*

### 60-Second Timeout

If no receiver responds within 60 seconds:
- Server sends `SESSION_EXPIRED` to sender
- Sender sees: *"No one caught it. File is still safe on your device."*
- All devices return to idle

---

<br/>

## 13. Folder Transfer & Auto-Zip Protocol

### Validation Rules

| Rule | Limit | Error |
|---|---|---|
| Max folder size | 1 GB | "AeroGrab Limit: Folder exceeds 1GB maximum" |
| Max file count | 20 files | "AeroGrab Limit: Folder contains more than 20 files" |
| Empty folder | Not allowed | "AeroGrab: Cannot transfer an empty folder" |

### Process

1. Validate (size + count) — fail fast before any compression
2. Zip folder in-browser using JSZip (held in ArrayBuffer, never written to disk)
3. Stream zip via P2P Bridge as single binary blob
4. Receiver gets `.zip` as browser download

---

<br/>

## 14. Error Handling & Edge Cases

| Scenario | Detection | Response |
|---|---|---|
| No hand detected | Frame counter shows no landmarks | Debug label: "👁 N \| no hand" |
| MediaPipe model fails to load | Promise rejection | "AeroGrab: Camera AI failed to load." |
| Camera permission denied | getUserMedia rejection | "AeroGrab needs camera access." |
| Receiver disconnects mid-transfer | WebRTC channel closes | "Connection lost. Resend?" |
| Multiple senders grab simultaneously | Each creates independent session | Sessions are isolated |
| WebRTC P2P fails (NAT/firewall) | ICE connection failure | Fallback offer via traditional download |
| Session timeout (60s) | Server timer | "Transfer expired. File still on your device." |
| Folder too large/many files | Pre-transfer validation | Specific error dialog |
| No file to grab | getAeroGrabPayload returns null | "No file to grab. Open or select a file first." |
| Device leaves network mid-transfer | Heartbeat timeout | Device removed from registry, all notified |

---

<br/>

## 15. Developer Implementation Guide

### Current State (v1 — What Is Already Built)

```
✅ Socket.io signaling server (FILE_GRABBED, DROP_HERE, webrtc_signal, SESSION_END)
✅ 60s timeout + First-Confirmed-Receiver-Wins rule
✅ MediaPipe Hands at 12fps via direct getUserMedia (no Camera utility)
✅ 2D distance-based gesture classification (FIST + OPEN_PALM)
✅ WebRTC P2P data channel with 64KB chunking
✅ Folder auto-zip with JSZip
✅ Permission dialog (one-time, localStorage remembered)
✅ Wake-up notification panel for receivers
✅ Green dot indicator (active = AeroGrab ON)
✅ Sidebar toggle + context menu "AeroGrab" button
✅ Energy Squeeze + Rocket Launch + Receiver Landing + Progress Ring animations
✅ Camera preview (150x112px, bottom-right, live while AeroGrab ON)
✅ Debug gesture label (shows curl ratios live, or gesture name when detected)
✅ Manual ✊ Grab button (bypasses gesture detection)
✅ Privacy .gitignore (files/, uploads/, *.db, .env excluded)
```

### What Needs to Be Built (v2 — LAN Discovery)

```
❌ HEVI_ANNOUNCE event (client sends on connection)
❌ HEVI_HEARTBEAT event (client sends every 15s)
❌ HEVI_PEERS_UPDATE broadcast (server sends on any join/leave)
❌ Device Registry (server-side Map of all online Hevi instances)
❌ Network tab UI in Hevi Explorer (shows all online devices)
❌ Device name + avatar setup (first-run prompt or settings)
❌ Targeted transfer mode (select a device → then grab → only that device wakes up)
❌ Broadcast transfer mode (grab without target → everyone wakes up, first palm wins)
❌ "N devices on this network" live counter
❌ Device-specific wake-up notification (shows WHICH device is sending and what)
```

### File Structure

```
hevi-explorer/
├── server.js                    ← Socket.io server + AeroGrab signals (v1 done)
│                                   + Add: device registry, HEVI_ANNOUNCE, HEVI_HEARTBEAT
├── public/
│   ├── app.js                   ← Hevi Explorer main app
│   │                               + Add: Network tab, device list rendering
│   ├── aerograb.js              ← All AeroGrab client logic (v1 done)
│   │                               + Add: HEVI_ANNOUNCE on connect, heartbeat, targeted grab
│   ├── aerograb-animation.js    ← Animations (v1 done)
│   ├── index.html               ← UI markup
│   │                               + Add: Network tab, device list container
│   └── style.css                ← Styles
│                                   + Add: Network tab + device card styles
└── AeroGrab_Blueprint.md        ← This document
```

### Coding Conventions (MUST follow when implementing v2)

1. **Keep aerograb.js isolated** — all AeroGrab logic stays inside `(function AeroGrab() { ... })()` IIFE
2. **No shared globals** — communicate with app.js only through `window.aeroGrab*` and `window.onHeviPeersUpdate` hooks
3. **Server sessions are in-memory only** — never write AeroGrab or device data to disk
4. **Toast notifications** use the existing Hevi Explorer `toast(msg, type)` function — types: `'success'`, `'error'`, `'warn'`, `''`
5. **CSS accent color** is `--accent: #25f4d0` — all AeroGrab UI uses this color
6. **Device IDs** are generated once via `crypto.randomUUID()` and stored in `localStorage('ag_device_id')`
7. **Socket events** follow the naming convention: `HEVI_*` for network/peer events, `AG_*` or existing names for AeroGrab transfer events

### v2 Socket Events Reference

```
Client → Server:
  HEVI_ANNOUNCE  { deviceId, deviceName, avatar }   ← on connect
  HEVI_HEARTBEAT { deviceId }                        ← every 15s
  FILE_GRABBED   { sessionId, metadata, targetId? } ← grab (targetId = optional targeted device)
  DROP_HERE      { sessionId }
  webrtc_signal  { to, signal }
  SESSION_END    { sessionId }

Server → Client:
  HEVI_PEERS_UPDATE  { devices: [...], total: N }   ← on any join/leave
  WAKE_UP_CAMERAS    { senderId, senderName, metadata, sessionId }
  TRANSFER_APPROVED  { peerId, sessionId }
  TRANSFER_TAKEN     { sessionId }
  SESSION_EXPIRED    { sessionId }
  webrtc_signal      { from, signal }
```

---

<br/>

## 16. Function Reference

### Existing v1 Functions (client-side, `aerograb.js`)

| Function | Description |
|---|---|
| `toggleAeroGrab(bool)` | Enable/disable AeroGrab, manage camera + MediaPipe lifecycle |
| `showPermissionDialog()` | Show custom permission explanation before browser prompt |
| `initMediaPipe()` | Load MediaPipe, start getUserMedia, setInterval at 12fps |
| `processGestureResults(results)` | MediaPipe callback — classifies gesture, updates debug label |
| `classifyGesture(lm)` | 2D distance-based classification → 'FIST' / 'OPEN_PALM' / null |
| `onGestureDetected(gesture)` | Route FIST→initiateGrab, OPEN_PALM→signalReadyToReceive |
| `initiateGrab()` | Get payload, emit FILE_GRABBED, start animation Phase 1 |
| `getAeroGrabPayload()` | Read app state → return file/folder/batch descriptor |
| `signalReadyToReceive()` | Emit DROP_HERE, start receiver animation |
| `openP2PBridge(peerId, role)` | Create RTCPeerConnection, set up data channel |
| `startFileTransfer()` | Fetch file from own server, stream via WebRTC |
| `streamFileOverBridge(blob, name)` | Chunk blob into 64KB pieces, send over data channel |
| `onChunkReceived(event)` | Receive chunks, track progress, call finaliseReceivedFile |
| `finaliseReceivedFile()` | Assemble blob → browser download (saves to device local storage) |
| `deactivateAeroGrab()` | Stop MediaPipe, stop camera, clear state |
| `showGreenDot(bool)` | Toggle green dot indicator + camera overlay visibility |
| `resetSession()` | Clear all session state (role, peer, channel, buffers) |

### New v2 Functions to Implement (client-side)

| Function | Description |
|---|---|
| `announceToNetwork()` | Emit HEVI_ANNOUNCE with deviceId, deviceName, avatar on connect |
| `startHeartbeat()` | setInterval 15s → emit HEVI_HEARTBEAT |
| `stopHeartbeat()` | clearInterval on disconnect |
| `onPeersUpdate(devices)` | Receive HEVI_PEERS_UPDATE → update Network tab UI |
| `renderDeviceList(devices)` | Render device cards in Network tab |
| `setTargetDevice(deviceId)` | Set targeted device for next grab (null = broadcast) |
| `getDeviceIdentity()` | Return/generate deviceId + deviceName from localStorage |

### New v2 Functions to Implement (server-side, `server.js`)

| Function | Description |
|---|---|
| `registerDevice(socket, info)` | Add to heviDevices Map, broadcast HEVI_PEERS_UPDATE |
| `removeDevice(socketId)` | Remove from Map on disconnect, broadcast update |
| `heartbeatCheck()` | setInterval 30s → remove devices with lastSeen > 30s |
| `broadcastPeersUpdate()` | io.emit('HEVI_PEERS_UPDATE', { devices, total }) |
| `handleFileGrabbed(socket, data)` | v2 version: supports targetId for directed wake-up |

---

<br/>

## 17. Phased Rollout Plan

### ✅ Phase 1 — Foundation (COMPLETE)

- Socket.io signaling server
- Camera permission system
- MediaPipe Hands at 12fps
- Basic gesture detection (v1 — Y-coordinate, replaced in debug)

### ✅ Phase 2 — File Transfer Core (COMPLETE)

- WebRTC P2P data channel
- 64KB file chunking
- Folder auto-zip (JSZip)
- Session management (60s timeout, First-Wins rule)

### ✅ Phase 3 — Experience Layer (COMPLETE)

- Energy Squeeze + Rocket Launch + Receiver Landing animations
- Progress Ring for large files
- Wake-up notification panel
- Green dot + sidebar toggle + context menu button
- Camera preview + debug gesture label + manual Grab button

### ✅ Phase 3.5 — Gesture Debug & Stabilization (COMPLETE)

- Replaced Y-coordinate classification with 2D distance-based algorithm
- Added concurrent processing guard (`_processingHands` flag)
- Added live debug output (curl ratios, frame counter, hand detection counter)
- Added manual Grab button fallback
- Lowered confidence thresholds (0.6 / 0.5)

### 🔲 Phase 4 — LAN Discovery & Device Registry (NEXT)

- `HEVI_ANNOUNCE` + `HEVI_HEARTBEAT` client events
- Device Registry on server (`heviDevices` Map)
- `HEVI_PEERS_UPDATE` broadcast on any change
- Network tab UI in Hevi Explorer showing all online devices
- Device name + avatar (auto-generated from hostname or user-set)
- "N devices on this network" live counter

### 🔲 Phase 5 — Targeted Transfer

- Select a specific device in Network tab
- Grab → only that device gets wake-up (not broadcast)
- Bi-directional: any device can send to any other device
- Device-aware wake-up notification: *"📱 Rahul Ka Phone is sending you: photo.jpg"*

### 🔲 Phase 6 — Robustness

- TURN server support (for 4G/5G where STUN alone fails)
- Transfer resume on connection drop
- Multiple simultaneous transfers (different sessions independent)
- Speed indicator during transfer (MB/s)

---

<br/>

## 18. Technology Stack Summary

| Component | Technology | Version | Source |
|---|---|---|---|
| Server Runtime | Node.js | ≥18 | Pre-installed |
| Realtime Signaling | Socket.io | 4.7.5 | CDN + npm |
| Gesture AI | Google MediaPipe Hands | Latest | CDN |
| P2P Transfer | WebRTC Data Channel | Native browser API | — |
| File Compression | JSZip | 3.x | CDN |
| Animation | anime.js | 3.x | CDN |
| Camera Access | getUserMedia API | Native browser API | — |
| Device Identity | crypto.randomUUID() | Native browser API | — |
| UI Framework | Vanilla JS + HTML5 | — | — |
| Styling | CSS3 Custom Properties | — | — |
| Accent Color | `#25f4d0` | — | TWH Eco System branding |

---

<div align="center">

**AeroGrab Blueprint v2.0**
**by Technical White Hat (TWH)**
**TWH Eco System Technology**

*"You grab. You throw. Someone catches."*

</div>
