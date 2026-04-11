"use strict";
/* ═══════════════════════════════════════════════════════════════════════════
   L-Host — Advanced Image Viewer (iv.js)
   High-fidelity gestures, Anime.js animations, Hindi metadata, glassmorphism
═══════════════════════════════════════════════════════════════════════════ */

// ── Demo image data ─────────────────────────────────────────────────────────
const IV_DEMO = [
  {
    name: "Kolkata Skyline",
    url: "https://picsum.photos/seed/kolkata-city/1400/900",
    thumb: "https://picsum.photos/seed/kolkata-city/400/260",
    meta: {
      Name: "Kolkata_Skyline_2024.jpg",
      Size: "4.2 MB",
      Resolution: "4032 × 2688 px",
      Type: "JPEG / sRGB",
      Date: "January 15, 2024",
      Camera: "Sony α7 IV · 24mm f/2.8",
      ISO: "400 · Shutter: 1/500s",
      Location: "Howrah Bridge, Kolkata",
      Source: "Localhost Kolkata · April 4, 2026",
    },
  },
  {
    name: "L-Host Diagram",
    url: "https://picsum.photos/seed/tech-server-dark/1400/900",
    thumb: "https://picsum.photos/seed/tech-server-dark/400/260",
    meta: {
      Name: "LHost_Architecture_v2.png",
      Size: "1.8 MB",
      Resolution: "3840 × 2160 px",
      Type: "PNG / RGB",
      Date: "April 4, 2026",
      Camera: "Screenshot — Figma",
      ISO: "N/A",
      Location: "Localhost Kolkata",
      Source: "L-Host Project · v2.0",
    },
  },
  {
    name: "Leh Landscape",
    url: "https://picsum.photos/seed/leh-mountains-snow/1400/900",
    thumb: "https://picsum.photos/seed/leh-mountains-snow/400/260",
    meta: {
      Name: "Leh_Pangong_Golden.jpg",
      Size: "6.1 MB",
      Resolution: "5472 × 3648 px",
      Type: "JPEG / Adobe RGB",
      Date: "July 20, 2023",
      Camera: "Canon EOS R5 · 16mm f/4",
      ISO: "100 · Shutter: 1/250s",
      Location: "Pangong Lake, Leh, Ladakh",
      Source: "Localhost Kolkata · April 4, 2026",
    },
  },
];

