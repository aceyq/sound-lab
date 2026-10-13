// Tiny element builder: h('div', { class: 'x', onclick: fn }, child, ...)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// Number formatting helpers shared by the pages.
export function fmtHz(f) {
  if (!Number.isFinite(f)) return '—';
  const r = Math.round(f * 100) / 100;
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' Hz';
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '—';
  if (sec >= 1) return trim(sec, 3) + ' s';
  return trim(sec * 1000, sec * 1000 < 10 ? 3 : 2) + ' ms';
}

function trim(v, digits) {
  return Number(v.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });
}
