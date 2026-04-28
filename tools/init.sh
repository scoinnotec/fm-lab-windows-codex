#!/usr/bin/env bash
# init.sh — First-time setup for fm-lab
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors (terminal only)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; BOLD=''; NC=''
fi

info()   { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}⚠${NC} $1"; }
error()  { echo -e "${RED}✗${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

header "fm-lab init"
echo "  Project root: $PROJECT_ROOT"

# ─── Prerequisites ────────────────────────────────────────────

header "Checking prerequisites"

ok=true

# DuckDB
if command -v duckdb &>/dev/null; then
  DUCKDB_VER=$(duckdb --version 2>/dev/null | head -1 || echo "unknown")
  info "DuckDB: $DUCKDB_VER"
else
  error "DuckDB CLI not found. Install it from https://duckdb.org/docs/installation/"
  ok=false
fi

# Node.js (≥18)
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    info "Node.js: $NODE_VER"
  else
    error "Node.js $NODE_VER found, but ≥18 is required."
    ok=false
  fi
else
  error "Node.js not found. Install it from https://nodejs.org/"
  ok=false
fi

# npm (≥9)
if command -v npm &>/dev/null; then
  NPM_VER=$(npm --version)
  NPM_MAJOR=$(echo "$NPM_VER" | sed 's/\([0-9]*\).*/\1/')
  if [ "$NPM_MAJOR" -ge 9 ]; then
    info "npm: $NPM_VER"
  else
    error "npm $NPM_VER found, but ≥9 is required. Run: npm install -g npm"
    ok=false
  fi
else
  error "npm not found."
  ok=false
fi

if [ "$ok" = false ]; then
  echo ""
  error "Prerequisites missing — please install the tools above and run init.sh again."
  exit 1
fi

# ─── npm install ──────────────────────────────────────────────

header "Installing dependencies"
cd "$PROJECT_ROOT"
npm install --silent && info "Dependencies installed"

# ─── Environment files ────────────────────────────────────────

header "Environment files"

if [ ! -f "$PROJECT_ROOT/rest-api/.env" ]; then
  cp "$PROJECT_ROOT/rest-api/.env.example" "$PROJECT_ROOT/rest-api/.env"
  info "Created rest-api/.env"
else
  info "rest-api/.env already exists"
fi

if [ ! -f "$PROJECT_ROOT/apps/web/.env" ]; then
  cp "$PROJECT_ROOT/apps/web/.env.example" "$PROJECT_ROOT/apps/web/.env"
  info "Created apps/web/.env"
else
  info "apps/web/.env already exists"
fi

# ─── Logs directory ───────────────────────────────────────────

mkdir -p "$PROJECT_ROOT/logs"

# ─── XML conversion ───────────────────────────────────────────

header "FileMaker XML export"

XML_FILES=$(find "$PROJECT_ROOT/xml" -maxdepth 1 -name "*.xml" 2>/dev/null | wc -l | tr -d ' ')

if [ "$XML_FILES" -eq 0 ]; then
  warn "No XML files found in xml/."
  echo ""
  echo "  Next step:"
  echo "  1. Export your FileMaker solution via File > Save a Copy As > XML"
  echo "  2. Place the .xml file in the xml/ directory"
  echo "  3. Run:  bash tools/convert_fm_xml.sh --batch"
  echo "  4. Then: bash tools/start-servers.sh"
  echo ""
  info "Setup complete — add your XML export to continue."
  exit 0
fi

info "Found $XML_FILES XML file(s) in xml/ — starting conversion"
bash "$SCRIPT_DIR/convert_fm_xml.sh" --batch

# ─── Start servers ────────────────────────────────────────────

header "Starting servers"
bash "$SCRIPT_DIR/start-servers.sh"

echo ""
info "fm-lab is ready."
echo "  Web Client:  http://localhost:5173"
echo "  REST API:    http://localhost:3003"
