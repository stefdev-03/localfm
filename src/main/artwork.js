// Cover art: pictures embedded in the files are extracted to a cache folder;
// songs without one are looked up online by artist + title (Deezer, then iTunes).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { nativeImage, net } from 'electron';
import { readJson, writeJsonAtomic } from './store.js';
import { isSameSong, lookupKey, normalize, primaryArtist } from './match.js';

const MAX_SIDE = 600;
const RETRY_MISS_AFTER = 30 * 24 * 60 * 60 * 1000;
const ITUNES_MIN_GAP = 3200; // iTunes allows roughly 20 searches a minute
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

export class Artwork {
  constructor({ dir, cacheFile, isOnlineEnabled, onFound, onArtistFound = () => {} }) {
    this.dir = dir;
    this.cacheFile = cacheFile;
    this.isOnlineEnabled = isOnlineEnabled;
    this.onFound = onFound;
    this.onArtistFound = onArtistFound;
    this.lookups = readJson(cacheFile, {});
    this.queue = [];
    this.queued = new Set();
    this.running = false;
    this.lastItunes = 0;
    this.saveTimer = null;
    fs.mkdirSync(dir, { recursive: true });
  }

  has(file) {
    return Boolean(file) && fs.existsSync(path.join(this.dir, file));
  }

  // Saves a picture found inside an audio file and returns its cache file name.
  async saveEmbedded(picture) {
    if (!picture?.data?.length) return null;
    const data = Buffer.from(picture.data);
    const name = `e-${sha1(data).slice(0, 20)}`;
    for (const ext of ['jpg', 'png']) {
      if (fs.existsSync(path.join(this.dir, `${name}.${ext}`))) return `${name}.${ext}`;
    }
    try {
      let image = nativeImage.createFromBuffer(data);
      if (!image.isEmpty()) {
        const { width, height } = image.getSize();
        if (Math.max(width, height) > MAX_SIDE) {
          image = image.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
        }
        await fs.promises.writeFile(path.join(this.dir, `${name}.jpg`), image.toJPEG(88));
        return `${name}.jpg`;
      }
    } catch {
      /* fall through to writing the raw bytes */
    }
    const format = String(picture.format ?? '').toLowerCase();
    const ext = format.includes('png') ? 'png' : format.includes('jp') ? 'jpg' : null;
    if (!ext) return null;
    await fs.promises.writeFile(path.join(this.dir, `${name}.${ext}`), data);
    return `${name}.${ext}`;
  }

  // Art we already downloaded for this artist + title, without touching the network.
  cached(track) {
    if (!track.artist || !track.title) return null;
    const hit = this.lookups[lookupKey(track.artist, track.title)];
    return hit?.file && this.has(hit.file) ? hit.file : null;
  }

  enqueue(tracks) {
    if (!this.isOnlineEnabled()) return;
    for (const track of tracks) {
      if (track.art || !track.artist || !track.title || this.queued.has(track.id)) continue;
      const key = lookupKey(track.artist, track.title);
      if (key.startsWith('|') || key.endsWith('|')) continue;
      const known = this.lookups[key];
      if (known?.file && this.has(known.file)) {
        this.onFound(track.id, known.file);
        continue;
      }
      if (known && !known.file && Date.now() - known.at < RETRY_MISS_AFTER) continue;
      this.queued.add(track.id);
      this.queue.push({ id: track.id, artist: track.artist, title: track.title, key });
    }
    this.#run();
  }

  // ---- artist pictures ----------------------------------------------------
  //
  // Looked up only for the names the window is about to show, through the
  // same queue as covers so the two together stay inside Deezer's limit.
  // Their lookup keys start with "@", which a normalised artist|title key
  // never does.

