import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Vite config: the production build (plus one build-time CSS guard, below) and
// the OPTIONAL dev server. The normal way OpenSign runs is a single server: the
// FastAPI backend on 6100 serves the built `dist/` AND the API (see opensign.sh).
// This config only matters if you explicitly run `npm run dev` for hot-reload —
// it puts Vite on 6101 and proxies /api to the managed backend on 6100.
// (NOT 6000 — the X11 port, which browsers hard-block as ERR_UNSAFE_PORT.)
// https://vite.dev/config/

// Build guard: fail the build if a built stylesheet ships -webkit-backdrop-filter
// without the standard backdrop-filter beside it. The minifier (Lightning CSS)
// collapses the pair to whichever one the source writes LAST, and Chromium ignores
// the -webkit- spelling, so a standard-first rule builds cleanly and ships frosted
// glass with NO blur in Chrome/Opera while Safari still frosts. Checks the built
// output, not the source, because the output is what the kiosk actually gets.
// ⚠ Runs in writeBundle (dist already written), NOT generateBundle: Vite empties
// dist/ before generateBundle, so failing there leaves the live server on :6100
// serving nothing. Failing here keeps a complete dist and still fails the build.
function requireStandardBackdropFilter(): Plugin {
  return {
    name: 'opensign:require-standard-backdrop-filter',
    apply: 'build',
    enforce: 'post',
    writeBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue
        const css = String(file.source)
        const prefixed = css.match(/-webkit-backdrop-filter\s*:/g)?.length ?? 0
        const standard = css.match(/(?<![\w-])backdrop-filter\s*:/g)?.length ?? 0
        if (standard < prefixed) {
          this.error(
            `${file.fileName}: ${prefixed} -webkit-backdrop-filter but only ` +
              `${standard} standard backdrop-filter, so Chromium would get no blur. ` +
              'Write the standard property LAST in the source rule.',
          )
        }
      }
    },
  }
}

export default defineConfig({
  // Some file-sync tools (Dropbox, OneDrive, …) race Vite's rapid dep-cache
  // rename and throw EBUSY/EPERM. Park the cache OUTSIDE any synced folder — it's
  // regenerable, so losing it only costs a rebuild, never data. LOCALAPPDATA (or
  // the OS temp dir) is a safe, machine-portable spot.
  cacheDir: join(process.env.LOCALAPPDATA ?? tmpdir(), 'opensign-vite-cache'),
  plugins: [react(), requireStandardBackdropFilter()],
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
