
<br/>
<br/>

---

<div align="center">

# AeroGrab Technology Blueprint

## Touchless Gesture-Controlled Local File Transfer System

### by Technical White Hat (TWH)

**Document Version:** 1.0 — Engineering Release
**Classification:** Internal Engineering Blueprint
**Author:** Technical White Hat (TWH), Independent Developer
**Created:** April 18, 2026
**Platform:** TWH Eco System Technology (Hevi Explorer)
**Status:** 🟡 Blueprint Phase — Ready for Phase 1 Development

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
3. [How AeroGrab Works — Plain English](#3-how-aerograb-works--plain-english)
4. [Core Technical Architecture](#4-core-technical-architecture)
5. [The P2P Bridge System — No Server File Routing](#5-the-p2p-bridge-system--no-server-file-routing)
6. [Intelligent File Selection Matrix](#6-intelligent-file-selection-matrix)
7. [Gesture Recognition Engine](#7-gesture-recognition-engine)
8. [Privacy & Permission Model](#8-privacy--permission-model)
9. [AeroGrab Fly — UI Animation Strategy](#9-aerograb-fly--ui-animation-strategy)
10. [Session Lifecycle & State Management](#10-session-lifecycle--state-management)
11. [Folder Transfer & Auto-Zip Protocol](#11-folder-transfer--auto-zip-protocol)
12. [Error Handling & Edge Cases](#12-error-handling--edge-cases)
13. [Developer Implementation Guide](#13-developer-implementation-guide)
14. [Function Reference](#14-function-reference)
15. [Phased Rollout Plan](#15-phased-rollout-plan)
16. [Future Roadmap — WAN Support](#16-future-roadmap--wan-support)
17. [Technology Stack Summary](#17-technology-stack-summary)

---

<br/>

## 1. Executive Summary

AeroGrab is a gesture-controlled, peer-to-peer file transfer system built for the TWH Eco System Technology (Hevi Explorer). It allows users on a local network to physically "grab" a file using a hand gesture (closed fist) and "throw" it to another device, where another user catches it using an open palm gesture — all without touching a single UI button for the transfer itself.

The system is engineered around three non-negotiable principles:

**Speed** — File data travels directly between devices via a P2P Bridge. The Hevi Explorer server handles only lightweight signaling (who grabbed, who caught), never the file bytes themselves. This means no server bottleneck regardless of file size.

**Privacy** — The camera feed never leaves the device. Google MediaPipe runs entirely inside the user's browser using on-device AI. No video, no frames, no images are transmitted anywhere. The server only receives gesture event strings like `"FIST_DETECTED"`. Camera access is requested once, on first use, with a full transparent explanation to the user.

**Simplicity** — Despite its sophisticated internals, AeroGrab has zero learning curve. You grab. You throw. Someone opens their hand. Done.

This document is the complete engineering reference for AeroGrab v1.0. It is intended for developers, AI coding assistants, and technical reviewers who will implement or evaluate the system.

---

<br/>

## 2. Vision & Motivation

### Why AeroGrab?

File transfer on local networks today is either clunky (USB drives, AirDrop menus, SMB shares) or requires cloud intermediaries (Google Drive, WhatsApp) that are unnecessary when devices are sitting right next to each other. Existing gesture-based transfer systems, like Huawei's Air Gesture, require proprietary hardware and closed ecosystems.

AeroGrab is different. It is:
- **Open** — Built on standard web technologies (HTML, JS, WebSockets, WebRTC)
- **Ecosystem-native** — Runs inside Hevi Explorer (TWH Eco System Technology), which users already have open
- **Hardware-agnostic** — Works on any device with a front camera and a modern browser
- **Local-first** — Your files never touch the internet

### Who Built This?

AeroGrab was conceived and architected by **Technical White Hat (TWH)**, the developer behind the Hevi Explorer — TWH Eco System Technology project. The technology was designed from scratch, inspired by the concept of physical intuition — the idea that transferring a file should feel as natural as handing someone a physical object.

---

<br/>

## 3. How AeroGrab Works — Plain English

Imagine you are in a room with two phones, both running Hevi Explorer on the same Wi-Fi network.

**On Phone A (Sender):**
You navigate to a file — maybe a video. You enable AeroGrab from the toggle in the menu. The camera turns on (with your permission). You hold your hand up in front of the phone and **close your fist** — like you are grabbing the file out of the screen.

**What happens next (invisible to user):**
The app detects your fist. It immediately starts packaging the file and signals the Hevi Explorer server: *"A file has been grabbed. Everyone wake up."* The server pings all other Hevi Explorer instances on the network.

**On Phone B (Receiver):**
The Hevi Explorer app receives the wake-up signal. A notification appears: *"Someone is sending a file — open your palm to catch it."* The user taps to activate their camera. They hold up an **open palm**.

**Final step:**
Phone B's gesture is confirmed. The server signals Phone A with Phone B's connection info. A direct P2P channel opens between Phone A and Phone B. The file streams across — no server in the middle. The animation shows a rocket landing on Phone B, a box opening, and the file appearing.

**Transfer complete.**

---

<br/>

## 4. Core Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AeroGrab System Architecture                 │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────────┐    Signal Only     ┌──────────────────────┐
  │   DEVICE A   │ ←────────────────→ │   L-HOST SERVER      │
  │  (Sender)    │                    │  (Signal Broker Only) │
  │              │ ←────────────────→ │  - No file data       │
  │  MediaPipe   │    Signal Only     │  - WebSocket only     │
  │  @ 12fps     │                    │  - Session mgmt       │
  └──────┬───────┘                    └──────────┬───────────┘
         │                                       │
         │  Direct P2P File Transfer             │ Signal Only
         │  (WebRTC Data Channel)                │
         │                                       │
  ┌──────▼───────┐                    ┌──────────▼───────────┐
  │   DEVICE B   │                    │   DEVICE C, D...     │
  │  (Receiver)  │                    │  (Waiting/Sleeping)  │
  │              │                    │  - Camera OFF         │
  │  MediaPipe   │                    │  - Await user tap     │
  │  @ 12fps     │                    │  - Receive wake ping  │
  └──────────────┘                    └──────────────────────┘

  KEY PRINCIPLE: File bytes NEVER pass through the server.
  Server = Signaling only. Files = P2P Bridge only.
```

### Architecture Layers

| Layer | Technology | Purpose |
|---|---|---|
| Gesture Detection | Google MediaPipe Hands (JS) | On-device, 12fps hand landmark tracking |
| Signaling | Socket.io (WebSocket) | Lightweight event messages between devices and server |
| File Transfer | WebRTC Data Channel | Direct P2P encrypted file streaming |
| Server | Node.js + Socket.io | Session management, broadcast, signal brokering |
| Animation | CSS Keyframes + anime.js | Latency-masking UI animations |
| Storage | None (P2P streaming) | File never stored on server |

---

<br/>

## 5. The P2P Bridge System — No Server File Routing

This is the most critical architectural decision in AeroGrab, and it is what makes the system both fast and private.

### The Problem with Server-Based File Routing

A naive implementation would have the sender upload the file to the Hevi Explorer server, which stores it in RAM or Redis, then streams it to the receiver. This creates three serious problems:

1. **Server memory pressure** — A 2GB video would require 2GB of server RAM
2. **Double bandwidth usage** — File travels sender→server AND server→receiver on the same LAN
3. **Server becomes a bottleneck** — All transfers compete for server resources

### The AeroGrab Solution: P2P Bridge

Instead, AeroGrab uses **WebRTC Data Channels** for the actual file transfer. WebRTC is the same technology browsers use for video calls — it creates a direct, encrypted, peer-to-peer connection between two browsers on the same network.

```
Traditional (BAD):        Sender → Server RAM → Receiver  (2x bandwidth, server bottleneck)

AeroGrab P2P (GOOD):      Sender ────────────────────────→ Receiver  (direct, full LAN speed)
                                       ↑
                                Server handles only the "who connects to whom" handshake
```

### WebRTC Signaling Flow

WebRTC requires a brief "handshake" to set up the direct connection. The Hevi Explorer server facilitates this handshake — this is the only thing the server does for file transfer:

```
Step 1: Sender creates WebRTC Offer → sends to Server
Step 2: Server forwards Offer to Receiver device
Step 3: Receiver creates WebRTC Answer → sends to Server
Step 4: Server forwards Answer to Sender
Step 5: P2P connection established — Server steps out
Step 6: File streams directly Sender → Receiver at full LAN speed
```

The entire handshake takes under 500ms. After that, the server has no involvement in the file transfer.

### Why This Is Better Than Anything Else

| Metric | Cloud Transfer | Server-Buffered | AeroGrab P2P |
|---|---|---|---|
| Max file size | Cloud plan limits | Server RAM limit | Unlimited (disk-to-disk) |
| Speed | Internet speed | LAN speed ÷ 2 | Full LAN speed |
| Privacy | Files on cloud server | Files on local server | Files never leave devices |
| Server load | High | High | Near zero |
| Works offline | No | Yes | Yes |

---

<br/>

## 6. Intelligent File Selection Matrix

AeroGrab uses a context-aware system to determine exactly what gets transferred when the user makes the grab gesture. It reads the current state of the Hevi Explorer app and selects the most logical payload automatically.

| User's Current State | What AeroGrab Grabs | Transfer Type |
|---|---|---|
| Files are selected (select mode active) | All selected files | Batch Array |
| A file is open (image viewer, video player, PDF) | That specific open file | Single Object (Priority Override) |
| A folder is highlighted/targeted | Entire folder contents | Zipped Archive |
| Nothing selected, nothing open | Last opened/viewed file | Single Object (Fallback) |

### Priority Override Rule

The **Priority Override** is important: if the user has 5 files selected in select mode but then opens an image in the image viewer, AeroGrab will grab the **currently viewed image**, not the selected batch. The logic is: what you are looking at right now is what you want to share. Selection mode is overridden by active viewing.

This mirrors natural human behavior — if you are holding something in your hands (actively viewing it), that is what you would grab and throw, not something sitting on a table (selected but not active).

---

<br/>

## 7. Gesture Recognition Engine

### Technology: Google MediaPipe Hands

MediaPipe Hands is an on-device machine learning model that tracks 21 key points (landmarks) on the human hand in real time. It runs entirely inside the browser using JavaScript — no data is sent to Google or any server.

```
Hand Landmark Map (21 Points):

        8   12  16  20
        |   |   |   |
    7   11  15  19
    |   |   |   |
    6   10  14  18
        |   |   |   |
    5 ──9───13──17
        \           |
     4   \          |
     |    \         |
     3     2────────0
     |    /
     2   1
     |
     1
     |
     0 (Wrist)
```

### Gesture Definitions

**Gesture 1: FIST (Grab Trigger)**
- Detection condition: All 5 fingertip landmarks (index, middle, ring, pinky tips) are positioned BELOW their respective knuckle landmarks
- Thumb tip is close to index finger base
- Confidence threshold: 85% or higher
- Meaning in AeroGrab: "I am grabbing this file"

**Gesture 2: OPEN_PALM (Drop/Catch Trigger)**
- Detection condition: All 5 fingertip landmarks are positioned ABOVE their respective knuckle landmarks
- Fingers are spread (spacing between tips exceeds threshold)
- Confidence threshold: 85% or higher
- Meaning in AeroGrab: "I am ready to receive this file"

### Performance Configuration

MediaPipe is configured at **12 frames per second** — deliberately lower than the default 30fps. This choice was made for three reasons:

1. **Battery preservation** — 12fps reduces CPU usage by ~60% compared to 30fps, which is critical for mobile devices during a transfer
2. **Gesture recognition accuracy** — Hand gestures are slow movements. 12fps is more than sufficient to detect a fist or open palm reliably
3. **Older device compatibility** — Mid-range and older phones handle 12fps MediaPipe smoothly without lag or overheating

The model is loaded asynchronously when the user first enables AeroGrab, and kept in memory for the duration of the session.

---

<br/>

## 8. Privacy & Permission Model

Privacy is a first-class requirement in AeroGrab, not an afterthought.

### One-Time Permission Request

The very first time a user enables AeroGrab in Hevi Explorer, the browser displays a transparent permission dialog explaining exactly why camera access is needed. This dialog is designed by AeroGrab, not the browser's default — it appears before the browser's own permission prompt.

**The AeroGrab Permission Dialog reads:**

```
┌─────────────────────────────────────────────────┐
│  🎯 AeroGrab needs your camera                   │
│                                                  │
│  AeroGrab uses your camera to detect hand         │
│  gestures (fist to grab, open palm to catch).    │
│                                                  │
│  ✅ Your camera feed NEVER leaves this device    │
│  ✅ No video is recorded or stored               │
│  ✅ No data is sent to any server                │
│  ✅ Only gesture events ("fist detected") are    │
│     transmitted — never images or video          │
│                                                  │
│  AeroGrab only works on your local network.       │
│  This is completely private.                      │
│                                                  │
│  [Enable AeroGrab]        [Not Now]              │
└─────────────────────────────────────────────────┘
```

After the user taps "Enable AeroGrab", the browser's native camera permission prompt appears. The user's choice is remembered — they will not be asked again.

### Camera State Rules

| AeroGrab State | Camera Status | Green Indicator |
|---|---|---|
| Toggle OFF | Camera OFF | Not shown |
| Toggle ON, idle | Camera ON, MediaPipe scanning | Shown (top-right) |
| Transfer in progress | Camera ON | Shown + pulsing |
| Transfer complete / timeout | Camera OFF automatically | Fades out |

### What the Server Sees

The Hevi Explorer server receives only these string events — never any media:

- `"FILE_GRABBED"` — with file metadata (name, size, type)
- `"DROP_HERE"` — with receiver device socket ID
- `"SESSION_START"` / `"SESSION_END"`
- WebRTC signaling objects (SDP offer/answer, ICE candidates) — these are encrypted connection negotiation data, not file content

**The server sees zero bytes of actual file content.**

---

<br/>

## 9. AeroGrab Fly — UI Animation Strategy

The "AeroGrab Fly" is the visual experience layer of the transfer. Its primary engineering purpose is **latency masking** — using carefully timed animations to keep the user engaged while the system performs real work (file chunking, WebRTC connection setup, data channel opening).

### Phase 1: The Energy Squeeze (Sender Side — 0s to 1.5s)

As the user's hand closes into a fist, MediaPipe tracks the closure percentage in real time (0% = open hand, 100% = full fist). This percentage drives a visual "energy particle" effect that intensifies around the file thumbnail on screen.

- At 30% fist closure: particles begin forming around the file icon
- At 60% closure: particles intensify, file icon begins to glow
- At 100% closure (confirmed fist): particles implode toward the file icon → triggers grab

**Engineering purpose:** Keeps user engaged, provides visual feedback that the gesture is being tracked, masks the 0.5-1 second it takes to initiate the WebRTC signaling handshake.

### Phase 2: The Rocket Launch (Sender Side — 1.5s to 4s)

Once the fist is confirmed:
1. The file's thumbnail is "packed" into a glowing 3D Box
2. The Box is loaded into a Rocket on screen
3. The Rocket launches off the top of the screen with a trail effect
4. The screen shows: *"File in air — waiting for receiver..."*

**Engineering purpose:** This 2.5-second animation window covers:
- WebRTC offer/answer exchange through the server (~500ms)
- P2P connection establishment (~200-500ms)
- File chunking and data channel preparation (~500ms–2s depending on file size)

### Phase 3: The Landing (Receiver Side — triggered on palm detection)

When the receiver shows an open palm:
1. A "Strong Energy" effect radiates outward from the center of the screen
2. As the palm opens fully, the effect transforms into a light beam coming from the sky
3. The Rocket descends from the top of the screen
4. The Box slides off the Rocket and lands at center screen
5. The Box opens, revealing the file with its thumbnail

**Engineering purpose:** Provides the receiver a satisfying confirmation experience. The landing animation is ~2 seconds, which covers the final handshake confirmation and first file chunks arriving.

### Phase 4: Dynamic Buffer Ring (Large Files)

For large files where the transfer is not complete when the landing animation finishes:

1. The open Box transforms into a circular **Progress Ring**
2. The ring fills clockwise as file data arrives (real percentage from WebRTC transfer progress)
3. When ring reaches 100%, it bursts open revealing the file
4. File is immediately accessible in Hevi Explorer

**This ensures users always have accurate transfer feedback regardless of file size.**

---

<br/>

## 10. Session Lifecycle & State Management

### Session States

```
IDLE → ENABLED → GRAB_TRIGGERED → BROADCASTING → RECEIVING → COMPLETE → IDLE
                                                      ↓
                                               TIMEOUT (60s) → CANCELLED → IDLE
```

### Detailed State Transitions

**IDLE:** AeroGrab toggle is OFF. No camera, no processing. Zero battery impact.

**ENABLED:** User turned on the toggle. Camera is active, MediaPipe scanning at 12fps. No file is in transit.

**GRAB_TRIGGERED:** Sender's fist was confirmed. File metadata captured. WebRTC signaling initiated. Server notified. Animation Phase 1 begins.

**BROADCASTING:** Server has sent `WAKE_UP` ping to all devices on the network. A 60-second countdown begins on the server.

**RECEIVING:** One or more receiver devices have responded. The server applies the **First Confirmed Receiver Wins** rule:
- First device to send confirmed `"DROP_HERE"` signal wins
- Server immediately sends `"TRANSFER_APPROVED"` to that device and `"TRANSFER_TAKEN"` to all others
- P2P connection opens between sender and winning receiver

**COMPLETE:** File fully transferred. Server broadcasts `"SESSION_END"` to all devices. All cameras deactivate. Animations complete.

**TIMEOUT:** 60 seconds elapsed with no receiver. Server sends `"SESSION_EXPIRED"` to sender. Sender gets notification: *"No one caught it. File is still on your device."* All cameras deactivate.

### First Confirmed Receiver Wins Rule

If multiple users show their open palm simultaneously:
- The server timestamps each `"DROP_HERE"` event (millisecond precision)
- The device with the earliest timestamp is declared the receiver
- All other devices receive a gentle notification: *"File was caught by another device"*
- No file data is lost, duplicated, or sent to wrong device

---

<br/>

## 11. Folder Transfer & Auto-Zip Protocol

When the payload is a folder, AeroGrab automatically handles compression:

### Validation Rules

| Rule | Limit | Error Message |
|---|---|---|
| Maximum folder size | 1 GB | "AeroGrab Limit: Folder exceeds 1GB maximum" |
| Maximum file count | 20 files | "AeroGrab Limit: Folder contains more than 20 files" |
| Nested folders | Supported (counted toward 20 file limit) | — |
| Empty folder | Not allowed | "AeroGrab: Cannot transfer an empty folder" |

### Compression Process

1. Validation runs first (size and count check) — fails fast before any compression
2. Folder is compressed to `.zip` format **on the sender device** using the browser's native `CompressionStream` API or a JS zip library
3. The zip file is held in memory (ArrayBuffer) — never written to disk
4. The zip is transferred via P2P Bridge as a single binary blob
5. **On the receiver:** The zip is automatically decompressed, recreating the exact directory structure

### Directory Structure Preservation

If the sender transfers a folder named `Music/Favorites/` containing 3 files:
```
Music/
  └── Favorites/
        ├── song1.mp3
        ├── song2.mp3
        └── cover.jpg
```

The receiver gets this exact structure placed in their Downloads folder:
```
Downloads/
  └── Music/
        └── Favorites/
              ├── song1.mp3
              ├── song2.mp3
              └── cover.jpg
```

---

<br/>

## 12. Error Handling & Edge Cases

| Scenario | Detection | Response |
|---|---|---|
| Receiver moves out of network mid-transfer | WebRTC data channel closes | "Connection lost. Resend?" prompt to sender |
| File modified on sender during transfer | File hash check pre/post | "File changed during transfer. Resend?" |
| Folder exceeds size/count limits | Pre-transfer validation | Error dialog with specific reason |
| MediaPipe model fails to load | Promise rejection caught | "AeroGrab unavailable. Camera AI failed to load." |
| Browser denies camera permission | Permission API event | "AeroGrab needs camera access. Enable in browser settings." with instructions |
| Two senders grab simultaneously | Server timestamps | Each grab creates a separate independent session |
| Receiver has insufficient storage | Pre-transfer size check | "Not enough storage on receiving device" notification |
| WebRTC P2P fails (firewall/NAT issue) | ICE connection failure | Fallback: offer to transfer via traditional Hevi Explorer file share |
| Session timeout (60s, no receiver) | Server timer | "Transfer expired. File remains on your device." |

---

<br/>

## 13. Developer Implementation Guide

### Prerequisites

Before implementing AeroGrab, ensure the Hevi Explorer server has Socket.io installed and the frontend has access to:

```
npm install socket.io          # Server side
npm install socket.io-client   # Client side (or CDN)
```

MediaPipe is loaded via CDN (no npm install needed):

```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
```

### File Structure

```
hevi-explorer/
├── server.js                    ← Add Socket.io + AeroGrab signal handlers
├── public/
│   ├── app.js                   ← Add AeroGrab toggle UI, session management
│   ├── aerograb.js              ← NEW: All AeroGrab client logic (keep isolated)
│   ├── aerograb-animation.js    ← NEW: Rocket/Box/Particle animations
│   └── style.css                ← Add AeroGrab UI styles
```

### Implementation Order (Follow This Exactly)

```
Step 1: Socket.io basic signaling          → Test: devices can ping each other
Step 2: AeroGrab toggle + permission UI    → Test: camera turns on/off correctly
Step 3: MediaPipe 12fps gesture detection  → Test: fist and palm logged to console
Step 4: Server session management          → Test: GRAB/WAKE_UP/DROP flow works
Step 5: WebRTC P2P connection              → Test: small text transfers P2P
Step 6: File chunking + transfer           → Test: transfer a 10MB file
Step 7: Folder zip + transfer              → Test: transfer a folder
Step 8: Animations (Phase 1-4)             → Test: full experience end to end
Step 9: Error handling                     → Test: all edge cases in section 12
```

---

<br/>

## 14. Function Reference

### Client-Side Functions (`aerograb.js`)

---

**`toggleAeroGrab(state: boolean): void`**

Enables or disables AeroGrab. On first call with `true`, shows the permission dialog. If permission was previously granted, starts the camera and MediaPipe directly.

Parameters: `state` — `true` to enable, `false` to disable
Side effects: Starts/stops camera, shows/hides green dot indicator, initializes/destroys MediaPipe session

---

**`showPermissionDialog(): Promise<boolean>`**

Shows the custom AeroGrab permission explanation dialog before the browser's native camera permission prompt. Returns a promise that resolves `true` if the user clicks "Enable AeroGrab", `false` if they click "Not Now".

---

**`initMediaPipe(): Promise<void>`**

Loads the MediaPipe Hands model and initializes it with:
- `maxNumHands: 1`
- `modelComplexity: 0` (lite model, best for mobile)
- Frame rate: 12fps

Sets up the `onResults` callback pointing to `processGestureResults()`.

---

**`processGestureResults(results: HandResults): void`**

Called by MediaPipe 12 times per second with hand landmark data. Internally calls `classifyGesture()` and dispatches events if a confident gesture is detected.

---

**`classifyGesture(landmarks: LandmarkList): string | null`**

Takes the 21 landmark points and returns `"FIST"`, `"OPEN_PALM"`, or `null` (no recognized gesture). Uses landmark Y-coordinate comparisons with 85% confidence threshold.

---

**`onGestureDetected(gesture: string): void`**

Called when a confident gesture is confirmed. Routes to:
- `"FIST"` → `initiateGrab()`
- `"OPEN_PALM"` → `signalReadyToReceive()`

---

**`initiateGrab(): void`**

Reads the current Hevi Explorer state (active file, selected files, or targeted folder) using `getAeroGrabPayload()`. Packages file metadata. Emits `socket.emit("FILE_GRABBED", metadata)`. Starts animation Phase 1.

---

**`getAeroGrabPayload(): PayloadDescriptor`**

Reads Hevi Explorer app state and returns a descriptor object. Priority order:
1. Check if a file is open in a viewer → return that file
2. Check if files are selected → return the batch
3. Check if a folder is targeted → return folder (triggers auto-zip)
4. Fall back to last viewed file

---

**`signalReadyToReceive(): void`**

Emits `socket.emit("DROP_HERE", { socketId: socket.id })`. Starts receiver-side animation. Listens for `"TRANSFER_APPROVED"` or `"TRANSFER_TAKEN"` response.

---

**`openP2PBridge(peerSocketId: string, role: "sender" | "receiver"): void`**

Creates a WebRTC peer connection and sets up the data channel. The `role` determines whether this device creates the Offer (sender) or Answer (receiver).

---

**`streamFileOverBridge(file: File | Blob, channel: RTCDataChannel): void`**

Reads the file in 64KB chunks and sends each chunk over the WebRTC data channel. Tracks progress percentage and updates the Progress Ring animation in real time.

---

**`listenForWakeUp(): void`**

Registers `socket.on("WAKE_UP_CAMERAS", ...)` listener. When triggered, shows the receiver notification: *"Someone is sending a file — open your palm to catch it."* Does NOT automatically start the camera. User must tap to activate their camera.

---

**`deactivateAeroGrab(): void`**

Stops MediaPipe, releases the camera stream, hides the green dot. Called automatically on session end or timeout.

---

### Server-Side Functions (`server.js` additions)

---

**`socket.on("FILE_GRABBED", handler)`**

Receives file metadata from sender. Stores the session: `{ senderId, metadata, timestamp }`. Calls `broadcastWakeUp()`. Starts the 60-second timeout timer.

---

**`broadcastWakeUp(senderId: string): void`**

Emits `io.emit("WAKE_UP_CAMERAS", { senderId, metadata })` to all connected sockets except the sender.

---

**`socket.on("DROP_HERE", handler)`**

Receives catch signal from a receiver device. Checks if this session is still active. Applies First-Confirmed-Receiver-Wins: compares timestamp to any previous `"DROP_HERE"` events for this session. If this is first, emits `"TRANSFER_APPROVED"` to this receiver and `"TRANSFER_TAKEN"` to all others. Initiates WebRTC signaling between sender and receiver.

---

**`socket.on("webrtc_signal", handler)`**

Relay function — forwards WebRTC SDP offers, answers, and ICE candidates between sender and receiver. This is the only server involvement in file transfer. Server does not read or store this data.

---

**`startSessionTimeout(sessionId: string): void`**

Starts a 60-second timer. On expiry, emits `"SESSION_EXPIRED"` to the sender and `"SLEEP_CAMERAS"` to all devices. Clears the session from server memory.

---

**`socket.on("SESSION_END", handler)`**

Called when transfer completes successfully. Cancels the timeout timer, emits `"SLEEP_CAMERAS"` to all devices, removes session from memory.

---

<br/>

## 15. Phased Rollout Plan

AeroGrab will be developed in three phases. Each phase is independently usable and testable.

---

### Phase 1: The Foundation (No Gestures)
**Goal:** Establish working P2P file transfer and signaling without any camera involvement.

**What gets built:**
- Socket.io integration in Hevi Explorer server
- "AeroGrab Share" button in Hevi Explorer file context menu
- Server session management (grab, wake-up, drop, timeout)
- WebRTC P2P file transfer (chunked streaming)
- Receiver notification UI
- Folder auto-zip protocol
- Error handling for all edge cases

**What this proves:** The entire transfer architecture works before any gesture complexity is added. This is the hardest part and must work reliably.

**Completion criteria:** Transfer a 500MB file between two devices on LAN via P2P at full network speed.

---

### Phase 2: Sender Gestures
**Goal:** Add MediaPipe hand detection on the sender side only.

**What gets built:**
- Camera permission dialog and toggle UI
- MediaPipe initialization at 12fps
- Fist gesture detection (sender only)
- Gesture-triggered file grab (replaces button tap)
- Green dot indicator
- Animation Phase 1 (Energy Squeeze) and Phase 2 (Rocket Launch)

**What this proves:** Gesture detection works reliably across different lighting conditions, skin tones, and device cameras.

**Completion criteria:** Consistent fist detection (>95% accurate) without false positives in normal indoor use.

---

### Phase 3: Full Gesture Experience + Animation
**Goal:** Complete the AeroGrab experience with receiver gestures and full animation suite.

**What gets built:**
- Open palm detection on receiver side
- Receiver wake-up notification with manual camera activation
- Animation Phase 3 (Rocket Landing)
- Animation Phase 4 (Dynamic Progress Ring)
- Performance optimization for mid-range devices
- Full end-to-end testing across all edge cases

**Completion criteria:** Full AeroGrab experience — grab, throw, catch — working smoothly on two mid-range Android phones on the same Wi-Fi network.

---

<br/>

## 16. Future Roadmap — WAN Support

The current v1.0 blueprint is designed for LAN (local network) operation. WAN (internet-based) AeroGrab is planned for a future version. Here is the technical roadmap:

### WAN Challenge

WebRTC P2P connections work easily on a LAN because devices are on the same network and can reach each other directly. Over the internet, devices are typically behind NAT routers and firewalls, which block direct P2P connections.

### WAN Solution: TURN Server

A TURN (Traversal Using Relays around NAT) server acts as a relay when direct P2P fails. AeroGrab WAN will:

1. **Attempt P2P first** (works in ~70-85% of cases via STUN)
2. **Fall back to TURN relay** only when direct P2P is impossible
3. **Encrypt all TURN-relayed traffic** end-to-end so the relay server cannot read file contents

### WAN-Specific Additions Needed

| Component | LAN v1.0 | WAN Future |
|---|---|---|
| Signaling server | Local Hevi Explorer | Deployed Hevi Explorer + STUN/TURN config |
| Device discovery | Socket.io local broadcast | User authentication + contact list |
| File transfer | WebRTC LAN P2P | WebRTC WAN P2P + TURN fallback |
| Security | Trusted LAN | End-to-end encryption required |
| Speed | Full LAN speed (100Mbps+) | Internet upload speed dependent |

---

<br/>

## 17. Technology Stack Summary

| Category | Technology | Version | Purpose |
|---|---|---|---|
| Backend Runtime | Node.js | 18+ | Hevi Explorer server |
| WebSocket Library | Socket.io | 4.x | Real-time signaling |
| Gesture AI | MediaPipe Hands (JS) | Latest | On-device gesture detection |
| P2P Transfer | WebRTC Data Channels | Browser native | File streaming |
| Compression | CompressionStream API / JSZip | Browser native / 3.x | Folder zip |
| Animation | anime.js + CSS Keyframes | 3.x | AeroGrab Fly experience |
| Frontend Framework | Vanilla JS (Hevi Explorer native) | — | No framework overhead |

---

<br/>

---

<div align="center">

## End of Document

**AeroGrab Technology Blueprint v1.0**
*TWH Eco System Technology — Engineering Division*

Authored by **Technical White Hat (TWH)**
April 18, 2026

*"Grab it. Throw it. They'll catch it."*

---

© 2026 Technical White Hat (TWH) — Hevi Explorer — TWH Eco System Technology
This document is an internal engineering blueprint.
All technology described herein is original work of Technical White Hat (TWH).

</div>
