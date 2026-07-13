# Deploying OpenSign

OpenSign is **local-first**: one always-on **server** on your network runs it, and
each **display** is just a browser pointed at that server. Nothing leaves the
building.

## The shape of a deployment

```
  ┌── server (always on) ──┐         ┌──── display box ────┐
  │  opensign start        │   LAN   │  browser, fullscreen │
  │  serves on :6100       │◄───────►│  http://SERVER:6100/ │
  └────────────────────────┘         └──────────────────────┘
        one server                      any number of screens
```

- **Server** — one machine on the LAN runs OpenSign. It builds and serves the app
  **and** the API on **port 6100**. It doesn't need a screen of its own.
- **Display(s)** — any number of screens, each a browser in fullscreen/kiosk mode
  pointed at the server. Configure them all from the **admin** page, from any device.

## Server setup

1. Install prerequisites and set up once (see the [README](README.md)): Node 20+,
   Python 3.10+.
2. Start it: `./opensign.sh start` (macOS/Linux) or `opensign.bat start` (Windows).
   It prints the LAN URL to use.
3. Keep the server **always on** and on a **stable address** — a static IP or a
   reserved DHCP lease — because every display points at it by address.
4. Kiosk: `http://<server-ip>:6100/`  ·  Admin: `http://<server-ip>:6100/admin`

## Display box setup — the checklist

Each screen is a dedicated mini-PC (or similar) running a browser fullscreen on the
kiosk URL. For a display that has to sit there for weeks and just work:

- [ ] **Point the browser at the server's kiosk URL** (`http://<server-ip>:6100/`),
      fullscreen / kiosk mode. Always the server on 6100 — never a dev server.
- [ ] **Auto-start the browser to that URL on boot**, fullscreen — so the screen
      comes back on its own after a reboot or power blip.
- [ ] **Reboot the display nightly.** **(Required.)** A display box left up for many
      days accumulates driver / network-stack cruft — most visibly a **WiFi adapter
      that starts dropping the connection when idle** (the sign blanks, then recovers
      when something wakes the link). A scheduled nightly reboot clears it before it
      can fail during the day.
      - Windows: Task Scheduler → daily `shutdown /r /t 0` at ~4:00am.
      - Linux: a root cron entry, e.g. `0 4 * * * /sbin/reboot`.
- [ ] **Disable sleep / power-saving** — display, disk, and especially the **network
      adapter**. A dozing screen or NIC looks like a broken sign.
      - Windows: High-Performance power plan; Device Manager → the network adapter →
        Power Management → uncheck "Allow the computer to turn off this device to
        save power." On WiFi, also set Wireless Adapter → Maximum Performance.
- [ ] **Prefer a wired connection.** WiFi is the usual source of "the sign went
      blank" flakiness; a cable sidesteps it. If WiFi is unavoidable, the nightly
      reboot + disabled adapter power-saving are the safety net — and a cheap USB
      WiFi dongle can replace a flaky built-in adapter.

## Notes

- **The server is not the display.** The machine running OpenSign doesn't need a
  screen — the displays are separate browsers on the LAN. One server, many screens.
- **Updating:** after changing OpenSign, re-run `start` (or `build`) on the server;
  displays pick it up on their next load — no need to touch each screen.
- **Config lives on the server** (`data/config.json`) — back it up with the project.
  Changes made in admin apply to every display within ~5 seconds.
- **Troubleshooting "can't be reached" on one display but not others:** that's a
  network/reachability issue on that display (usually WiFi power-saving or a
  degrading adapter), not the OpenSign server. See the nightly-reboot item above.
