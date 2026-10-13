import './style.css';
import * as frequencyPage from './pages/frequency/index.js';
import * as motionScorePage from './pages/motion-score/index.js';
import * as controllerPage from './pages/motion-score/controller.js';

// Hash routing (#/frequency) works on GitHub Pages sub-paths without any
// server-side rewrite rules, so every page can be opened directly.
const routes = {
  '/frequency': frequencyPage,
  '/motion-score': motionScorePage,
  // Phone companion page, reached through the pairing link / QR code.
  '/controller': controllerPage,
};
// Old link from the previous Project 2.
const aliases = { '/air-canvas': '/motion-score' };

const outlet = document.getElementById('app');
let current = null;

function route() {
  const raw = location.hash.replace(/^#/, '') || '/frequency';
  const q = raw.indexOf('?');
  let path = q >= 0 ? raw.slice(0, q) : raw;
  const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
  path = aliases[path] || path;
  if (!routes[path]) path = '/frequency';

  // Each page owns its own audio engine and connections; unmount stops and
  // releases them before the next page mounts.
  if (current) {
    current.unmount();
    current = null;
  }
  outlet.replaceChildren();
  window.scrollTo(0, 0);
  // The phone controller is a standalone page without the desktop navigation.
  document.body.classList.toggle('controller-page', path === '/controller');
  current = routes[path].mount(outlet, params);

  for (const a of document.querySelectorAll('.app-nav a')) {
    const active = a.dataset.route === path;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', route);
route();
