/* ═══════════════════════════════════════════════════════════════════════════
   AeroGrab v1.0  —  Gesture-Controlled P2P File Transfer
   by Technical White Hat (TWH)
   TWH Eco System Technology — Hevi Explorer
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function AeroGrab() {

  // ── Constants ──────────────────────────────────────────────────────────────
  const CHUNK_SIZE       = 64 * 1024;        // 64 KB per WebRTC chunk
  const GESTURE_FPS      = 12;               // MediaPipe target FPS
  const CONFIDENCE_THRESH = 0.85;            // 85% gesture confidence
  const PERM_KEY         = 'ag_cam_perm';    // localStorage key for camera permission
  const FOLDER_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
  const FOLDER_MAX_FILES = 20;

  // ── State ──────────────────────────────────────────────────────────────────
  let _enabled        = false;
  let _socket         = null;
  let _hands          = null;          // MediaPipe Hands instance
  let _camera         = null;          // MediaPipe Camera util
  let _sessionId      = null;          // active AeroGrab session
  let _myRole         = null;          // 'sender' | 'receiver' | null
  let _peerConn       = null;          // RTCPeerConnection
  let _dataChannel    = null;          // RTCDataChannel
  let _recvBuffer     = [];            // incoming chunks
  let _recvMeta       = null;          // { name, size, type }
  let _recvReceived   = 0;             // bytes received so far
  let _targetSocketId = null;          // if set, only this device gets WAKE_UP
  let _heartbeatTimer = null;          // setInterval handle for HEVI_HEARTBEAT
  let _lastGesture    = null;
  let _gestureDebounce = null;
  let _activeOpenFile = null;          // set by Hevi Explorer when a file is opened
  let _wakePayload    = null;          // sender's metadata received via WAKE_UP_CAMERAS

  // Expose the active-file hook so app.js can set it
  window.aeroGrabSetOpenFile = (fileMeta) => { _activeOpenFile = fileMeta; };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const qs = s  => document.querySelector(s);

  // ── Initialise Socket.io connection ────────────────────────────────────────
  // ── Device Identity (persisted in localStorage) ───────────────────────────
  function getOrCreateDeviceId() {
    let id = localStorage.getItem('ag_device_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('ag_device_id', id); }
    return id;
  }
  function getDeviceName() {
    const saved = localStorage.getItem('ag_device_name');
    if (saved) return saved;
    const ua = navigator.userAgent;
    if (/android/i.test(ua))   return 'Android Device';
    if (/iphone|ipad/i.test(ua)) return 'iPhone/iPad';
    if (/mac/i.test(ua))       return 'Mac';
    if (/win/i.test(ua))       return 'Windows PC';
    return 'Hevi Device';
  }
  function getDeviceAvatar() {
    const saved = localStorage.getItem('ag_device_avatar');
    if (saved) return saved;
    const ua = navigator.userAgent;
    if (/android/i.test(ua))     return '📱';
    if (/iphone|ipad/i.test(ua)) return '📱';
    if (/mac/i.test(ua))         return '💻';
    if (/win/i.test(ua))         return '🖥';
    return '📡';
  }

  // ── Network announce + heartbeat ──────────────────────────────────────────
  function announceToNetwork() {
    if (!_socket) return;
    _socket.emit('HEVI_ANNOUNCE', {
      deviceId:   getOrCreateDeviceId(),
      deviceName: getDeviceName(),
      avatar:     getDeviceAvatar(),
    });
  }
  function startHeartbeat() {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = setInterval(() => {
      if (_socket && _socket.connected) _socket.emit('HEVI_HEARTBEAT');
    }, 15000);
  }
  function stopHeartbeat() {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }

  // ── Socket.io connection ───────────────────────────────────────────────────
  function initSocket() {
    if (_socket) return;
    // Use default transport negotiation (polling → websocket upgrade)
    // so it works on Replit proxy, LAN, and all network configs
    _socket = io(window.location.origin, {
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });

    _socket.on('connect', () => {
      console.log('[AeroGrab] socket connected:', _socket.id);
      announceToNetwork();
      startHeartbeat();
    });

    _socket.on('connect_error', (err) => {
      console.warn('[AeroGrab] socket connect_error:', err.message);
    });

    _socket.on('reconnect', () => {
      console.log('[AeroGrab] socket reconnected, re-announcing...');
      announceToNetwork();
    });

    // ── Hevi Network: peer list updated
    _socket.on('HEVI_PEERS_UPDATE', ({ devices, total }) => {
      if (typeof window.onHeviPeersUpdate === 'function') {
        window.onHeviPeersUpdate(devices, total, _socket.id);
      }
    });

    // ── Receiver: someone grabbed a file on another device
    _socket.on('WAKE_UP_CAMERAS', ({ sessionId, senderId, senderName, metadata }) => {
      if (_myRole === 'sender') return;
      _wakePayload = { sessionId, senderId, metadata };
      showWakeUpNotification(metadata, senderName);
    });

    // ── Sender: a receiver has confirmed they want the file
    _socket.on('TRANSFER_APPROVED', ({ receiverId, sessionId }) => {
      _sessionId = sessionId;
      _myRole    = 'sender';
      openP2PBridge(receiverId, 'sender');
    });

    // ── Receiver: server confirmed we are the catcher
    _socket.on('YOU_ARE_RECEIVER', ({ senderId, sessionId, metadata }) => {
      _sessionId = sessionId;
      _myRole    = 'receiver';
      _recvMeta  = metadata;
      openP2PBridge(senderId, 'receiver');
      aeroAnim.showReceiverLanding(metadata);
    });

    // ── Someone else caught the file first
    _socket.on('TRANSFER_TAKEN', () => {
      if (_myRole !== 'sender') {
        showToast('File was caught by another device', 'info');
        hideWakeUpNotification();
      }
    });

    // ── Session timed out (no receiver in 60s)
    _socket.on('SESSION_EXPIRED', () => {
      showToast('No one caught it. File is still on your device.', 'warn');
      resetSession();
    });

    // ── Session ended — everyone go to sleep
    _socket.on('SLEEP_CAMERAS', ({ sessionId }) => {
      if (sessionId === _sessionId) resetSession();
      hideWakeUpNotification();
    });

    // ── WebRTC signaling relay
    _socket.on('webrtc_signal', async ({ from, signal }) => {
      if (!_peerConn) return;
      try {
        if (signal.sdp) {
          await _peerConn.setRemoteDescription(new RTCSessionDescription(signal));
          if (signal.type === 'offer') {
            const answer = await _peerConn.createAnswer();
            await _peerConn.setLocalDescription(answer);
            _socket.emit('webrtc_signal', { to: from, signal: _peerConn.localDescription });
          }
        } else if (signal.candidate) {
          await _peerConn.addIceCandidate(new RTCIceCandidate(signal));
        }
      } catch (e) {
        console.warn('[AeroGrab] webrtc_signal error:', e.message);
      }
    });
  }

  // ── Toggle AeroGrab on/off ─────────────────────────────────────────────────
  async function toggleAeroGrab(enable) {
    if (enable === _enabled) return;

    if (enable) {
      // requestCameraPermission now returns the MediaStream directly (or null on failure)
      // This avoids the double getUserMedia call that caused "device in use" errors
      const stream = await requestCameraPermission();
      if (!stream) {
        const toggle = $('aeroGrabToggle');
        if (toggle) toggle.checked = false;
        return;
      }
      _enabled = true;
      initSocket();
      await initMediaPipe(stream);
      showGreenDot(true);
      showToast('AeroGrab active — make a fist to grab a file', 'info');
    } else {
      deactivateAeroGrab();
    }
  }

  // ── Camera permission dialog ───────────────────────────────────────────────
  // Returns the MediaStream on success, or null on any failure.
  // Only ONE getUserMedia call is made — the stream is passed directly to
  // initMediaPipe() to avoid "device in use" errors from double acquisition.
  async function requestCameraPermission() {
    // Modern browsers block getUserMedia on non-secure (HTTP) origins
    // except localhost. Show a clear error before even trying.
    if (!window.isSecureContext) {
      showCameraHttpsError();
      return null;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('Your browser does not support camera access.', 'error');
      return null;
    }

    // Show custom explanation dialog before the browser native prompt
    const alreadyGranted = localStorage.getItem(PERM_KEY) === 'granted';
    if (!alreadyGranted) {
      const ok = await showPermissionDialog();
      if (!ok) return null;
    }

    try {
      // Request with actual constraints used by MediaPipe — only ONE getUserMedia call
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      });
      localStorage.setItem(PERM_KEY, 'granted');
      return stream;   // caller (toggleAeroGrab) passes this directly to initMediaPipe
    } catch (e) {
      localStorage.removeItem(PERM_KEY);  // clear cached grant so dialog shows next time
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        showToast('Camera access denied. Go to browser Settings → Site permissions → Camera → Allow.', 'error');
      } else if (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError') {
        showToast('No camera found on this device.', 'error');
      } else if (e.name === 'NotReadableError' || e.name === 'TrackStartError') {
        showToast('Camera is being used by another app. Close it and try again.', 'error');
      } else if (e.name === 'OverconstrainedError') {
        // facingMode 'user' may not exist on desktop — retry without facingMode
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({ video: true });
          localStorage.setItem(PERM_KEY, 'granted');
          return fallback;
        } catch (e2) {
          showToast('Camera error: ' + e2.message, 'error');
        }
      } else {
        showToast('Camera error: ' + e.message, 'error');
      }
      console.error('[AeroGrab] getUserMedia error:', e.name, e.message);
      return null;
    }
  }

  // Shows a friendly error when HTTP (non-secure) is detected.
  // Server runs HTTPS on httpPort + 443 (e.g. 5000 → 5443).
  function showCameraHttpsError() {
    const loc = window.location;
    // Compute the HTTPS URL: same host, same path, port = current port + 443
    const httpPort   = parseInt(loc.port) || 80;
    const httpsPort  = httpPort + 443;
    const httpsUrl   = `https://${loc.hostname}:${httpsPort}${loc.pathname}`;

    showToast(
      `Camera blocked on HTTP. Open the HTTPS link and accept the security warning:\n${httpsUrl}`,
      'error'
    );

    // Also copy URL to clipboard silently for quick access
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(httpsUrl).catch(() => {});
    }

    console.warn('[AeroGrab] Camera blocked — non-secure context. HTTPS URL:', httpsUrl);
  }

  function showPermissionDialog() {
    return new Promise(resolve => {
      const overlay = $('aeroPermDialog');
      if (!overlay) { resolve(true); return; }
      overlay.classList.remove('hidden');
      $('aeroPermEnable').onclick = () => { overlay.classList.add('hidden'); resolve(true);  };
      $('aeroPermCancel').onclick = () => { overlay.classList.add('hidden'); resolve(false); };
    });
  }

  // ── MediaPipe Hands — direct getUserMedia (no Camera utility) ─────────────
  let _rafId      = null;   // requestAnimationFrame id
  let _camStream  = null;   // raw MediaStream

  // existingStream: the MediaStream already acquired by requestCameraPermission().
  // Passing it in avoids a second getUserMedia call ("device in use" errors).
  async function initMediaPipe(existingStream) {
    if (_hands) return;
    try {
      // Build Hands model
      _hands = new Hands({
        locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      _hands.setOptions({
        maxNumHands:             1,
        modelComplexity:         0,
        minDetectionConfidence:  0.6,
        minTrackingConfidence:   0.5,
      });
      _hands.onResults(processGestureResults);

      // Use the stream already acquired in requestCameraPermission — no second getUserMedia call
      _camStream = existingStream || await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      });

      const videoEl = $('aeroVideoEl');
      videoEl.srcObject = _camStream;
      videoEl.style.cssText = 'position:fixed;bottom:80px;right:12px;width:150px;height:112px;border-radius:10px;object-fit:cover;z-index:850;border:2px solid var(--accent);opacity:0.9;';
      await videoEl.play();

      // Send frames at 12fps — skip frame if previous still processing
      _rafId = setInterval(async () => {
        if (_processingHands) return;           // don't overlap calls
        if (videoEl.readyState < 2) return;     // video not ready
        _processingHands = true;
        try { await _hands.send({ image: videoEl }); }
        catch (e) { _processingHands = false; console.warn('[AeroGrab] send err:', e); }
      }, Math.round(1000 / GESTURE_FPS));

      console.log('[AeroGrab] MediaPipe started, watching at', GESTURE_FPS, 'fps');
    } catch (e) {
      // Give specific error based on what failed
      if (e.name === 'NotAllowedError') {
        showToast('Camera access denied. Allow camera in browser settings and try again.', 'error');
      } else if (e.name === 'NotReadableError') {
        showToast('Camera is in use by another app. Close it and try again.', 'error');
      } else if (e.message && e.message.includes('hands')) {
        showToast('AeroGrab: Gesture model failed to load. Check your internet connection.', 'error');
      } else {
        showToast('AeroGrab: Camera failed to start. ' + e.message, 'error');
      }
      console.error('[AeroGrab] MediaPipe init failed:', e.name, e.message);
      deactivateAeroGrab();
    }
  }

  // ── Gesture classification ─────────────────────────────────────────────────
  // IMPORTANT: Only use x,y — MediaPipe z is relative depth, NOT same scale as x,y.
  function lmDist2D(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  let _frameCount     = 0;    // total frames sent to MediaPipe
  let _detectCount    = 0;    // frames where a hand was found
  let _processingHands = false; // prevent concurrent send() calls

  function processGestureResults(results) {
    _processingHands = false;   // unlock for next frame
    _frameCount++;

    const lbl = $('aeroGestureLbl');

    if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
      // No hand detected — show frame counter so user knows model is running
      if (lbl) lbl.textContent = `👁 ${_frameCount} | no hand`;
      return;
    }

    _detectCount++;
    const lm      = results.multiHandLandmarks[0];
    const gesture = classifyGesture(lm);

    // Show live debug: gesture + curl ratios
    if (lbl) {
      const fingerTips = [8, 12, 16, 20];
      const fingerMCP  = [5, 9, 13, 17];
      const handSize   = lmDist2D(lm[0], lm[9]);
      const ratios     = fingerTips.map((t, i) =>
        (lmDist2D(lm[t], lm[fingerMCP[i]]) / handSize).toFixed(2));
      lbl.textContent  = gesture
        ? `✅ ${gesture}`
        : `H:${handSize.toFixed(2)} [${ratios.join(',')}]`;
    }

    if (gesture && gesture !== _lastGesture) {
      _lastGesture = gesture;
      clearTimeout(_gestureDebounce);
      _gestureDebounce = setTimeout(() => { _lastGesture = null; }, 1500);
      onGestureDetected(gesture);
    }
  }

  function classifyGesture(lm) {
    // Hand size = wrist(0) to middle-finger-MCP(9) in 2D normalised space
    const handSize = lmDist2D(lm[0], lm[9]);
    if (handSize < 0.03) return null;  // too small / too far — ignore

    // Finger tips vs their MCP (knuckle) in 2D
    const fingerTips = [8, 12, 16, 20];
    const fingerMCP  = [5,  9, 13, 17];

    const curlRatios = fingerTips.map((tip, i) =>
      lmDist2D(lm[tip], lm[fingerMCP[i]]) / handSize
    );

    // Lenient thresholds — wide enough to catch real gestures
    // Curl ratio: small → finger folded, large → finger extended
    const allCurled   = curlRatios.every(r => r < 0.65);   // fist
    const allExtended = curlRatios.every(r => r > 0.65);   // open palm

    if (allCurled)   return 'FIST';
    if (allExtended) return 'OPEN_PALM';
    return null;
  }

  function onGestureDetected(gesture) {
    console.log('[AeroGrab] gesture:', gesture);
    if (gesture === 'FIST'      && _myRole === null) initiateGrab();
    if (gesture === 'OPEN_PALM' && _wakePayload)     signalReadyToReceive();
  }

  // ── Sender: initiate grab ──────────────────────────────────────────────────
  async function initiateGrab() {
    if (!_socket || _myRole) return;
    const payload = await getAeroGrabPayload();
    if (!payload) {
      showToast('No file to grab. Open or select a file first.', 'warn');
      return;
    }
    _myRole = 'sender';
    const meta = {
      name: payload.name,
      size: payload.size,
      type: payload.type || 'application/octet-stream',
      isFolder: !!payload.isFolder,
    };
    const targetId = _targetSocketId;
    _targetSocketId = null;   // reset after use
    _socket.emit('FILE_GRABBED', { metadata: meta, targetId });
    if (targetId) {
      const targetName = window._heviPeerName && window._heviPeerName(targetId);
      showToast(`Grabbing → ${targetName || 'targeted device'}...`, 'info');
    } else {
      showToast('File grabbed — waiting for a receiver...', 'info');
    }
    aeroAnim.showSenderLaunch(payload);
  }

  // ── Determine what to grab based on Hevi Explorer state ───────────────────
  async function getAeroGrabPayload() {
    // Priority 1: file currently open in viewer (_activeOpenFile set by app.js)
    if (_activeOpenFile) return _activeOpenFile;

    // Priority 2: selected files in select mode
    const selectedPaths = [...document.querySelectorAll('.file-card.selected, .file-row.selected')]
      .map(el => el.dataset.path).filter(Boolean);
    if (selectedPaths.length > 0) {
      if (selectedPaths.length === 1) {
        const info = await fetchFileMeta(selectedPaths[0]);
        return info;
      }
      // Multiple selected — we'll create a virtual batch
      return { name: `${selectedPaths.length} files`, size: 0, isMulti: true, paths: selectedPaths };
    }

    // Priority 3: folder card highlighted/targeted
    const folderEl = document.querySelector('.file-card.folder-targeted, .file-row.folder-targeted');
    if (folderEl && folderEl.dataset.path) {
      const info = await fetchFileMeta(folderEl.dataset.path);
      if (info) return { ...info, isFolder: true };
    }

    // Priority 4: last opened file (from prefs)
    try {
      const lastPath = localStorage.getItem('ag_last_file');
      if (lastPath) return await fetchFileMeta(lastPath);
    } catch (_) {}

    return null;
  }

  async function fetchFileMeta(filePath) {
    try {
      const r = await fetch(`/api/info?path=${encodeURIComponent(filePath)}`);
      if (!r.ok) return null;
      const d = await r.json();
      return { name: d.name, size: d.size, type: d.mimeType || 'application/octet-stream', path: d.path };
    } catch (_) { return null; }
  }

  // ── Receiver: signal ready to catch ───────────────────────────────────────
  function signalReadyToReceive() {
    if (!_socket || !_wakePayload) return;
    _socket.emit('DROP_HERE', { sessionId: _wakePayload.sessionId });
    hideWakeUpNotification();
  }

  // ── WebRTC P2P Bridge ──────────────────────────────────────────────────────
  function openP2PBridge(peerId, role) {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
    _peerConn = new RTCPeerConnection(config);

    _peerConn.onicecandidate = ({ candidate }) => {
      if (candidate) _socket.emit('webrtc_signal', { to: peerId, signal: candidate });
    };

    _peerConn.onconnectionstatechange = () => {
      const s = _peerConn.connectionState;
      if (s === 'failed' || s === 'disconnected') {
        showToast('Connection lost. File remains on sender.', 'error');
        resetSession();
      }
    };

    if (role === 'sender') {
      _dataChannel = _peerConn.createDataChannel('aerograb', { ordered: true });
      _dataChannel.binaryType = 'arraybuffer';
      _dataChannel.onopen = () => startFileTransfer();
      _dataChannel.onclose = () => console.log('[AeroGrab] data channel closed');
    } else {
      _peerConn.ondatachannel = ({ channel }) => {
        _dataChannel = channel;
        _dataChannel.binaryType = 'arraybuffer';
        _dataChannel.onmessage = onChunkReceived;
        _dataChannel.onclose   = () => console.log('[AeroGrab] recv channel closed');
      };
    }

    if (role === 'sender') {
      _peerConn.createOffer()
        .then(offer => _peerConn.setLocalDescription(offer))
        .then(() => _socket.emit('webrtc_signal', { to: peerId, signal: _peerConn.localDescription }))
        .catch(e => console.error('[AeroGrab] offer error:', e));
    }
  }

  // ── File Transfer — Sender side ────────────────────────────────────────────
  async function startFileTransfer() {
    const payload = await getAeroGrabPayload();
    if (!payload) { showToast('Could not find file to send.', 'error'); resetSession(); return; }

    let blob;
    try {
      if (payload.isFolder) {
        blob = await zipFolder(payload);
      } else if (payload.isMulti) {
        blob = await zipMultipleFiles(payload.paths);
      } else {
        const resp = await fetch(`/file?path=${encodeURIComponent(payload.path)}`);
        if (!resp.ok) throw new Error('File fetch failed');
        blob = await resp.blob();
      }
    } catch (e) {
      showToast(`Transfer failed: ${e.message}`, 'error');
      resetSession();
      return;
    }

    streamFileOverBridge(blob, payload.name);
  }

  function streamFileOverBridge(blob, name) {
    const totalSize = blob.size;
    let offset      = 0;

    // Send metadata header first
    const headerStr = JSON.stringify({ name, size: totalSize, type: blob.type });
    _dataChannel.send(headerStr);

    function sendNextChunk() {
      if (offset >= totalSize) {
        _dataChannel.send('__TRANSFER_DONE__');
        showToast('File sent successfully!', 'success');
        _socket.emit('SESSION_END', { sessionId: _sessionId });
        aeroAnim.onSenderComplete();
        resetSession();
        return;
      }
      if (_dataChannel.readyState !== 'open') return;
      const slice = blob.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = e => {
        _dataChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        const pct = Math.round((offset / totalSize) * 100);
        aeroAnim.updateSenderProgress(pct);
        if (_dataChannel.bufferedAmount < 16 * CHUNK_SIZE) {
          sendNextChunk();
        } else {
          setTimeout(sendNextChunk, 50);
        }
      };
      reader.readAsArrayBuffer(slice);
    }
    sendNextChunk();
  }

  // ── File Transfer — Receiver side ──────────────────────────────────────────
  function onChunkReceived(event) {
    const data = event.data;
    if (typeof data === 'string') {
      if (data === '__TRANSFER_DONE__') {
        finaliseReceivedFile();
        return;
      }
      // JSON header with metadata
      try {
        _recvMeta     = JSON.parse(data);
        _recvBuffer   = [];
        _recvReceived = 0;
      } catch (_) {}
      return;
    }
    // Binary chunk
    _recvBuffer.push(data);
    _recvReceived += data.byteLength;
    if (_recvMeta && _recvMeta.size > 0) {
      const pct = Math.round((_recvReceived / _recvMeta.size) * 100);
      aeroAnim.updateReceiverProgress(pct);
    }
  }

  function finaliseReceivedFile() {
    if (!_recvMeta || !_recvBuffer.length) return;
    const blob = new Blob(_recvBuffer, { type: _recvMeta.type || 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = _recvMeta.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 3000);

    showToast(`Received: ${_recvMeta.name}`, 'success');
    aeroAnim.onReceiverComplete(_recvMeta);
    _socket.emit('SESSION_END', { sessionId: _sessionId });
    resetSession();
  }

  // ── Folder zip using JSZip ─────────────────────────────────────────────────
  async function zipFolder(payload) {
    const resp = await fetch(`/api/list?path=${encodeURIComponent(payload.path)}`);
    if (!resp.ok) throw new Error('Cannot read folder');
    const files = await resp.json();
    const allFiles = files.filter(f => f.type === 'file');
    if (allFiles.length === 0)          throw new Error('AeroGrab: Cannot transfer an empty folder');
    if (payload.size > FOLDER_MAX_BYTES) throw new Error('AeroGrab Limit: Folder exceeds 1GB maximum');
    if (allFiles.length > FOLDER_MAX_FILES) throw new Error(`AeroGrab Limit: Folder contains more than ${FOLDER_MAX_FILES} files`);

    const zip = new JSZip();
    for (const f of allFiles) {
      const fr = await fetch(`/file?path=${encodeURIComponent(f.path)}`);
      const ab = await fr.arrayBuffer();
      zip.file(f.name, ab);
    }
    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  async function zipMultipleFiles(paths) {
    const zip = new JSZip();
    for (const p of paths) {
      const name = p.split('/').pop();
      const fr   = await fetch(`/file?path=${encodeURIComponent(p)}`);
      const ab   = await fr.arrayBuffer();
      zip.file(name, ab);
    }
    return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // ── Wake-up notification for receivers ────────────────────────────────────
  function showWakeUpNotification(metadata, senderName) {
    const panel  = $('aeroWakePanel');
    const label  = $('aeroWakeFileName');
    const device = $('aeroWakeSender');
    if (!panel) return;
    if (label)  label.textContent  = metadata.name || 'a file';
    if (device) device.textContent = senderName ? `From: ${senderName}` : '';
    panel.classList.remove('hidden');
    panel.classList.add('ag-wake-enter');
  }

  function hideWakeUpNotification() {
    const panel = $('aeroWakePanel');
    if (panel) panel.classList.add('hidden');
    _wakePayload = null;
  }

  // ── Green dot + camera overlay ────────────────────────────────────────────
  function showGreenDot(visible) {
    const dot = $('aeroGreenDot');
    if (dot) dot.classList.toggle('hidden', !visible);
    const overlay = $('agCamOverlay');
    if (overlay) overlay.classList.toggle('hidden', !visible);
  }

  // ── Reset session state ────────────────────────────────────────────────────
  function resetSession() {
    _sessionId   = null;
    _myRole      = null;
    _wakePayload = null;
    _recvBuffer  = [];
    _recvMeta    = null;
    _recvReceived = 0;
    if (_peerConn) { try { _peerConn.close(); } catch (_) {} _peerConn = null; }
    _dataChannel = null;
  }

  // ── Deactivate AeroGrab completely ────────────────────────────────────────
  function deactivateAeroGrab() {
    _enabled = false;
    showGreenDot(false);
    hideWakeUpNotification();
    resetSession();

    if (_rafId)     { clearInterval(_rafId); _rafId = null; }
    if (_camStream) { _camStream.getTracks().forEach(t => t.stop()); _camStream = null; }
    if (_camera)    { try { _camera.stop(); } catch (_) {} _camera = null; }
    if (_hands)     { try { _hands.close(); } catch (_) {} _hands  = null; }
    _processingHands = false;
    _frameCount = 0; _detectCount = 0;
    // NOTE: Socket + heartbeat stay alive for Hevi Network discovery

    // Reset video element to hidden
    const videoEl = $('aeroVideoEl');
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.style.cssText = 'display:none;position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    }
    const lbl = $('aeroGestureLbl');
    if (lbl) lbl.textContent = '—';

    const toggle = $('aeroGrabToggle');
    if (toggle) toggle.checked = false;
  }

  // ── Toast helper (uses Hevi Explorer toast if available) ──────────────────
  function showToast(msg, type) {
    if (typeof toast === 'function') { toast(msg, type === 'warn' ? 'warn' : type); return; }
    console.log(`[AeroGrab] ${type}: ${msg}`);
  }

  // ── Context-menu AeroGrab button wiring ───────────────────────────────────
  function wireContextMenuButton() {
    const btn = $('ctxAeroGrab');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const ctxItem = window._aeroCtxItem;
      if (!ctxItem) return;
      _activeOpenFile = { name: ctxItem.name, size: ctxItem.size, path: ctxItem.path, type: ctxItem.mimeType || 'application/octet-stream' };
      localStorage.setItem('ag_last_file', ctxItem.path);
      if (!_enabled) {
        toggleAeroGrab(true).then(() => { setTimeout(() => initiateGrab(), 500); });
      } else {
        initiateGrab();
      }
    });
  }

  // ── Wake-up catch button ───────────────────────────────────────────────────
  function wireWakePanel() {
    const btn = $('aeroWakeCatchBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!_enabled) {
        await toggleAeroGrab(true);
      }
      signalReadyToReceive();
    });
    const dismissBtn = $('aeroWakeDismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', hideWakeUpNotification);
  }

  // ── Sidebar toggle wiring ──────────────────────────────────────────────────
  function wireToggle() {
    const toggle = $('aeroGrabToggle');
    if (!toggle) return;
    toggle.addEventListener('change', () => toggleAeroGrab(toggle.checked));
  }

  // ── Manual grab button (bypasses gesture detection) ──────────────────────
  function wireManualGrab() {
    const btn = $('aeroManualGrab');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!_enabled) return;
      if (_myRole !== null) return;
      initiateGrab();
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    wireToggle();
    wireContextMenuButton();
    wireWakePanel();
    wireManualGrab();
    // Connect socket immediately for Hevi Network discovery (even if AeroGrab is OFF)
    initSocket();
    console.log('[AeroGrab] ready — by TWH');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.aeroGrab = {
    toggle:    toggleAeroGrab,
    isOn:      () => _enabled,
    grab:      initiateGrab,
    catch:     signalReadyToReceive,
    setTarget: (socketId) => { _targetSocketId = socketId || null; },
    mySocketId: () => _socket ? _socket.id : null,
  };

  // Helper used by initiateGrab to look up peer names (populated by Network tab)
  window._heviPeerName = null;

})();
