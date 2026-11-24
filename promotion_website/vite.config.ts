import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Same Windows/esbuild workaround the app build uses: node 22+ can hit
// EPERM/Access-Denied unlinking files from the system AppData\Local\Temp, so
// point TEMP at a directory inside this project before Vite touches esbuild.
if (process.platform === 'win32') {
  const localTmp = path.resolve(process.cwd(), '.tmp-build');
  if (!fs.existsSync(localTmp)) fs.mkdirSync(localTmp, { recursive: true });
  process.env.TEMP = localTmp;
  process.env.TMP = localTmp;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Absolute base: the site is BrowserRouter-routed and served at the domain root
  // on Cloudflare Pages, so every deep link (e.g. /privacy) must resolve assets
  // from /assets, not from a path relative to the current route.
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'terser',
    sourcemap: false,
  },
  server: {
    port: 5199,
    allowedHosts: true,
  },
});