  #artistKey(name) {
    const key = normalize(name);
    return key ? `@artist:${key}` : null;
  }

  // The saved picture for each name that has one; the rest are looked up
  // (when online lookups are on) and reported through onArtistFound.
  artistPictures(names) {
    const found = {};
    const wanted = [];
    for (const name of names) {
      const key = this.#artistKey(name);
      if (!key) continue;
      const known = this.lookups[key];
      if (known?.file && this.has(known.file)) found[name] = known.file;
      else if (!(known && !known.file && Date.now() - known.at < RETRY_MISS_AFTER)) wanted.push({ name, key });
    }
    if (this.isOnlineEnabled()) {
      // Someone is looking at these right now, so they go ahead of covers.
      const jobs = wanted
        .filter(({ key }) => !this.queued.has(key))
        .map(({ name, key }) => ({ kind: 'artist', id: key, name, key }));
      for (const job of jobs) this.queued.add(job.id);
      this.queue.unshift(...jobs);
      this.#run();
    }
    return found;
  }

  clearQueue() {
    this.queue.length = 0;
    this.queued.clear();
  }

  async #run() {
    if (this.running) return;
    this.running = true;
    let networkFailures = 0;
    try {
      while (this.queue.length && this.isOnlineEnabled()) {
        const job = this.queue.shift();
        this.queued.delete(job.id);
        const isArtist = job.kind === 'artist';
        const report = (file) => (isArtist ? this.onArtistFound(job.name, file) : this.onFound(job.id, file));
        const known = this.lookups[job.key];
        if (known?.file && this.has(known.file)) {
          report(known.file);
          continue;
        }
        if (known && !known.file && Date.now() - known.at < RETRY_MISS_AFTER) continue;
        try {
          const url = isArtist ? await this.#searchArtist(job) : await this.#search(job);
          const file = url ? await this.#download(url, job.key, isArtist ? 'a' : 'o') : null;
          this.lookups[job.key] = { file, at: Date.now() };
          this.#saveSoon();
          if (file) report(file);
          networkFailures = 0;
        } catch {
          // Offline or the service is unreachable: do not record a miss, try again next launch.
          networkFailures += 1;
          if (networkFailures >= 3) {
            this.clearQueue();
            break;
          }
        }
        await sleep(140);
      }
    } finally {
      this.running = false;
    }
  }

  async #getJson(url) {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async #search(job) {
    const artist = primaryArtist(job.artist);
    const title = job.title.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s+/g, ' ').trim() || job.title;
    const local = { artist: job.artist, title: job.title };

    const deezer = async (query) => {
      let body = await this.#getJson(`https://api.deezer.com/search?limit=8&q=${encodeURIComponent(query)}`);
      if (body?.error?.code === 4) {
        await sleep(5000); // quota: 50 requests per 5 seconds
        body = await this.#getJson(`https://api.deezer.com/search?limit=8&q=${encodeURIComponent(query)}`);
      }
      const match = (body?.data ?? []).find(
        (item) => item?.album?.cover_big && isSameSong(local, { artist: item.artist?.name, title: item.title }),
      );
      return match?.album?.cover_big ?? null;
    };

    const quoted = (text) => text.replace(/"/g, ' ');
    let url = await deezer(`artist:"${quoted(artist)}" track:"${quoted(title)}"`);
    if (!url) url = await deezer(`${artist} ${title}`);
    if (url) return url;

    const wait = this.lastItunes + ITUNES_MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastItunes = Date.now();
    const body = await this.#getJson(
      `https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${encodeURIComponent(`${artist} ${title}`)}`,
    );
    const match = (body?.results ?? []).find(
      (item) => item?.artworkUrl100 && isSameSong(local, { artist: item.artistName, title: item.trackName }),
    );
    return match ? match.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null;
  }

  // Deezer's artist search. Only an exact name match is accepted: a wrong
  // face is worse than an initial. Artists Deezer has no picture of come
  // with a grey silhouette whose address has an empty id segment
  // (".../images/artist//500x500..."); that is not saved.
  async #searchArtist(job) {
    const url = `https://api.deezer.com/search/artist?limit=5&q=${encodeURIComponent(job.name)}`;
    let body = await this.#getJson(url);
    if (body?.error?.code === 4) {
      await sleep(5000); // quota: 50 requests per 5 seconds
      body = await this.#getJson(url);
    }
    const wanted = normalize(job.name);
    const match = (body?.data ?? []).find((item) => item?.name && normalize(item.name) === wanted);
    const picture = match?.picture_big;
    if (typeof picture !== 'string' || !/^https?:\/\//.test(picture) || /\/images\/artist\/\//.test(picture)) return null;
    return picture;
  }

  // prefix: "o" for covers found online, "a" for artist pictures.
  async #download(url, key, prefix = 'o') {
    const response = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    let image = nativeImage.createFromBuffer(data);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    if (Math.max(width, height) > MAX_SIDE) image = image.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    const file = `${prefix}-${sha1(key).slice(0, 20)}.jpg`;
    await fs.promises.writeFile(path.join(this.dir, file), image.toJPEG(88));
    return file;
  }

  #saveSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 1000);
  }

  flush() {
    clearTimeout(this.saveTimer);
    try {
      writeJsonAtomic(this.cacheFile, this.lookups);
    } catch {
      /* the cache is only an optimisation */
    }
  }
}
