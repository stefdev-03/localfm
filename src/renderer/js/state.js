// Shared app state, a small event bus, and the actions that change playlists.

const api = window.api;
const listeners = new Map();

export const bus = {
  on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return () => listeners.get(event)?.delete(callback);
  },
  emit(event, payload) {
    for (const callback of [...(listeners.get(event) ?? [])]) callback(payload);
  },
};

export const app = {
  version: '',
  settings: { onlineArt: true, theme: 'dark' },
  profiles: [],
  profile: null, // the profile currently in use
  tracks: [],
  trackMap: new Map(),
  view: { type: 'songs' },
  scanning: false,
  missingFolders: [],
};

// Dark is the default; "light" is the only other theme.
export function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
}

// Filled in by app.js so views can start flows without importing each other.
export const ui = {};

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// The library is kept in title order, so every list that does not offer its
// own sorting (the song picker, the setup preview) reads the same way.
export function setTracks(tracks) {
  app.tracks = tracks.slice().sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist));
  app.trackMap = new Map(app.tracks.map((track) => [track.id, track]));
  bus.emit('tracks');
}

export function navigate(view) {
  app.view = view;
  bus.emit('view');
}

// Detail pages (an album, later an artist) carry the view they were opened
// from, so Back returns there with its scroll position and search intact.
export function goBack() {
  if (!app.view.from) return false;
  navigate(app.view.from);
  return true;
}

export const findPlaylist = (id) => app.profile?.playlists.find((playlist) => playlist.id === id) ?? null;

export const playlistTracks = (playlist) =>
  playlist.trackIds.map((id) => app.trackMap.get(id)).filter(Boolean);

function replacePlaylist(saved) {
  const playlists = app.profile.playlists;
  const index = playlists.findIndex((playlist) => playlist.id === saved.id);
  if (index === -1) playlists.push(saved);
  else playlists[index] = saved;
  bus.emit('playlists', { id: saved.id });
}

// draft: { id?, name, trackIds, image, banner } where each picture is
// { blob } for a new upload, { file } to keep the saved one, or null for none.
export async function savePlaylist(profileId, draft) {
  const payload = { id: draft.id, name: draft.name, trackIds: draft.trackIds };
  for (const key of ['image', 'banner']) {
    const picture = draft[key];
    if (picture?.blob) {
      const bytes = new Uint8Array(await picture.blob.arrayBuffer());
      payload[key] = (await api.saveImage(bytes)) ?? null;
    } else {
      payload[key] = picture?.file ?? null;
    }
  }
  const saved = await api.savePlaylist(profileId, payload);
  if (!saved) throw new Error('The playlist could not be saved.');
  if (app.profile?.id === profileId) replacePlaylist(saved);
  return saved;
}

export async function setPlaylistTracks(playlistId, trackIds) {
  const playlist = findPlaylist(playlistId);
  if (!playlist) return null;
  const saved = await api.savePlaylist(app.profile.id, { id: playlist.id, name: playlist.name, trackIds });
  if (saved) replacePlaylist(saved);
  return saved;
}

export async function deletePlaylist(playlistId) {
  const profile = app.profile;
  await api.deletePlaylist(profile.id, playlistId);
  profile.playlists = profile.playlists.filter((playlist) => playlist.id !== playlistId);
  if (app.view.type === 'playlist' && app.view.id === playlistId) navigate({ type: 'songs' });
  bus.emit('playlists', { id: playlistId, deleted: true });
}
