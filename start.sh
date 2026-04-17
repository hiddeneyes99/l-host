#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Hevi Explorer — Smart Auto-Setup & Launcher
#  Works on: Termux (Android) · Kali Linux · Ubuntu/Debian
#            Arch · Fedora · macOS
#  Usage: bash start.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colors ─────────────────────────────────────────────────────
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m'
C='\033[0;36m' B='\033[1;34m' NC='\033[0m'
ok()   { echo -e "${G}  ✓ $*${NC}"; }
info() { echo -e "${C}  ► $*${NC}"; }
warn() { echo -e "${Y}  ⚠ $*${NC}"; }
err()  { echo -e "${R}  ✗ $*${NC}"; }
banner() {
  echo ""
  echo -e "${C}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${C}║      Hevi Explorer — Smart Auto-Setup        ║${NC}"
  echo -e "${C}╚══════════════════════════════════════════════╝${NC}"
  echo ""
}

# ── Run with or without sudo ────────────────────────────────────
try_sudo() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo &>/dev/null; then
    sudo "$@"
  else
    "$@" 2>/dev/null || true
  fi
}

# ── Platform detection ──────────────────────────────────────────
detect_platform() {
  if [ -n "${TERMUX_VERSION:-}" ] || [ -n "${TERMUX_PREFIX:-}" ] || [ -d "/data/data/com.termux" ]; then
    echo "termux"; return
  fi
  case "$(uname -s)" in
    Darwin) echo "macos"; return ;;
  esac
  if [ -f /etc/os-release ]; then
    local ids
    ids=$(grep -E "^(ID|ID_LIKE)=" /etc/os-release 2>/dev/null | tr '\n' ' ')
    case "$ids" in
      *kali*|*debian*|*ubuntu*|*mint*|*pop*|*elementary*|*raspbian*) echo "debian"; return ;;
      *arch*|*manjaro*|*endeavour*) echo "arch"; return ;;
      *fedora*|*rhel*|*centos*|*rocky*|*alma*) echo "fedora"; return ;;
      *opensuse*|*suse*) echo "suse"; return ;;
    esac
  fi
  echo "linux"
}

# ── Node.js version check ───────────────────────────────────────
node_version_ok() {
  command -v node &>/dev/null || return 1
  local ver
  ver=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
  [ "$ver" = "ok" ]
}

# ── Install Node.js ─────────────────────────────────────────────
install_node() {
  info "Installing Node.js 20..."
  case "$PLATFORM" in
    termux)
      pkg install -y nodejs ;;
    debian)
      if ! command -v curl &>/dev/null; then try_sudo apt-get install -y curl; fi
      curl -fsSL https://deb.nodesource.com/setup_20.x | try_sudo bash - 2>&1 | grep -v "^$"
      try_sudo apt-get install -y nodejs ;;
    arch)
      try_sudo pacman -S --noconfirm nodejs npm ;;
    fedora)
      try_sudo dnf install -y nodejs ;;
    suse)
      try_sudo zypper install -y nodejs20 ;;
    macos)
      if command -v brew &>/dev/null; then brew install node
      else err "Install Node.js from https://nodejs.org"; exit 1; fi ;;
    *)
      err "Cannot auto-install Node.js on this platform."
      err "Please install Node.js 18+ from: https://nodejs.org"
      exit 1 ;;
  esac
}

# ── Install FFmpeg ──────────────────────────────────────────────
check_ffmpeg() {
  command -v ffmpeg &>/dev/null && return 0
  # Termux absolute path fallback
  [ -f "${TERMUX_PREFIX:-/data/data/com.termux/files/usr}/bin/ffmpeg" ] && return 0
  return 1
}
install_ffmpeg() {
  info "Installing FFmpeg (for video thumbnails & HEIC)..."
  case "$PLATFORM" in
    termux)  pkg install -y ffmpeg ;;
    debian)  try_sudo apt-get install -y ffmpeg ;;
    arch)    try_sudo pacman -S --noconfirm ffmpeg ;;
    fedora)  try_sudo dnf install -y ffmpeg --allowerasing 2>/dev/null || try_sudo dnf install -y ffmpeg ;;
    suse)    try_sudo zypper install -y ffmpeg ;;
    macos)   command -v brew &>/dev/null && brew install ffmpeg ;;
    *)       warn "FFmpeg not found — video thumbnails will be disabled." ;;
  esac
}

# ── Install p7zip ───────────────────────────────────────────────
check_7zip() {
  command -v 7z &>/dev/null || command -v 7za &>/dev/null
}
install_7zip() {
  info "Installing p7zip (for RAR/7z archive preview)..."
  case "$PLATFORM" in
    termux)  pkg install -y p7zip ;;
    debian)  try_sudo apt-get install -y p7zip-full ;;
    arch)    try_sudo pacman -S --noconfirm p7zip ;;
    fedora)  try_sudo dnf install -y p7zip p7zip-plugins ;;
    suse)    try_sudo zypper install -y p7zip ;;
    macos)   command -v brew &>/dev/null && brew install p7zip ;;
    *)       warn "p7zip not found — RAR/7z preview will be disabled." ;;
  esac
}

# ── npm install with auto-retry ─────────────────────────────────
run_npm_install() {
  info "Installing Node packages..."
  if npm install 2>&1; then ok "npm install complete"; return 0; fi
  warn "Retrying with --legacy-peer-deps..."
  if npm install --legacy-peer-deps 2>&1; then ok "npm install complete (legacy mode)"; return 0; fi
  warn "Clearing npm cache and retrying..."
  npm cache clean --force 2>/dev/null || true
  if npm install --legacy-peer-deps 2>&1; then ok "npm install complete (after cache clear)"; return 0; fi
  err "npm install failed. Check your internet connection and try again."
  return 1
}

# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════
banner
PLATFORM=$(detect_platform)
ok "Platform detected: $PLATFORM"

# ── Node.js ────────────────────────────────────────────────────
if node_version_ok; then
  ok "Node.js $(node --version) — OK"
else
  warn "Node.js not found or too old (need 18+)"
  install_node
  if node_version_ok; then
    ok "Node.js $(node --version) installed"
  else
    err "Node.js install failed. Please install manually: https://nodejs.org"
    exit 1
  fi
fi

# ── FFmpeg (optional) ──────────────────────────────────────────
if check_ffmpeg; then
  ok "FFmpeg found"
else
  install_ffmpeg
  check_ffmpeg && ok "FFmpeg installed" || warn "FFmpeg unavailable — video thumbnails disabled"
fi

# ── p7zip (optional) ───────────────────────────────────────────
if check_7zip; then
  ok "p7zip / 7z found"
else
  install_7zip
  check_7zip && ok "p7zip installed" || warn "p7zip unavailable — RAR/7z preview disabled"
fi

# ── npm install ─────────────────────────────────────────────────
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  run_npm_install || exit 1
else
  ok "node_modules already up to date"
fi

# ── Launch ──────────────────────────────────────────────────────
echo ""
echo -e "${G}  All set! Starting Hevi Explorer...${NC}"
echo ""
exec node server.js
