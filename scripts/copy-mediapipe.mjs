// Copies MediaPipe's WebAssembly files from node_modules into public/ so the
// Pose Sound Map loads them from this site (no CDN needed during class).
// Runs automatically before `npm run dev`, `npm run dev:phone` and `npm run build`.
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const from = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const to = new URL('../public/mediapipe/wasm/', import.meta.url);
if (!existsSync(from)) {
  console.error('copy-mediapipe: @mediapipe/tasks-vision is not installed; run npm install.');
  process.exit(1);
}
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('copy-mediapipe: WebAssembly files copied to public/mediapipe/wasm/');
