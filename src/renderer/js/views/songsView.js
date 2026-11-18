// "All songs": every track in the profile's music folders.

import { h, fill, icon, button, summarize, plural } from '../dom.js';
import { app, bus, ui } from '../state.js';
import { player } from '../player.js';
import { VirtualList } from '../components/virtualList.js';
import { openMenu } from '../components/overlays.js';
import { songRow, songListHead, playlistMenuItems, SONG_ROW_HEIGHT } from '../components/songRow.js';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const byText = (key) => (a, b) => {
  // Songs with nothing in this column go to the end instead of the start.
  if (!a[key] !== !b[key]) return a[key] ? -1 : 1;
  return collator.compare(a[key], b[key]) || collator.compare(a.title, b.title);
};
const SORTS = {
  title: { label: 'Title', compare: (a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist) },
  artist: { label: 'Artist', compare: byText('artist') },
  album: { label: 'Album', compare: byText('album') },
  recent: { label: 'Newest files', compare: (a, b) => b.mtime - a.mtime },
};

// Remembered while the app is open, so coming back to the page keeps them.
const remembered = { query: '', sort: 'title' };

export function renderSongsView(container) {
  let visible = [];
  const context = { type: 'songs', name: 'All songs' };

  const sub = h('p', { class: 'view-sub', dataset: { test: 'songs-count' } });
  const notices = h('div', { class: 'notices' });
  const scroller = h('div', { class: 'view-scroller' });
  const rows = h('div', { role: 'list', 'aria-label': 'Songs' });
  const empty = h('div', { class: 'empty' });
  const head = songListHead('Add to playlist');

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search songs',
    value: remembered.query,
    'aria-label': 'Search songs',
    dataset: { test: 'songs-search' },
  });
  const sort = h(
    'select',
    { class: 'select', 'aria-label': 'Sort songs by' },
    Object.entries(SORTS).map(([value, { label }]) => h('option', { value }, `Sort: ${label}`)),
  );
  sort.value = remembered.sort;

  const playAll = button('Play all', { class: 'btn-accent', dataset: { test: 'play-all' }, onclick: () => play(null, false) }, 'play');
  const shuffleAll = button('Shuffle and play', { onclick: () => play(null, true) }, 'shuffle');

  function play(startId, shuffle) {
    if (!visible.length) return;
    player.playList(
      visible.map((track) => track.id),
      startId,
      context,
      typeof shuffle === 'boolean' ? { shuffle } : {},
    );
  }

  const list = new VirtualList({
    scroller,
    container: rows,
    rowHeight: SONG_ROW_HEIGHT,
    renderRow: (index) => {
      const track = visible[index];
      return songRow(track, {
        onPlay: () => play(track.id),
        onContext: (point) =>
          openMenu(point, [
            { label: 'Play', icon: 'play', onClick: () => play(track.id) },
            { label: 'Show in folder', icon: 'folder', onClick: () => window.api.showTrackInFolder(track.id) },
            { separator: true },
            ...playlistMenuItems(track),
          ]),
        action: {
          icon: 'plus',
          label: `Add ${track.title} to a playlist`,
          onClick: (anchor) => openMenu(anchor, playlistMenuItems(track)),
        },
      });
    },
  });

  function update() {
    const needle = remembered.query.trim().toLowerCase();
    const matches = needle
      ? app.tracks.filter((track) => `${track.title}\n${track.artist}\n${track.album}`.toLowerCase().includes(needle))
      : app.tracks.slice();
    visible = matches.sort(SORTS[remembered.sort].compare);

    fill(
      sub,
      needle ? `${visible.length.toLocaleString()} of ${plural(app.tracks.length, 'song')}` : summarize(app.tracks),
      app.scanning && h('span', { class: 'scan-status' }, h('span', { class: 'spinner' }), 'Updating library…'),
    );
    fill(
      notices,
      app.missingFolders.map((folder) =>
        h(
          'div',
          { class: 'notice' },
          icon('warning', 18),
          h('span', null, `Local.fm can’t find ${folder}. Check that the drive is connected, or choose another folder.`),
          button('Open settings', { onclick: () => ui.openSettings() }),
        ),
      ),
    );

    const hasSongs = visible.length > 0;
    head.hidden = !hasSongs;
    empty.hidden = hasSongs;
    playAll.disabled = shuffleAll.disabled = !hasSongs;
    if (!hasSongs) {
      if (needle) {
        fill(empty, h('h2', null, 'No matches'), h('p', null, `Nothing in your library matches “${remembered.query.trim()}”.`));
      } else if (app.scanning) {
        fill(empty, h('h2', null, 'Reading your music folder…'));
      } else {
        fill(
          empty,
          icon('music', 36),
          h('h2', null, 'No songs yet'),
          h('p', null, 'Add music files to your music folder, or point Local.fm at a different folder.'),
          button('Open settings', { class: 'btn-accent', onclick: () => ui.openSettings() }, 'settings'),
        );
      }
    }
    list.setCount(visible.length);
  }

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

  scroller.append(
    h(
      'header',
      { class: 'view-head' },
      h('div', { class: 'view-heading' }, h('h1', null, 'All songs'), sub),
      h(
        'div',
        { class: 'view-actions' },
        playAll,
        shuffleAll,
        h('span', { class: 'spacer' }),
        h('div', { class: 'search' }, icon('search', 16), search),
        sort,
      ),
    ),
    notices,
    head,
    rows,
    empty,
  );
  container.replaceChildren(h('div', { class: 'view' }, scroller));
  update();

  ui.playCurrentView = () => play(null);
  const offs = [
    bus.on('tracks', update),
    bus.on('scan', update),
    bus.on('track-art', () => list.refreshSoon()),
    bus.on('player:track', () => list.refreshSoon()),
    bus.on('player:state', () => list.refreshSoon()),
    bus.on('focus-search', () => search.focus()),
  ];
  return () => {
    offs.forEach((off) => off());
    list.destroy();
  };
}
