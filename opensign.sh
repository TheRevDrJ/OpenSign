#!/usr/bin/env bash
#
# OpenSign — dev server manager (macOS / Linux)
#
# The cross-platform twin of opensign.bat. OpenSign runs TWO dev servers:
#   Frontend — Vite    :6100  (npm run dev, in ./frontend)
#   Backend  — FastAPI :6101  (uvicorn app.main:app, via ./backend/.venv)
# In production the FastAPI backend serves the built dist/ on a single port;
# this two-server split is dev convenience only.
#
# Usage:  ./opensign.sh [start|stop|restart|status|verbose|log|help]
#
# SAFETY (process kills are destructive — kill NARROW, never broad):
#   `stop` targets ONLY the process LISTENING on a hard-coded port (6100 / 6101)
#   via `lsof -sTCP:LISTEN`, validates each target is a numeric PID, and is a
#   no-op when nothing is listening. There is no wildcard / name / broad match
#   anywhere, so an empty target can never degrade into "kill everything."

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_PORT=6100
BACKEND_PORT=6101
FRONTEND_DIR="$DIR/frontend"
BACKEND_LOG="$DIR/backend.log"
FRONTEND_LOG="$DIR/frontend.log"
VENV_PYTHON="$DIR/backend/.venv/bin/python"
URL="http://localhost:$FRONTEND_PORT"

# --- narrow helpers ----------------------------------------------------------

# PIDs LISTENING on an exact port (empty if none). Never broad, never by name.
listeners() {
  lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true
}

# Stop whatever listens on ONE hard-coded port. Returns 0 if it killed
# something, 1 if nothing was listening. Blank target => no-op (the return 1).
kill_port() {
  local port="$1" label="$2" pids pid
  pids="$(listeners "$port")"
  [ -z "$pids" ] && return 1
  echo "  Stopping $label on $port (pid: $(echo "$pids" | tr '\n' ' ')) ..."
  for pid in $pids; do
    [[ "$pid" =~ ^[0-9]+$ ]] && kill "$pid" 2>/dev/null || true
  done
  sleep 1
  # escalate ONLY against the same narrow port target, if anything survived
  for pid in $(listeners "$port"); do
    [[ "$pid" =~ ^[0-9]+$ ]] && kill -9 "$pid" 2>/dev/null || true
  done
  return 0
}

show_urls() {
  echo "    Kiosk:  $URL/"
  echo "    Admin:  $URL/admin"
}

