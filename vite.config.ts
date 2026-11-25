import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local lobby service (npm run server).
const proxy = { '/api': 'http://localhost:8787' };
// Public tunnels (cloudflared quick tunnels) for remote multiplayer testing.
const allowedHosts = ['.trycloudflare.com'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
    allowedHosts,
    fs: {
      // Never serve keys or build artefacts from the dev server, even if exposed.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.keys/**', '**/target/**', '**/*keypair*.json', '**/authority.json'],
    },
  },
  // `vite preview` serves only dist/: the one to put behind a public tunnel.
  preview: {
    port: 4173,
    proxy,
    allowedHosts,
  },
});
