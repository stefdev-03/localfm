// "Artists": everyone credited in the library, as a grid of round pictures.

import { h, fill, icon, plural } from '../dom.js';
import { app, bus, navigate } from '../state.js';
import { getCatalog, playArtist, requestArtistPictures } from '../catalogStore.js';
import { ARTIST_SORTS } from '../catalog.js';
import { artistTile } from '../components/artistTile.js';

// Remembered while the app is open, so coming back from an artist lands where
// the user was.
const remembered = { query: '', sort: 'name', scroll: 0 };

export function renderArtistsView(container) {
  const view = { type: 'artists' };
  let visible = [];
  const sub = h('p', { class: 'view-sub', dataset: { test: 'artists-count' } });
  const grid = h('div', { class: 'album-grid artist-grid', role: 'list', 'aria-label': 'Artists' });
  const empty = h('div', { class: 'empty' });
  const scroller = h('div', { class: 'view-scroller' });

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search artists',
    value: remembered.query,
    'aria-label': 'Search artists',
    dataset: { test: 'artists-search' },
  });
  const sort = h(
    'select',
    { class: 'select', 'aria-label': 'Sort artists by', dataset: { test: 'artists-sort' } },
    Object.entries(ARTIST_SORTS).map(([value, { label }]) => h('option', { value }, `Sort: ${label}`)),
  );
  sort.value = remembered.sort;

  function update() {
    const { artists } = getCatalog();
    const needle = remembered.query.trim().toLowerCase();
    visible = (needle ? artists.filter((artist) => artist.name.toLowerCase().includes(needle)) : artists.slice()).sort(
      ARTIST_SORTS[remembered.sort].compare,
    );

    fill(
      sub,
      needle ? `${visible.length.toLocaleString()} of ${plural(artists.length, 'artist')}` : plural(artists.length, 'artist'),
      app.scanning && h('span', { class: 'scan-status' }, h('span', { class: 'spinner' }), 'Updating library…'),
    );
    fill(
      grid,
      visible.map((artist) =>
        h(
          'div',
          { role: 'listitem' },
          artistTile(artist, {
            onOpen: () => navigate({ type: 'artist', key: artist.key, tab: 'songs', from: view }),
            onPlay: () => playArtist(artist),
          }),
        ),
      ),
    );

    const hasArtists = visible.length > 0;
    grid.hidden = !hasArtists;
    empty.hidden = hasArtists;
    if (!hasArtists) {
      if (needle) fill(empty, h('h2', null, 'No matches'), h('p', null, `No artist matches “${remembered.query.trim()}”.`));
      else if (app.scanning && !app.tracks.length) fill(empty, h('h2', null, 'Reading your music folder…'));
      else
        fill(
          empty,
          icon('mic', 36),
          h('h2', null, 'No artists yet'),
          h('p', null, 'Artists appear here when your music files name who made them.'),
        );
    }
  }

  // Asks for the pictures of the artists on show; ones found later arrive
  // as 'artist-picture' events.
  const askForPictures = () => requestArtistPictures(visible.map((artist) => artist.name));
  const refresh = () => {
    update();
    askForPictures();
  };

  // Pictures arriving in bursts are folded into one redraw per frame.
  let frame = 0;
  const updateSoon = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  let searchTimer = 0;
  search.addEventListener('input', () => {
    remembered.query = search.value;
    scroller.scrollTop = 0;
    update();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(askForPictures, 300);
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
      h('div', { class: 'view-heading' }, h('h1', null, 'Artists'), sub),
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
  refresh();
  scroller.scrollTop = remembered.scroll;

  const offs = [
    bus.on('tracks', refresh),
    bus.on('scan', update),
    bus.on('artist-picture', updateSoon),
    bus.on('focus-search', () => search.focus()),
  ];
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(searchTimer);
    offs.forEach((off) => off());
  };
}
