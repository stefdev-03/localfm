// The transport bar along the bottom: seek, now playing, shuffle / previous /
// play-pause / next / repeat, and volume.

import { h, fill, icon, iconButton, setCover, formatTime, formatDuration } from '../dom.js';
import { bus, ui } from '../state.js';
import { player } from '../player.js';

const REPEAT_LABELS = { off: 'Repeat is off', all: 'Repeating the whole list', one: 'Repeating this song' };

export function createPlayerBar() {
  const coverEl = h('div', { class: 'cover pb-cover' });
  const titleEl = h('div', { class: 'pb-title ellipsis' });
  const artistEl = h('div', { class: 'pb-artist ellipsis' });
  const elapsed = h('span', { class: 'pb-time' }, '0:00');
  const total = h('span', { class: 'pb-time' }, '0:00');
  const seek = h('input', { type: 'range', class: 'slider', min: '0', max: '1000', value: '0', 'aria-label': 'Seek', dataset: { test: 'seek' } });
  const volume = h('input', { type: 'range', class: 'slider pb-volume', min: '0', max: '100', value: '80', 'aria-label': 'Volume' });

  const shuffle = iconButton('shuffle', 'Shuffle', { class: 'pb-btn', dataset: { test: 'shuffle' }, onclick: () => player.toggleShuffle() });
  const prev = iconButton('prev', 'Previous', { class: 'pb-btn', dataset: { test: 'prev' }, onclick: () => player.prev() }, 20);
  const play = iconButton('play', 'Play', { class: 'pb-play', dataset: { test: 'play-pause' }, onclick: () => (player.current ? player.toggle() : ui.playCurrentView?.()) }, 22);
  const next = iconButton('next', 'Next', { class: 'pb-btn', dataset: { test: 'next' }, onclick: () => player.next() }, 20);
  const repeat = iconButton('repeat', 'Repeat', { class: 'pb-btn', dataset: { test: 'repeat' }, onclick: () => player.cycleRepeat() });
  const mute = iconButton('volume', 'Mute', { class: 'pb-btn', onclick: () => player.toggleMute() });

  let seeking = false;
  const setFill = (slider, fraction) => slider.style.setProperty('--fill', `${Math.min(1, Math.max(0, fraction)) * 100}%`);

  function renderTrack() {
    const track = player.current;
    setCover(coverEl, track);
    coverEl.classList.toggle('is-idle', !track);
    titleEl.textContent = track ? track.title : 'Nothing playing';
    titleEl.title = track?.title ?? '';
    artistEl.textContent = track ? track.artist || 'Unknown artist' : 'Pick a song to start listening';
    for (const control of [prev, next, seek]) control.disabled = !track;
    renderTime();
  }

  function renderState() {
    const playing = player.playing;
    fill(play, icon(playing ? 'pause' : 'play', 22));
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.title = playing ? 'Pause (Space)' : 'Play (Space)';

    shuffle.classList.toggle('is-on', player.shuffle);
    shuffle.setAttribute('aria-pressed', String(player.shuffle));
    shuffle.title = player.shuffle ? 'Shuffle is on' : 'Shuffle is off';

    fill(repeat, icon(player.repeat === 'one' ? 'repeatOne' : 'repeat', 18));
    repeat.classList.toggle('is-on', player.repeat !== 'off');
    repeat.setAttribute('aria-pressed', String(player.repeat !== 'off'));
    repeat.title = REPEAT_LABELS[player.repeat];
    repeat.setAttribute('aria-label', REPEAT_LABELS[player.repeat]);
    repeat.dataset.mode = player.repeat;

    const level = player.muted ? 0 : player.volume;
    fill(mute, icon(level === 0 ? 'mute' : level < 0.5 ? 'volumeLow' : 'volume', 18));
    mute.title = player.muted ? 'Unmute' : 'Mute';
    volume.value = String(Math.round(level * 100));
    setFill(volume, level);
  }

  function renderTime() {
    const duration = player.duration;
    total.textContent = formatDuration(duration);
    if (seeking) return;
    const position = player.position;
    elapsed.textContent = formatTime(position);
    const fraction = duration ? position / duration : 0;
    seek.value = String(Math.round(fraction * 1000));
    setFill(seek, fraction);
  }

  seek.addEventListener('pointerdown', () => {
    seeking = true;
  });
  seek.addEventListener('input', () => {
    const fraction = Number(seek.value) / 1000;
    setFill(seek, fraction);
    elapsed.textContent = formatTime(fraction * player.duration);
  });
  seek.addEventListener('change', () => {
    seeking = false;
    player.seek((Number(seek.value) / 1000) * player.duration);
  });
  volume.addEventListener('input', () => player.setVolume(Number(volume.value) / 100));

  const el = h(
    'footer',
    { class: 'playerbar' },
    h('div', { class: 'pb-seek' }, elapsed, seek, total),
    h(
      'div',
      { class: 'pb-row' },
      h('div', { class: 'pb-now' }, coverEl, h('div', { class: 'pb-text' }, titleEl, artistEl)),
      h('div', { class: 'pb-controls' }, shuffle, prev, play, next, repeat),
      h('div', { class: 'pb-extra' }, mute, volume),
    ),
  );

  renderTrack();
  renderState();
  const offs = [
    bus.on('player:track', renderTrack),
    bus.on('player:state', renderState),
    bus.on('player:time', renderTime),
    bus.on('track-art', (track) => {
      if (player.current?.id === track.id) setCover(coverEl, track);
    }),
  ];
  return { el, destroy: () => offs.forEach((off) => off()) };
}
