// Spotlight tour: dims the page, cuts a bright "hole" around one control,
// and shows a small card next to it with what it is and what to try.
// The highlighted control stays clickable, so you can try it right away.
// The tour never clicks, plays sound or changes anything by itself.
//
// steps: [{ id, target: () => Element | DOMRect-like | null, title, body, tryIt }]

import { h } from './dom.js';

const PAD = 8;
const GAP = 14;

export class Tour {
  constructor(steps, { label = 'Guide' } = {}) {
    this.steps = steps;
    this.label = label;
    this.i = -1;
    this.hole = h('div', { class: 'tour-hole', 'aria-hidden': 'true' });
    this.shade = h('div', { class: 'tour-shade', 'aria-hidden': 'true' });
    this.count = h('div', { class: 'tour-count' });
    this.title = h('div', { class: 'tour-title' });
    this.body = h('div', { class: 'tour-body' });
    this.tryIt = h('div', { class: 'tour-try' });
    this.back = h('button', { class: 'btn small', onclick: () => this.go(this.i - 1) }, '← Back');
    this.next = h('button', { class: 'btn small primary', onclick: () => this.go(this.i + 1) }, 'Next →');
    this.pop = h('div', { class: 'tour-pop', role: 'dialog', 'aria-label': label },
      this.count, this.title, this.body, this.tryIt,
      h('div', { class: 'tour-buttons' }, this.back, this.next, h('button', { class: 'btn small', onclick: () => this.close() }, 'Close')));
    this.onKey = (e) => {
      if (this.i < 0) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowRight' && e.target === document.body) this.go(this.i + 1);
      else if (e.key === 'ArrowLeft' && e.target === document.body) this.go(this.i - 1);
    };
  }

  get open() {
    return this.i >= 0;
  }

  /** Open at a step index or id. */
  start(at = 0) {
    const idx = typeof at === 'string' ? Math.max(0, this.steps.findIndex((s) => s.id === at)) : at;
    if (!this.pop.isConnected) {
      document.body.append(this.shade, this.hole, this.pop);
      window.addEventListener('keydown', this.onKey);
    }
    this.go(idx);
    const loop = () => {
      if (this.i < 0) return;
      this.place();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  go(i) {
    if (i >= this.steps.length) return this.close();
    this.i = Math.max(0, i);
    const s = this.steps[this.i];
    if (s.before) s.before();
    this.count.textContent = `${this.label} · ${this.i + 1} of ${this.steps.length}`;
    this.title.textContent = s.title;
    this.body.textContent = s.body;
    this.tryIt.textContent = s.tryIt ? `Try it: ${s.tryIt}` : '';
    this.tryIt.hidden = !s.tryIt;
    this.back.disabled = this.i === 0;
    this.next.textContent = this.i === this.steps.length - 1 ? 'Finish' : 'Next →';
    const t = this._target();
    if (t && t.el) t.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.place();
  }

  _target() {
    const s = this.steps[this.i];
    const t = s && s.target && s.target();
    if (!t) return null;
    if (t instanceof Element) {
      const r = t.getBoundingClientRect();
      if (!r.width && !r.height) return null; // hidden
      return { el: t, r };
    }
    return { el: t.scrollEl || null, r: t.rect() };
  }

  /** Keep the hole and the card attached to the target as the page moves. */
  place() {
    const t = this._target();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.min(380, vw - 24);
    this.pop.style.width = `${pw}px`;
    const ph = this.pop.offsetHeight;
    if (!t) {
      this.hole.hidden = true;
      this.shade.hidden = false;
      this.pop.style.left = `${(vw - pw) / 2}px`;
      this.pop.style.top = `${Math.max(12, (vh - ph) / 2)}px`;
      this.pop.dataset.side = 'none';
      return;
    }
    const r = t.r;
    this.shade.hidden = true;
    this.hole.hidden = false;
    Object.assign(this.hole.style, {
      left: `${r.left - PAD}px`, top: `${r.top - PAD}px`,
      width: `${r.width + 2 * PAD}px`, height: `${r.height + 2 * PAD}px`,
    });
    // Prefer the right side, then below, then above, then left.
    let left;
    let top;
    let side;
    if (r.right + PAD + GAP + pw < vw - 8) {
      side = 'right';
      left = r.right + PAD + GAP;
      top = Math.min(Math.max(12, r.top), vh - ph - 12);
    } else if (r.bottom + PAD + GAP + ph < vh - 8) {
      side = 'below';
      top = r.bottom + PAD + GAP;
      left = Math.min(Math.max(12, r.left), vw - pw - 12);
    } else if (r.top - PAD - GAP - ph > 8) {
      side = 'above';
      top = r.top - PAD - GAP - ph;
      left = Math.min(Math.max(12, r.left), vw - pw - 12);
    } else if (r.left - PAD - GAP - pw > 8) {
      side = 'left';
      left = r.left - PAD - GAP - pw;
      top = Math.min(Math.max(12, r.top), vh - ph - 12);
    } else {
      side = 'inside';
      left = vw - pw - 16;
      top = vh - ph - 16;
    }
    this.pop.style.left = `${left}px`;
    this.pop.style.top = `${top}px`;
    this.pop.dataset.side = side;
  }

  close() {
    this.i = -1;
    cancelAnimationFrame(this.raf);
    this.hole.remove();
    this.shade.remove();
    this.pop.remove();
    window.removeEventListener('keydown', this.onKey);
  }
}
