# Changelog

Released versions of OpenSign. Each entry covers a minor or major release; smaller
fixes fold into the next one.

## 1.6.0 — 2026-09-23 · A bug tracker and a workshop

For the people building OpenSign: somewhere to keep bugs and requests, and a place
to read them.

- **Tracker bench** for a private `docs/bugs.json` kept alongside the code (it is not part
  of the repository).
- **Workshop:** `node tools/serve.mjs` serves a read-only launcher at
  <http://localhost:6102/> and the tracker bench at `/workshop/bugs.html`.

## 1.5.0 — 2026-09-23 · Even spacing for widgets

Stacked widgets now look evenly spaced, whatever their sizes.

- **Grid | Even spacing** on the Widgets tab. With Even spacing on, widgets that
  share a column on a portrait screen (or a row on a landscape one) keep the first
  and last against the edges and get equal gaps between them. Spacing is measured
  from each widget's real size, so it adjusts when the verse changes length.
- Grid keeps the snap-point placement exactly as before.

## 1.4.0 — 2026-09-23 · The verse fits its card, and the church can skip one

The verse card now keeps a steady size on every screen, and a church can take out
any verse it doesn't want shown.

- **Fixed-size verse card**: each S/M/L/XL has a maximum size. Long verses shrink
  to fit and short ones stay at full size, so the card never pushes into its
  neighbours.
- **One length rule for every version**: a verse too long for the card, in
  whatever version is showing, is skipped for the next verse in that same version.
- **Skip this verse** in admin shows today's verse and removes it from the list for
  good; every display moves on within seconds. **Restore skipped** puts them back.
- A larger curated list (710 verses), with verses that don't stand alone on a
  lobby screen left out, and "Selah" dropped from verse text.
- Admin: an (i) on the API.Bible key explains where to get one; the key buttons sit
  on one line.

## 1.3.0 — 2026-09-23 · Verse of the day, in the church's own translation

A daily scripture widget that shows the same verse on every screen, in a
translation the church chooses.

- **Verse of the day widget**: a curated set of 499 well-loved verses (selection
  from OpenBible.info, CC BY 4.0), one per day, rolling over at midnight on the
  chosen clock. The Berean Standard Bible is built in and works offline.
- **Other translations through API.Bible**: paste the church's own free key into
  Admin → Widgets → Verse, then pick a language (English, Spanish, Korean) and a
  translation. The server fetches each day's verse and deletes cached verses after
  30 days; the widget falls back to BSB if the key or the internet is missing.
- **Reload displays** button in admin: every connected screen reloads itself within
  a few seconds. Displays also reload on their own after the server restarts.
- **Frosted glass now blurs in Chrome, Edge and Opera.** The build had been
  dropping the standard `backdrop-filter`, so only Safari-based displays frosted.
  A build check now fails if that happens again.
- Glass sizing scales with the screen (vmin), and the verse card stays on screen at XL.

## 1.2.0 — 2026-07-12 · Displays stay in step

Several screens showing the same content now agree with each other.

- Slideshows advance on the server's clock, so every display shows the same image
  at the same moment.
- A clock-source setting (default: server) makes the clock, calendar and countdown
  show the server's time on every display, whatever each box's own clock says.
- One server on port 6100 serves both the app and the API (the short-lived split
  into separate dev and production servers was removed).
- DEPLOYMENT.md: the checklist for putting OpenSign on a display, including the
  required nightly reboot.
- 1.2.1 (2026-07-13): the server-time clock now shows the server's timezone, not
  each display's.

## 1.1.0 — 2026-07-08 · Runs on macOS as well as Windows

Clone, run `setup.sh`, then `opensign.sh start`.

- macOS/Linux setup and server scripts, twins of the Windows ones.
- Native file and folder pickers on macOS.
- Images load on macOS (Unix paths were mistaken for web addresses).
- Countdown and Giving (QR) widgets, per-widget sizes, admin tabs, Keep Display
  Awake, and the HonedEdge / Eggshell / Seafoam themes.

## 1.0.0 — 2026-06-25 · First public release

Text and Images (single or slideshow) modes, clock and calendar widgets on a snap
grid, and a browser admin page that applies changes as you make them.
