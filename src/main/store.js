// Persistent app data: profiles, each profile's folders and playlists, settings.
// Everything lives in one JSON file inside the app's user-data folder.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROFILE_COLORS = ['#ffb454', '#60cdff', '#6ccb5f', '#ff8fa3', '#b4a0ff', '#4fd8c4'];

export const newId = () => crypto.randomBytes(8).toString('hex');

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isImageName = (value) => typeof value === 'string' && /^[\w-]+\.(jpg|png)$/.test(value);
const clamp01 = (n) => Math.min(1, Math.max(0, n));

const defaults = () => ({
  version: 1,
  activeProfileId: null,
  profiles: [],
  settings: { onlineArt: true, theme: 'dark' },
});

export class Store {
  constructor(dir) {
    this.file = path.join(dir, 'data.json');
    this.timer = null;
    this.data = this.#load();
  }

  #load() {
    if (!fs.existsSync(this.file)) return defaults();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || !Array.isArray(parsed.profiles)) throw new Error('unexpected shape');
      return { ...defaults(), ...parsed, settings: { ...defaults().settings, ...parsed.settings } };
    } catch {
      // Keep the unreadable file so nothing is silently lost, then start fresh.
      try {
        fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        /* nothing more we can do */
      }
      return defaults();
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    writeJsonAtomic(this.file, this.data);
  }

  get state() {
    return this.data;
  }

  profile(id) {
    return this.data.profiles.find((p) => p.id === id) ?? null;
  }

  createProfile({ name, color } = {}) {
    const used = new Set(this.data.profiles.map((p) => p.color));
    const profile = {
      id: newId(),
      name: cleanText(name, 40) || `Profile ${this.data.profiles.length + 1}`,
      color: PROFILE_COLORS.includes(color) ? color : PROFILE_COLORS.find((c) => !used.has(c)) ?? PROFILE_COLORS[0],
      picture: null,
      setupComplete: false,
      folders: [],
      playlists: [],
      player: { volume: 0.8, shuffle: false, repeat: 'off' },
      createdAt: Date.now(),
    };
    this.data.profiles.push(profile);
    this.save();
    return profile;
  }

  updateProfile(id, patch = {}) {
    const profile = this.profile(id);
    if (!profile) return null;
    if (typeof patch.name === 'string' && cleanText(patch.name, 40)) profile.name = cleanText(patch.name, 40);
    if (PROFILE_COLORS.includes(patch.color)) profile.color = patch.color;
    // A picture is the name of a file in the images folder, or null for none.
    if ('picture' in patch) profile.picture = isImageName(patch.picture) ? patch.picture : null;
    if (typeof patch.setupComplete === 'boolean') profile.setupComplete = patch.setupComplete;
    if (Array.isArray(patch.folders)) {
      const seen = new Set();
      profile.folders = patch.folders
        .filter((f) => typeof f === 'string' && path.isAbsolute(f))
        .map((f) => path.normalize(f))
        .filter((f) => !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase()));
    }
    if (patch.player && typeof patch.player === 'object') {
      const { volume, shuffle, repeat } = patch.player;
      if (Number.isFinite(volume)) profile.player.volume = clamp01(volume);
      if (typeof shuffle === 'boolean') profile.player.shuffle = shuffle;
      if (['off', 'all', 'one'].includes(repeat)) profile.player.repeat = repeat;
    }
    this.save();
    return profile;
  }

  deleteProfile(id) {
    const index = this.data.profiles.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.data.profiles.splice(index, 1);
    if (this.data.activeProfileId === id) this.data.activeProfileId = null;
    this.save();
    return true;
  }

  setActive(id) {
    this.data.activeProfileId = this.profile(id) ? id : null;
    this.save();
  }

  // Creates the playlist when it has no id yet, otherwise updates it in place.
  // Returns { playlist, replacedImages } so the caller can delete old picture files.
  savePlaylist(profileId, input = {}) {
    const profile = this.profile(profileId);
    if (!profile) return null;
    const existing = input.id ? profile.playlists.find((p) => p.id === input.id) : null;
    const seen = new Set();
    const trackIds = (Array.isArray(input.trackIds) ? input.trackIds : existing?.trackIds ?? []).filter(
      (id) => typeof id === 'string' && /^[0-9a-f]{16}$/.test(id) && !seen.has(id) && seen.add(id),
    );
    const pick = (key) => (key in input ? (isImageName(input[key]) ? input[key] : null) : existing?.[key] ?? null);
    const next = {
      id: existing?.id ?? newId(),
      name: cleanText(input.name, 80) || existing?.name || 'New playlist',
      image: pick('image'),
      banner: pick('banner'),
      trackIds,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const replacedImages = [];
    if (existing) {
      for (const key of ['image', 'banner']) {
        if (existing[key] && existing[key] !== next[key]) replacedImages.push(existing[key]);
      }
      Object.assign(existing, next);
    } else {
      profile.playlists.push(next);
    }
    this.save();
    return { playlist: existing ?? next, replacedImages };
  }

  deletePlaylist(profileId, playlistId) {
    const profile = this.profile(profileId);
    if (!profile) return null;
    const index = profile.playlists.findIndex((p) => p.id === playlistId);
    if (index === -1) return null;
    const [removed] = profile.playlists.splice(index, 1);
    this.save();
    return removed;
  }

  updateSettings(patch = {}) {
    if (typeof patch.onlineArt === 'boolean') this.data.settings.onlineArt = patch.onlineArt;
    if (patch.theme === 'dark' || patch.theme === 'light') this.data.settings.theme = patch.theme;
    this.save();
    return this.data.settings;
  }

  referencedImages() {
    const names = new Set();
    for (const profile of this.data.profiles) {
      if (profile.picture) names.add(profile.picture);
      for (const playlist of profile.playlists) {
        if (playlist.image) names.add(playlist.image);
        if (playlist.banner) names.add(playlist.banner);
      }
    }
    return names;
  }
}