// ── State ────────────────────────────────────────────────────────────────────
const iv = {
  list: [],
  idx: 0,
  scale: 1,
  rotate: 0,
  panX: 0,
  panY: 0,
  filter: "",
  isDemo: false,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragPanX: 0,
  dragPanY: 0,
  pinchActive: false,
  pinchDist: 0,
  pinchCenterX: 0,
  pinchCenterY: 0,
  pinchScaleStart: 1,
  pinchPanXStart: 0,
  pinchPanYStart: 0,
  swipeStartX: 0,
  swipeStartY: 0,
  swipeStartTime: 0,
  metaOpen: false,
  filterOpen: false,
  zoomBadgeTimer: null,
  transitioning: false,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const $iv = (id) => document.getElementById(id);
const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.25;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function ivGetCurrentItem() {
  return iv.list[iv.idx];
}

function ivGetUrl(item) {
  if (item._demo) return item.url;
  return `/file?path=${encodeURIComponent(item.path)}`;
}

function ivGetMeta(item) {
  if (item._demo) return item.meta;
  return {
    Name: item.name,
    Size: item.sizeStr || "--",
    Resolution: "Unknown",
    Type: (item.ext || "").toUpperCase().replace(".", "") || "--",
    Date: item.mtimeStr || "--",
    Camera: "--",
    ISO: "--",
    Location: "--",
    Source: "Localhost Kolkata · April 4, 2026",
  };
}

// ── Pulse effect ─────────────────────────────────────────────────────────────
function ivPulse(el) {
  if (!el || typeof anime === "undefined") return;
  const rect = el.getBoundingClientRect();
  const dot = document.createElement("div");
  dot.className = "iv-pulse-dot";
  dot.style.cssText = `left:${rect.left + rect.width / 2}px;top:${rect.top + rect.height / 2}px`;
  document.body.appendChild(dot);
  anime({
    targets: dot,
    scale: [0.2, 2.5],
    opacity: [0.8, 0],
    duration: 500,
    easing: "easeOutExpo",
    complete: () => dot.remove(),
  });
}

function ivPulseAt(x, y) {
  if (typeof anime === "undefined") return;
  const dot = document.createElement("div");
  dot.className = "iv-pulse-dot";
  dot.style.cssText = `left:${x}px;top:${y}px`;
  document.body.appendChild(dot);
  anime({
    targets: dot,
    scale: [0.1, 3],
    opacity: [0.9, 0],
    duration: 600,
    easing: "easeOutExpo",
    complete: () => dot.remove(),
  });
}

// ── Transform application ────────────────────────────────────────────────────
function ivApplyTransform(animate = false) {
  const wrap = $iv("ivImgWrap");
  if (!wrap) return;
  const t = `translate(${iv.panX}px, ${iv.panY}px) scale(${iv.scale}) rotate(${iv.rotate}deg)`;
  if (animate && typeof anime !== "undefined") {
    anime({
      targets: wrap,
      translateX: iv.panX,
      translateY: iv.panY,
      scale: iv.scale,
      rotate: iv.rotate,
      duration: 320,
      easing: "easeOutExpo",
    });
  } else {
    wrap.style.transform = t;
  }
}

// ── Zoom level badge ─────────────────────────────────────────────────────────
function ivShowZoomBadge() {
  const badge = $iv("ivZoomBadge");
  if (!badge) return;
  badge.textContent = Math.round(iv.scale * 100) + "%";
  badge.classList.remove("hidden");
  clearTimeout(iv.zoomBadgeTimer);
  badge.style.opacity = "1";
  iv.zoomBadgeTimer = setTimeout(() => {
    if (typeof anime !== "undefined") {
      anime({
        targets: badge,
        opacity: 0,
        duration: 400,
        easing: "linear",
        complete: () => badge.classList.add("hidden"),
      });
    } else {
      badge.classList.add("hidden");
    }
  }, 1200);
}

// ── Reset transform ──────────────────────────────────────────────────────────
function ivResetTransform(animate = true) {
  iv.scale = 1;
  iv.panX = 0;
  iv.panY = 0;
  ivApplyTransform(animate);
  ivShowZoomBadge();
}

// ── Clamp pan so image stays at least partially visible ──────────────────────
function ivClampPan() {
  const stage = $iv("ivStage");
  const img = $iv("imagePlayer");
  if (!stage || !img) return;
  const sw = stage.offsetWidth;
  const sh = stage.offsetHeight;
  const iw = img.naturalWidth || img.offsetWidth || sw;
  const ih = img.naturalHeight || img.offsetHeight || sh;
  const scaledW = iw * iv.scale;
  const scaledH = ih * iv.scale;
  const maxPanX = Math.max(0, (scaledW - sw) / 2 + 60);
  const maxPanY = Math.max(0, (scaledH - sh) / 2 + 60);
  iv.panX = clamp(iv.panX, -maxPanX, maxPanX);
  iv.panY = clamp(iv.panY, -maxPanY, maxPanY);
}

// ── Open ─────────────────────────────────────────────────────────────────────
function ivOpen(list, startIdx = 0, isDemo = false) {
  iv.list = list;
  iv.idx = startIdx;
  iv.isDemo = isDemo;
  iv.scale = 1;
  iv.rotate = 0;
  iv.panX = 0;
  iv.panY = 0;
  iv.filter = "";
  iv.metaOpen = false;
  iv.filterOpen = false;

  $iv("imageModal").classList.remove("hidden");
  document.body.style.overflow = "hidden";

  // Hide sub panels
  $iv("ivMetaModal").classList.add("hidden");
  $iv("ivFilterBar").classList.remove("iv-filter-open");
  $iv("imagePlayer").style.filter = "";

  // Reset active filter chip
  document
    .querySelectorAll(".iv-filter-chip")
    .forEach((c) => c.classList.remove("active"));
  const firstChip = document.querySelector('.iv-filter-chip[data-filter=""]');
  if (firstChip) firstChip.classList.add("active");

  ivShowAt(iv.idx, "none");
}

function ivOpenDemo() {
  const list = IV_DEMO.map((d) => ({
    ...d,
    _demo: true,
    type: "file",
    category: "image",
  }));
  ivOpen(list, 0, true);
}

// ── Show image at index ──────────────────────────────────────────────────────
function ivShowAt(idx, direction = "none") {
  const item = iv.list[idx];
  if (!item) return;
  iv.idx = idx;
  iv.scale = 1;
  iv.panX = 0;
  iv.panY = 0;

  const img = $iv("imagePlayer");
  const wrap = $iv("ivImgWrap");
  const url = ivGetUrl(item);
  const title = item.name || item.title || "Image";
  const dlUrl = item._demo ? url : url + "&dl=1";

  $iv("imageTitle").textContent = title;
  $iv("imageDl").href = dlUrl;
  if (!item._demo) $iv("imageDl").download = title;
  $iv("imageCounter").textContent = `${idx + 1} / ${iv.list.length}`;

  // Animate transition
  if (typeof anime !== "undefined" && direction !== "none") {
    const fromX = direction === "next" ? 60 : -60;
    anime({
      targets: wrap,
      opacity: [0, 1],
      translateX: [fromX, 0],
      scale: [0.93, 1],
      rotate: 0,
      duration: 380,
      easing: "easeOutExpo",
    });
  } else {
    wrap.style.transform = "translateX(0) scale(1) rotate(0deg)";
    wrap.style.opacity = "1";
    if (typeof anime !== "undefined") {
      anime({
        targets: wrap,
        opacity: [0, 1],
        scale: [0.96, 1],
        duration: 300,
        easing: "easeOutExpo",
      });
    }
  }

  img.style.filter = iv.filter || "";
  img.src = url;

  // Re-apply active filter chip
  document.querySelectorAll(".iv-filter-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.filter === iv.filter);
  });

  ivShowZoomBadge();
}

