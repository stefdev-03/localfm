// Playback engine: one <audio> element plus the play queue.
// The queue is a snapshot of the list the user started from (all songs or a
// playlist); shuffle and repeat only change the order it is walked in.

import { app, bus } from './state.js';
import { artUrl, trackUrl } from './dom.js';

const RESTART_THRESHOLD = 3; // seconds; "previous" restarts the song past this point

function shuffled(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.list = []; // track ids, in the order shown on screen
    this.order = []; // indexes into list, in play order
    this.pos = -1;
    this.current = null;
    this.context = null; // { type: 'songs' | 'playlist', id?, name }
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.volume = 0.8;
    this.muted = false;
    this.failures = 0;

    this.audio.addEventListener('play', () => bus.emit('player:state'));
    this.audio.addEventListener('pause', () => bus.emit('player:state'));
    this.audio.addEventListener('playing', () => {
      this.failures = 0;
    });
    this.audio.addEventListener('timeupdate', () => bus.emit('player:time'));
    this.audio.addEventListener('durationchange', () => bus.emit('player:time'));
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('error', () => this.#onError());
    this.#applyVolume();
    this.#bindMediaKeys();
  }

  get playing() {
    return Boolean(this.current) && !this.audio.paused;
  }

  get position() {
    return this.audio.currentTime || 0;
  }

  get duration() {
    const real = this.audio.duration;
    return Number.isFinite(real) && real > 0 ? real : this.current?.duration || 0;
  }

  restore({ volume, shuffle, repeat } = {}) {
    if (Number.isFinite(volume)) this.volume = Math.min(1, Math.max(0, volume));
    this.shuffle = Boolean(shuffle);
    this.repeat = ['off', 'all', 'one'].includes(repeat) ? repeat : 'off';
    this.muted = false;
    this.#applyVolume();
    bus.emit('player:state');
  }

  // Starts playing a list. startId picks the first song; without it playback
  // starts at the top (or at a random song when shuffle is on).
  playList(ids, startId = null, context = null, { shuffle } = {}) {
    if (!ids.length) return;
    if (typeof shuffle === 'boolean' && shuffle !== this.shuffle) {
      this.shuffle = shuffle;
      bus.emit('player:prefs');
    }
    this.list = ids.slice();
    this.context = context;
    let start = startId ? this.list.indexOf(startId) : -1;
    if (start === -1) start = this.shuffle ? Math.floor(Math.random() * this.list.length) : 0;
    this.#buildOrder(start);
    this.#playAt(this.pos);
  }

  #buildOrder(startIndex) {
    const indexes = this.list.map((_, i) => i);
    if (this.shuffle) {
      this.order = [startIndex, ...shuffled(indexes.filter((i) => i !== startIndex))];
      this.pos = 0;
    } else {
      this.order = indexes;
      this.pos = startIndex;
    }
  }

  // Loads the song at a queue position, skipping entries whose file is gone.
  #playAt(pos, autoplay = true) {
    const count = this.order.length;
    for (let tries = 0; tries < count; tries++) {
      const track = app.trackMap.get(this.list[this.order[pos]]);
      if (track) {
        this.pos = pos;
        this.#start(track, autoplay);
        return true;
      }
      pos = (pos + 1) % count;
    }
    this.stop();
    return false;
  }

  #start(track, autoplay) {
    this.current = track;
    this.audio.src = trackUrl(track.id);
    if (autoplay) this.audio.play().catch(() => {});
    else this.audio.load();
    this.#updateMediaSession();
    bus.emit('player:track');
    bus.emit('player:state');
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  // auto = the song ended by itself (as opposed to the user pressing "next").
  next(auto = false) {
    if (!this.current || !this.order.length) return;
    if (auto && this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    let pos = this.pos + 1;
    let autoplay = true;
    if (pos >= this.order.length) {
      // End of the list: repeat starts it over, otherwise rewind and stop.
      if (auto && this.repeat === 'off') autoplay = false;
      if (this.shuffle && this.order.length > 1) {
        const last = this.order[this.pos];
        do {
          this.#buildOrder(Math.floor(Math.random() * this.list.length));
        } while (this.order[0] === last);
      }
      pos = 0;
    }
    this.#playAt(pos, autoplay);
  }

  prev() {
    if (!this.current || !this.order.length) return;
    if (this.position > RESTART_THRESHOLD || (this.pos === 0 && this.repeat !== 'all')) {
      this.audio.currentTime = 0;
      if (this.audio.paused) this.audio.play().catch(() => {});
      return;
    }
    this.#playAt(this.pos === 0 ? this.order.length - 1 : this.pos - 1);
  }

  seek(seconds) {
    if (!this.current) return;
    const max = this.duration || 0;
    this.audio.currentTime = Math.min(Math.max(0, seconds), max ? Math.max(0, max - 0.05) : seconds);
    bus.emit('player:time');
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.order.length && this.pos >= 0) this.#buildOrder(this.order[this.pos]);
    bus.emit('player:state');
    bus.emit('player:prefs');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    bus.emit('player:state');
    bus.emit('player:prefs');
  }

  setVolume(value) {
    this.volume = Math.min(1, Math.max(0, value));
    this.muted = false;
    this.#applyVolume();
    bus.emit('player:state');
    bus.emit('player:prefs');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.#applyVolume();
    bus.emit('player:state');
  }

  #applyVolume() {
    this.audio.volume = this.volume ** 2; // squared so the slider feels even to the ear
    this.audio.muted = this.muted;
  }

  stop() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.list = [];
    this.order = [];
    this.pos = -1;
    this.current = null;
    this.context = null;
    this.failures = 0;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    bus.emit('player:track');
    bus.emit('player:state');
    bus.emit('player:time');
  }

  #onError() {
    if (!this.current || !this.audio.getAttribute('src')) return;
    const failed = this.current;
    this.failures += 1;
    bus.emit('player:error', failed);
    const atEnd = this.pos + 1 >= this.order.length;
    if (this.failures >= Math.min(5, this.order.length) || (atEnd && this.repeat !== 'all')) {
      this.stop();
      return;
    }
    this.#playAt(atEnd ? 0 : this.pos + 1);
  }

  #updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.current.title,
        artist: this.current.artist || 'Unknown artist',
        album: this.current.album || '',
        artwork: this.current.art ? [{ src: artUrl(this.current.art) }] : [],
      });
    } catch {
      /* metadata is a nicety */
    }
  }

  #bindMediaKeys() {
    if (!('mediaSession' in navigator)) return;
    const bind = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* not every action exists everywhere */
      }
    };
    bind('play', () => this.toggle());
    bind('pause', () => this.toggle());
    bind('nexttrack', () => this.next());
    bind('previoustrack', () => this.prev());
  }
}

export const player = new Player();
