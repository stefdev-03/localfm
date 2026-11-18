// Settings dialog: the current profile's music folders, plus cover-art lookups
// and the theme, which apply to every profile.

import { h, fill, icon, button, iconButton } from '../dom.js';
import { app, bus, ui, applyTheme } from '../state.js';
import { openModal } from '../components/overlays.js';

const api = window.api;

export function openSettings() {
  const folders = h('div', { class: 'settings-folders' });
  const rescan = button('Rescan now', { onclick: () => ui.rescan() }, 'refresh');

  async function setFolders(next) {
    const updated = await api.updateProfile(app.profile.id, { folders: next });
    app.profile.folders = updated.folders;
    renderFolders();
    ui.rescan();
  }

  function renderFolders() {
    const list = app.profile.folders;
    fill(
      folders,
      list.length === 0 && h('p', { class: 'muted' }, 'No music folder yet. Add one to fill your library.'),
      list.map((folder) =>
        h(
          'div',
          { class: `folder-row ${app.missingFolders.includes(folder) ? 'is-missing' : ''}` },
          icon('folder', 18),
          h(
            'div',
            { class: 'folder-row-text' },
            h('div', { class: 'ellipsis', title: folder }, folder),
            app.missingFolders.includes(folder) && h('div', { class: 'folder-row-warn' }, 'This folder can’t be found right now'),
          ),
          iconButton('close', `Remove ${folder}`, { onclick: () => setFolders(list.filter((item) => item !== folder)) }, 16),
        ),
      ),
    );
    rescan.disabled = app.scanning || list.length === 0;
    fill(rescan, icon('refresh', 16), h('span', null, app.scanning ? 'Scanning…' : 'Rescan now'));
  }

  const onlineArt = h('input', { type: 'checkbox', class: 'switch', checked: app.settings.onlineArt, id: 'setting-online-art' });
  onlineArt.addEventListener('change', async () => {
    app.settings = await api.updateSettings({ onlineArt: onlineArt.checked });
  });

  const lightTheme = h('input', {
    type: 'checkbox',
    class: 'switch',
    checked: app.settings.theme === 'light',
    id: 'setting-light-theme',
    dataset: { test: 'setting-light-theme' },
  });
  lightTheme.addEventListener('change', async () => {
    const theme = lightTheme.checked ? 'light' : 'dark';
    applyTheme(theme); // straight away; saving and the window buttons follow
    app.settings = await api.updateSettings({ theme });
  });

  const offScan = bus.on('scan', renderFolders);
  renderFolders();

  return openModal({
    title: 'Settings',
    size: 'md',
    onClose: offScan,
    content: [
      h(
        'section',
        { class: 'settings-section' },
        h('h3', null, 'Music folders'),
        h('p', { class: 'muted' }, `Songs in these folders, and their subfolders, appear in “All songs” for ${app.profile.name}.`),
        folders,
        h(
          'div',
          { class: 'settings-row' },
          button(
            'Add folder',
            {
              dataset: { test: 'settings-add-folder' },
              onclick: async () => {
                const picked = await api.pickFolder();
                if (picked && !app.profile.folders.includes(picked)) setFolders([...app.profile.folders, picked]);
              },
            },
            'plus',
          ),
          rescan,
        ),
      ),
      h(
        'section',
        { class: 'settings-section' },
        h('h3', null, 'Cover art'),
        h(
          'label',
          { class: 'switch-row', for: 'setting-online-art' },
          h(
            'span',
            null,
            h('span', { class: 'switch-title' }, 'Find missing cover art online'),
            h(
              'span',
              { class: 'muted' },
              'For songs without a built-in cover, Local.fm searches Deezer and iTunes using only the artist and song name. Artist pictures are looked up on Deezer by the artist’s name alone, when you open Artists. Applies to every profile.',
            ),
          ),
          onlineArt,
        ),
      ),
      h(
        'section',
        { class: 'settings-section' },
        h('h3', null, 'Appearance'),
        h(
          'label',
          { class: 'switch-row', for: 'setting-light-theme' },
          h(
            'span',
            null,
            h('span', { class: 'switch-title' }, 'Light theme'),
            h('span', { class: 'muted' }, 'Local.fm is dark unless this is on. Applies to every profile.'),
          ),
          lightTheme,
        ),
      ),
      h('p', { class: 'muted settings-about' }, `Local.fm ${app.version}`),
    ],
  });
}
