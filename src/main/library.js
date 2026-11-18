// Scans a profile's music folders, reads tags, and keeps a per-profile cache
// so later launches only re-read files that changed.
//
// Cover art, in order: the picture inside the file, a picture file beside it,
// then whatever the online lookup has found for that artist and title.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJson, writeJsonAtomic } from './store.js';
import { resolveNames } from './trackname.js';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus']);
const PARSE_CONCURRENCY = 6;

// Pictures kept beside the music: "Song.jpg" next to "Song.flac", or one
// cover for a whole album folder.
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const FOLDER_COVERS = ['cover', 'folder', 'front'];
const MAX_COVER_BYTES = 15 * 1024 * 1024;

// Raised whenever a track gains fields, so tracks cached by an older version
// are read again once instead of lacking them forever.
export const TRACK_VERSION = 2;

const positiveInt = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
const sensibleYear = (value) => (Number.isInteger(value) && value >= 1000 && value <= new Date().getFullYear() + 1 ? value : 0);

// Albums are often saved as "Artist - Album/01 - Artist - Title.ext" with no
// album tag in the files. Only that exact layout is read as an album: a folder
// directly inside a music folder never is, and the file must start with a
// track number.
export function albumFromFolder(filePath, roots) {
  const dir = path.dirname(filePath);
  if (roots.has(path.normalize(dir).toLowerCase())) return null;
  const folder = path.basename(dir).match(/^(.+?) - (.+)$/);
  const number = path.basename(filePath).match(/^(\d{1,3})\s*(?:-|\.|\s)/);
  if (!folder || !number) return null;
  return { albumArtist: folder[1].trim(), album: folder[2].trim(), trackNo: positiveInt(Number(number[1])) };
}

export const trackIdFor = (filePath) =>
  crypto.createHash('sha1').update(path.normalize(filePath).toLowerCase()).digest('hex').slice(0, 16);

async function walk(dir, out) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable folder: skip it, keep going
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

export class Library {
  constructor({ dir, artwork }) {
    this.dir = dir;
    this.artwork = artwork;
    this.cache = new Map(); // profileId -> tracks[]
    this.paths = new Map(); // trackId -> absolute path, for the media protocol
    this.scans = new Map(); // profileId -> in-flight scan promise
    this.saveTimers = new Map();
    this.mm = null;
  }

