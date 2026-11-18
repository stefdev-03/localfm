import { ICONS } from './icons.js';

const PROPERTIES = new Set(['value', 'checked', 'disabled', 'textContent', 'tabIndex', 'draggable', 'hidden']);

// Tiny element builder: h('button', { class: 'btn', onclick: fn }, 'Label')
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') setStyles(el, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (PROPERTIES.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  return add(el, ...children);
}

const clean = (children) => children.flat(Infinity).filter((child) => child != null && child !== false);

// Like append / replaceChildren, but skipping null and false so callers can
// write `condition && element`.
export const add = (el, ...children) => {
  el.append(...clean(children));
  return el;
};
export const fill = (el, ...children) => {
  el.replaceChildren(...clean(children));
  return el;
};

// Plain properties are assigned; custom properties ("--fill") need setProperty.
export function setStyles(el, styles) {
  for (const [name, value] of Object.entries(styles)) {
    if (name.startsWith('--')) el.style.setProperty(name, value);
    else el.style[name] = value;
  }
}

const template = document.createElement('template');

export function icon(name, size = 20) {
  template.innerHTML = `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return template.content.removeChild(template.content.firstElementChild);
}

// The run of three small notes that links one step of a flow to the next.
export const stepNotes = () =>
  h('span', { class: 'step-notes', 'aria-hidden': 'true' }, icon('note', 12), icon('note', 12), icon('note', 12));

export const artUrl = (file) => `media://art/${file}`;
export const imageUrl = (file) => `media://img/${file}`;
export const trackUrl = (id) => `media://track/${id}`;

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

// A song's length. Rounded, so the tag reader's estimate (7.0003 s) and the
// decoder's exact figure (6.97 s) both read "0:07"; positions still count down.
// A length of zero means it could not be read from the file, shown as a dash.
export const formatDuration = (seconds) => (seconds > 0 ? formatTime(Math.round(seconds)) : '–:––');

export function formatTotal(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

export function summarize(tracks) {
  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0);
  return total ? `${plural(tracks.length, 'song')} · ${formatTotal(total)}` : plural(tracks.length, 'song');
}

function hueFor(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

// A square cover: the song's art when there is some, otherwise a tinted tile.
export function cover(track, className = '') {
  const el = h('div', { class: `cover ${className}` });
  setCover(el, track);
  return el;
}

export function setCover(el, track) {
  const placeholder = () => {
    el.style.background = tintFor(`${track?.artist ?? ''}${track?.title ?? ''}`);
    el.classList.add('is-tinted');
    el.replaceChildren(icon('music', 18));
  };
  if (!track?.art) return placeholder();
  el.style.background = '';
  el.classList.remove('is-tinted');
  el.replaceChildren(h('img', { src: artUrl(track.art), alt: '', draggable: false, onerror: placeholder }));
}

// The two-tone tile shown for something with no picture, seeded by its name.
export function tintFor(text) {
  const hue = hueFor(text);
  return `linear-gradient(135deg, hsl(${hue} 32% 34%), hsl(${(hue + 40) % 360} 36% 22%))`;
}

// An album's cover, or a tinted tile with a disc when it has none. Pictures
// load lazily so a long grid only fetches what is on screen.
export function albumCover(album, className = '') {
  const el = h('div', { class: `cover album-cover ${className}` });
  const placeholder = () => {
    el.style.background = tintFor(`${album.artist}${album.title}`);
    el.classList.add('is-tinted');
    el.replaceChildren(icon('disc', 24));
  };
  if (!album.art) placeholder();
  else el.append(h('img', { src: artUrl(album.art), alt: '', loading: 'lazy', draggable: false, onerror: placeholder }));
  return el;
}

// Picture for a playlist: its own image, else a tile with the playlist icon.
export function playlistTile(playlist, className = '') {
  const el = h('div', { class: `cover playlist-tile ${className}` });
  if (playlist?.image) el.append(h('img', { src: imageUrl(playlist.image), alt: '', draggable: false }));
  else el.append(icon('playlist', 18));
  return el;
}

export function iconButton(name, label, props = {}, size = 18) {
  const { class: extra = '', ...rest } = props;
  return h('button', { type: 'button', class: `icon-btn ${extra}`, 'aria-label': label, title: label, ...rest }, icon(name, size));
}

export function button(label, props = {}, iconName = null) {
  const { class: extra = '', ...rest } = props;
  return h('button', { type: 'button', class: `btn ${extra}`, ...rest }, iconName && icon(iconName, 16), h('span', null, label));
}

export const isTypingTarget = (target) =>
  target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
