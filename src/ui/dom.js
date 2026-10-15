/**
 * Mini-utilitaire de création d'éléments DOM (pas de framework).
 * h('div.class#id', {attrs, on:{click}}, ...children)
 */
export function h(tag, props = {}, ...children) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] ?? '').match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function setChildren(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Icônes SVG originales (traits simples, 24×24). */
const ICONS = {
  select: 'M5 3l13 8-6 1.5L9 19z',
  road: 'M8 2l-3 20M16 2l3 20M12 4v3M12 10v3M12 16v3',
  zone: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  energy: 'M13 2L4 14h7l-1 8 9-12h-7z',
  water: 'M12 2c4 6 6 9 6 12a6 6 0 01-12 0c0-3 2-6 6-12z',
  services: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6',
  parks: 'M12 2a6 6 0 00-4 10.5A5 5 0 0012 20a5 5 0 004-7.5A6 6 0 0012 2zM12 14v8',
  logistics: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  demolish: 'M4 20h16M7 20l2-9h6l2 9M9 7l3-4 3 4',
  terrain: 'M2 20l6-9 4 5 3-4 7 8zM8 11l2-3 2 3',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  school: 'M2 9l10-5 10 5-10 5zM6 11v5c3 3 9 3 12 0v-5M22 9v6',
  shield: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5zM9 12l2 2 4-4',
  move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  check: 'M4 12l5 5L20 6',
  finance: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  city: 'M3 21V9l6-3v15M9 21V3l8 4v14M17 21v-9l4 2v7M2 21h20',
  ai: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6zM10 10h4v4h-4z',
  policy: 'M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7',
  help: 'M12 21a9 9 0 110-18 9 9 0 010 18zM9.5 9a2.5 2.5 0 115 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  fast: 'M3 5l9 7-9 7zM12 5l9 7-9 7z',
  ultra: 'M2 5l7 7-7 7zM9 5l7 7-7 7zM16 5l6 7-6 7z',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3',
  close: 'M6 6l12 12M18 6L6 18',
  focus: 'M12 8a4 4 0 110 8 4 4 0 010-8zM12 2v4M12 18v4M2 12h4M18 12h4',
  xray: 'M3 12s3-7 9-7 9 7 9 7-3 7-9 7-9-7-9-7zM12 9a3 3 0 110 6 3 3 0 010-6z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  waste: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  bus: 'M6 4h12a2 2 0 012 2v10H4V6a2 2 0 012-2zM4 11h16M7 19v2M17 19v2M7 15h1M16 15h1',
  era: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z',
  expand: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  rotl: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4',
  rotr: 'M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4',
  topview: 'M4 4h16v16H4zM4 12h16M12 4v16',
  isoview: 'M12 3l9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8',
  guide: 'M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6M20 4v14h-6',
  shrink: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
  rotate: 'M20 12a8 8 0 11-2.34-5.66M20 4v4h-4',
  settings: 'M12 9a3 3 0 110 6 3 3 0 010-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  sound: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
  mute: 'M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6',
  scenario: 'M5 21V4M5 4h11l-2 4 2 4H5',
  vote: 'M4 11h16v10H4zM8 11V4h8v7M10 7l1.5 1.5L14 6M8 15h8',
  risk: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  install: 'M12 3v12M7 10l5 5 5-5M4 19h16'
};

export function icon(name, size = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name] ?? ICONS.help);
  svg.appendChild(path);
  return svg;
}
