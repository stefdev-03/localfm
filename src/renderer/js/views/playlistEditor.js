// The three-step flow for a new playlist: name, pictures, songs.
// Used by the first-run setup and by "Create playlist" in the sidebar.
// Given an existing playlist it shows only the song picker ("Add songs");
// that playlist's name and pictures are edited in playlistDetails.js.

import { h, fill, icon, button, cover, formatDuration, imageUrl, plural, stepNotes } from '../dom.js';
import { bus } from '../state.js';
import { VirtualList } from '../components/virtualList.js';
import { pickPicture, PICTURE_SIZES } from '../components/cropper.js';
import { toast } from '../components/overlays.js';

const STEPS = ['Name', 'Pictures', 'Songs'];
const ROW_HEIGHT = 56;

export function createPlaylistEditor({
  tracks,
  playlist = null,
  preselect = [],
  cancelLabel = 'Cancel',
  onCancel,
  onSubmit,
}) {
  const editing = Boolean(playlist);
  const draft = {
    id: playlist?.id,
    name: playlist?.name ?? '',
    image: playlist?.image ? { file: playlist.image } : null,
    banner: playlist?.banner ? { file: playlist.banner } : null,
    selected: new Set([...(playlist?.trackIds ?? []), ...preselect]),
  };
  let step = editing ? STEPS.length - 1 : 0;
  let busy = false;
  let list = null;
  let query = '';
  const cleanups = [];
  const objectUrls = new Set();

  const stepsEl = h('ol', { class: 'pe-steps' });
  const bodyEl = h('div', { class: 'pe-body' });
  const footEl = h('div', { class: 'pe-foot' });
  const el = h('div', { class: 'pe' }, stepsEl, bodyEl, footEl);

  const pictureUrl = (picture) => {
    if (!picture) return null;
    if (picture.file) return imageUrl(picture.file);
    if (!picture.url) {
      picture.url = URL.createObjectURL(picture.blob);
      objectUrls.add(picture.url);
    }
    return picture.url;
  };

  const nameIsValid = () => draft.name.trim().length > 0;

  function goTo(next) {
    if (busy) return;
    if (next > 0 && !nameIsValid()) {
      step = 0;
      render();
      const input = bodyEl.querySelector('input');
      input?.classList.add('is-invalid');
      input?.focus();
      return;
    }
    step = next;
    render();
  }

  async function submit() {
    if (busy) return;
    if (!nameIsValid()) return goTo(1);
    busy = true;
    renderFoot();
    try {
      await onSubmit({
        id: draft.id,
        name: draft.name.trim(),
        image: draft.image,
        banner: draft.banner,
        trackIds: [...draft.selected],
      });
    } catch (error) {
      busy = false;
      renderFoot();
      toast(error?.message || 'The playlist could not be saved.');
    }
  }

  // --- step 1: name ------------------------------------------------------

  function renderName() {
    const input = h('input', {
      class: 'input input-lg',
      type: 'text',
      maxlength: '80',
      placeholder: 'My playlist',
      value: draft.name,
      autofocus: true,
      'aria-label': 'Playlist name',
      dataset: { test: 'playlist-name' },
    });
    input.addEventListener('input', () => {
      draft.name = input.value;
      input.classList.remove('is-invalid');
      renderFoot();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      goTo(1);
    });
    bodyEl.append(
      h('h3', { class: 'pe-title' }, 'Name your playlist'),
      h('p', { class: 'muted' }, 'Pick something you will recognise in the sidebar. You can rename it later.'),
      input,
    );
    requestAnimationFrame(() => input.focus());
  }

  // --- step 2: pictures --------------------------------------------------

  function renderPictures() {
    const banner = h('div', { class: 'pe-preview-banner' });
    const tile = h('div', { class: 'cover pe-preview-tile' });
    const preview = h(
      'div',
      { class: 'pe-preview' },
      banner,
      h('div', { class: 'pe-preview-info' }, tile, h('div', { class: 'pe-preview-name' }, draft.name.trim() || 'My playlist')),
    );

    const paint = () => {
      const bannerUrl = pictureUrl(draft.banner);
      banner.replaceChildren(bannerUrl ? h('img', { src: bannerUrl, alt: '' }) : '');
      banner.classList.toggle('is-empty', !bannerUrl);
      const tileUrl = pictureUrl(draft.image);
      tile.replaceChildren(tileUrl ? h('img', { src: tileUrl, alt: '' }) : icon('playlist', 28));
    };

    const field = (key, title) => {
      const size = PICTURE_SIZES[key];
      const row = h('div', { class: 'pe-field' });
      const draw = () => {
        const has = Boolean(draft[key]);
        fill(
          row,
          h(
            'div',
            { class: 'pe-field-text' },
            h('div', { class: 'pe-field-title' }, title),
            h('div', { class: 'muted' }, `${size.width} × ${size.height} pixels. Larger pictures can be cropped to fit.`),
          ),
          has &&
            button('Remove', {
              onclick: () => {
                draft[key] = null;
                draw();
                paint();
              },
            }),
          button(
            has ? 'Replace' : 'Choose picture',
            {
              dataset: { test: `pick-${key}` },
              onclick: async () => {
                const blob = await pickPicture(key);
                if (!blob) return;
                draft[key] = { blob };
                draw();
                paint();
              },
            },
            'image',
          ),
        );
      };
      draw();
      return row;
    };

    paint();
    bodyEl.append(
      h('h3', { class: 'pe-title' }, 'Add pictures'),
      h('p', { class: 'muted' }, 'Both are optional. Skip this step and add them whenever you like.'),
      preview,
      field('image', 'Playlist picture'),
      field('banner', 'Banner'),
    );
  }

  // --- step 3: songs -----------------------------------------------------

  function renderSongs() {
    const counter = h('span', { class: 'pe-count', dataset: { test: 'selected-count' } });
    const scroller = h('div', { class: 'pe-songs' });
    const rows = h('div');
    const empty = h('div', { class: 'empty empty-compact' });
    scroller.append(rows, empty);
    let visible = tracks;

    const updateCounter = () => {
      const known = tracks.reduce((n, track) => n + (draft.selected.has(track.id) ? 1 : 0), 0);
      counter.textContent = known ? `${plural(known, 'song')} added` : 'No songs added yet';
    };

    const toggle = (track) => {
      if (draft.selected.has(track.id)) draft.selected.delete(track.id);
      else draft.selected.add(track.id);
      updateCounter();
      list.refresh();
    };

    const renderRow = (index) => {
      const track = visible[index];
      const added = draft.selected.has(track.id);
      return h(
        'div',
        { class: `pick-row ${added ? 'is-added' : ''}`, onclick: () => toggle(track) },
        cover(track, 'cover-sm'),
        h(
          'div',
          { class: 'pick-text' },
          h('div', { class: 'pick-title' }, track.title),
          h('div', { class: 'pick-artist' }, track.artist || 'Unknown artist'),
        ),
        h('div', { class: 'pick-time' }, formatDuration(track.duration)),
        h(
          'button',
          {
            type: 'button',
            class: `pick-btn ${added ? 'is-added' : ''}`,
            'aria-label': `${added ? 'Remove' : 'Add'} ${track.title}`,
            title: added ? 'Remove from playlist' : 'Add to playlist',
            dataset: { test: added ? 'pick-remove' : 'pick-add' },
            onclick: (event) => {
              event.stopPropagation();
              toggle(track);
            },
          },
          icon(added ? 'minus' : 'plus', 16),
        ),
      );
    };

    list = new VirtualList({ scroller, container: rows, rowHeight: ROW_HEIGHT, renderRow });

    const applyFilter = () => {
      const needle = query.trim().toLowerCase();
      visible = needle
        ? tracks.filter((track) => `${track.title}\n${track.artist}\n${track.album}`.toLowerCase().includes(needle))
        : tracks;
      empty.hidden = visible.length > 0;
      empty.textContent = tracks.length
        ? 'No songs match that search.'
        : 'There are no songs in your music folder yet. You can add songs to this playlist later.';
      list.setCount(visible.length);
      scroller.scrollTop = 0;
    };

    const search = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Search songs',
      value: query,
      'aria-label': 'Search songs',
    });
    search.addEventListener('input', () => {
      query = search.value;
      applyFilter();
    });

    const bulk = (add) => {
      for (const track of visible) {
        if (add) draft.selected.add(track.id);
        else draft.selected.delete(track.id);
      }
      updateCounter();
      list.refresh();
    };

    bodyEl.append(
      h('div', { class: 'pe-songs-head' }, h('h3', { class: 'pe-title' }, 'Choose songs'), counter),
      h(
        'p',
        { class: 'muted' },
        'Press + to add a song. Changed your mind? Press − to take it back out.',
      ),
      h(
        'div',
        { class: 'pe-songs-tools' },
        h('div', { class: 'search' }, icon('search', 16), search),
        button('Add all', { onclick: () => bulk(true) }),
        button('Remove all', { onclick: () => bulk(false) }),
      ),
      scroller,
    );
    updateCounter();
    applyFilter();
    cleanups.push(bus.on('track-art', () => list?.refreshSoon()));
  }

  // --- frame -------------------------------------------------------------

  function renderSteps() {
    stepsEl.hidden = editing; // an existing playlist has no steps to walk through
    if (editing) return;
    stepsEl.replaceChildren(
      ...STEPS.map((label, index) => {
        const state = index === step ? 'is-active' : index < step ? 'is-done' : '';
        return h(
          'li',
          { class: `pe-step ${state}` },
          h(
            'span',
            { class: 'pe-step-btn', 'aria-current': index === step ? 'step' : null },
            h('span', { class: 'pe-step-num' }, index < step ? icon('check', 12) : String(index + 1)),
            label,
          ),
          index < STEPS.length - 1 && stepNotes(),
        );
      }),
    );
  }

  function renderFoot() {
    const last = step === STEPS.length - 1;
    const back =
      editing || step === 0
        ? button(cancelLabel, { disabled: busy, onclick: () => onCancel?.() })
        : button('Back', { disabled: busy, onclick: () => goTo(step - 1) }, 'arrowLeft');
    let primary;
    if (editing) {
      primary = button(busy ? 'Saving…' : 'Save changes', {
        class: 'btn-accent',
        disabled: busy,
        dataset: { test: 'playlist-submit' },
        onclick: submit,
      });
    } else if (last) {
      primary = button(busy ? 'Creating…' : 'Create playlist', {
        class: 'btn-accent',
        disabled: busy,
        dataset: { test: 'playlist-submit' },
        onclick: submit,
      });
    } else {
      primary = button('Next', {
        class: 'btn-accent',
        disabled: step === 0 && !nameIsValid(),
        dataset: { test: 'playlist-next' },
        onclick: () => goTo(step + 1),
      });
    }
    footEl.replaceChildren(back, h('span', { class: 'spacer' }), primary);
  }

  function render() {
    while (cleanups.length) cleanups.pop()();
    list?.destroy();
    list = null;
    bodyEl.replaceChildren();
    bodyEl.dataset.step = String(step);
    renderSteps();
    if (step === 0) renderName();
    else if (step === 1) renderPictures();
    else renderSongs();
    renderFoot();
  }

  render();

  return {
    el,
    destroy() {
      while (cleanups.length) cleanups.pop()();
      list?.destroy();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    },
  };
}
