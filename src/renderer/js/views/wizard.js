// First-run setup (and "Add profile"): music folder -> first playlist -> profile.

import { h, add, icon, button, cover, plural, stepNotes } from '../dom.js';
import { app, bus, setTracks, savePlaylist } from '../state.js';
import { VirtualList } from '../components/virtualList.js';
import { createPlaylistEditor } from './playlistEditor.js';
import { avatarPicker, colorPicker, savePicture } from './profiles.js';
import { toast } from '../components/overlays.js';

const api = window.api;
const STAGES = ['Music folder', 'Playlist', 'Profile'];

export function showWizard(root, { profile, isFirst, onFinish, onCancel }) {
  let stage = 0;
  let folder = profile.folders[0] ?? null;
  let scanning = false;
  let scanned = false;
  let progress = { done: 0, total: 0 };
  let createdPlaylist = null;
  let editor = null;
  let previewList = null;
  let name = profile.setupComplete ? profile.name : '';
  let color = profile.color;
  let picture = profile.picture ? { file: profile.picture } : null;
  const cleanups = [];

  const stepsEl = h('ol', { class: 'wizard-steps' });
  const bodyEl = h('div', { class: 'wizard-body' });
  root.replaceChildren(h('div', { class: 'wizard' }, h('div', { class: 'wizard-card' }, stepsEl, bodyEl)));

  const offProgress = bus.on('scan-progress', (update) => {
    if (update.profileId !== profile.id || !scanning) return;
    progress = update;
    const bar = bodyEl.querySelector('.progress-fill');
    const label = bodyEl.querySelector('.progress-label');
    if (bar) bar.style.width = `${update.total ? (update.done / update.total) * 100 : 0}%`;
    if (label) label.textContent = update.total ? `Reading song ${update.done} of ${update.total}…` : 'Looking for songs…';
  });

  function clearStage() {
    while (cleanups.length) cleanups.pop()();
    editor?.destroy();
    editor = null;
    previewList?.destroy();
    previewList = null;
    bodyEl.replaceChildren();
  }

  function renderSteps() {
    stepsEl.replaceChildren(
      ...STAGES.map((label, index) =>
        h(
          'li',
          { class: `wizard-step ${index === stage ? 'is-active' : index < stage ? 'is-done' : ''}`, 'aria-current': index === stage ? 'step' : null },
          h('span', { class: 'wizard-step-num' }, index < stage ? icon('check', 12) : String(index + 1)),
          label,
          index < STAGES.length - 1 && stepNotes(),
        ),
      ),
    );
  }

  function go(next) {
    stage = next;
    renderSteps();
    clearStage();
    [renderFolder, renderPlaylistAsk, renderProfile][stage]();
  }

  // --- 1. music folder ---------------------------------------------------

  async function chooseFolder() {
    const picked = await api.pickFolder();
    if (!picked) return;
    folder = picked;
    await api.updateProfile(profile.id, { folders: [folder] });
    await scan();
  }

  async function scan() {
    scanning = true;
    scanned = false;
    progress = { done: 0, total: 0 };
    if (stage === 0) go(0);
    try {
      const result = await api.scanLibrary(profile.id);
      setTracks(result.tracks);
      scanned = true;
    } catch {
      toast('That folder could not be read. Try choosing it again.');
    } finally {
      scanning = false;
      if (stage === 0) go(0);
    }
  }

  function renderFolder() {
    const count = app.tracks.length;
    const folderBox = h(
      'div',
      { class: 'folder-box' },
      icon('folder', 22),
      h(
        'div',
        { class: 'folder-box-text' },
        h('div', { class: 'folder-box-label' }, folder ? 'Music folder' : 'No folder chosen yet'),
        folder && h('div', { class: 'folder-box-path', title: folder }, folder),
      ),
      button(folder ? 'Change folder' : 'Choose folder', {
        class: folder ? '' : 'btn-accent',
        disabled: scanning,
        dataset: { test: 'choose-folder' },
        onclick: chooseFolder,
      }),
    );

    add(
      bodyEl,
      isFirst && h('div', { class: 'eyebrow' }, 'Welcome to Local.fm'),
      h('h1', { class: 'wizard-title' }, 'Where is your music?'),
      h(
        'p',
        { class: 'muted wizard-lead' },
        'Choose the folder that holds your MP3 files. Local.fm reads the artist and song name from each one and shows its cover art when it recognises the song.',
      ),
      folderBox,
    );

    if (scanning) {
      add(
      bodyEl,
        h(
          'div',
          { class: 'progress-block' },
          h('div', { class: 'progress-label' }, 'Looking for songs…'),
          h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: '0%' } })),
        ),
      );
    } else if (scanned && count > 0) {
      const scroller = h('div', { class: 'wizard-preview' });
      const rows = h('div');
      scroller.append(rows);
      previewList = new VirtualList({
        scroller,
        container: rows,
        rowHeight: 52,
        renderRow: (index) => {
          const track = app.tracks[index];
          return h(
            'div',
            { class: 'preview-row' },
            cover(track, 'cover-sm'),
            h('div', { class: 'preview-title' }, track.title),
            h('div', { class: 'preview-artist' }, track.artist || 'Unknown artist'),
          );
        },
      });
      add(
      bodyEl,
        h(
          'div',
          { class: 'wizard-result', dataset: { test: 'scan-result' } },
          icon('check', 16),
          h('span', null, `Found ${plural(count, 'song')}`),
          h('span', { class: 'wizard-result-note' }, '· song name on the left, artist on the right'),
        ),
        scroller,
      );
      previewList.setCount(count);
      cleanups.push(bus.on('track-art', () => previewList?.refreshSoon()));
    } else if (scanned) {
      add(
      bodyEl,
        h(
          'div',
          { class: 'notice' },
          icon('warning', 18),
          h('span', null, 'No music files were found in that folder or its subfolders. Choose a different folder, or continue and add music later.'),
        ),
      );
    }

    add(
      bodyEl,
      h(
        'div',
        { class: 'wizard-foot' },
        !isFirst && button('Cancel', { onclick: onCancel }),
        h('span', { class: 'spacer' }),
        button(scanned && count === 0 ? 'Continue anyway' : 'Continue', {
          class: 'btn-accent',
          disabled: !scanned || scanning,
          dataset: { test: 'wizard-continue' },
          onclick: () => go(1),
        }),
      ),
    );
  }

  // --- 2. first playlist -------------------------------------------------

  function renderPlaylistAsk() {
    add(
      bodyEl,
      h('h1', { class: 'wizard-title' }, createdPlaylist ? 'Playlist created' : 'Create a playlist?'),
      h(
        'p',
        { class: 'muted wizard-lead' },
        createdPlaylist
          ? `“${createdPlaylist.name}” is ready with ${plural(createdPlaylist.trackIds.length, 'song')}. You can make more from the sidebar at any time.`
          : `Group some of your ${plural(app.tracks.length, 'song')} into a playlist. You can skip this and make one later from the sidebar.`,
      ),
      !createdPlaylist &&
        h(
          'div',
          { class: 'choice-row' },
          h(
            'button',
            { type: 'button', class: 'choice is-primary', dataset: { test: 'playlist-yes' }, onclick: renderPlaylistEditor },
            icon('playlist', 24),
            h('span', { class: 'choice-title' }, 'Create a playlist'),
            h('span', { class: 'choice-sub' }, 'Name it, add pictures, pick songs'),
          ),
          h(
            'button',
            { type: 'button', class: 'choice', dataset: { test: 'playlist-skip' }, onclick: () => go(2) },
            icon('chevronRight', 24),
            h('span', { class: 'choice-title' }, 'Skip'),
            h('span', { class: 'choice-sub' }, 'Go straight to your songs'),
          ),
        ),
      h(
        'div',
        { class: 'wizard-foot' },
        button('Back', { onclick: () => go(0) }, 'arrowLeft'),
        h('span', { class: 'spacer' }),
        createdPlaylist && button('Continue', { class: 'btn-accent', dataset: { test: 'wizard-continue' }, onclick: () => go(2) }),
      ),
    );
  }

  function renderPlaylistEditor() {
    clearStage();
    editor = createPlaylistEditor({
      tracks: app.tracks,
      cancelLabel: 'Back',
      onCancel: () => go(1),
      onSubmit: async (draft) => {
        createdPlaylist = await savePlaylist(profile.id, draft);
        go(2);
      },
    });
    add(
      bodyEl,editor.el);
  }

  // --- 3. profile --------------------------------------------------------

  function renderProfile() {
    const picker = avatarPicker({ name, color, picture, onChange: (next) => (picture = next) });
    cleanups.push(() => picker.destroy());
    const repaint = () => {
      picker.update({ name, color });
      document.documentElement.style.setProperty('--profile-color', color);
    };
    const input = h('input', {
      class: 'input input-lg',
      type: 'text',
      maxlength: '40',
      placeholder: 'Profile name',
      value: name,
      'aria-label': 'Profile name',
      dataset: { test: 'profile-name' },
    });
    const finish = button('Finish', { class: 'btn-accent', disabled: !name.trim(), dataset: { test: 'wizard-finish' }, onclick: () => submit() });
    const another = button(
      'Save and add another profile',
      { disabled: !name.trim(), dataset: { test: 'wizard-add-another' }, onclick: () => submit({ addAnother: true }) },
      'users',
    );
    input.addEventListener('input', () => {
      name = input.value;
      finish.disabled = another.disabled = !name.trim();
      repaint();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });

    let busy = false;
    async function submit({ addAnother = false } = {}) {
      if (busy || !name.trim()) return;
      busy = true;
      finish.disabled = another.disabled = true;
      try {
        await api.updateProfile(profile.id, { name: name.trim(), color, picture: await savePicture(picture), setupComplete: true });
      } catch (error) {
        busy = false;
        finish.disabled = another.disabled = !name.trim();
        toast(error?.message || 'The profile could not be saved.');
        return;
      }
      onFinish(profile.id, { addAnother });
    }

    add(
      bodyEl,
      h('h1', { class: 'wizard-title' }, 'Name this profile'),
      h(
        'p',
        { class: 'muted wizard-lead' },
        'A profile keeps its own music folder and playlists, the way browser profiles keep separate bookmarks. You can add more profiles later and switch between them from the profile button at the top right.',
      ),
      createdPlaylist &&
        h('div', { class: 'wizard-result is-inline' }, icon('check', 16), h('span', null, `Playlist “${createdPlaylist.name}” created`)),
      h(
        'div',
        { class: 'profile-form' },
        picker.el,
        h(
          'div',
          { class: 'profile-form-fields' },
          input,
          h('div', { class: 'field-label' }, 'Colour'),
          colorPicker(color, (next) => {
            color = next;
            repaint();
          }),
        ),
      ),
      picker.error,
      h(
        'div',
        { class: 'wizard-foot' },
        button('Back', { onclick: () => go(1) }, 'arrowLeft'),
        h('span', { class: 'spacer' }),
        another,
        finish,
      ),
    );
    requestAnimationFrame(() => input.focus());
  }

  go(0);
  // Resuming an interrupted setup: the folder is already known, so read it again.
  if (folder) scan();

  return () => {
    offProgress();
    clearStage();
  };
}
