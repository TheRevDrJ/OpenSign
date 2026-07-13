#!/usr/bin/env bash
#
# OpenSign — server manager (macOS / Linux)
#
# One server, one port. The FastAPI backend on :6100 serves BOTH the built
# frontend (frontend/dist) AND the API — the same artifact in development and on
# the kiosk (dev/prod parity, no separate dev server, no hot-reload socket).
#
#   ./opensign.sh start     build the frontend, then serve it + the API on :6100
#   ./opensign.sh stop      stop the server
#   ./opensign.sh build     rebuild the frontend (after changing frontend code)
#   ./opensign.sh watch     serve + auto-rebuild on save (dev loop; refresh page)
#   ./opensign.sh status    is it running, plus the URLs
#   ./opensign.sh restart   stop, then start
#   ./opensign.sh log       follow the log
#
# Point the kiosk display at the printed LAN URL (http://<lan-ip>:6100/).
#
# SAFETY (process kills are destructive — kill NARROW, never broad): stop targets
# ONLY the PID LISTENING on the hard-coded port 6100 via `lsof -sTCP:LISTEN`,
# validates it's numeric, and is a no-op when nothing is listening. No wildcard
# or name match, so an empty target can never become "kill everything."

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=6100
FRONTEND_DIR="$DIR/frontend"
BACKEND_LOG="$DIR/backend.log"
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
  for pid in $(listeners "$port"); do [[ "$pid" =~ ^[0-9]+$ ]] && kill -9 "$pid" 2>/dev/null || true; done
  return 0
}

_start_backend() {
  if [ -n "$(listeners "$PORT")" ]; then echo "  Server already running on $PORT."; return; fi
  echo "  Starting server (uvicorn) on $PORT ..."
  # < /dev/null so the backgrounded server can't inherit (and hold open) a
  # caller's stdout pipe — otherwise `opensign.sh start | ...` hangs forever.
  ( cd "$DIR" && nohup "$VENV_PYTHON" -m uvicorn app.main:app \
      --host 0.0.0.0 --port "$PORT" --app-dir backend < /dev/null > "$BACKEND_LOG" 2>&1 & )
}

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

# Is the server up AND serving the built SPA (not just the API)?
serving_built() {
  [ -n "$(listeners "$PORT")" ] \
    && curl -sf "http://localhost:$PORT/" 2>/dev/null | grep -q 'id="root"'
}

show_urls() {
  local ip; ip="$(lan_ip)"
  echo "    Local:  http://localhost:$PORT/   (admin: /admin)"
  [ -n "$ip" ] && echo "    LAN  :  http://$ip:$PORT/          <- point the kiosk display here"
}

# --- commands ----------------------------------------------------------------

cmd_build() {
  echo "  Building the frontend (npm run build) ..."
  ( cd "$FRONTEND_DIR" && npm run build ) || return 1
  echo "  [OK] Built to frontend/dist/"
}

cmd_start() {
  if [ ! -x "$VENV_PYTHON" ]; then
    echo "  [X] backend venv not found — run ./setup.sh first."; return 1
  fi
  cmd_build || { echo "  [X] build failed — leaving any running server untouched."; return 1; }
  echo
  # Non-disruptive: if the server is already serving the built app, a rebuild is
  # picked up live (files are read per request), so don't restart and blip the
  # display; only (re)start when it isn't already serving dist.
  if serving_built; then
    echo "  Server already up on $PORT — picked up the fresh build live (no restart)."
  else
    kill_port "$PORT" "server" >/dev/null 2>&1 || true
    _start_backend
    _wait_port "$PORT" >/dev/null \
      || { echo "  [X] server did not come up on $PORT — see backend.log"; return 1; }
  fi
  echo
  echo "  OpenSign is running on $PORT (built app + API, one server)."
  show_urls
  echo
  echo "  Changed frontend code? Re-run './opensign.sh build' (or use 'watch')."
}

cmd_stop() {
  if kill_port "$PORT" "server"; then echo "  Stopped."; else echo "  Nothing running on $PORT."; fi
}

cmd_restart() { cmd_stop; sleep 1; echo; cmd_start; }

cmd_status() {
  local back; back="$(listeners "$PORT")"
  echo
  echo "  OpenSign"
  echo "  ========"
  if [ -n "$back" ]; then
    if serving_built; then
      echo "  server :$PORT   RUNNING (pid: $(echo "$back" | tr '\n' ' ')) — serving the built app"
    else
      echo "  server :$PORT   RUNNING (pid: $(echo "$back" | tr '\n' ' ')) — API only (run 'build')"
    fi
    echo
    show_urls
  else
    echo "  server :$PORT   stopped"
  fi
  echo
}

# Serve + auto-rebuild the frontend on every save (dev loop). Refresh the page to
# see changes. Ctrl-C stops watching; the server keeps running.
cmd_watch() {
  if [ ! -x "$VENV_PYTHON" ]; then echo "  [X] backend venv not found — run ./setup.sh first."; return 1; fi
  cmd_build || return 1
  if ! serving_built; then
    kill_port "$PORT" "server" >/dev/null 2>&1 || true
    _start_backend
    _wait_port "$PORT" >/dev/null || { echo "  [X] server did not come up — see backend.log"; return 1; }
  fi
  echo
  echo "  Watching frontend — edits auto-rebuild. Refresh:  http://localhost:$PORT/"
  echo "  Ctrl-C stops watching (the server keeps running)."
  echo "  ================================================"
  cd "$FRONTEND_DIR"
  exec npx vite build --watch
}

cmd_log() {
  if [ ! -f "$BACKEND_LOG" ]; then echo "  No log yet. Start the server first: ./opensign.sh start"; return 1; fi
  echo "  Following backend.log. Ctrl-C to stop."
  echo "  ================================================"
  tail -n 20 -F "$BACKEND_LOG" 2>/dev/null
}

usage() {
  cat <<EOF

  OpenSign — server manager (macOS / Linux)
  =========================================

  One server on :$PORT serves the built frontend AND the API — the same in
  development and on the kiosk. No separate dev server, no hot-reload socket.

    start     build the frontend, then serve it + the API on :$PORT
    stop      stop the server
    build     rebuild the frontend (after changing frontend code)
    watch     serve + auto-rebuild on save (dev loop — refresh to see changes)
    status    is it running, plus the URLs
    restart   stop, then start
    log       follow the log (Ctrl-C)
    help      this help

  Point a display at the LAN URL (http://<lan-ip>:$PORT/), never localhost on
  another machine.
EOF
}

case "${1:-help}" in
  start|up)        cmd_start ;;
  stop|down|drop)  cmd_stop ;;
  restart)         cmd_restart ;;
  build)           cmd_build ;;
  watch)           cmd_watch ;;
  status)          cmd_status ;;
  log|logs)        cmd_log ;;
  help|--help|-h)  usage ;;
  *) echo "  Unknown command: '${1}'."; usage; exit 1 ;;
esac
