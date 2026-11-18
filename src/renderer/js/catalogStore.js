// The window's albums and artists, worked out from app.tracks once and kept
// until the tracks or their cover art change. Also holds the artist pictures
// found so far.

import { app, bus } from './state.js';
import { buildCatalog } from './catalog.js';
import { player } from './player.js';

let cached = null;
let source = null;
const forget = () => {
  cached = null;
};
bus.on('tracks', forget);
bus.on('track-art', forget); // an album's picture is its first song's

export function getCatalog() {
  if (!cached || source !== app.tracks) {
    source = app.tracks;
    cached = buildCatalog(app.tracks);
  }
  return cached;
}

export const findAlbum = (key) => getCatalog().albumMap.get(key) ?? null;
export const findArtist = (key) => getCatalog().artistMap.get(key) ?? null;

function playTracks(tracks, startId, context, options) {
  player.playList(
    tracks.map((track) => track.id),
    startId,
    context,
    options,
  );
}

export function playAlbum(album, startId = null, options = {}) {
  playTracks(album.tracks, startId, { type: 'album', key: album.key, name: album.title }, options);
}

export function playArtist(artist, startId = null, options = {}) {
  playTracks(artist.tracks, startId, { type: 'artist', key: artist.key, name: artist.name }, options);
}

// ---- artist pictures ----------------------------------------------------
// Keyed by the artist's name as shown. Asked for only when a page is about to
// show those artists, so opening the app never starts a burst of lookups.

const pictures = new Map();

export const artistPicture = (name) => pictures.get(name) ?? null;

export async function requestArtistPictures(names) {
  if (!names.length) return;
  const found = await window.api.getArtistPictures(names);
  let changed = false;
  for (const [name, file] of Object.entries(found ?? {})) {
    if (pictures.get(name) !== file) {
      pictures.set(name, file);
      changed = true;
    }
  }
  if (changed) bus.emit('artist-picture');
}

window.api.onArtistPicture(({ name, file }) => {
  pictures.set(name, file);
  bus.emit('artist-picture', { name, file });
});
