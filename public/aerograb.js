/* ═══════════════════════════════════════════════════════════════════════════
   AeroGrab v1.0  —  Gesture-Controlled P2P File Transfer
   by Technical White Hat (TWH)
   TWH Eco System Technology — Hevi Explorer
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function AeroGrab() {

  // ── Constants ──────────────────────────────────────────────────────────────
  const CHUNK_SIZE       = 64 * 1024;        // 64 KB per WebRTC chunk
  const FOLDER_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB
  const FOLDER_MAX_FILES = 20;

  // ── State ──────────────────────────────────────────────────────────────────
  let _enabled           = false;
  let _socket            = null;
  let _sessionId         = null;          // active AeroGrab session
  let _myRole            = null;          // 'sender' | 'receiver' | null
  let _peerConn          = null;          // RTCPeerConnection
  let _dataChannel       = null;          // RTCDataChannel
  let _recvBuffer        = [];            // incoming chunks
  let _recvMeta          = null;          // { name, size, type }
  let _recvReceived      = 0;             // bytes received so far
  let _targetSocketId    = null;          // if set, only this device gets WAKE_UP
  let _heartbeatTimer    = null;          // setInterval handle for HEVI_HEARTBEAT
  let _capturedPhotoFile = null;          // photo taken via native <input type="file">
  let _activeOpenFile    = null;          // set by Hevi Explorer when a file is opened
  let _wakePayload       = null;          // sender's metadata received via WAKE_UP_CAMERAS

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
      _enabled = true;
      if (_socket) announceToNetwork();
      showGreenDot(true);
      showToast('AeroGrab active — select a file or tap 📷 to take a photo, then tap a device to send', 'info');
    } else {
      deactivateAeroGrab();
    }
  }

  // ── Native camera capture via <input type="file" accept="image/*;capture=camera"> ──
  // Works on HTTP LAN — no HTTPS or getUserMedia needed. Opens the device's
  // native camera app. Photo is then held as the AeroGrab payload.
  function wireCameraCapture() {
    let inp = document.getElementById('aeroCameraInput');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.id   = 'aeroCameraInput';
      inp.setAttribute('accept', 'image/*;capture=camera');
      inp.setAttribute('capture', 'environment');
      inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(inp);
    }

    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      _capturedPhotoFile = file;
      inp.value = '';  // reset so same file can be re-selected again

      // Show thumbnail preview where the old video feed used to appear
      let preview = document.getElementById('aeroCapturedPreview');
      if (preview) {
        const url = URL.createObjectURL(file);
        preview.src = url;
        preview.style.display = 'block';
        // Revoke after a while to free memory
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }

      showToast(`📷 Photo ready (${(file.size / 1024).toFixed(0)} KB) — tap a device in Hevi Network to send!`, 'success');
      if (!_enabled) toggleAeroGrab(true);
    });

    // Camera button click → open native camera
    const btn = document.getElementById('aeroCameraBtn');
    if (btn) btn.addEventListener('click', () => inp.click());
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
