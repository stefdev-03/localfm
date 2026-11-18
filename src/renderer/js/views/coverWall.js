// The wall behind "Who's listening?": the user's album covers in columns that
// drift up and down very slowly, blurred and dimmed so they read as soft
// blocks of colour. Pure decoration: hidden from screen readers, not
// clickable, not focusable.
//
// To stay cheap on a screen that can sit open for hours, the wall is built at
// a quarter of its size and scaled up four times, so the blur works on a
// sixteenth of the pixels; and only `transform` is animated, so nothing is
// repainted while it drifts.

import { h, artUrl } from '../dom.js';

const SCALE = 4;
const TILT = -6; // degrees
const MIN_TILES = 8; // fewer covers than this are topped up with tinted tiles
const SECONDS_PER_TILE = 16; // time a tile takes to travel its own height…
const SPEED_SPREAD = 0.2; // …give or take up to 20% from column to column
const LOAD_TIMEOUT = 2500;

// The hue of a "#rrggbb" colour, for tinting tiles after the profiles.
function hueOf(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!match) return 30;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 30;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((hue * 60 + 360) % 360);
}

// The same two-tone tile `tintFor` gives a song without art.
const tint = (hue) => `linear-gradient(135deg, hsl(${hue} 32% 34%), hsl(${(hue + 40) % 360} 36% 22%))`;

// Waits for a picture to be ready to draw; false if it cannot be.
function preload(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => img.decode().then(() => resolve(true), () => resolve(true));
    img.onerror = () => resolve(false);
    img.src = artUrl(name);
  });
}

// covers: art file names; colors: the profiles' colours.
export function createCoverWall({ covers, colors }) {
  const inner = h('div', { class: 'wall-inner' });
  const el = h('div', { class: 'wall', 'aria-hidden': 'true' }, inner, h('div', { class: 'wall-veil' }), h('div', { class: 'wall-fade' }));
  let pool = [];
  let built = '';
  let destroyed = false;

  // Covers first; tinted tiles, with hues spread around the profiles'
  // colours, make up the numbers.
  function makePool(loaded) {
    const items = loaded.map((name) => ({ cover: name }));
    const hues = (colors.length ? colors : ['#ffb454']).map(hueOf);
    for (let i = 0; items.length < MIN_TILES; i++) {
      const base = hues[i % hues.length];
      const step = Math.floor(i / hues.length);
      items.push({ tint: tint((base + (step % 2 ? -1 : 1) * Math.ceil(step / 2) * 28 + 360) % 360) });
    }
    return items;
  }

  const tile = (item) =>
    item.cover
      ? h('div', { class: 'wall-tile' }, h('img', { src: artUrl(item.cover), alt: '', draggable: false }))
      : h('div', { class: 'wall-tile', style: { background: item.tint } });

  // Lays the columns out for the current window size. The wall is tilted, so
  // it is made larger than the screen area until no corner shows.
  function build() {
    if (destroyed || !pool.length) return;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (!width || !height) return;
    const size = Math.min(190, Math.max(110, window.innerWidth * 0.11)); // as seen
    const gap = size * 0.08;
    const pitch = size + gap;
    const angle = (Math.abs(TILT) * Math.PI) / 180;
    const needWidth = width * Math.cos(angle) + height * Math.sin(angle) + pitch;
    const needHeight = width * Math.sin(angle) + height * Math.cos(angle) + pitch;
    const columns = Math.ceil(needWidth / pitch) + 1;
    let perColumn = Math.ceil(needHeight / pitch) + 1;
    // A column repeats its tiles once for a seamless loop; where the end meets
    // the start again, the two tiles must differ.
    if (pool.length > 1 && (perColumn - 1) % pool.length === 0) perColumn += 1;

    const key = [columns, perColumn, Math.round(size)].join();
    if (key === built) return;
    built = key;

    const q = (px) => `${px / SCALE}px`;
    inner.style.setProperty('--wall-tile', q(size));
    inner.style.setProperty('--wall-gap', q(gap));
    inner.style.setProperty('--wall-radius', q(size * 0.05));
    inner.style.width = q(columns * pitch);
    inner.style.height = q(perColumn * pitch);
    inner.style.transform = `translate(-50%, -50%) scale(${SCALE}) rotate(${TILT}deg)`;

    // Neighbouring columns start half a pool apart, so the same cover does
    // not sit side by side, and run in opposite directions at their own speeds.
    const offset = Math.max(1, Math.floor(pool.length / 2) + 1);
    const cols = [];
    for (let c = 0; c < columns; c++) {
      const items = Array.from({ length: perColumn }, (_, i) => pool[(c * offset + i) % pool.length]);
      const seconds = perColumn * SECONDS_PER_TILE * (1 + ((c * 7919) % 100) / 100 * SPEED_SPREAD);
      const col = h('div', { class: `wall-col ${c % 2 ? 'is-down' : ''}`, style: { animationDuration: `${seconds.toFixed(1)}s`, animationDelay: `${(-seconds * (((c * 37) % 100) / 100)).toFixed(1)}s` } }, items.map(tile), items.map(tile));
      cols.push(col);
    }
    inner.replaceChildren(...cols);
  }

  const observer = new ResizeObserver(() => build());
  observer.observe(el);
  // Nothing to animate while the window is minimised or hidden.
  const onVisibility = () => el.classList.toggle('is-paused', document.hidden);
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();

  // The wall fades in once, when its pictures are ready, instead of tiles
  // popping in one by one. One that never loads is left out.
  const distinct = [...new Set(covers)];
  const timeout = new Promise((resolve) => setTimeout(() => resolve('late'), LOAD_TIMEOUT));
  Promise.all(distinct.map((name) => Promise.race([preload(name), timeout]).then((ok) => (ok === true ? name : null)))).then((loaded) => {
    if (destroyed) return;
    pool = makePool(loaded.filter(Boolean));
    build();
    requestAnimationFrame(() => el.classList.add('is-ready'));
  });

  return {
    el,
    destroy() {
      destroyed = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
