import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
// so built asset URLs need that sub-path. Set BASE_PATH at build time
// (e.g. BASE_PATH=/my-repo/ npm run build). Locally it defaults to "/".
// The included GitHub Actions workflow fills it in from the repository name.
const raw = process.env.BASE_PATH || '/';
const base = raw.endsWith('/') ? raw : raw + '/';

// `npm run dev:phone` serves over HTTPS with a self-signed certificate so a
// phone on the same Wi-Fi can open the controller page (phone browsers only
// allow motion sensors on secure pages). The phone will show a certificate
// warning that has to be accepted once. Hot reload is off in this mode so a
// failed live-reload connection can never reload the page mid-performance.
export default defineConfig(({ mode }) => ({
  base,
  plugins: mode === 'phone' ? [basicSsl()] : [],
  server: mode === 'phone' ? { host: true, port: 5174, hmr: false } : { host: true, port: 5173 },
  preview: { port: 4173 },
}));
