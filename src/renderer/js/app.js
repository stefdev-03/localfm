// Entry point: decides which screen to show and wires the flows together.

import { isTypingTarget } from './dom.js';
import { app, bus, ui, setTracks, navigate, goBack, savePlaylist, applyTheme } from './state.js';
import { player } from './player.js';
import { openModal, toast } from './components/overlays.js';
import { showWizard } from './views/wizard.js';
import { showProfilePicker, openProfileEditor, confirmProfileDelete } from './views/profiles.js';
import { createPlaylistEditor } from './views/playlistEditor.js';
import { openPlaylistDetails } from './views/playlistDetails.js';
import { mountShell } from './views/shell.js';
import { openSettings } from './views/settings.js';

const api = window.api;
const screen = document.getElementById('screen');
let cleanupScreen = null;
let scanToken = 0;
let rescanQueued = false;

function setScreen(mount) {
  cleanupScreen?.();
  cleanupScreen = null;
  screen.replaceChildren();
  cleanupScreen = mount(screen) ?? null;
}

// The stylesheet works the accent out from this, differently for each theme.
const setAccent = (color) => document.documentElement.style.setProperty('--profile-color', color);

async function refreshState() {
  const state = await api.getState();
  app.version = state.version;
  app.settings = state.settings;
  applyTheme(app.settings.theme);
  app.profiles = state.profiles;
  return state;
}

const readyProfiles = () => app.profiles.filter((profile) => profile.setupComplete);

function leaveProfile() {
  scanToken += 1;
  rescanQueued = false;
  player.stop();
  app.profile = null;
  app.scanning = false;
  app.missingFolders = [];
  setTracks([]);
}

// --- screens --------------------------------------------------------------

async function enterProfile(profileId) {
  leaveProfile();
  await api.setActiveProfile(profileId);
  await refreshState();
  const profile = app.profiles.find((item) => item.id === profileId);
  if (!profile) return start();
  app.profile = profile;
  app.view = { type: 'songs' };
  setAccent(profile.color);
  setTracks(await api.getLibrary(profile.id));
  player.restore(profile.player);
  setScreen(mountShell);
  rescan(); // pick up files added or removed since the last launch
}

async function rescan() {
  const profile = app.profile;
  if (!profile) return;
  if (app.scanning) {
    rescanQueued = true; // folders changed mid-scan: go again when this one ends
    return;
  }
  const token = ++scanToken;
  app.scanning = true;
  bus.emit('scan');
  try {
    const result = await api.scanLibrary(profile.id);
    if (token !== scanToken) return; // the user switched profile meanwhile
    app.missingFolders = result.missingFolders;
    setTracks(result.tracks);
  } catch {
    if (token === scanToken) toast('Your music folder could not be read.');
  } finally {
    if (token === scanToken) {
      app.scanning = false;
      bus.emit('scan');
      if (rescanQueued) {
        rescanQueued = false;
        rescan();
      }
    }
  }
}

async function startWizard({ isFirst }) {
  leaveProfile();
  await refreshState();
  // Reuse a setup that was interrupted, otherwise begin a new profile.
  const profile = app.profiles.find((item) => !item.setupComplete) ?? (await api.createProfile({}));
  setAccent(profile.color);
  setScreen((root) =>
    showWizard(root, {
      profile,
      isFirst,
      onFinish: (profileId, { addAnother } = {}) => (addAnother ? startWizard({ isFirst: false }) : enterProfile(profileId)),
      onCancel: async () => {
        await api.deleteProfile(profile.id);
        start();
      },
    }),
  );
}

async function showPicker() {
  leaveProfile();
  await refreshState();
  const profiles = readyProfiles();
  if (!profiles.length) return start();
  setAccent(profiles[0].color);
  setScreen((root) =>
    showProfilePicker(root, {
      profiles,
      onChoose: (profile) => enterProfile(profile.id),
      onAdd: () => startWizard({ isFirst: false }),
      onEdit: (profile) => editProfile(profile, showPicker),
      onDelete: (profile) => deleteProfile(profile),
    }),
  );
}

// Opens the right screen for the saved data: setup, the picker, or the player.
async function start({ fresh = false } = {}) {
  await refreshState();
  const ready = readyProfiles();
  if (!ready.length) return startWizard({ isFirst: true });
  if (fresh) {
    // A setup abandoned by closing the app leaves a half-made profile behind.
    for (const draft of app.profiles.filter((profile) => !profile.setupComplete)) await api.deleteProfile(draft.id);
  }
  if (ready.length === 1) return enterProfile(ready[0].id);
  return showPicker();
}