// ── Navigation ───────────────────────────────────────────────────────────────
function ivPrev() {
  if (iv.transitioning) return;
  iv.transitioning = true;
  const newIdx = (iv.idx - 1 + iv.list.length) % iv.list.length;
  ivShowAt(newIdx, "prev");
  ivPulse($iv("imagePrev"));
  setTimeout(() => {
    iv.transitioning = false;
  }, 400);
}

function ivNext() {
  if (iv.transitioning) return;
  iv.transitioning = true;
  const newIdx = (iv.idx + 1) % iv.list.length;
  ivShowAt(newIdx, "next");
  ivPulse($iv("imageNext"));
  setTimeout(() => {
    iv.transitioning = false;
  }, 400);
}

// ── Close ────────────────────────────────────────────────────────────────────
function ivClose() {
  $iv("imageModal").classList.add("hidden");
  document.body.style.overflow = "";
  $iv("imagePlayer").src = "";
  $iv("ivMetaModal").classList.add("hidden");
}

// ── Zoom (programmatic) ──────────────────────────────────────────────────────
function ivZoomBy(delta, cx, cy) {
  const stage = $iv("ivStage");
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  // Pivot relative to the transform-origin (center of the stage)
  const pivotX = (cx !== undefined ? cx : rect.left + rect.width / 2) - rect.left - rect.width / 2;
  const pivotY = (cy !== undefined ? cy : rect.top + rect.height / 2) - rect.top - rect.height / 2;
  const oldScale = iv.scale;
  iv.scale = clamp(iv.scale + delta, MIN_SCALE, MAX_SCALE);
  const ratio = iv.scale / oldScale;
  iv.panX = pivotX + (iv.panX - pivotX) * ratio;
  iv.panY = pivotY + (iv.panY - pivotY) * ratio;
  ivClampPan();
  ivApplyTransform(delta !== 0 && Math.abs(delta) >= ZOOM_STEP);
  ivShowZoomBadge();
}

