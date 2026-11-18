// "Edit details" for an existing playlist: its banner, picture and name, all
// on one screen. Click a picture to change it; nothing is saved until Save.

import { h, fill, icon, button, iconButton, imageUrl } from '../dom.js';
import { findPlaylist, savePlaylist } from '../state.js';
import { pickPicture, PICTURE_SIZES } from '../components/cropper.js';
import { openModal, toast } from '../components/overlays.js';

const SLOTS = {
  banner: { title: 'banner', empty: 'Add a banner', icon: 'image' },
  image: { title: 'picture', empty: 'Add a picture', icon: 'playlist' },
};

export function openPlaylistDetails(profileId, playlist) {
  const draft = {
    name: playlist.name,
    image: playlist.image ? { file: playlist.image } : null,
    banner: playlist.banner ? { file: playlist.banner } : null,
  };
  let busy = false;
  const objectUrls = new Set();

  const pictureUrl = (picture) => {
    if (picture.file) return imageUrl(picture.file);
    if (!picture.url) {
      picture.url = URL.createObjectURL(picture.blob);
      objectUrls.add(picture.url);
    }
    return picture.url;
  };

  // One clickable picture: shows what is there now, opens the file chooser on
  // click, and offers a small remove button once it holds a picture.
  function slot(key) {
    const { title, empty, icon: emptyIcon } = SLOTS[key];
    const size = PICTURE_SIZES[key];
    const el = h('div', { class: `pd-slot pd-slot-${key}` });

    async function choose() {
      if (busy) return;
      const blob = await pickPicture(key);
      if (!blob) return;
      draft[key] = { blob };
      draw();
      el.querySelector('.pd-pic')?.focus();
    }

    function draw() {
      const picture = draft[key];
      fill(
        el,
        h(
          'button',
          {
            type: 'button',
            class: `pd-pic ${picture ? '' : 'is-empty'}`,
            'aria-label': `${picture ? 'Change' : 'Choose'} ${title}`,
            title: `${size.width} × ${size.height} pixels. Larger pictures can be cropped to fit.`,
            dataset: { test: `pick-${key}` },
            onclick: choose,
          },
          picture
            ? h('img', { src: pictureUrl(picture), alt: '', draggable: false })
            : h('span', { class: 'pd-pic-empty' }, icon(emptyIcon, key === 'image' ? 40 : 22), h('span', null, empty)),
          picture && h('span', { class: 'pd-pic-hover' }, icon('pencil', key === 'image' ? 28 : 18), h('span', null, `Change ${title}`)),
        ),
        picture &&
          iconButton(
            'trash',
            `Remove ${title}`,
            {
              class: 'pd-remove',
              dataset: { test: `remove-${key}` },
              onclick: () => {
                draft[key] = null;
                draw();
                el.querySelector('.pd-pic')?.focus();
              },
            },
            15,
          ),
      );
    }

    draw();
    return el;
  }

  const nameIsValid = () => draft.name.trim().length > 0;

  const input = h('input', {
    class: 'input input-lg',
    type: 'text',
    id: 'pd-name',
    maxlength: '80',
    placeholder: 'Playlist name',
    value: draft.name,
    autofocus: true,
    dataset: { test: 'playlist-name' },
  });
  const save = button('Save', { class: 'btn-accent', dataset: { test: 'playlist-submit' }, onclick: () => submit() });
  const cancel = button('Cancel', { onclick: () => modal.close() });

  const syncButtons = () => {
    save.disabled = busy || !nameIsValid();
    cancel.disabled = busy;
    save.lastElementChild.textContent = busy ? 'Saving…' : 'Save';
  };

  input.addEventListener('input', () => {
    draft.name = input.value;
    input.classList.remove('is-invalid');
    syncButtons();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  });

  async function submit() {
    if (busy) return;
    if (!nameIsValid()) {
      input.classList.add('is-invalid');
      input.focus();
      return;
    }
    busy = true;
    syncButtons();
    try {
      // The songs are whatever the playlist holds right now; this dialog never changes them.
      const current = findPlaylist(playlist.id) ?? playlist;
      await savePlaylist(profileId, {
        id: playlist.id,
        name: draft.name.trim(),
        image: draft.image,
        banner: draft.banner,
        trackIds: current.trackIds,
      });
      modal.close();
    } catch (error) {
      busy = false;
      syncButtons();
      toast(error?.message || 'The playlist could not be saved.');
    }
  }

  const modal = openModal({
    title: 'Edit details',
    size: 'md',
    onClose: () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    },
    content: h(
      'div',
      { class: 'pd', dataset: { test: 'playlist-details' } },
      slot('banner'),
      h(
        'div',
        { class: 'pd-row' },
        slot('image'),
        h(
          'div',
          { class: 'pd-fields' },
          h('label', { class: 'field-label', for: 'pd-name' }, 'Name'),
          input,
          h('p', { class: 'pd-hint muted' }, 'Click the banner or the picture to change it. Pictures that are not the right shape can be cropped to fit.'),
        ),
      ),
      h('div', { class: 'modal-actions' }, cancel, save),
    ),
  });
  syncButtons();
  requestAnimationFrame(() => input.select());
  return modal;
}
