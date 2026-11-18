// The saved-data rules for the theme and for profile pictures:  npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/main/store.js';

function withStore(run, seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localfm-store-'));
  try {
    if (seed) fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(seed));
    const store = new Store(dir);
    run(store);
    clearTimeout(store.timer); // nothing here needs the debounced write
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the theme is dark until it is changed', () => {
  withStore((store) => {
    assert.equal(store.state.settings.theme, 'dark');
    assert.equal(store.updateSettings({ theme: 'light' }).theme, 'light');
    assert.equal(store.updateSettings({ onlineArt: false }).theme, 'light', 'other settings leave it alone');
    assert.equal(store.updateSettings({ theme: 'dark' }).theme, 'dark');
  });
});

test('an unknown theme is ignored', () => {
  withStore((store) => {
    store.updateSettings({ theme: 'light' });
    for (const junk of ['sepia', '', null, 1, { theme: 'dark' }]) store.updateSettings({ theme: junk });
    assert.equal(store.state.settings.theme, 'light');
  });
});

test('data saved before themes existed opens dark', () => {
  withStore(
    (store) => {
      assert.equal(store.state.settings.theme, 'dark');
      assert.equal(store.state.settings.onlineArt, false);
    },
    { version: 1, activeProfileId: null, profiles: [], settings: { onlineArt: false } },
  );
});

test('a new profile has no picture', () => {
  withStore((store) => {
    assert.equal(store.createProfile({ name: 'Ana' }).picture, null);
  });
});

test('a profile picture is set, kept by other edits, and removed', () => {
  withStore((store) => {
    const { id } = store.createProfile({ name: 'Ana' });
    assert.equal(store.updateProfile(id, { picture: '0123456789abcdef.jpg' }).picture, '0123456789abcdef.jpg');
    assert.equal(store.updateProfile(id, { name: 'Ana B' }).picture, '0123456789abcdef.jpg', 'a rename keeps it');
    assert.equal(store.updateProfile(id, { picture: null }).picture, null);
  });
});

test('a profile picture must be a plain image file name', () => {
  withStore((store) => {
    const { id } = store.createProfile({ name: 'Ana' });
    for (const bad of ['../secret.jpg', 'C:\\Windows\\win.ini', 'picture.exe', 'a/b.png', '', 42, {}]) {
      assert.equal(store.updateProfile(id, { picture: bad }).picture, null, String(bad));
    }
  });
});

test('profile pictures count as pictures in use', () => {
  withStore((store) => {
    const ana = store.createProfile({ name: 'Ana' });
    const ben = store.createProfile({ name: 'Ben' });
    store.updateProfile(ana.id, { picture: 'aaaaaaaaaaaaaaaa.jpg' });
    store.updateProfile(ben.id, { picture: 'bbbbbbbbbbbbbbbb.png' });
    store.savePlaylist(ana.id, { name: 'Mix', image: 'cccccccccccccccc.jpg' });
    assert.deepEqual([...store.referencedImages()].sort(), ['aaaaaaaaaaaaaaaa.jpg', 'bbbbbbbbbbbbbbbb.png', 'cccccccccccccccc.jpg']);
    store.deleteProfile(ben.id);
    assert.equal(store.referencedImages().has('bbbbbbbbbbbbbbbb.png'), false, 'a deleted profile frees its picture');
  });
});
