// One album in a grid: the cover, the name, and a line of detail. Shared by
// "All albums" and an artist's Albums tab.

import { h, icon, albumCover } from '../dom.js';

// detail: 'artist-year' (the albums page) or 'year' (where the artist is obvious).
export function albumTile(album, { onOpen, onPlay, detail = 'artist-year' }) {
  const parts = detail === 'year' ? [album.year || ''] : [album.artist, album.year || ''];
  const line = parts.filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'album-tile', dataset: { key: album.key } },
    h(
      'button',
      {
        type: 'button',
        class: 'album-open',
        'aria-label': `${album.title} by ${album.artist}`,
        dataset: { test: 'album-tile' },
        onclick: onOpen,
      },
      albumCover(album, 'album-tile-cover'),
      h('span', { class: 'album-title ellipsis', title: album.title }, album.title),
      h('span', { class: 'album-detail ellipsis', title: line }, line || ' '),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'album-play',
        'aria-label': `Play ${album.title}`,
        title: 'Play',
        dataset: { test: 'album-play' },
        onclick: onPlay,
      },
      icon('play', 16),
    ),
  );
}
