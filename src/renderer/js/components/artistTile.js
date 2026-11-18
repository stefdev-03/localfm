// An artist's round picture, and the tile that shows it on the Artists page.

import { h, icon, artUrl, tintFor, plural } from '../dom.js';
import { artistPicture } from '../catalogStore.js';

// The picture if one has been found, else a tinted circle with the initial:
// a wall of identical icons says nothing, initials are at least scannable.
export function artistAvatar(artist, className = '') {
  const el = h('div', { class: `artist-pic ${className}` });
  const initial = () => {
    el.style.background = tintFor(artist.name);
    el.classList.add('is-tinted');
    el.replaceChildren(h('span', { class: 'artist-initial', 'aria-hidden': 'true' }, [...artist.name.trim()][0]?.toUpperCase() ?? '?'));
  };
  const file = artistPicture(artist.name);
  if (!file) initial();
  else el.append(h('img', { src: artUrl(file), alt: '', loading: 'lazy', draggable: false, onerror: initial }));
  return el;
}

export function artistTile(artist, { onOpen, onPlay }) {
  return h(
    'div',
    { class: 'artist-tile', dataset: { key: artist.key } },
    h(
      'button',
      {
        type: 'button',
        class: 'artist-open',
        'aria-label': `${artist.name}, ${plural(artist.tracks.length, 'song')}`,
        dataset: { test: 'artist-tile' },
        onclick: onOpen,
      },
      artistAvatar(artist, 'artist-tile-pic'),
      h('span', { class: 'artist-name ellipsis', title: artist.name }, artist.name),
      h('span', { class: 'artist-count' }, plural(artist.tracks.length, 'song')),
    ),
    artist.tracks.length > 0 &&
      h(
        'button',
        {
          type: 'button',
          class: 'album-play',
          'aria-label': `Play ${artist.name}`,
          title: 'Play',
          dataset: { test: 'artist-play' },
          onclick: onPlay,
        },
        icon('play', 16),
      ),
  );
}
