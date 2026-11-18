// One album's page: back button, cover, name and facts, and its songs in
// album order.

import { h, fill, button, albumCover, summarize } from '../dom.js';
import { bus, ui, navigate } from '../state.js';
import { VirtualList } from '../components/virtualList.js';
import { openMenu } from '../components/overlays.js';
import { songRow, songListHead, playlistMenuItems, SONG_ROW_HEIGHT } from '../components/songRow.js';
import { findAlbum, findArtist, playAlbum } from '../catalogStore.js';
import { norm } from '../catalog.js';
import { backButton } from '../components/backButton.js';

export function renderAlbumView(container, view) {
  const parent = view.from ?? { type: 'albums' };
  let album = findAlbum(view.key);

  const hero = h('div', { class: 'detail-hero' });
  const scroller = h('div', { class: 'view-scroller' });
  const rows = h('div', { role: 'list', 'aria-label': 'Songs on this album' });
  const head = songListHead('Add to playlist', { showAlbum: false });

  const play = (startId, shuffle) => album && playAlbum(album, startId, typeof shuffle === 'boolean' ? { shuffle } : {});

  const list = new VirtualList({
    scroller,
    container: rows,
    rowHeight: SONG_ROW_HEIGHT,
    renderRow: (index) => {
      const track = album.tracks[index];
      return songRow(track, {
        number: track.trackNo || index + 1,
        showAlbum: false,
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
    album = findAlbum(view.key);
    if (!album) {
      // Its files are gone: show the page it was opened from instead.
      navigate(parent);
      return;
    }
    view.name = album.title; // the back button's label on a page opened from here
    // The artist links to their page; "Various artists" is plain text.
    const artist = findArtist(norm(album.artist));
    const artistLabel = artist
      ? h(
          'button',
          {
            type: 'button',
            class: 'text-link',
            dataset: { test: 'album-artist' },
            onclick: () => navigate({ type: 'artist', key: artist.key, tab: 'songs', name: artist.name, from: view }),
          },
          album.artist,
        )
      : album.artist;
    const rest = [album.year || null, summarize(album.tracks)].filter(Boolean).join(' · ');
    const facts = h('span', null, artistLabel, ` · ${rest}`);
    fill(
      hero,
      backButton(parent),
      h(
        'div',
        { class: 'detail-info' },
        albumCover(album, 'detail-cover'),
        h(
          'div',
          { class: 'pl-text' },
          h('div', { class: 'eyebrow' }, 'Album'),
          h('h1', { class: 'ellipsis', title: album.title }, album.title),
          h('p', { class: 'view-sub', dataset: { test: 'album-facts' } }, facts),
          h(
            'div',
            { class: 'view-actions' },
            button('Play', { class: 'btn-accent', dataset: { test: 'album-page-play' }, onclick: () => play(null, false) }, 'play'),
            button('Shuffle and play', { onclick: () => play(null, true) }, 'shuffle'),
          ),
        ),
      ),
    );
    list.setCount(album.tracks.length);
  }

  scroller.append(hero, head, rows);
  container.replaceChildren(h('div', { class: 'view' }, scroller));
  update();

  // Cover art arriving in bursts is folded into one redraw per frame.
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
    bus.on('player:track', () => list.refreshSoon()),
    bus.on('player:state', () => list.refreshSoon()),
  ];
  return () => {
    cancelAnimationFrame(frame);
    offs.forEach((off) => off());
    list.destroy();
  };
}
