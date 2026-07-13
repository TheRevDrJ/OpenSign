import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// OPTIONAL dev server. The normal way OpenSign runs is a single server: the
// FastAPI backend on 6100 serves the built `dist/` AND the API (see opensign.sh).
// This config only matters if you explicitly run `npm run dev` for hot-reload —
// it puts Vite on 6101 and proxies /api to the managed backend on 6100.
// (NOT 6000 — the X11 port, which browsers hard-block as ERR_UNSAFE_PORT.)
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
    port: 6101,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:6100',
    },
  },
})
