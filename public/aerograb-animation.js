/* ═══════════════════════════════════════════════════════════════════════════
   AeroGrab Fly  —  Animation Engine v1.0
   by Technical White Hat (TWH)
   Phase 1: Energy Squeeze | Phase 2: Rocket Launch
   Phase 3: Rocket Landing | Phase 4: Progress Ring
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

(function AeroGrabAnimation() {
  const $  = id => document.getElementById(id);

  // ── Overlay stage helper ───────────────────────────────────────────────────
  function getStage() { return $('aeroAnimStage'); }
  function clearStage() {
    const s = getStage();
    if (s) s.innerHTML = '';
  }
  function showStage()  { const s = getStage(); if (s) s.classList.remove('hidden'); }
  function hideStage()  { const s = getStage(); if (s) s.classList.add('hidden'); clearStage(); }

  // ── Particle burst helper ──────────────────────────────────────────────────
  function spawnParticles(container, count, color) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'ag-particle';
      p.style.cssText = `
        position:absolute;
        width:6px; height:6px;
        border-radius:50%;
        background:${color};
        top:50%; left:50%;
        transform:translate(-50%,-50%);
        pointer-events:none;
      `;
      container.appendChild(p);
      const angle = (360 / count) * i;
      const dist  = 40 + Math.random() * 40;
      anime({
        targets: p,
        translateX: Math.cos(angle * Math.PI / 180) * dist,
        translateY: Math.sin(angle * Math.PI / 180) * dist,
        opacity:    [1, 0],
        scale:      [1, 0],
        duration:   800 + Math.random() * 400,
        easing:     'easeOutExpo',
        complete:   () => p.remove(),
      });
    }
  }

  // ── Phase 1 + 2: Sender — Energy Squeeze → Rocket Launch ─────────────────
  function showSenderLaunch(payload) {
    const stage = getStage();
    if (!stage) return;
    clearStage();
    showStage();

    // File box
    const box = document.createElement('div');
    box.className = 'ag-file-box';
    box.innerHTML = `
      <div class="ag-box-icon">${getFileEmoji(payload)}</div>
      <div class="ag-box-name">${escHtml(payload.name || 'File')}</div>
    `;
    stage.appendChild(box);

    // Phase 1: Energy Squeeze — particles implode
    const energyRing = document.createElement('div');
    energyRing.className = 'ag-energy-ring';
    stage.appendChild(energyRing);

    anime({
      targets: energyRing,
      scale:   [2, 0],
      opacity: [0.8, 0],
      duration: 800,
      easing:   'easeInExpo',
    });

    spawnParticles(stage, 16, 'var(--accent)');

    // Phase 2: Box bounces then rocket launches
    anime({
      targets: box,
      scale: [1, 1.15, 0.9, 1.05, 1],
      duration: 600,
      easing: 'easeInOutBack',
      complete: () => launchRocket(stage, payload),
    });
  }

  function launchRocket(stage, payload) {
    const rocket = document.createElement('div');
    rocket.className = 'ag-rocket';
    rocket.innerHTML = `
      <div class="ag-rocket-body">🚀</div>
      <div class="ag-rocket-trail"></div>
    `;
    stage.appendChild(rocket);

    const box = stage.querySelector('.ag-file-box');
    if (box) {
      anime({
        targets: box,
        scale:   [1, 0.3],
        opacity: [1, 0],
        duration: 400,
        easing: 'easeInBack',
      });
    }

    // Rocket enters from center, launches upward
    anime({
      targets: rocket,
      translateY: [0, -window.innerHeight * 0.8],
      scale:      [0.5, 1, 0.8],
      opacity:    [0, 1, 0],
      duration:   1200,
      easing:     'easeInCubic',
      complete:   () => {
        showStage();
        showSenderWaiting(stage);
      },
    });
  }

  function showSenderWaiting(stage) {
    clearStage();
    const waiting = document.createElement('div');
    waiting.className = 'ag-waiting';
    waiting.innerHTML = `
      <div class="ag-waiting-rocket">🚀</div>
      <div class="ag-waiting-orbit"></div>
      <div class="ag-waiting-label">File in air…<br><small>Waiting for receiver</small></div>
    `;
    stage.appendChild(waiting);
    anime({
      targets: '.ag-waiting-orbit',
      rotate:  '1turn',
      duration: 2000,
      loop:    true,
      easing:  'linear',
    });
  }

  // ── Phase 3: Receiver — Rocket Landing ────────────────────────────────────
  function showReceiverLanding(meta) {
    const stage = getStage();
    if (!stage) return;
    clearStage();
    showStage();

    // Strong energy pulse from center
    const pulse = document.createElement('div');
    pulse.className = 'ag-pulse-ring';
    stage.appendChild(pulse);
    anime({
      targets: pulse,
      scale:   [0, 3],
      opacity: [0.8, 0],
      duration: 900,
      easing:   'easeOutExpo',
    });

    // Light beam from sky
    const beam = document.createElement('div');
    beam.className = 'ag-beam';
    stage.appendChild(beam);
    anime({
      targets: beam,
      scaleY:  [0, 1],
      opacity: [0, 0.6, 0],
      duration: 800,
      easing:   'easeOutQuart',
    });

    // Rocket descends
    setTimeout(() => {
      const rocket = document.createElement('div');
      rocket.className = 'ag-rocket ag-rocket-land';
      rocket.textContent = '🚀';
      stage.appendChild(rocket);
      anime({
        targets: rocket,
        translateY: [-window.innerHeight * 0.6, 0],
        rotate:     ['180deg', '180deg'],
        scale:      [0.6, 1],
        opacity:    [0, 1],
        duration:   900,
        easing:     'easeOutBounce',
        complete:   () => openLandingBox(stage, meta),
      });
    }, 400);
  }

  function openLandingBox(stage, meta) {
    clearStage();
    spawnParticles(stage, 20, 'var(--accent)');

    const box = document.createElement('div');
    box.className = 'ag-file-box ag-land-box';
    box.innerHTML = `
      <div class="ag-box-icon ag-box-opening">${getFileEmoji(meta)}</div>
      <div class="ag-box-name">${escHtml(meta.name || 'File')}</div>
      <div class="ag-progress-wrap hidden" id="agProgressWrap">
        <svg class="ag-ring-svg" viewBox="0 0 80 80">
          <circle class="ag-ring-bg" cx="40" cy="40" r="34"/>
          <circle class="ag-ring-fill" id="agRingFill" cx="40" cy="40" r="34"/>
        </svg>
        <div class="ag-ring-pct" id="agRingPct">0%</div>
      </div>
    `;
    stage.appendChild(box);

    anime({
      targets: box,
      scale: [0.4, 1.05, 1],
      opacity: [0, 1],
      duration: 600,
      easing: 'easeOutBack',
    });
  }

  // ── Phase 4: Progress Ring ─────────────────────────────────────────────────
  const RING_CIRC = 2 * Math.PI * 34; // circumference for r=34

  function updateProgress(pct, ringFillId, pctLabelId, wrapId) {
    const fill  = $(ringFillId);
    const label = $(pctLabelId);
    const wrap  = $(wrapId);
    if (!fill || !label) return;
    if (wrap && pct > 0 && pct < 100) wrap.classList.remove('hidden');
    const offset = RING_CIRC * (1 - pct / 100);
    fill.style.strokeDashoffset = offset;
    label.textContent = `${pct}%`;
  }

  function updateSenderProgress(pct) {
    // Sender side doesn't show ring — just a simple label update
    const label = document.querySelector('.ag-waiting-label');
    if (label) label.innerHTML = `Sending… <b>${pct}%</b>`;
  }

  function updateReceiverProgress(pct) {
    updateProgress(pct, 'agRingFill', 'agRingPct', 'agProgressWrap');
  }

  function onSenderComplete() {
    const stage = getStage();
    if (!stage) return;
    clearStage();
    const done = document.createElement('div');
    done.className = 'ag-done';
    done.innerHTML = `<div class="ag-done-icon">✅</div><div class="ag-done-label">Sent!</div>`;
    stage.appendChild(done);
    anime({ targets: done, scale: [0.5, 1.1, 1], opacity: [0, 1], duration: 500, easing: 'easeOutBack' });
    setTimeout(hideStage, 2000);
  }

  function onReceiverComplete(meta, openUrl) {
    const stage = getStage();
    if (!stage) return;
    clearStage();
    const safeName = escHtml(meta && meta.name ? meta.name : 'file');
    const emoji = getFileEmoji(meta || {});
    const wrap = document.createElement('div');
    wrap.className = 'ag-done';
    const autoOpened = !openUrl;
    wrap.innerHTML = `
      <div class="ag-done-icon">${emoji}</div>
      <div class="ag-done-label">Caught: ${safeName}</div>
      ${autoOpened ? '' : '<button class="ag-open-btn" type="button">Open file</button>'}
      <div class="ag-done-sub">${autoOpened ? 'Saved to Downloads · opened automatically' : 'Saved to Downloads · tap to open'}</div>
    `;
    stage.appendChild(wrap);
    spawnParticles(stage, 24, 'var(--accent)');
    anime({ targets: wrap, scale: [0.6, 1.1, 1], opacity: [0, 1], duration: 500, easing: 'easeOutBack' });
    const btn = wrap.querySelector('.ag-open-btn');
    if (btn && openUrl) {
      btn.addEventListener('click', () => {
        try {
          const w = window.open(openUrl, '_blank', 'noopener');
          if (!w) location.href = openUrl;
        } catch (_) { location.href = openUrl; }
      });
    }
    setTimeout(hideStage, autoOpened ? 4000 : 12000);
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function getFileEmoji(meta) {
    if (!meta) return '📦';
    const name = (meta.name || '').toLowerCase();
    if (meta.isFolder)                                        return '📁';
    if (meta.isMulti)                                         return '📦';
    if (/\.(mp4|mkv|avi|mov|webm)$/.test(name))              return '🎬';
    if (/\.(mp3|flac|ogg|wav|aac|opus)$/.test(name))         return '🎵';
    if (/\.(jpg|jpeg|png|gif|webp|heic|svg)$/.test(name))    return '🖼️';
    if (/\.(pdf)$/.test(name))                                return '📄';
    if (/\.(zip|rar|7z|tar|gz)$/.test(name))                 return '🗜️';
    if (/\.(apk)$/.test(name))                                return '📱';
    if (/\.(doc|docx|txt|md)$/.test(name))                   return '📝';
    return '📦';
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Expose to aerograb.js ──────────────────────────────────────────────────
  window.aeroAnim = {
    showSenderLaunch,
    showReceiverLanding,
    updateSenderProgress,
    updateReceiverProgress,
    onSenderComplete,
    onReceiverComplete,
  };

})();