// ── Rotate ───────────────────────────────────────────────────────────────────
function ivRotate(deg) {
  iv.rotate += deg;
  ivApplyTransform(true);
  ivPulse(deg < 0 ? $iv("ivRotateLeftBtn") : $iv("ivRotateRightBtn"));
}

// ── Filter ───────────────────────────────────────────────────────────────────
function ivSetFilter(f) {
  iv.filter = f;
  const img = $iv("imagePlayer");
  if (typeof anime !== "undefined") {
    anime({
      targets: img,
      opacity: [0.6, 1],
      duration: 250,
      easing: "easeOutQuad",
    });
  }
  img.style.filter = f || "";
  document.querySelectorAll(".iv-filter-chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.filter === f);
  });
}

// ── Metadata modal ────────────────────────────────────────────────────────────
function ivToggleMeta() {
  const modal = $iv("ivMetaModal");
  iv.metaOpen = !iv.metaOpen;
  if (iv.metaOpen) {
    const item = ivGetCurrentItem();
    const meta = ivGetMeta(item);
    const rows = Object.entries(meta)
      .map(
        ([k, v]) =>
          `<div class="iv-meta-row"><span class="iv-meta-label">${k}</span><span class="iv-meta-val">${v}</span></div>`,
      )
      .join("");
    $iv("ivMetaBody").innerHTML = rows;
    $iv("ivMetaTitle").textContent = item.name || "Image Info";
    modal.classList.remove("hidden");
    if (typeof anime !== "undefined") {
      anime({
        targets: modal,
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 300,
        easing: "easeOutExpo",
      });
    }
  } else {
    if (typeof anime !== "undefined") {
      anime({
        targets: modal,
        opacity: [1, 0],
        translateY: [0, 20],
        duration: 220,
        easing: "easeInQuad",
        complete: () => modal.classList.add("hidden"),
      });
    } else {
      modal.classList.add("hidden");
    }
  }
  ivPulse($iv("ivInfoBtn"));
}

// ── Filter bar toggle ─────────────────────────────────────────────────────────
function ivToggleFilter() {
  iv.filterOpen = !iv.filterOpen;
  const bar = $iv("ivFilterBar");
  bar.classList.toggle("iv-filter-open", iv.filterOpen);
  ivPulse($iv("ivFilterBtn"));
}

// ── Mouse wheel zoom ──────────────────────────────────────────────────────────
function ivInitWheel() {
  const stage = $iv("ivStage");
  let wheelTimer;
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      ivZoomBy(delta, e.clientX, e.clientY);
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {}, 80);
    },
    { passive: false },
  );
}

// ── Mouse drag (pan) ──────────────────────────────────────────────────────────
function ivInitMouseDrag() {
  const stage = $iv("ivStage");

  stage.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (
      e.target.closest(".iv-nav") ||
      e.target.closest(".iv-ctrl-btn") ||
      e.target.closest("#ivMetaModal")
    )
      return;
    iv.isDragging = true;
    iv.dragStartX = e.clientX - iv.panX;
    iv.dragStartY = e.clientY - iv.panY;
    stage.style.cursor = iv.scale > 1 ? "grabbing" : "default";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!iv.isDragging) return;
    if (iv.scale <= 1 && !$iv("imageModal").classList.contains("hidden"))
      return;
    iv.panX = e.clientX - iv.dragStartX;
    iv.panY = e.clientY - iv.dragStartY;
    ivClampPan();
    ivApplyTransform(false);
  });

  document.addEventListener("mouseup", (e) => {
    if (!iv.isDragging) return;
    iv.isDragging = false;
    const stage2 = $iv("ivStage");
    if (stage2) stage2.style.cursor = "";
    // Pulse at click point if no pan happened
    if (
      Math.abs(e.clientX - (iv.dragStartX + iv.panX)) < 5 &&
      Math.abs(e.clientY - (iv.dragStartY + iv.panY)) < 5
    ) {
      ivPulseAt(e.clientX, e.clientY);
    }
  });
}

