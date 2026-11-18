// The main window after setup: sidebar on the left, the current page beside
// it, the player bar underneath, and the profile button up in the title bar.

import { h, fill, icon, playlistTile, plural } from '../dom.js';
import { app, bus, ui, navigate, findPlaylist, playlistTracks } from '../state.js';
import { player } from '../player.js';
import { openMenu, closeMenu } from '../components/overlays.js';
import { avatar } from './profiles.js';
import { createPlayerBar } from './playerBar.js';
import { renderSongsView } from './songsView.js';
import { renderPlaylistView } from './playlistView.js';
import { renderAlbumsView } from './albumsView.js';
import { renderAlbumView } from './albumView.js';
import { renderArtistsView } from './artistsView.js';
import { renderArtistView } from './artistView.js';
import { findAlbum, findArtist } from '../catalogStore.js';

const titlebarActions = document.getElementById('titlebar-actions');

export function mountShell(root) {
  const nav = h('nav', { class: 'sidebar-nav', 'aria-label': 'Library' });
  const foot = h('div', { class: 'sidebar-foot' });
  const content = h('section', { class: 'content' });
  const playerBar = createPlayerBar();
  let cleanupView = null;

  const navItem = ({ label, leading, active, onClick, test, title, large, sub, id }) =>
    h(
      'button',
      {
        type: 'button',
        class: `nav-item ${large ? 'nav-item-lg' : ''} ${active ? 'is-active' : ''}`,
        'aria-current': active ? 'page' : null,
        title: title ?? null,
        dataset: { ...(test ? { test } : {}), ...(id ? { id } : {}) },
        onclick: onClick,
      },
      leading,
      sub
        ? h('span', { class: 'nav-text' }, h('span', { class: 'nav-label ellipsis' }, label), h('span', { class: 'nav-sub ellipsis' }, sub))
        : h('span', { class: 'nav-label ellipsis' }, label),
    );

  // Until the library has been read, count the saved ids; afterwards count
  // the songs the playlist page will actually show.
  const songCount = (playlist) => (app.tracks.length ? playlistTracks(playlist).length : playlist.trackIds.length);

  // The playlist that is playing gets the equaliser bars at the end of its
  // row. Toggled in place so a play/pause never redraws the sidebar.
  function markPlaying() {
    const context = player.current ? player.context : null;
    const playingId = context?.type === 'playlist' ? context.id : null;
    for (const row of nav.querySelectorAll('[data-test="nav-playlist"]')) {
      const isPlaying = row.dataset.id === playingId;
      let bars = row.querySelector('.eq');
      if (isPlaying && !bars) {
        bars = h('span', { class: 'eq nav-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
        row.append(bars);
      } else if (!isPlaying && bars) bars.remove();
      bars?.classList.toggle('is-paused', isPlaying && !player.playing);
    }
  }

  function renderSidebar() {
    const view = app.view;
    fill(
      nav,
      navItem({
        label: 'All songs',
        leading: icon('music', 18),
        active: view.type === 'songs',
        test: 'nav-songs',
        onClick: () => navigate({ type: 'songs' }),
      }),
      navItem({
        label: 'All albums',
        leading: icon('disc', 18),
        active: view.type === 'albums' || view.type === 'album',
        test: 'nav-albums',
        onClick: () => navigate({ type: 'albums' }),
      }),
      navItem({
        label: 'Artists',
        leading: icon('mic', 18),
        active: view.type === 'artists' || view.type === 'artist',
        test: 'nav-artists',
        onClick: () => navigate({ type: 'artists' }),
      }),
      h('div', { class: 'nav-heading' }, 'Playlists'),
      navItem({
        label: 'Create playlist',
        leading: h('span', { class: 'nav-plus' }, icon('plus', 20)),
        large: true,
        test: 'nav-create-playlist',
        onClick: () => ui.createPlaylist(),
      }),
      h(
        'div',
        { class: 'nav-playlists' },
        app.profile.playlists.map((playlist) =>
          navItem({
            label: playlist.name,
            title: playlist.name,
            sub: plural(songCount(playlist), 'song'),
            leading: playlistTile(playlist, 'cover-nav'),
            large: true,
            id: playlist.id,
            active: view.type === 'playlist' && view.id === playlist.id,
            test: 'nav-playlist',
            onClick: () => navigate({ type: 'playlist', id: playlist.id }),
          }),
        ),
      ),
    );
    markPlaying();

    fill(
      foot,
      navItem({ label: 'Settings', leading: icon('settings', 18), test: 'nav-settings', onClick: () => ui.openSettings() }),
    );
  }

  // The title bar holds the profile button in a slot of its own.
  const profileSlot = h('div', { class: 'titlebar-slot' });
  titlebarActions.replaceChildren(profileSlot);

  // The profile button lives in the title bar, beside the window controls.
  let menuWasOpen = false;
  function renderProfileButton() {
    const name = app.profile.name;
    const profileButton = h(
      'button',
      {
        type: 'button',
        class: 'profile-btn',
        title: `${name} · Switch profile`,
        'aria-label': `Profile: ${name}. Switch profile`,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        dataset: { test: 'profile-chip', profile: name },
        // Pressing the button while its menu is open closes it (the press
        // outside the menu does that), so the click must not reopen it.
        onmousedown: () => {
          menuWasOpen = profileButton.getAttribute('aria-expanded') === 'true';
        },
        onclick: () => {
          if (!menuWasOpen) openProfileMenu(profileButton);
          menuWasOpen = false;
        },
      },
      avatar(app.profile, 'avatar-md'),
    );
    fill(profileSlot, profileButton);
  }

  // Right-click on a profile in the menu: edit or delete that profile.
  const profileOptions = (profile) => (point) =>
    openMenu(
      point,
      [
        { heading: profile.name },
        { label: 'Edit profile', icon: 'pencil', test: 'profile-edit', onClick: () => ui.editProfile(profile) },
        { label: 'Delete profile', icon: 'trash', danger: true, test: 'profile-delete', onClick: () => ui.deleteProfile(profile) },
      ],
      { submenu: true },
    );

  function openProfileMenu(anchor) {
    const ready = app.profiles.filter((profile) => profile.setupComplete);
    anchor.setAttribute('aria-expanded', 'true');
    openMenu(
      anchor,
      [
        { heading: 'Profiles' },
        ...ready.map((profile) => ({
          label: profile.name,
          leading: avatar(profile, 'avatar-xs'),
          checked: profile.id === app.profile.id,
          title: 'Right-click to edit or delete',
          test: 'profile-option',
          onClick: () => profile.id !== app.profile.id && ui.switchProfile(profile.id),
          onContext: profileOptions(profile),
        })),
        { separator: true },
        { label: 'Add profile', icon: 'plus', onClick: () => ui.addProfile() },
        ready.length > 1 && { label: 'Choose a profile…', icon: 'users', onClick: () => ui.showPicker() },
      ].filter(Boolean),
      { align: 'end', dropdown: true, onClose: () => anchor.setAttribute('aria-expanded', 'false') },
    );
  }

  function renderView() {
    cleanupView?.();
    cleanupView = null;
    ui.playCurrentView = null;
    const view = app.view;
    if (view.type === 'playlist' && findPlaylist(view.id)) cleanupView = renderPlaylistView(content, view.id);
    else if (view.type === 'album' && findAlbum(view.key)) cleanupView = renderAlbumView(content, view);
    else if (view.type === 'artist' && findArtist(view.key)) cleanupView = renderArtistView(content, view);
    else if (view.type === 'albums') cleanupView = renderAlbumsView(content);
    else if (view.type === 'artists') cleanupView = renderArtistsView(content);
    // An album or artist that is gone shows the page it was opened from.
    else if (view.type === 'album' || view.type === 'artist') {
      navigate(view.from ?? { type: `${view.type}s` }); // redraws the sidebar and the page
    } else cleanupView = renderSongsView(content);
  }

  root.replaceChildren(
    h('div', { class: 'shell' }, h('aside', { class: 'sidebar' }, nav, foot), content, playerBar.el),
  );
  renderSidebar();
  renderProfileButton();
  renderView();

  const offs = [
    bus.on('view', () => {
      renderSidebar();
      renderView();
    }),
    bus.on('playlists', renderSidebar),
    // Leaving a profile empties the library after the profile is gone.
    bus.on('tracks', () => app.profile && renderSidebar()),
    bus.on('player:state', markPlaying),
    bus.on('player:track', markPlaying),
    bus.on('profile', renderProfileButton),
  ];

  return () => {
    offs.forEach((off) => off());
    cleanupView?.();
    playerBar.destroy();
    closeMenu();
    titlebarActions.replaceChildren();
    ui.playCurrentView = null;
  };
}