# Launch the backend headless if it isn't already up. Does not wait.
_start_backend() {
  if [ -n "$(listeners "$BACKEND_PORT")" ]; then
    echo "  Backend  already running on $BACKEND_PORT."
    return
  fi
  echo "  Starting backend  (uvicorn) on $BACKEND_PORT ..."
  ( cd "$DIR" && nohup "$VENV_PYTHON" -m uvicorn app.main:app \
      --host 0.0.0.0 --port "$BACKEND_PORT" --app-dir backend \
      > "$BACKEND_LOG" 2>&1 & )
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

# --- commands ----------------------------------------------------------------

cmd_start() {
  if [ ! -x "$VENV_PYTHON" ]; then
    echo "  [X] backend venv not found at:"
    echo "        $VENV_PYTHON"
    echo "      Run setup first:  ./setup.sh"
    return 1
  fi

  # --- Backend (FastAPI :6101) ---
  _start_backend

  # --- Frontend (Vite :6100) ---
  if [ -n "$(listeners "$FRONTEND_PORT")" ]; then
    echo "  Frontend already running on $FRONTEND_PORT."
  else
    echo "  Starting frontend (Vite) on $FRONTEND_PORT ..."
    ( cd "$FRONTEND_DIR" && nohup npm run dev > "$FRONTEND_LOG" 2>&1 & )
  fi

  # --- Wait for both ports to come up ---
  echo "  Waiting for servers ..."
  local n=0
  while { [ -z "$(listeners "$BACKEND_PORT")" ] || [ -z "$(listeners "$FRONTEND_PORT")" ]; } \
        && [ "$n" -lt 40 ]; do
    sleep 1; n=$((n + 1))
  done

  local back front
  back="$(listeners "$BACKEND_PORT")"
  front="$(listeners "$FRONTEND_PORT")"
  echo
  if [ -n "$back" ] && [ -n "$front" ]; then
    echo "  OpenSign is running (both servers up in ${n}s)."
    show_urls
    echo "    Logs:  backend.log / frontend.log   (or:  ./opensign.sh log)"
    echo
    echo "  Leave them running; they survive closing this terminal."
    echo "  Use './opensign.sh stop' to shut down."
  else
    echo "  Servers did not both come up within ${n}s."
    [ -z "$back" ]  && echo "    - backend  :$BACKEND_PORT not listening — see backend.log"
    [ -z "$front" ] && echo "    - frontend :$FRONTEND_PORT not listening — see frontend.log"
    echo "  Try './opensign.sh verbose' to watch backend errors live."
    return 1
  fi
}

cmd_stop() {
  local hit=1
  kill_port "$FRONTEND_PORT" "frontend" && hit=0
  kill_port "$BACKEND_PORT"  "backend"  && hit=0
  if [ "$hit" -eq 0 ]; then
    echo "  Stopped."
  else
    echo "  Nothing running on $FRONTEND_PORT or $BACKEND_PORT."
  fi
}

cmd_restart() { cmd_stop; sleep 1; echo; cmd_start; }

# Build the production frontend bundle into frontend/dist/.
cmd_build() {
  echo "  Building the production frontend (npm run build) ..."
  ( cd "$FRONTEND_DIR" && npm run build ) || return 1
  echo "  [OK] Built to frontend/dist/"
}

# PRODUCTION mode. Build the frontend, then serve it AND the API from the backend
# alone on one port — no Vite dev server, so there is no hot-reload WebSocket for
# a kiosk to drop and auto-refresh on. This is how a display machine should run.
# Non-disruptive: if the backend is already serving the built app, a rebuild is
# picked up live (files are read per-request), so we don't restart and blip the
# display; we only (re)start when the backend isn't already serving dist.
cmd_serve() {
  if [ ! -x "$VENV_PYTHON" ]; then
    echo "  [X] backend venv not found — run ./setup.sh first."
    return 1
  fi
  cmd_build || { echo "  [X] build failed — leaving the running server untouched."; return 1; }
  echo

  # Is a backend already up AND actually serving the built SPA (not just the API)?
  local serving_dist=0
  if [ -n "$(listeners "$BACKEND_PORT")" ] \
     && curl -sf "http://localhost:$BACKEND_PORT/" 2>/dev/null | grep -q 'id="root"'; then
    serving_dist=1
  fi

  if [ "$serving_dist" -eq 1 ]; then
    echo "  Backend already serving on $BACKEND_PORT — picked up the fresh build live (no restart)."
  else
    # Either it's down, or it started before dist/ existed (SPA mount inactive).
    # Restart so the built app is mounted and served.
    kill_port "$BACKEND_PORT" "backend" >/dev/null 2>&1 || true
    _start_backend
    if ! _wait_port "$BACKEND_PORT"; then
      echo "  [X] backend did not come up on $BACKEND_PORT — see backend.log"
      return 1
    fi
  fi

  local ip; ip="$(lan_ip)"
  echo
  echo "  OpenSign is serving the PRODUCTION build on $BACKEND_PORT (no dev server, no HMR)."
  echo "    Local:  http://localhost:$BACKEND_PORT/   (admin: /admin)"
  [ -n "$ip" ] && echo "    LAN  :  http://$ip:$BACKEND_PORT/          <- point the kiosk display here"
  echo
  echo "  The :$FRONTEND_PORT Vite dev server is only for development — the kiosk does NOT need it."
  echo "  After changing frontend code, re-run './opensign.sh serve' to rebuild + refresh."
}

cmd_status() {
  local back front
  back="$(listeners "$BACKEND_PORT")"
  front="$(listeners "$FRONTEND_PORT")"
  echo
  echo "  OpenSign dev servers"
  echo "  ===================="
  if [ -n "$back" ];  then echo "  Backend  :$BACKEND_PORT   RUNNING (pid: $(echo "$back"  | tr '\n' ' '))"; else echo "  Backend  :$BACKEND_PORT   stopped"; fi
  if [ -n "$front" ]; then echo "  Frontend :$FRONTEND_PORT   RUNNING (pid: $(echo "$front" | tr '\n' ' '))"; else echo "  Frontend :$FRONTEND_PORT   stopped"; fi
  echo
  show_urls
  echo
}

# Backend in the FOREGROUND with live output (Ctrl-C to stop); frontend headless.
cmd_verbose() {
  if [ ! -x "$VENV_PYTHON" ]; then
    echo "  [X] backend venv not found — run ./setup.sh first."
    return 1
  fi
  if [ -n "$(listeners "$BACKEND_PORT")" ]; then
    echo "  Backend already running on $BACKEND_PORT — './opensign.sh stop' it first."
    return 1
  fi
  if [ -z "$(listeners "$FRONTEND_PORT")" ]; then
    echo "  Starting frontend (Vite) on $FRONTEND_PORT headless ..."
    ( cd "$FRONTEND_DIR" && nohup npm run dev > "$FRONTEND_LOG" 2>&1 & )
  fi
  echo
  echo "  Backend on $BACKEND_PORT — live logs below. Ctrl-C to stop."
  echo "  ================================================"
  echo
  cd "$DIR"
  exec "$VENV_PYTHON" -m uvicorn app.main:app \
    --host 0.0.0.0 --port "$BACKEND_PORT" --app-dir backend
}

cmd_log() {
  if [ ! -f "$BACKEND_LOG" ] && [ ! -f "$FRONTEND_LOG" ]; then
    echo "  No logs yet. Start the servers first with './opensign.sh start'."
    return 1
  fi
  echo "  Following backend.log + frontend.log. Ctrl-C to stop."
  echo "  ================================================"
  # -F: keep following even as the files are rotated/created
  tail -n 20 -F "$BACKEND_LOG" "$FRONTEND_LOG" 2>/dev/null
}

cmd_help() {
  cat <<EOF

  OpenSign — dev server manager (macOS / Linux)
  =============================================

  Usage:  ./opensign.sh [command]

  DEVELOPMENT (Vite hot-reload on $FRONTEND_PORT + API on $BACKEND_PORT):
    start     Start both dev servers in the background
    stop      Stop both (only ever touches those two ports)
    restart   Stop, then start
    status    Show whether each server is running
    verbose   Run backend in the foreground with live logs (Ctrl-C); frontend stays headless
    log       Follow both server logs live (Ctrl-C)

  PRODUCTION (what a kiosk/display should run — single port, no hot-reload socket):
    build     Build the production frontend into frontend/dist/
    serve     Build, then serve the app + API from the backend alone on $BACKEND_PORT

    help      This help

  Aliases:  up = start      down, drop = stop      prod = serve

    Dev kiosk:  $URL/          (admin: $URL/admin)

  Dev servers run in the background and survive closing this terminal. After a
  sleep drops them, just run:  ./opensign.sh start

  A DISPLAY MACHINE should point at the 'serve' URL ($BACKEND_PORT), NOT the Vite
  dev server ($FRONTEND_PORT): the dev server's hot-reload socket can drop over a
  LAN and force the page to reload every minute or so. The built app has no such
  socket.
EOF
}

case "${1:-help}" in
  start|up)         cmd_start ;;
  stop|down|drop)   cmd_stop ;;
  restart)          cmd_restart ;;
  status)           cmd_status ;;
  verbose)          cmd_verbose ;;
  build)            cmd_build ;;
  serve|prod)       cmd_serve ;;
  log|logs)         cmd_log ;;
  help|--help|-h)   cmd_help ;;
  *) echo "Unknown command: ${1:-}"; cmd_help; exit 1 ;;
esac
