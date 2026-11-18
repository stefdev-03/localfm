// Profile avatar, the "Who's listening?" picker, and the edit-profile dialog.

import { h, fill, icon, button, iconButton, imageUrl } from '../dom.js';
import { openModal, openMenu, confirmDialog, toast } from '../components/overlays.js';
import { pickPicture, PICTURE_SIZES } from '../components/cropper.js';
import { createCoverWall } from './coverWall.js';

const api = window.api;

export const PROFILE_COLORS = ['#ffb454', '#60cdff', '#6ccb5f', '#ff8fa3', '#b4a0ff', '#4fd8c4'];
const COLOR_NAMES = ['Amber', 'Sky', 'Green', 'Rose', 'Violet', 'Teal'];

const initialOf = (name) => ([...name.trim()][0] ?? '?').toUpperCase();

// Fills an avatar: the picture when there is one, otherwise the name's initial
// on the profile colour. A picture that will not load falls back to the initial.
function paintAvatar(el, { name, color }, src) {
  el.style.background = color;
  const initial = initialOf(name);
  if (!src) return void el.replaceChildren(initial);
  if (el.querySelector('img')?.getAttribute('src') === src) return;
  el.replaceChildren(h('img', { src, alt: '', draggable: false, onerror: () => el.replaceChildren(initial) }));
}

export function avatar(profile, className = '') {
  const el = h('span', { class: `avatar ${className}`, 'aria-hidden': 'true' });
  paintAvatar(el, profile, profile.picture ? imageUrl(profile.picture) : null);
  return el;
}

// The avatar in the profile form. It is also the button for choosing a profile
// picture, which is optional: hovering shows a pencil, clicking opens the file
// chooser. Nothing is saved here; the form keeps the choice until it is saved.
//
// picture: { file } for one already saved, { blob } for a new one, or null.
// Returns { el, error, update, destroy }; put `error` under the form, it shows
// the message for a picture that cannot be used.
export function avatarPicker({ name, color, picture = null, onChange }) {
  const size = PICTURE_SIZES.avatar;
  const state = { name, color, picture };
  let objectUrl = null;

  const face = h('span', { class: 'avatar avatar-lg', 'aria-hidden': 'true' });
  const pick = h(
    'button',
    { type: 'button', class: 'avatar-edit-btn', dataset: { test: 'pick-avatar' }, onclick: () => choose() },
    face,
    h('span', { class: 'avatar-edit-hover' }, icon('pencil', 22)),
  );
  const remove = iconButton(
    'trash',
    'Remove profile picture',
    {
      class: 'avatar-edit-remove',
      dataset: { test: 'remove-avatar' },
      onclick: () => {
        setPicture(null);
        pick.focus();
      },
    },
    13,
  );
  const el = h('div', { class: 'avatar-edit' }, pick);
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true, dataset: { test: 'avatar-error' } });

  const showError = (message) => {
    fill(error, message && [icon('warning', 16), h('span', null, message)]);
    error.hidden = !message;
  };

  function source() {
    if (!state.picture) return null;
    if (state.picture.file) return imageUrl(state.picture.file);
    objectUrl ??= URL.createObjectURL(state.picture.blob);
    return objectUrl;
  }

  function draw() {
    paintAvatar(face, state, source());
    const label = state.picture ? 'Change profile picture' : 'Add a profile picture';
    pick.setAttribute('aria-label', label);
    pick.title = `${label} (optional). ${size.width} × ${size.height} pixels; larger pictures can be cropped to fit.`;
    if (state.picture) el.append(remove);
    else remove.remove();
  }

  function setPicture(next) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    state.picture = next;
    showError('');
    draw();
    onChange?.(next);
  }

  async function choose() {
    showError('');
    const blob = await pickPicture('avatar', { onError: showError });
    if (!blob) return;
    setPicture({ blob });
    pick.focus();
  }

  draw();
  return {
    el,
    error,
    // The name or colour changed in the form beside it.
    update(patch) {
      Object.assign(state, patch);
      draw();
    },
    destroy() {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    },
  };
}

// Turns the form's picture into what is stored with the profile: the name of
// a file in Local.fm's own pictures folder, or null for none.
export async function savePicture(picture) {
  if (!picture?.blob) return picture?.file ?? null;
  const name = await api.saveImage(new Uint8Array(await picture.blob.arrayBuffer()));
  if (!name) throw new Error('The profile picture could not be saved.');
  return name;
}

// Asks before a profile is deleted. Resolves true when the user agrees.
export const confirmProfileDelete = (profile) =>
  confirmDialog({
    title: `Delete “${profile.name}”?`,
    message: 'This removes the profile and its playlists from Local.fm. Your music files stay exactly where they are.',
    confirmLabel: 'Delete profile',
    danger: true,
  });

