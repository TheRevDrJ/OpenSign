#!/usr/bin/env bash
#
# OpenSign — server manager (macOS / Linux)
#
# Two ways to run OpenSign:
#   DEV   — Vite hot-reload frontend on :6100 + FastAPI backend on :6101.
#           For developing; changes appear live.
#   PROD  — the BUILT frontend served together with the API from the backend
#           alone on :6101. No Vite, no hot-reload WebSocket — this is what a
#           kiosk/display should point at (the dev server's HMR socket drops
#           over a LAN and makes the page reload ~every minute).
#
# The backend on :6101 is SHARED: dev calls its API, prod also serves the built
# app from it. So 'stop dev' stops only Vite; 'stop prod' stops the backend.
#
# Usage:  ./opensign.sh <command> [dev|prod]
#   start dev | start prod | stop dev | stop prod | status | build |
#   restart dev|prod | log | help
#
# SAFETY (process kills are destructive — kill NARROW, never broad):
#   every stop targets ONLY the PID LISTENING on a hard-coded port (6100/6101)
#   via `lsof -sTCP:LISTEN`, validates it's numeric, and is a no-op when nothing
#   is listening. No wildcard/name match anywhere, so an empty target can never
#   become "kill everything."

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT=6100      # Vite dev server (DEV only)
BACKEND_PORT=6101       # FastAPI: API always; also serves the built app in PROD
FRONTEND_DIR="$DIR/frontend"
BACKEND_LOG="$DIR/backend.log"
FRONTEND_LOG="$DIR/frontend.log"
VENV_PYTHON="$DIR/backend/.venv/bin/python"

# --- narrow helpers ----------------------------------------------------------

# PIDs LISTENING on an exact port (empty if none). Never broad, never by name.
listeners() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; }

# Stop whatever listens on ONE hard-coded port. 0 if it killed something, 1 if
# nothing was listening. Blank target => no-op (the return 1).
kill_port() {
  local port="$1" label="$2" pids pid
  pids="$(listeners "$port")"
  [ -z "$pids" ] && return 1
  echo "  Stopping $label on $port (pid: $(echo "$pids" | tr '\n' ' ')) ..."
  for pid in $pids; do [[ "$pid" =~ ^[0-9]+$ ]] && kill "$pid" 2>/dev/null || true; done
  sleep 1
  # escalate ONLY against the same narrow port target, if anything survived
  for pid in $(listeners "$port"); do [[ "$pid" =~ ^[0-9]+$ ]] && kill -9 "$pid" 2>/dev/null || true; done
  return 0
}

# Launch the backend headless if it isn't already up. Does not wait.
_start_backend() {
  if [ -n "$(listeners "$BACKEND_PORT")" ]; then echo "  Backend already running on $BACKEND_PORT."; return; fi
  echo "  Starting backend (uvicorn) on $BACKEND_PORT ..."
  ( cd "$DIR" && nohup "$VENV_PYTHON" -m uvicorn app.main:app \
      --host 0.0.0.0 --port "$BACKEND_PORT" --app-dir backend > "$BACKEND_LOG" 2>&1 & )
}

# Launch the Vite dev server headless if it isn't already up. Does not wait.
_start_vite() {
  if [ -n "$(listeners "$FRONTEND_PORT")" ]; then echo "  Vite dev server already running on $FRONTEND_PORT."; return; fi
  echo "  Starting frontend (Vite) on $FRONTEND_PORT ..."
  ( cd "$FRONTEND_DIR" && nohup npm run dev > "$FRONTEND_LOG" 2>&1 & )
}

# Wait up to ~40s for a port to start listening. Returns 0 if it came up.
_wait_port() {
  local n=0
  while [ -z "$(listeners "$1")" ] && [ "$n" -lt 40 ]; do sleep 1; n=$((n + 1)); done
  [ -n "$(listeners "$1")" ]
}

# Best-effort LAN IPv4, for a kiosk URL other machines can reach (empty if none).
lan_ip() {
  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' \
      | xargs -I{} ipconfig getifaddr {} 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(ifconfig 2>/dev/null | awk '/inet /{if($2!="127.0.0.1"){print $2; exit}}')"
  echo "$ip"
}

