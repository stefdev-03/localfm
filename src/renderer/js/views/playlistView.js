// A playlist's page: banner, picture, name, and its songs.

import { h, fill, icon, button, iconButton, imageUrl, playlistTile, summarize, plural } from '../dom.js';
import { app, bus, ui, findPlaylist, playlistTracks, setPlaylistTracks, deletePlaylist } from '../state.js';
import { player } from '../player.js';
import { VirtualList } from '../components/virtualList.js';
import { openMenu, confirmDialog, toast } from '../components/overlays.js';
import { songRow, songListHead, playlistMenuItems, SONG_ROW_HEIGHT } from '../components/songRow.js';
import { enableRowDrag } from '../components/rowDrag.js';
import { moveInPlaylist } from '../reorder.js';

export function renderPlaylistView(container, playlistId) {
  let playlist = findPlaylist(playlistId);
  let tracks = [];

  const hero = h('div', { class: 'pl-hero' });
  const notices = h('div', { class: 'notices' });
  const scroller = h('div', { class: 'view-scroller' });
  const rows = h('div', { role: 'list', 'aria-label': 'Songs in this playlist' });
  const empty = h('div', { class: 'empty' });
  const head = songListHead('Remove from playlist');

  function play(startId, shuffle) {
    if (!tracks.length) return;
    player.playList(
      tracks.map((track) => track.id),
      startId,
      { type: 'playlist', id: playlist.id, name: playlist.name },
      typeof shuffle === 'boolean' ? { shuffle } : {},
    );
  }

  async function remove(track) {
    const before = playlist.trackIds.slice();
    const id = playlist.id;
    await setPlaylistTracks(id, before.filter((trackId) => trackId !== track.id));
    toast(`Removed “${track.title}”`, { action: { label: 'Undo', onClick: () => setPlaylistTracks(id, before) } });
  }

  async function confirmDelete() {
    const sure = await confirmDialog({
      title: `Delete “${playlist.name}”?`,
      message: 'The playlist is removed from this profile. The songs themselves stay in your music folder.',
      confirmLabel: 'Delete playlist',
      danger: true,
    });
    if (sure) await deletePlaylist(playlist.id);
  }

  // Moves a song to a new place. The page's own list changes first, so there
  // is no flicker while the new order is saved; if saving fails, the old
  // order comes back. Nothing announces the move: the list is the message.
  async function move(from, to, { keepFocus = false } = {}) {
    if (from === to || to < 0 || to >= tracks.length) return;
    const id = playlist.id;
    const next = moveInPlaylist(
      playlist.trackIds,
      tracks.map((track) => track.id),
      from,
      to,
    );
    const [moved] = tracks.splice(from, 1);
    tracks.splice(to, 0, moved);
    list.refresh();
    if (keepFocus) focusSong(moved.id);
    let saved = null;
    try {
      saved = await setPlaylistTracks(id, next);
    } catch {
      saved = null;
    }
    if (!saved) {
      update();
      toast('The new order could not be saved. Try again.');
    }
    if (keepFocus) focusSong(moved.id);
  }

  function focusSong(trackId) {
    const index = tracks.findIndex((track) => track.id === trackId);
    if (index === -1) return;
    const rowTop = rows.offsetTop + index * SONG_ROW_HEIGHT;
    const headHeight = head.offsetHeight;
    if (rowTop - headHeight < scroller.scrollTop) scroller.scrollTop = rowTop - headHeight;
    else if (rowTop + SONG_ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = rowTop + SONG_ROW_HEIGHT - scroller.clientHeight;
    list.update();
    rows.querySelector(`.song-row[data-id="${trackId}"] .song-play`)?.focus();
  }

  let drag = null;
  const list = new VirtualList({
    scroller,
    container: rows,
    rowHeight: SONG_ROW_HEIGHT,
    decorateRow: (el, index) => drag?.decorate(el, index),
    renderRow: (index) => {
      const track = tracks[index];
      return songRow(track, {
        onPlay: () => play(track.id),
        onContext: (point) =>
          openMenu(point, [
            { label: 'Play', icon: 'play', onClick: () => play(track.id) },
            { label: 'Remove from this playlist', icon: 'minus', onClick: () => remove(track) },
            tracks.length > 1 && { separator: true },
            tracks.length > 1 && index > 0 && { label: 'Move to top', test: 'move-top', onClick: () => move(index, 0) },
            tracks.length > 1 && index < tracks.length - 1 && { label: 'Move to bottom', test: 'move-bottom', onClick: () => move(index, tracks.length - 1) },
            { separator: true },
            { label: 'Show in folder', icon: 'folder', onClick: () => window.api.showTrackInFolder(track.id) },
            { separator: true },
            ...playlistMenuItems(track),
          ].filter(Boolean)),
        action: { icon: 'minus', label: `Remove ${track.title} from this playlist`, onClick: () => remove(track) },
      });
    },
  });

  function update() {
    playlist = findPlaylist(playlistId);
    if (!playlist) return; // deleted; the shell is already navigating away
    tracks = playlistTracks(playlist);
    const missing = playlist.trackIds.length - tracks.length;
    const hasSongs = tracks.length > 0;

    const playButton = button('Play', { class: 'btn-accent', disabled: !hasSongs, dataset: { test: 'playlist-play' }, onclick: () => play(null, false) }, 'play');
    const shuffleButton = button('Shuffle and play', { disabled: !hasSongs, onclick: () => play(null, true) }, 'shuffle');

    fill(
      hero,
      h(
        'div',
        { class: `pl-banner ${playlist.banner ? '' : 'is-empty'}` },
        playlist.banner && h('img', { src: imageUrl(playlist.banner), alt: '', draggable: false }),
      ),
      h(
        'div',
        { class: 'pl-info' },
        playlistTile(playlist, 'pl-tile'),
        h(
          'div',
          { class: 'pl-text' },
          h('div', { class: 'eyebrow' }, 'Playlist'),
          h('h1', { class: 'ellipsis', title: playlist.name }, playlist.name),
          h('p', { class: 'view-sub' }, summarize(tracks)),
          h(
            'div',
            { class: 'view-actions' },
            playButton,
            shuffleButton,
            button('Add songs', { dataset: { test: 'playlist-add-songs' }, onclick: () => ui.editPlaylistSongs(playlist) }, 'plus'),
            iconButton('more', 'More playlist options', {
              class: 'btn-square',
              onclick: (event) =>
                openMenu(event.currentTarget, [
                  { label: 'Edit name and pictures', icon: 'pencil', onClick: () => ui.editPlaylistDetails(playlist) },
                  { separator: true },
                  { label: 'Delete playlist', icon: 'trash', danger: true, onClick: confirmDelete },
                ]),
            }),
          ),
        ),
      ),
    );

    fill(
      notices,
      missing > 0 &&
        !app.scanning &&
        h(
          'div',
          { class: 'notice' },
          icon('warning', 18),
          h(
            'span',
            null,
            `${plural(missing, 'song')} in this playlist can’t be found in your music folder. ${missing === 1 ? 'It' : 'They'} will come back if the ${missing === 1 ? 'file returns' : 'files return'}.`,
          ),
        ),
    );

    head.hidden = !hasSongs;
    empty.hidden = hasSongs;
    if (!hasSongs) {
      fill(
        empty,
        icon('playlist', 36),
        h('h2', null, 'This playlist is empty'),
        h('p', null, 'Add songs from your library to start listening.'),
        button('Add songs', { class: 'btn-accent', onclick: () => ui.editPlaylistSongs(playlist) }, 'plus'),
      );
    }
    list.setCount(tracks.length);
  }

  drag = enableRowDrag({
    list,
    rows,
    scroller,
    rowHeight: SONG_ROW_HEIGHT,
    count: () => tracks.length,
    // The sticky column headings count as the top edge.
    edgeTop: () => head.getBoundingClientRect().bottom,
    onDrop: (from, to) => move(from, to),
  });

  // Without a mouse: Alt+Up / Alt+Down move the song one place.
  rows.addEventListener('keydown', (event) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const row = event.target.closest('.song-row');
    if (!row) return;
    event.preventDefault();
    const index = tracks.findIndex((track) => track.id === row.dataset.id);
    if (index !== -1) move(index, index + (event.key === 'ArrowUp' ? -1 : 1), { keepFocus: true });
  });

  scroller.append(hero, notices, head, rows, empty);
  container.replaceChildren(h('div', { class: 'view view-playlist' }, scroller));
  update();

  ui.playCurrentView = () => play(null);
  const offs = [
    bus.on('tracks', update),
    bus.on('scan', update),
    bus.on('playlists', update),
    bus.on('track-art', () => list.refreshSoon()),
    bus.on('player:track', () => list.refreshSoon()),
    bus.on('player:state', () => list.refreshSoon()),
  ];
  return () => {
    offs.forEach((off) => off());
    drag.destroy();
    list.destroy();
  };
}