// ── Touch gestures (swipe + pinch + pan) ─────────────────────────────────────
function ivInitTouch() {
  const stage = $iv("ivStage");

  stage.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        iv.swipeStartX = e.touches[0].clientX;
        iv.swipeStartY = e.touches[0].clientY;
        iv.swipeStartTime = Date.now();
        iv.dragStartX = e.touches[0].clientX - iv.panX;
        iv.dragStartY = e.touches[0].clientY - iv.panY;
        iv.isDragging = true;
      }
      if (e.touches.length === 2) {
        iv.isDragging = false;
        iv.pinchActive = true;
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        iv.pinchDist = Math.hypot(dx, dy);
        iv.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        iv.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        iv.pinchScaleStart = iv.scale;
        iv.pinchPanXStart = iv.panX;
        iv.pinchPanYStart = iv.panY;
        // Show cyan pinch dot
        ivShowPinchDot(iv.pinchCenterX, iv.pinchCenterY);
      }
    },
    { passive: true },
  );

  stage.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (e.touches.length === 2 && iv.pinchActive) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        const dist = Math.hypot(dx, dy);
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        const ratio = dist / iv.pinchDist;
        const newScale = clamp(
          iv.pinchScaleStart * ratio,
          MIN_SCALE,
          MAX_SCALE,
        );

        // Adjust pan so zoom is anchored at the pinch midpoint
        // Pivot must be relative to transform-origin (center of stage)
        const stageRect = $iv("ivStage").getBoundingClientRect();
        const pivotX = cx - stageRect.left - stageRect.width / 2;
        const pivotY = cy - stageRect.top - stageRect.height / 2;
        const scaleRatio = newScale / iv.scale;
        iv.panX = pivotX + (iv.panX - pivotX) * scaleRatio;
        iv.panY = pivotY + (iv.panY - pivotY) * scaleRatio;
        iv.scale = newScale;
        ivClampPan();
        ivApplyTransform(false);
        ivShowZoomBadge();

        // Move pinch dot
        ivMovePinchDot(cx, cy);
      } else if (e.touches.length === 1 && iv.isDragging && iv.scale > 1) {
        iv.panX = e.touches[0].clientX - iv.dragStartX;
        iv.panY = e.touches[0].clientY - iv.dragStartY;
        ivClampPan();
        ivApplyTransform(false);
      }
    },
    { passive: false },
  );

  stage.addEventListener(
    "touchend",
    (e) => {
      if (iv.pinchActive && e.touches.length < 2) {
        iv.pinchActive = false;
        hidePinchDot();
        return;
      }

      if (
        !iv.pinchActive &&
        e.changedTouches.length === 1 &&
        iv.scale <= 1.05
      ) {
        const t = e.changedTouches[0];
        const dx = t.clientX - iv.swipeStartX;
        const dy = t.clientY - iv.swipeStartY;
        const dt = Date.now() - iv.swipeStartTime;
        const isHSwipe =
          Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 400;

        if (isHSwipe) {
          // Swipe gesture visual trace
          ivShowSwipeTrace(dx < 0 ? "left" : "right");
          if (dx < 0) ivNext();
          else ivPrev();
        } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          ivPulseAt(t.clientX, t.clientY);
        }
      }
      iv.isDragging = false;
    },
    { passive: true },
  );
}

// ── Pinch dot ────────────────────────────────────────────────────────────────
function ivShowPinchDot(x, y) {
  let dot = $iv("ivPinchDot");
  if (!dot) return;
  dot.style.left = x + "px";
  dot.style.top = y + "px";
  dot.classList.remove("hidden");
  dot.classList.add("iv-pinch-active");
}