# Is the backend up AND serving the built SPA (not just the API)?
backend_serving_built() {
  [ -n "$(listeners "$BACKEND_PORT")" ] \
    && curl -sf "http://localhost:$BACKEND_PORT/" 2>/dev/null | grep -q 'id="root"'
}

# --- build -------------------------------------------------------------------

cmd_build() {
  echo "  Building the production frontend (npm run build) ..."
  ( cd "$FRONTEND_DIR" && npm run build ) || return 1
  echo "  [OK] Built to frontend/dist/"
}

# --- start dev / start prod --------------------------------------------------

start_dev() {
  if [ ! -x "$VENV_PYTHON" ]; then
    echo "  [X] backend venv not found — run ./setup.sh first."; return 1
  fi
  _start_backend
  _start_vite
  echo "  Waiting for servers ..."
  _wait_port "$BACKEND_PORT" >/dev/null || true
  _wait_port "$FRONTEND_PORT" >/dev/null || true
  echo
  if [ -n "$(listeners "$FRONTEND_PORT")" ] && [ -n "$(listeners "$BACKEND_PORT")" ]; then
    echo "  DEV is up (Vite hot-reload)."
    echo "    Kiosk:  http://localhost:$FRONTEND_PORT/"
    echo "    Admin:  http://localhost:$FRONTEND_PORT/admin"
    echo "    Logs:   ./opensign.sh log"
    echo
    echo "  For a real display, run PROD instead:  ./opensign.sh start prod"
  else
    echo "  [X] servers did not both come up — see ./opensign.sh log"
    return 1
  fi
}

start_prod() {
  if [ ! -x "$VENV_PYTHON" ]; then
    echo "  [X] backend venv not found — run ./setup.sh first."; return 1
  fi
  cmd_build || { echo "  [X] build failed — leaving any running server untouched."; return 1; }
  echo
  # Non-disruptive: if the backend is already serving the built app, a rebuild is
  # picked up live (files are read per request), so don't restart and blip the
  # display; only (re)start when it isn't already serving dist.
  if backend_serving_built; then
    echo "  Backend already serving on $BACKEND_PORT — picked up the fresh build live (no restart)."
  else
    kill_port "$BACKEND_PORT" "backend" >/dev/null 2>&1 || true
    _start_backend
    _wait_port "$BACKEND_PORT" >/dev/null \
      || { echo "  [X] backend did not come up on $BACKEND_PORT — see backend.log"; return 1; }
  fi
  local ip; ip="$(lan_ip)"
  echo
  echo "  PROD is up — built app + API from the backend alone on $BACKEND_PORT (no Vite, no HMR)."
  echo "    Local:  http://localhost:$BACKEND_PORT/   (admin: /admin)"
  [ -n "$ip" ] && echo "    LAN  :  http://$ip:$BACKEND_PORT/          <- point the kiosk display here"
  echo
  echo "  Re-run './opensign.sh start prod' after frontend changes to rebuild + refresh."
}

cmd_start() {
  case "${1:-}" in
    dev)             start_dev ;;
    prod|production) start_prod ;;
    "")              usage ;;
    *) echo "  Unknown: 'start ${1}'. Use 'start dev' or 'start prod'."; return 1 ;;
  esac
}

# --- stop dev / stop prod ----------------------------------------------------

stop_dev() {
  if kill_port "$FRONTEND_PORT" "dev server (Vite)"; then
    echo "  Dev server stopped."
  else
    echo "  Dev server (Vite :$FRONTEND_PORT) is not running."
  fi
  if [ -n "$(listeners "$BACKEND_PORT")" ]; then
    echo "  (Backend :$BACKEND_PORT left up — it also serves PROD/the kiosk. 'stop prod' stops it.)"
  fi
}

stop_prod() {
  if kill_port "$BACKEND_PORT" "backend (prod)"; then
    echo "  Prod backend stopped."
  else
    echo "  Backend (:$BACKEND_PORT) is not running."
  fi
  if [ -n "$(listeners "$FRONTEND_PORT")" ]; then
    echo "  (Dev server :$FRONTEND_PORT still running. 'stop dev' stops it.)"
  fi
}

