// "All albums": every album in the library as a grid of covers, five across.

import { h, fill, icon, plural } from '../dom.js';
import { app, bus, navigate } from '../state.js';
import { getCatalog, playAlbum } from '../catalogStore.js';
import { ALBUM_SORTS } from '../catalog.js';
import { albumTile } from '../components/albumTile.js';

// Remembered while the app is open, so coming back from an album lands where
// the user was.
const remembered = { query: '', sort: 'title', scroll: 0 };

export function renderAlbumsView(container) {
  const view = { type: 'albums' };
  const sub = h('p', { class: 'view-sub', dataset: { test: 'albums-count' } });
  const grid = h('div', { class: 'album-grid', role: 'list', 'aria-label': 'Albums' });
  const empty = h('div', { class: 'empty' });
  const scroller = h('div', { class: 'view-scroller' });

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search albums',
    value: remembered.query,
    'aria-label': 'Search albums',
    dataset: { test: 'albums-search' },
  });
  const sort = h(
    'select',
    { class: 'select', 'aria-label': 'Sort albums by', dataset: { test: 'albums-sort' } },
    Object.entries(ALBUM_SORTS).map(([value, { label }]) => h('option', { value }, `Sort: ${label}`)),
  );
  sort.value = remembered.sort;

  function update() {
    const { albums } = getCatalog();
    const needle = remembered.query.trim().toLowerCase();
    const visible = (needle ? albums.filter((album) => `${album.title}\n${album.artist}`.toLowerCase().includes(needle)) : albums.slice()).sort(
      ALBUM_SORTS[remembered.sort].compare,
    );

    fill(
      sub,
      needle ? `${visible.length.toLocaleString()} of ${plural(albums.length, 'album')}` : plural(albums.length, 'album'),
      app.scanning && h('span', { class: 'scan-status' }, h('span', { class: 'spinner' }), 'Updating library…'),
    );
    fill(
      grid,
      visible.map((album) =>
        h(
          'div',
          { role: 'listitem' },
          albumTile(album, {
            onOpen: () => navigate({ type: 'album', key: album.key, from: view }),
            onPlay: () => playAlbum(album),
          }),
        ),
      ),
    );

    const hasAlbums = visible.length > 0;
    grid.hidden = !hasAlbums;
    empty.hidden = hasAlbums;
    if (!hasAlbums) {
      if (needle) fill(empty, h('h2', null, 'No matches'), h('p', null, `No album matches “${remembered.query.trim()}”.`));
      else if (app.scanning && !app.tracks.length) fill(empty, h('h2', null, 'Reading your music folder…'));
      else
        fill(
          empty,
          icon('disc', 36),
          h('h2', null, 'No albums yet'),
          h('p', null, 'Albums appear here when your music files have an album name.'),
        );
    }
  }

  // Cover art arriving in bursts is folded into one redraw per frame.
  let frame = 0;
  const updateSoon = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  search.addEventListener('input', () => {
    remembered.query = search.value;
    scroller.scrollTop = 0;
    update();
  });
  sort.addEventListener('change', () => {
    remembered.sort = sort.value;
    scroller.scrollTop = 0;
    update();
  });
  scroller.addEventListener('scroll', () => (remembered.scroll = scroller.scrollTop), { passive: true });

  scroller.append(
    h(
      'header',
      { class: 'view-head grid-head' },
      h('div', { class: 'view-heading' }, h('h1', null, 'All albums'), sub),
      h(
        'div',
        { class: 'view-actions' },
        h('span', { class: 'spacer' }),
        h('div', { class: 'search' }, icon('search', 16), search),
        sort,
      ),
    ),
    grid,
    empty,
  );
  container.replaceChildren(h('div', { class: 'view' }, scroller));
  update();
  scroller.scrollTop = remembered.scroll;

  const offs = [
    bus.on('tracks', update),
    bus.on('scan', update),
    bus.on('track-art', updateSoon),
    bus.on('focus-search', () => search.focus()),
  ];
  return () => {
    cancelAnimationFrame(frame);
    offs.forEach((off) => off());
  };
}