// A row of colour swatches; calls onChange with the chosen colour.
export function colorPicker(current, onChange) {
  const group = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Profile colour' });
  const draw = (selected) => {
    group.replaceChildren(
      ...PROFILE_COLORS.map((color, index) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: `swatch ${color === selected ? 'is-selected' : ''}`,
            'aria-checked': String(color === selected),
            'aria-label': COLOR_NAMES[index],
            title: COLOR_NAMES[index],
            style: { background: color },
            onclick: () => {
              draw(color);
              onChange(color);
            },
          },
          color === selected && icon('check', 14),
        ),
      ),
    );
  };
  draw(current);
  return group;
}

// Returns the screen's cleanup, which stops the wall behind it.
export function showProfilePicker(root, { profiles, onChoose, onAdd, onEdit, onDelete }) {
  // The screen shows at once; the wall joins it when its covers are known.
  const holder = h('div', { class: 'picker-wall' });
  let current = null;
  let gone = false;
  window.api.getWallCovers().then(
    (covers) => {
      if (gone) return;
      current = createCoverWall({ covers: Array.isArray(covers) ? covers : [], colors: profiles.map((profile) => profile.color) });
      holder.replaceChildren(current.el);
    },
    () => {},
  );

  root.replaceChildren(
    holder,
    h(
      'div',
      { class: 'picker' },
      h('h1', { class: 'picker-title' }, 'Who’s listening?'),
      h('p', { class: 'muted picker-sub' }, 'Each profile has its own music folder and playlists.'),
      h(
        'div',
        { class: 'picker-grid' },
        profiles.map((profile) =>
          h(
            'div',
            { class: 'profile-tile-wrap', style: { '--profile-ring': profile.color } },
            h(
              'button',
              {
                type: 'button',
                class: 'profile-tile',
                title: 'Right-click to edit or delete',
                dataset: { test: 'profile-tile' },
                onclick: () => onChoose(profile),
                oncontextmenu: (event) => {
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  const fromKeyboard = event.clientX === 0 && event.clientY === 0;
                  openMenu(fromKeyboard ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: event.clientX, y: event.clientY }, [
                    { heading: profile.name },
                    { label: 'Edit profile', icon: 'pencil', test: 'profile-edit', onClick: () => onEdit(profile) },
                    { label: 'Delete profile', icon: 'trash', danger: true, test: 'profile-delete', onClick: () => onDelete(profile) },
                  ]);
                },
              },
              avatar(profile, 'avatar-xl'),
              h('span', { class: 'profile-tile-name' }, profile.name),
            ),
            iconButton('pencil', `Edit ${profile.name}`, { class: 'profile-tile-edit', onclick: () => onEdit(profile) }, 15),
          ),
        ),
        h(
          'div',
          { class: 'profile-tile-wrap' },
          h(
            'button',
            { type: 'button', class: 'profile-tile is-add', dataset: { test: 'profile-add' }, onclick: onAdd },
            h('span', { class: 'avatar avatar-xl avatar-add' }, icon('plus', 28)),
            h('span', { class: 'profile-tile-name' }, 'Add profile'),
          ),
        ),
      ),
    ),
  );
  root.querySelector('.profile-tile')?.focus();
  return () => {
    gone = true;
    current?.destroy();
  };
}

// Rename, recolour, give a picture to, or delete a profile.
export function openProfileEditor(profile, { onSave, onDelete }) {
  let name = profile.name;
  let color = profile.color;
  let picture = profile.picture ? { file: profile.picture } : null;
  let busy = false;
  const picker = avatarPicker({ name, color, picture, onChange: (next) => (picture = next) });
  const input = h('input', { class: 'input', type: 'text', maxlength: '40', value: name, 'aria-label': 'Profile name', autofocus: true });
  const save = button('Save', { class: 'btn-accent', dataset: { test: 'profile-save' }, onclick: () => submit() });
  input.addEventListener('input', () => {
    name = input.value;
    save.disabled = busy || !name.trim();
    picker.update({ name });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  async function submit() {
    if (busy || !name.trim()) return;
    busy = true;
    save.disabled = true;
    try {
      await onSave({ name: name.trim(), color, picture: await savePicture(picture) });
      modal.close();
    } catch (error) {
      busy = false;
      save.disabled = !name.trim();
      toast(error?.message || 'The profile could not be saved.');
    }
  }

  const modal = openModal({
    title: 'Edit profile',
    size: 'sm',
    onClose: () => picker.destroy(),
    content: [
      h('div', { class: 'profile-form' }, picker.el, h('div', { class: 'profile-form-fields' }, input, colorPicker(color, (next) => {
        color = next;
        picker.update({ color });
      }))),
      picker.error,
      h(
        'div',
        { class: 'modal-actions' },
        button(
          'Delete profile',
          {
            class: 'btn-quiet-danger',
            onclick: async () => {
              if (!(await confirmProfileDelete(profile))) return;
              modal.close();
              await onDelete();
            },
          },
          'trash',
        ),
        h('span', { class: 'spacer' }),
        button('Cancel', { onclick: () => modal.close() }),
        save,
      ),
    ],
  });
  return modal;
}