cmd_stop() {
  case "${1:-}" in
    dev)             stop_dev ;;
    prod|production) stop_prod ;;
    "")              cmd_status; usage ;;
    *) echo "  Unknown: 'stop ${1}'. Use 'stop dev' or 'stop prod'."; return 1 ;;
  esac
}

# --- status ------------------------------------------------------------------

cmd_status() {
  local vite back mode
  vite="$(listeners "$FRONTEND_PORT")"
  back="$(listeners "$BACKEND_PORT")"
  echo
  echo "  OpenSign"
  echo "  ========"
  if [ -n "$vite" ]; then
    echo "  DEV  frontend (Vite) :$FRONTEND_PORT   RUNNING (pid: $(echo "$vite" | tr '\n' ' '))"
  else
    echo "  DEV  frontend (Vite) :$FRONTEND_PORT   stopped"
  fi
  if [ -n "$back" ]; then
    if backend_serving_built; then mode="serving the built app (PROD)"; else mode="API only (dev)"; fi
    echo "  backend / API        :$BACKEND_PORT   RUNNING (pid: $(echo "$back" | tr '\n' ' ')) — $mode"
  else
    echo "  backend / API        :$BACKEND_PORT   stopped"
  fi
  echo
  [ -n "$vite" ] && echo "    Dev  view:  http://localhost:$FRONTEND_PORT/"
  if [ -n "$back" ]; then
    local ip; ip="$(lan_ip)"
    echo "    Prod view:  http://localhost:$BACKEND_PORT/   (kiosk: http://${ip:-<lan-ip>}:$BACKEND_PORT/)"
  fi
  echo
}

# --- restart -----------------------------------------------------------------

cmd_restart() {
  case "${1:-}" in
    dev)             stop_dev; sleep 1; echo; start_dev ;;
    prod|production) stop_prod; sleep 1; echo; start_prod ;;
    "")   echo "  Usage: restart dev | restart prod"; return 1 ;;
    *) echo "  Unknown: 'restart ${1}'. Use 'restart dev' or 'restart prod'."; return 1 ;;
  esac
}

# --- log ---------------------------------------------------------------------

cmd_log() {
  if [ ! -f "$BACKEND_LOG" ] && [ ! -f "$FRONTEND_LOG" ]; then
    echo "  No logs yet. Start a server first (e.g. ./opensign.sh start dev)."
    return 1
  fi
  echo "  Following backend.log + frontend.log. Ctrl-C to stop."
  echo "  ================================================"
  tail -n 20 -F "$BACKEND_LOG" "$FRONTEND_LOG" 2>/dev/null
}

# --- usage -------------------------------------------------------------------

usage() {
  cat <<EOF

  OpenSign — server manager (macOS / Linux)
  =========================================

  Usage:  ./opensign.sh <command> [dev|prod]

  DEVELOPMENT  (Vite hot-reload :$FRONTEND_PORT + API :$BACKEND_PORT):
    start dev        start the dev servers
    stop dev         stop the Vite dev server (leaves the backend up)

  PRODUCTION  (what a kiosk/display runs — built app + API on :$BACKEND_PORT, no HMR):
    start prod       build, then serve the built app + API on :$BACKEND_PORT
    stop prod        stop the backend / prod server

  EITHER:
    status           what's running, plus the URLs
    build            build the frontend without starting anything
    restart dev|prod stop then start that mode
    log              follow the logs live (Ctrl-C)
    help             this help

  A display should point at the PROD LAN URL (:$BACKEND_PORT), never the Vite dev
  server (:$FRONTEND_PORT): the dev server's hot-reload socket drops over a LAN and
  forces the page to reload ~every minute. The built app has no such socket.
EOF
}

# --- dispatch ----------------------------------------------------------------

case "${1:-help}" in
  start)            cmd_start "${2:-}" ;;
  stop)             cmd_stop "${2:-}" ;;
  restart)          cmd_restart "${2:-}" ;;
  status)           cmd_status ;;
  build)            cmd_build ;;
  serve|prod)       start_prod ;;   # back-compat alias for 'start prod'
  log|logs)         cmd_log ;;
  help|--help|-h)   usage ;;
  *) echo "  Unknown command: '${1}'."; usage; exit 1 ;;
esac
