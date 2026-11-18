// One artist's page: back button, picture, name and facts, then two tabs:
// every song credited to them, and their albums.

import { h, fill, button, plural } from '../dom.js';
import { bus, ui, navigate } from '../state.js';
import { VirtualList } from '../components/virtualList.js';
import { openMenu } from '../components/overlays.js';
import { songRow, songListHead, playlistMenuItems, SONG_ROW_HEIGHT } from '../components/songRow.js';
import { findArtist, playArtist, playAlbum, requestArtistPictures } from '../catalogStore.js';
import { backButton } from '../components/backButton.js';
import { albumTile } from '../components/albumTile.js';
import { artistAvatar } from '../components/artistTile.js';

const TABS = [
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
];
const newestFirst = (a, b) => (!a.year !== !b.year ? (a.year ? -1 : 1) : b.year - a.year || a.title.localeCompare(b.title));

export function renderArtistView(container, view) {
  const parent = view.from ?? { type: 'artists' };
  let artist = findArtist(view.key);
  if (!['songs', 'albums'].includes(view.tab)) view.tab = 'songs';

  const hero = h('div', { class: 'detail-hero' });
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Show' });
  const scroller = h('div', { class: 'view-scroller' });
  const songsPanel = h('div', { role: 'tabpanel', id: 'artist-songs', dataset: { test: 'artist-songs' } });
  const albumsPanel = h('div', { role: 'tabpanel', id: 'artist-albums', dataset: { test: 'artist-albums' } });
  const rows = h('div', { role: 'list', 'aria-label': 'Songs' });
  const head = songListHead('Add to playlist');
  songsPanel.append(head, rows);

  const play = (startId, shuffle) => artist && playArtist(artist, startId, typeof shuffle === 'boolean' ? { shuffle } : {});

  const list = new VirtualList({
    scroller,
    container: rows,
    rowHeight: SONG_ROW_HEIGHT,
    renderRow: (index) => {
      const track = artist.tracks[index];
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

  function selectTab(id, { focus = false } = {}) {
    view.tab = id; // kept in the view, so coming back from an album returns to this tab
    for (const tab of tablist.children) {
      const selected = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle('is-selected', selected);
      if (selected && focus) tab.focus();
    }
    songsPanel.hidden = id !== 'songs';
    albumsPanel.hidden = id !== 'albums';
    if (id === 'songs') list.setCount(artist.tracks.length);
  }

  fill(
    tablist,
    TABS.map(({ id, label }) =>
      h(
        'button',
        {
          type: 'button',
          class: 'tab',
          role: 'tab',
          id: `artist-tab-${id}`,
          'aria-controls': `artist-${id}`,
          dataset: { tab: id, test: `artist-tab-${id}` },
          onclick: () => selectTab(id),
          onkeydown: (event) => {
            const step = { ArrowRight: 1, ArrowLeft: -1, Home: -TABS.length, End: TABS.length }[event.key];
            if (!step || event.altKey) return;
            event.preventDefault();
            const index = Math.min(TABS.length - 1, Math.max(0, TABS.findIndex((tab) => tab.id === id) + step));
            selectTab(TABS[index].id, { focus: true });
          },
        },
        label,
      ),
    ),
  );

  function update() {
    artist = findArtist(view.key);
    if (!artist) {
      // Their files are gone: show the page this was opened from instead.
      navigate(parent);
      return;
    }
    view.name = artist.name;
    const hasSongs = artist.tracks.length > 0;
    fill(
      hero,
      backButton(parent),
      h(
        'div',
        { class: 'detail-info' },
        artistAvatar(artist, 'detail-artist-pic'),
        h(
          'div',
          { class: 'pl-text' },
          h('div', { class: 'eyebrow' }, 'Artist'),
          h('h1', { class: 'ellipsis', title: artist.name }, artist.name),
          h(
            'p',
            { class: 'view-sub', dataset: { test: 'artist-facts' } },
            `${plural(artist.tracks.length, 'song')} · ${plural(artist.albums.length, 'album')}`,
          ),
          h(
            'div',
            { class: 'view-actions' },
            button('Play', { class: 'btn-accent', disabled: !hasSongs, dataset: { test: 'artist-page-play' }, onclick: () => play(null, false) }, 'play'),
            button('Shuffle and play', { disabled: !hasSongs, onclick: () => play(null, true) }, 'shuffle'),
          ),
        ),
      ),
    );

    const albums = artist.albums.slice().sort(newestFirst);
    fill(
      albumsPanel,
      albums.length
        ? h(
            'div',
            { class: 'album-grid', role: 'list', 'aria-label': `Albums by ${artist.name}` },
            albums.map((album) =>
              h(
                'div',
                { role: 'listitem' },
                albumTile(album, {
                  detail: 'year',
                  onOpen: () => navigate({ type: 'album', key: album.key, from: view }),
                  onPlay: () => playAlbum(album),
                }),
              ),
            ),
          )
        : h('div', { class: 'empty empty-compact' }, h('p', null, 'No albums by this artist in your library.')),
    );
    selectTab(view.tab);
  }

  scroller.append(hero, tablist, songsPanel, albumsPanel);
  container.replaceChildren(h('div', { class: 'view' }, scroller));
  update();
  requestArtistPictures([artist.name]);

  // Pictures and covers arriving in bursts are folded into one redraw per frame.
  let frame = 0;
  const updateSoon = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };

  ui.playCurrentView = () => play(null);
  const offs = [
    bus.on('tracks', update),
    bus.on('track-art', updateSoon),
    bus.on('artist-picture', updateSoon),
    bus.on('player:track', () => list.refreshSoon()),
    bus.on('player:state', () => list.refreshSoon()),
  ];
  return () => {
    cancelAnimationFrame(frame);
    offs.forEach((off) => off());
    list.destroy();
  };
}