  #file(profileId) {
    return path.join(this.dir, `library-${profileId}.json`);
  }

  #register(tracks) {
    for (const track of tracks) this.paths.set(track.id, track.path);
  }

  pathFor(trackId) {
    return this.paths.get(trackId) ?? null;
  }

  get(profileId) {
    if (!this.cache.has(profileId)) {
      const saved = readJson(this.#file(profileId), []);
      const tracks = Array.isArray(saved) ? saved.filter((t) => t && t.id && t.path) : [];
      this.cache.set(profileId, tracks);
      this.#register(tracks);
    }
    return this.cache.get(profileId);
  }

  forget(profileId) {
    this.cache.delete(profileId);
    clearTimeout(this.saveTimers.get(profileId));
    this.saveTimers.delete(profileId);
    fs.rmSync(this.#file(profileId), { force: true });
  }

  scan(profileId, folders, onProgress) {
    if (!this.scans.has(profileId)) {
      const run = this.#scan(profileId, folders, onProgress).finally(() => this.scans.delete(profileId));
      this.scans.set(profileId, run);
    }
    return this.scans.get(profileId);
  }

  async #scan(profileId, folders, onProgress = () => {}) {
    const previous = new Map(this.get(profileId).map((t) => [t.path, t]));
    const files = [];
    const missingFolders = [];
    for (const folder of folders) {
      try {
        if (!(await fs.promises.stat(folder)).isDirectory()) throw new Error('not a folder');
      } catch {
        missingFolders.push(folder);
        continue;
      }
      await walk(folder, files);
    }
    const unique = [...new Map(files.map((f) => [f.toLowerCase(), f])).values()];
    // A cover file in a music folder itself would be claimed by every loose
    // song in it, so folder covers only count inside subfolders.
    const covers = { roots: new Set(folders.map((f) => path.normalize(f).toLowerCase())), dirs: new Map(), saved: new Map() };
    const total = unique.length;
    let done = 0;
    let lastReport = 0;
    onProgress({ done, total });

    const tracks = new Array(total);
    let cursor = 0;
    const worker = async () => {
      while (cursor < total) {
        const index = cursor++;
        tracks[index] = await this.#readTrack(unique[index], previous.get(unique[index]), covers);
        done += 1;
        if (Date.now() - lastReport > 60 || done === total) {
          lastReport = Date.now();
          onProgress({ done, total });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARSE_CONCURRENCY, total) }, worker));

    const result = tracks.filter(Boolean);
    this.cache.set(profileId, result);
    this.#register(result);
    this.#saveNow(profileId);
    this.artwork.enqueue(result);
    return { tracks: result, missingFolders };
  }

  // The picture stored next to a song, copied into the art cache. Returns its
  // cache name, or null when there is none.
  async #coverBeside(filePath, covers) {
    const dir = path.dirname(filePath);
    if (!covers.dirs.has(dir)) {
      covers.dirs.set(
        dir,
        fs.promises.readdir(dir).then(
          (names) => new Map(names.map((name) => [name.toLowerCase(), name])),
          () => new Map(),
        ),
      );
    }
    const names = await covers.dirs.get(dir);
    const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const stems = covers.roots.has(dir.toLowerCase()) ? [stem] : [stem, ...FOLDER_COVERS];
    for (const candidate of stems) {
      for (const ext of COVER_EXTENSIONS) {
        const name = names.get(candidate + ext);
        if (!name) continue;
        const file = path.join(dir, name);
        if (!covers.saved.has(file)) covers.saved.set(file, this.#importCover(file));
        const art = await covers.saved.get(file);
        if (art) return art;
      }
    }
    return null;
  }

  async #importCover(file) {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > MAX_COVER_BYTES) return null;
      return await this.artwork.saveEmbedded({ data: await fs.promises.readFile(file), format: path.extname(file) });
    } catch {
      return null;
    }
  }

  async #readTrack(filePath, previous, covers) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return null;
    }
    const fresh = previous && previous.v === TRACK_VERSION && previous.mtime === stat.mtimeMs && previous.size === stat.size;
    if (fresh) {
      if (previous.art && !this.artwork.has(previous.art)) previous.art = null;
      if (!previous.art) previous.art = (await this.#coverBeside(filePath, covers)) ?? this.artwork.cached(previous);
      return previous;
    }

    const fileName = path.basename(filePath);
    let tags = {};
    let duration = 0;
    let art = null;
    try {
      this.mm ??= await import('music-metadata');
      const meta = await this.mm.parseFile(filePath);
      tags = meta.common ?? {};
      duration = Number.isFinite(meta.format?.duration) ? meta.format.duration : 0;
      const cover = this.mm.selectCover(tags.picture);
      if (cover) art = await this.artwork.saveEmbedded(cover);
    } catch {
      /* unreadable tags: the file name is enough to list and play it */
    }

    const { title, artist } = resolveNames(fileName, tags);
    const track = {
      v: TRACK_VERSION,
      id: trackIdFor(filePath),
      path: filePath,
      title,
      artist,
      album: typeof tags.album === 'string' ? tags.album.trim() : '',
      albumArtist: typeof tags.albumartist === 'string' ? tags.albumartist.trim() : '',
      year: sensibleYear(tags.year),
      trackNo: positiveInt(tags.track?.no),
      discNo: positiveInt(tags.disk?.no),
      duration,
      art,
      mtime: stat.mtimeMs,
      size: stat.size,
    };
    if (!track.album) {
      const guess = albumFromFolder(filePath, covers.roots);
      if (guess) {
        track.album = guess.album;
        track.albumArtist ||= guess.albumArtist;
        track.trackNo ||= guess.trackNo;
      }
    }
    if (!track.art) track.art = (await this.#coverBeside(filePath, covers)) ?? this.artwork.cached(track);
    return track;
  }

  // Called when an online lookup finds a cover. Returns true if anything changed.
  setArt(trackId, file) {
    let changed = false;
    for (const [profileId, tracks] of this.cache) {
      const track = tracks.find((t) => t.id === trackId);
      if (track && track.art !== file) {
        track.art = file;
        changed = true;
        this.#saveSoon(profileId);
      }
    }
    return changed;
  }

  #saveSoon(profileId) {
    clearTimeout(this.saveTimers.get(profileId));
    this.saveTimers.set(profileId, setTimeout(() => this.#saveNow(profileId), 1500));
  }

  #saveNow(profileId) {
    clearTimeout(this.saveTimers.get(profileId));
    this.saveTimers.delete(profileId);
    if (!this.cache.has(profileId)) return;
    try {
      writeJsonAtomic(this.#file(profileId), this.cache.get(profileId));
    } catch {
      /* the cache is rebuilt by the next scan */
    }
  }

  flush() {
    for (const profileId of [...this.saveTimers.keys()]) this.#saveNow(profileId);
  }
}
