// One row in a song list, shared by "All songs" and the playlist page.

import { h, icon, iconButton, cover, formatDuration, playlistTile } from '../dom.js';
import { app, ui, setPlaylistTracks } from '../state.js';
import { player } from '../player.js';
import { toast } from './overlays.js';

export const SONG_ROW_HEIGHT = 56;

// showAlbum: false drops the Album column (an album's own page).
export function songListHead(actionLabel, { showAlbum = true } = {}) {
  return h(
    'div',
    { class: `list-head ${showAlbum ? '' : 'no-album'}`, 'aria-hidden': 'true' },
    h('span', { class: showAlbum ? null : 'col-number' }, showAlbum ? '' : '#'),
    h('span', null, 'Title'),
    h('span', null, 'Artist'),
    showAlbum && h('span', { class: 'col-album' }, 'Album'),
    h('span', { class: 'col-time' }, 'Length'),
    h('span', { class: 'sr-only' }, actionLabel),
  );
}

// action: { icon, label, onClick(buttonEl) }  — the + or − at the end of the row.
// number: shown in place of the cover, where every row would show the same one.
export function songRow(track, { onPlay, action, onContext, number = null, showAlbum = true }) {
  const isCurrent = player.current?.id === track.id;
  const playing = isCurrent && player.playing;
  const row = h(
    'div',
    {
      class: `song-row ${isCurrent ? 'is-current' : ''} ${showAlbum ? '' : 'no-album'}`,
      role: 'listitem',
      dataset: { id: track.id },
      ondblclick: (event) => {
        if (!event.target.closest('button')) onPlay();
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        onContext?.({ x: event.clientX, y: event.clientY });
      },
    },
    h(
      'button',
      {
        type: 'button',
        class: `song-play ${number === null ? '' : 'is-number'}`,
        'aria-label': `${playing ? 'Pause' : 'Play'} ${track.title}`,
        onclick: () => (isCurrent ? player.toggle() : onPlay()),
      },
      number === null ? cover(track, 'cover-sm') : h('span', { class: 'song-number', dataset: { test: 'track-number' } }, String(number)),
      h('span', { class: 'song-play-icon' }, icon(playing ? 'pause' : 'play', 16)),
    ),
    h(
      'div',
      { class: 'song-title', title: track.title },
      playing && h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { class: 'ellipsis' }, track.title),
    ),
    h('div', { class: 'song-artist ellipsis', title: track.artist }, track.artist || 'Unknown artist'),
    showAlbum && h('div', { class: 'song-album col-album ellipsis', title: track.album }, track.album || ''),
    h('div', { class: 'song-time col-time' }, formatDuration(track.duration)),
    action
      ? iconButton(action.icon, action.label, {
          class: 'song-action',
          dataset: { test: 'song-action' },
          onclick: (event) => action.onClick(event.currentTarget),
        })
      : h('span'),
  );
  return row;
}

// Menu entries for putting a song into (or taking it out of) playlists.
export function playlistMenuItems(track) {
  const playlists = app.profile.playlists;
  return [
    { heading: 'Add to playlist' },
    ...playlists.map((playlist) => {
      const has = playlist.trackIds.includes(track.id);
      return {
        label: playlist.name,
        leading: playlistTile(playlist, 'cover-xs'),
        checked: has,
        onClick: async () => {
          const next = has ? playlist.trackIds.filter((id) => id !== track.id) : [...playlist.trackIds, track.id];
          await setPlaylistTracks(playlist.id, next);
          toast(has ? `Removed from “${playlist.name}”` : `Added to “${playlist.name}”`);
        },
      };
    }),
    playlists.length > 0 && { separator: true },
    { label: 'New playlist…', icon: 'plus', onClick: () => ui.createPlaylist({ preselect: [track.id] }) },
  ].filter(Boolean);
}