// --- flows used from the views ---------------------------------------------

function editProfile(profile, afterChange) {
  openProfileEditor(profile, {
    onSave: async (patch) => {
      const updated = await api.updateProfile(profile.id, patch);
      await refreshState();
      if (app.profile?.id === profile.id) {
        Object.assign(app.profile, { name: updated.name, color: updated.color, picture: updated.picture });
        setAccent(updated.color);
        bus.emit('profile');
      }
      afterChange?.();
    },
    onDelete: () => removeProfile(profile),
  });
}

// Deletes a profile that the user has already agreed to delete. Deleting some
// other profile from inside the player leaves the music playing; deleting the
// one in use (or any from the picker) goes back to whichever screen fits.
async function removeProfile(profile) {
  const inUse = app.profile?.id === profile.id;
  if (inUse) leaveProfile();
  await api.deleteProfile(profile.id);
  if (inUse || !app.profile) return start();
  await refreshState();
  bus.emit('profile');
  toast(`Profile “${profile.name}” deleted`);
}

async function deleteProfile(profile) {
  if (await confirmProfileDelete(profile)) await removeProfile(profile);
}

// New playlist: the three steps. Existing playlist: just the song picker.
function openPlaylistDialog({ playlist = null, preselect = [] } = {}) {
  let modal;
  const editor = createPlaylistEditor({
    tracks: app.tracks,
    playlist,
    preselect,
    onCancel: () => modal.close(),
    onSubmit: async (draft) => {
      const saved = await savePlaylist(app.profile.id, draft);
      modal.close();
      if (!playlist) {
        navigate({ type: 'playlist', id: saved.id });
        toast(`Playlist “${saved.name}” created`);
      }
    },
  });
  modal = openModal({
    title: playlist ? `Add songs to “${playlist.name}”` : 'Create playlist',
    size: 'xl',
    content: editor.el,
    onClose: () => editor.destroy(),
  });
}

Object.assign(ui, {
  createPlaylist: (options) => openPlaylistDialog(options),
  editPlaylistSongs: (playlist) => openPlaylistDialog({ playlist }),
  editPlaylistDetails: (playlist) => openPlaylistDetails(app.profile.id, playlist),
  openSettings,
  rescan,
  switchProfile: (profileId) => enterProfile(profileId),
  addProfile: () => startWizard({ isFirst: false }),
  editProfile: (profile) => editProfile(profile),
  deleteProfile,
  showPicker,
});

// --- app-wide wiring --------------------------------------------------------

api.onTrackUpdated(({ id, art }) => {
  const track = app.trackMap.get(id);
  if (!track) return;
  track.art = art;
  bus.emit('track-art', track);
});
api.onScanProgress((progress) => bus.emit('scan-progress', progress));

bus.on('player:error', (track) => {
  toast(`“${track.title}” could not be played. The file may have been moved or deleted.`);
});

let prefsTimer = null;
bus.on('player:prefs', () => {
  const profile = app.profile;
  if (!profile) return;
  profile.player = { volume: player.volume, shuffle: player.shuffle, repeat: player.repeat };
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => api.updateProfile(profile.id, { player: profile.player }), 400);
});

document.addEventListener('keydown', (event) => {
  if (!app.profile || document.querySelector('.modal-overlay')) return;
  const typing = isTypingTarget(event.target);
  if (event.code === 'Space' && !typing && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    if (player.current) player.toggle();
    else ui.playCurrentView?.();
  } else if (event.ctrlKey && event.key === 'ArrowRight' && !typing) {
    event.preventDefault();
    player.next();
  } else if (event.ctrlKey && event.key === 'ArrowLeft' && !typing) {
    event.preventDefault();
    player.prev();
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    bus.emit('focus-search');
  } else if (event.altKey && event.key === 'ArrowLeft' && !typing) {
    if (goBack()) event.preventDefault();
  }
});

// The mouse's back button (button 3) leaves an album or artist page too.
document.addEventListener('mouseup', (event) => {
  if (event.button !== 3 || !app.profile || document.querySelector('.modal-overlay')) return;
  if (goBack()) event.preventDefault();
});

start({ fresh: true });