function ivMovePinchDot(x, y) {
  const dot = $iv("ivPinchDot");
  if (!dot) return;
  dot.style.left = x + "px";
  dot.style.top = y + "px";
}

function hidePinchDot() {
  const dot = $iv("ivPinchDot");
  if (!dot) return;
  dot.classList.remove("iv-pinch-active");
  setTimeout(() => dot.classList.add("hidden"), 300);
}

// ── Swipe trace ───────────────────────────────────────────────────────────────
function ivShowSwipeTrace(dir) {
  const trace = $iv("ivSwipeGlow");
  if (!trace) return;
  trace.style.left = dir === "left" ? "auto" : "0";
  trace.style.right = dir === "left" ? "0" : "auto";
  trace.classList.remove("active");
  void trace.offsetWidth;
  trace.classList.add("active");
  setTimeout(() => trace.classList.remove("active"), 600);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function ivInitKeyboard() {
  document.addEventListener("keydown", (e) => {
    if ($iv("imageModal").classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") ivPrev();
    if (e.key === "ArrowRight") ivNext();
    if (e.key === "+" || e.key === "=") ivZoomBy(ZOOM_STEP);
    if (e.key === "-") ivZoomBy(-ZOOM_STEP);
    if (e.key === "0") ivResetTransform(true);
    if (e.key === "r" || e.key === "R") ivRotate(90);
    if (e.key === "i" || e.key === "I") ivToggleMeta();
    if (e.key === "Escape") {
      if (iv.metaOpen) {
        ivToggleMeta();
        return;
      }
      ivClose();
    }
  });
}

// ── Wire up all controls ──────────────────────────────────────────────────────
function ivInit() {
  // Navigation
  $iv("imagePrev").addEventListener("click", (e) => {
    e.stopPropagation();
    ivPrev();
  });
  $iv("imageNext").addEventListener("click", (e) => {
    e.stopPropagation();
    ivNext();
  });

  // Header controls
  $iv("imageClose").addEventListener("click", ivClose);
  $iv("ivZoomInBtn").addEventListener("click", (e) => {
    ivZoomBy(ZOOM_STEP);
    ivPulse(e.currentTarget);
  });
  $iv("ivZoomOutBtn").addEventListener("click", (e) => {
    ivZoomBy(-ZOOM_STEP);
    ivPulse(e.currentTarget);
  });
  $iv("ivRotateLeftBtn").addEventListener("click", () => ivRotate(-90));
  $iv("ivRotateRightBtn").addEventListener("click", () => ivRotate(90));
  $iv("ivInfoBtn").addEventListener("click", ivToggleMeta);
  $iv("ivFilterBtn").addEventListener("click", ivToggleFilter);
  $iv("ivMetaClose").addEventListener("click", ivToggleMeta);

  // Filter chips
  document.querySelectorAll(".iv-filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      ivSetFilter(chip.dataset.filter);
      ivPulse(chip);
    });
  });

  // Double-tap to reset zoom
  let lastTap = 0;
  $iv("ivStage").addEventListener("click", (e) => {
    if (
      e.target.closest(".iv-nav") ||
      e.target.closest(".iv-ctrl-btn") ||
      e.target.closest("#ivMetaModal")
    )
      return;
    const now = Date.now();
    if (now - lastTap < 300) {
      if (iv.scale > 1.05) {
        ivResetTransform(true);
      } else {
        ivZoomBy(ZOOM_STEP * 3, e.clientX, e.clientY);
      }
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });

  ivInitWheel();
  ivInitMouseDrag();
  ivInitTouch();
  ivInitKeyboard();
}

// ── Public API ───────────────────────────────────────────────────────────────
window.ivOpen = ivOpen;
window.ivOpenDemo = ivOpenDemo;
window.ivClose = ivClose;
window.ivInit = ivInit;
window.IV_DEMO = IV_DEMO;
