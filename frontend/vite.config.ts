import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// OpenSign dev server. Pinned to 6100 (Bobnet port registry); backend on 6101.
// NOT 6000 — that's the X11 port, which browsers hard-block as ERR_UNSAFE_PORT.
// In production the FastAPI backend serves the built `dist/` on a single port —
// this proxy only matters during `npm run dev`.
// https://vite.dev/config/
export default defineConfig({
  // Some file-sync tools (Dropbox, OneDrive, …) race Vite's rapid dep-cache
  // rename and throw EBUSY/EPERM. Park the cache OUTSIDE any synced folder — it's
  // regenerable, so losing it only costs a rebuild, never data. LOCALAPPDATA (or
  // the OS temp dir) is a safe, machine-portable spot.
  cacheDir: join(process.env.LOCALAPPDATA ?? tmpdir(), 'opensign-vite-cache'),
  plugins: [react()],
  server: {
    // Bind to all interfaces so /admin and the kiosk are reachable from other
    // devices on the LAN (e.g. http://<hostname>:6100), like the backend already
    // is. allowedHosts: true lets a LAN hostname through Vite's DNS-rebinding
    // host check (fine for a trusted-LAN dev tool).
    host: true,
    allowedHosts: true,
    port: 6100,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:6101',
    },
  },
})
