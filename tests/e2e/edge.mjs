// Edge cases against the real app:  npm run test:edge
//
// Broken and missing files, a vanished folder, end-of-list and repeat-one
// behaviour, pictures that need no crop, cancelled flows, the "Edit details"
// dialog, deleting playlists and profiles, the profile menu in the title bar,
// a damaged data file, and a 3,000-song library.
// Cover lookups are switched off here so the run does not need the internet.

import fs from 'node:fs';
import path from 'node:path';
import {
  library,
  pictures,
  ensureTestLibrary,
  tempDir,
  removeDir,
  outputDir,
  launch,
  setDialogFolder,
  t,
  text,
  chooseFile,
  eventually,
  playLabelBecomes,
  reporter,
} from './harness.mjs';

ensureTestLibrary();
const outDir = outputDir('edge');
const { check, crash, finish } = reporter();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const temps = [];
const temp = (prefix) => {
  const dir = tempDir(prefix);
  temps.push(dir);
  return dir;
};
const offlineData = (dir) =>
  fs.writeFileSync(
    path.join(dir, 'data.json'),
    JSON.stringify({ version: 1, activeProfileId: null, profiles: [], settings: { onlineArt: false } }),
  );

const title = (page) => text(page, '.pb-title');
const songCountIs = (page, count) =>
  eventually(page, (n) => document.querySelector('[data-test="songs-count"]')?.textContent.startsWith(`${n} song`), count, 15000);
const toastSays = (page, fragment) =>
  eventually(page, (needle) => [...document.querySelectorAll('.toast')].some((el) => el.textContent.includes(needle)), fragment);
const rowByTitle = (page, name) => page.locator('.song-row', { has: page.locator('.song-title', { hasText: name }) }).first();

async function seekTo(page, fraction) {
  const box = await page.locator(t('seek')).boundingBox();
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

async function everydayEdges() {
  const dataDir = temp('localfm-edge-data-');
  const music = temp('localfm-edge-music-');
  fs.cpSync(library, music, { recursive: true });
  fs.writeFileSync(path.join(music, 'Broken Band - Broken Song.mp3'), 'this is not audio at all. '.repeat(400));
  fs.writeFileSync(path.join(music, 'Empty File.mp3'), '');
  offlineData(dataDir);
  const TOTAL = 38;

  const { app, page, errors } = await launch(dataDir, music);

  console.log('Setup with awkward pictures');
  await page.click(t('choose-folder'));
  await page.waitForSelector(t('scan-result'));
  check('unreadable files are still listed', (await text(page, t('scan-result'))).includes(`Found ${TOTAL} songs`), await text(page, t('scan-result')));
  await page.click(t('wizard-continue'));
  await page.click(t('playlist-yes'));
  await page.fill(t('playlist-name'), '   ');
  check('a name of only spaces is not accepted', await page.locator(t('playlist-next')).isDisabled());
  await page.fill(t('playlist-name'), 'Mix');
  await page.keyboard.press('Enter');

  await chooseFile(page, t('pick-image'), path.join(pictures, 'exact-square.png'));
  await page.waitForSelector('.pe-preview-tile img');
  check('a picture of exactly 640 × 640 skips the cropper', (await page.locator('.crop-stage').count()) === 0);
  await chooseFile(page, t('pick-banner'), path.join(pictures, 'large-photo.png'));
  await page.waitForSelector('.crop-stage');
  await page.locator('.modal .btn', { hasText: 'Cancel' }).click();
  check('cancelling the crop leaves the banner empty', (await page.locator('.pe-preview-banner.is-empty').count()) === 1 && (await page.locator('.crop-stage').count()) === 0);
  await chooseFile(page, t('pick-image'), path.join(music, 'notes.txt'));
  check('a file that is not a picture is refused with a message', await toastSays(page, 'could not be opened as a picture'));
  check('the earlier picture is kept', (await page.locator('.pe-preview-tile img').count()) === 1);
  await page.click(t('playlist-next'));

  for (const needle of ['billie', 'africa', 'broken']) {
    await page.fill('.pe-songs-tools input', needle);
    await page.locator(t('pick-add')).first().click();
  }
  await page.fill('.pe-songs-tools input', 'zzz-nothing');
  check('song search shows an empty message', (await text(page, '.pe-songs .empty')).includes('No songs match'));
  await page.fill('.pe-songs-tools input', '');
  check('selection survives searching', (await text(page, t('selected-count'))) === '3 songs added', await text(page, t('selected-count')));
  await page.click(t('playlist-submit'));
  await page.fill(t('profile-name'), 'Edge');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.shell');
  check('library loads', await songCountIs(page, TOTAL), await text(page, t('songs-count')));
  check('uncropped exact-size picture was saved', fs.readdirSync(path.join(dataDir, 'images')).length === 1);

  console.log('Keyboard');
  await page.click('.view-heading h1');
  await page.keyboard.press('Space');
  check('Space starts playback', await playLabelBecomes(page, 'Pause'));
  await page.keyboard.press('Space');
  check('Space pauses', await playLabelBecomes(page, 'Play'));
  await page.keyboard.press('Control+f');
  check('Ctrl+F focuses search', await page.evaluate(() => document.activeElement?.dataset.test === 'songs-search'));
  await page.keyboard.type('a b');
  check('Space types a space while searching', (await page.inputValue(t('songs-search'))) === 'a b');

  console.log('Files that cannot be played');
  await page.fill(t('songs-search'), 'broken');
  await rowByTitle(page, 'Broken Song').dblclick();
  check('a broken file shows a message', await toastSays(page, 'could not be played'));
  check('playback stops when nothing playable is left', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Nothing playing'));
  await page.fill(t('songs-search'), '');

  await rowByTitle(page, 'Bohemian Rhapsody').dblclick();
  await playLabelBecomes(page, 'Pause');
  await page.click(t('next'));
  check('a broken file in the middle of a list is skipped', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Come Together'), await title(page));

  fs.rmSync(path.join(music, 'Michael Jackson - Billie Jean.mp3'));
  await rowByTitle(page, 'Billie Jean').dblclick();
  check('a file deleted behind the app is skipped', await eventually(page, () => document.querySelector('.pb-title')?.textContent === 'Bloom'), await title(page));

  await page.click(t('nav-settings'));
  await page.locator('.settings-row .btn', { hasText: 'Rescan' }).click();
  await page.keyboard.press('Escape');
  check('rescan drops the deleted file', await songCountIs(page, TOTAL - 1), await text(page, t('songs-count')));
  await page.click(t('nav-playlist'));
  await page.waitForSelector('.pl-hero');
  check('playlist keeps its remaining songs', (await page.locator('.song-row').count()) === 2);
  check('playlist explains the missing song', (await text(page, '.notice')).includes('1 song in this playlist can’t be found'));
  await shot(page, '01-playlist-missing-song');

  console.log('End of list and repeat');
  await page.click(t('nav-songs'));
  check('repeat starts off', (await page.locator(t('repeat')).getAttribute('data-mode')) === 'off');
  const firstTitle = await text(page, '.song-row .song-title');
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.locator('.song-row').last().dblclick();
  await playLabelBecomes(page, 'Pause');
  await seekTo(page, 0.97);
  check('playback stops after the last song', await playLabelBecomes(page, 'Play'));
  check('the list is rewound to the first song', (await title(page)) === firstTitle, `${await title(page)} vs ${firstTitle}`);
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = 0));

  await page.click(t('repeat'));
  await page.click(t('repeat'));
  check('repeat one is selected', (await page.locator(t('repeat')).getAttribute('data-mode')) === 'one');
  await rowByTitle(page, 'Africa').dblclick();
  await playLabelBecomes(page, 'Pause');
  await seekTo(page, 0.93);
  await eventually(page, () => document.querySelector('.pb-time')?.textContent === '0:08', null, 3000);
  const wrapped = await eventually(page, () => ['0:00', '0:01'].includes(document.querySelector('.pb-time')?.textContent), null, 6000);
  check('repeat one plays the same song again', wrapped && (await title(page)) === 'Africa' && (await page.locator(t('play-pause')).getAttribute('aria-label')) === 'Pause', await title(page));
  await page.click(t('next'));
  check('next still moves on while repeating one', (await title(page)) !== 'Africa', await title(page));
  await page.click(t('repeat'));

  console.log('Folders');
  await page.click(t('nav-settings'));
  await page.locator('.folder-row .icon-btn').click();
  await page.keyboard.press('Escape');
  check('removing the folder empties the library', await eventually(page, () => document.querySelector('.empty h2')?.textContent === 'No songs yet'));
  check('play buttons are disabled with no songs', await page.locator(t('play-all')).isDisabled());
  await shot(page, '02-empty-library');
  await page.click(t('nav-settings'));
  await page.click(t('settings-add-folder'));
  await page.keyboard.press('Escape');
  check('adding the folder back restores the songs', await songCountIs(page, TOTAL - 1), await text(page, t('songs-count')));

  const extra = temp('localfm-edge-extra-');
  fs.copyFileSync(path.join(library, 'Daft Punk - Get Lucky.mp3'), path.join(extra, 'Extra Artist - Extra Song.mp3'));
  await setDialogFolder(app, extra);
  await page.click(t('nav-settings'));
  await page.click(t('settings-add-folder'));
  check('a second folder adds its songs', await songCountIs(page, TOTAL));
  fs.rmSync(extra, { recursive: true, force: true });
  await page.locator('.settings-row .btn', { hasText: 'Rescan' }).click();
  check('settings flags a folder that vanished', await eventually(page, () => document.querySelector('.folder-row-warn') !== null));
  await page.keyboard.press('Escape');
  check('the song list explains the vanished folder', (await text(page, '.notice')).includes('can’t find'));
  check('songs from the remaining folder stay', await songCountIs(page, TOTAL - 1));
  await shot(page, '03-missing-folder');

  console.log('Editing a playlist, menus, mute');
  await page.click(t('nav-playlist'));
  await page.waitForSelector('.pl-hero');
  await page.click('.pl-text .btn-square');
  await page.locator('.menu-item', { hasText: 'Edit name and pictures' }).click();
  await page.waitForSelector(t('playlist-details'));
  check(
    'editing opens one "Edit details" screen, not the setup steps',
    (await text(page, '.modal-head h2')) === 'Edit details' && (await page.locator('.modal .pe-steps').count()) === 0,
  );
  check(
    'it shows the current name and pictures',
    (await page.inputValue(t('playlist-name'))) === 'Mix' &&
      (await page.locator('.pd-slot-image img').count()) === 1 &&
      (await page.locator('.pd-slot-banner .pd-pic.is-empty').count()) === 1,
  );
  await page.waitForTimeout(250); // let the dialog finish fading in
  await shot(page, '04-edit-details');
  await page.fill(t('playlist-name'), '   ');
  check('a blank name cannot be saved', await page.locator(t('playlist-submit')).isDisabled());
  await page.fill(t('playlist-name'), 'Mix Two');
  await page.click(t('playlist-submit'));
  check(
    'renaming a playlist updates the page and the sidebar',
    await eventually(page, () => document.querySelector('.pl-text h1')?.textContent === 'Mix Two' && document.querySelector('[data-test="nav-playlist"] .nav-label')?.textContent === 'Mix Two'),
  );
  check('its picture survives the rename', (await page.locator('.pl-tile img').count()) === 1);

  const openDetails = async () => {
    await page.click('.pl-text .btn-square');
    await page.locator('.menu-item', { hasText: 'Edit name and pictures' }).click();
    await page.waitForSelector(t('playlist-details'));
  };
  const imageFiles = () => fs.readdirSync(path.join(dataDir, 'images')).length;
  const gone = (selector) => eventually(page, (sel) => !document.querySelector(sel), selector);

  await openDetails();
  await chooseFile(page, t('pick-banner'), path.join(pictures, 'large-photo.png'));
  await page.waitForSelector('.crop-stage');
  await page.click(t('crop-apply'));
  await page.waitForSelector('.pd-slot-banner img');
  await page.click(t('remove-image'));
  check('pictures can be changed and removed in the dialog', (await page.locator('.pd-slot-image .pd-pic.is-empty').count()) === 1);
  await page.fill(t('playlist-name'), 'Never Saved');
  await shot(page, '05-edit-details-changed');
  await page.locator('.pd .btn', { hasText: 'Cancel' }).click();
  check(
    'cancelling "Edit details" changes nothing',
    (await gone('.modal')) &&
      (await text(page, '.pl-text h1')) === 'Mix Two' &&
      (await page.locator('.pl-tile img').count()) === 1 &&
      (await page.locator('.pl-banner img').count()) === 0 &&
      imageFiles() === 1,
  );

  await openDetails();
  await chooseFile(page, t('pick-banner'), path.join(pictures, 'large-photo.png'));
  await page.waitForSelector('.crop-stage');
  await page.click(t('crop-apply'));
  await page.waitForSelector('.pd-slot-banner img');
  await page.click(t('playlist-submit'));
  check('a banner added in "Edit details" is saved', (await eventually(page, () => document.querySelector('.pl-banner img') !== null)) && imageFiles() === 2, `${imageFiles()} files`);
  check('the song list is untouched by editing details', (await page.locator('.song-row').count()) === 2);

  await openDetails();
  await page.click(t('remove-banner'));
  await page.click(t('playlist-name'));
  await page.keyboard.press('Enter');
  check('Enter in the name box saves', await gone('.modal'));
  check('a removed banner is deleted from disk', (await eventually(page, () => !document.querySelector('.pl-banner img'))) && imageFiles() === 1, `${imageFiles()} files`);
  const beforeAdd = await page.locator('.song-row').count();
  await page.click(t('playlist-add-songs'));
  await page.waitForSelector('.pick-row');
  check('"Add songs" opens on the song step with current songs counted', (await text(page, t('selected-count'))) === `${beforeAdd} songs added`, await text(page, t('selected-count')));
  check('"Add songs" shows only the song picker', (await page.locator('.modal .pe-steps:visible').count()) === 0 && (await text(page, '.modal-head h2')) === 'Add songs to “Mix Two”');
  await page.locator(t('pick-add')).first().click();
  await page.click(t('playlist-submit'));
  check('adding a song to an existing playlist works', await eventually(page, (n) => document.querySelectorAll('.song-row').length === n, beforeAdd + 1));

  await page.locator('.song-row').first().click({ button: 'right' });
  check('right-click opens the song menu', await eventually(page, () => [...document.querySelectorAll('.menu-item')].some((el) => el.textContent.includes('Show in folder'))));
  await page.keyboard.press('Escape');
  check('Escape closes the menu', (await page.locator('.menu').count()) === 0);

  await page.click('.pb-extra .icon-btn');
  check('mute silences and says so', (await page.locator('.pb-extra .icon-btn').getAttribute('title')) === 'Unmute' && (await page.inputValue('.pb-volume')) === '0');
  await page.click('.pb-extra .icon-btn');
  check('unmute restores the volume', (await page.inputValue('.pb-volume')) === '80', await page.inputValue('.pb-volume'));

  console.log('Deleting things');
  await page.click(t('nav-playlist'));
  await page.click('.pl-text .btn-square');
  await page.locator('.menu-item', { hasText: 'Delete playlist' }).click();
  await page.locator('.modal .btn', { hasText: 'Cancel' }).click();
  check('cancelling keeps the playlist', (await page.locator(t('nav-playlist')).count()) === 1);
  await page.click('.pl-text .btn-square');
  await page.locator('.menu-item', { hasText: 'Delete playlist' }).click();
  await page.locator('.modal .btn-danger').click();
  check('deleting a playlist returns to All songs', await eventually(page, () => !document.querySelector('[data-test="nav-playlist"]') && document.querySelector('.view-heading h1')?.textContent === 'All songs'));
  check('its picture file is removed', fs.readdirSync(path.join(dataDir, 'images')).length === 0);

  await page.click(t('profile-chip'));
  await page.locator('.menu-item', { hasText: 'Add profile' }).click();
  await page.waitForSelector('.wizard');
  await page.locator('.wizard-foot .btn', { hasText: 'Cancel' }).click();
  await page.waitForSelector('.shell');
  check('cancelling "Add profile" returns to the existing profile', (await page.getAttribute(t('profile-chip'), 'data-profile')) === 'Edge');

  await page.click(t('profile-chip'));
  check('"Edit this profile" has moved out of the main menu', (await page.locator('.menu-item', { hasText: 'Edit this profile' }).count()) === 0);
  await page.locator(t('profile-option'), { hasText: 'Edge' }).click({ button: 'right' });
  await page.click(t('profile-edit'));
  await page.fill('.modal input[type="text"]', 'Renamed');
  await page.locator('.modal .swatch').nth(4).click();
  await page.locator('.modal .btn-accent').click();
  check('renaming a profile updates the profile button', await eventually(page, () => document.querySelector('[data-test="profile-chip"]')?.dataset.profile === 'Renamed'));
  check('the accent follows the profile colour', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#b4a0ff');

  // The edit dialog keeps its own Delete button.
  await page.click(t('profile-chip'));
  await page.locator(t('profile-option'), { hasText: 'Renamed' }).click({ button: 'right' });
  await page.click(t('profile-edit'));
  await page.locator('.modal .btn', { hasText: 'Delete profile' }).click();
  await page.locator('.modal .btn-danger').click();
  check('deleting the only profile returns to first-run setup', await eventually(page, () => document.querySelector('.wizard-title')?.textContent === 'Where is your music?'));
  check('music files are untouched by deleting a profile', fs.existsSync(path.join(music, 'Daft Punk - Get Lucky.mp3')));
  // The song this script deleted on purpose is requested once and answers 404.
  const unexpected = errors.filter((message) => !message.includes('404 (Not Found)'));
  check('no unexpected errors in the window', unexpected.length === 0 && errors.length <= 1, errors.join(' | '));
  await app.close();
}

// The profile button in the title bar, its drop-down, and right-click on a profile.
async function profileMenu() {
  console.log('Profile menu');
  const dataDir = temp('localfm-edge-profiles-');
  const seed = (id, name, color) => ({
    id,
    name,
    color,
    setupComplete: true,
    folders: [path.join(library, 'Albums')],
    playlists: [],
    player: { volume: 0.8, shuffle: false, repeat: 'off' },
    createdAt: 1,
  });
  fs.writeFileSync(
    path.join(dataDir, 'data.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: null,
      settings: { onlineArt: false },
      profiles: [seed('a'.repeat(16), 'Ana', '#ffb454'), seed('b'.repeat(16), 'Ben', '#60cdff'), seed('c'.repeat(16), 'Cy', '#6ccb5f')],
    }),
  );
  const { app, page, errors } = await launch(dataDir, library);
  const menus = () => page.locator('.menu').count();
  const optionNames = () => page.locator(`${t('profile-option')} .menu-label`).allInnerTexts();
  const profileName = () => page.getAttribute(t('profile-chip'), 'data-profile');

  await page.waitForSelector('.picker');
  check('no profile button before a profile is chosen', (await page.locator(t('profile-chip')).count()) === 0);
  await page.locator(t('profile-tile'), { hasText: 'Cy' }).click({ button: 'right' });
  check('right-click on a picker tile offers edit and delete', (await page.locator(t('profile-edit')).count()) === 1 && (await page.locator(t('profile-delete')).count()) === 1);
  await page.click(t('profile-delete'));
  await page.locator('.modal .btn-danger').click();
  check('deleting from the picker removes the tile', await eventually(page, () => document.querySelectorAll('[data-test="profile-tile"]').length === 2));

  await page.locator(t('profile-tile'), { hasText: 'Ana' }).click();
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !document.querySelector('.scan-status'));
  const chip = page.locator(t('profile-chip'));
  const chipBox = await chip.boundingBox();
  const overlay = await page.evaluate(() => {
    const rect = navigator.windowControlsOverlay?.getTitlebarAreaRect?.();
    return { width: window.innerWidth, visible: navigator.windowControlsOverlay?.visible ?? null, right: rect ? rect.x + rect.width : null };
  });
  console.log(`  info profile button: ${JSON.stringify(chipBox)} window: ${JSON.stringify(overlay)}`);
  check('the profile button is in the title bar', chipBox.y >= 0 && chipBox.y + chipBox.height <= 40);
  const controlsLeft = overlay.right ?? overlay.width - 138;
  const gap = controlsLeft - (chipBox.x + chipBox.width);
  check('it sits just left of the window buttons without overlapping them', gap >= 0 && gap <= 24, `gap ${gap}px`);
  check('the sidebar no longer has a profile entry', (await page.locator('.sidebar').innerText()).includes('Settings') && !(await page.locator('.sidebar').innerText()).includes('Ana'));

  await chip.click();
  await page.waitForSelector('.menu.is-dropdown');
  check('the menu plays the drop-down animation', (await page.locator('.menu').evaluate((el) => getComputedStyle(el).animationName)) === 'drop');
  const menuBox = await page.locator('.menu').boundingBox();
  check(
    'the menu drops down under the button, lined up with its right edge',
    menuBox.y >= chipBox.y + chipBox.height && Math.abs(menuBox.x + menuBox.width - (chipBox.x + chipBox.width)) <= 2,
    JSON.stringify(menuBox),
  );
  check('the menu lists the profiles', (await optionNames()).join(',') === 'Ana,Ben', (await optionNames()).join(','));
  await page.waitForTimeout(400);
  await shot(page, '06-profile-dropdown');
  await chip.click();
  check('clicking the button again closes the menu', (await menus()) === 0);
  check('the button reports the menu closed', (await chip.getAttribute('aria-expanded')) === 'false');

  await chip.click();
  await page.locator(t('profile-option'), { hasText: 'Ben' }).click({ button: 'right' });
  check('right-click on a profile opens its options over the menu', (await menus()) === 2 && (await page.locator(t('profile-delete')).isVisible()));
  await page.waitForTimeout(200);
  await shot(page, '07-profile-right-click');
  await page.locator(t('profile-option'), { hasText: 'Ana' }).click({ button: 'right' });
  check('right-clicking another profile swaps the options', (await menus()) === 2 && (await text(page, '.menu:last-child .menu-heading')) === 'Ana');
  await page.keyboard.press('Escape');
  check('Escape closes the options first', (await menus()) === 1);
  await page.keyboard.press('Escape');
  check('and then the menu', (await menus()) === 0);

  // Deleting another profile must not interrupt what is playing.
  await page.click(t('play-all'));
  await playLabelBecomes(page, 'Pause');
  const playing = await title(page);
  await chip.click();
  await page.locator(t('profile-option'), { hasText: 'Ben' }).click({ button: 'right' });
  await page.click(t('profile-delete'));
  check('deleting asks first', (await text(page, '.modal-head h2')) === 'Delete “Ben”?' && (await menus()) === 0);
  await page.locator('.modal .btn', { hasText: 'Cancel' }).click();
  await chip.click();
  check('cancelling keeps the profile', (await optionNames()).join(',') === 'Ana,Ben');
  await page.locator(t('profile-option'), { hasText: 'Ben' }).click({ button: 'right' });
  await page.click(t('profile-delete'));
  await page.locator('.modal .btn-danger').click();
  check('deleting another profile says so', await toastSays(page, 'Profile “Ben” deleted'));
  check('the music keeps playing', (await title(page)) === playing && (await page.locator(t('play-pause')).getAttribute('aria-label')) === 'Pause' && (await profileName()) === 'Ana');
  await chip.click();
  check('the deleted profile is gone from the menu', (await optionNames()).join(',') === 'Ana' && (await page.locator('.menu-item', { hasText: 'Choose a profile' }).count()) === 0);
  check('it is gone from the saved data', await eventually(page, async () => (await window.api.getState()).profiles.length === 1));

  await page.locator(t('profile-option'), { hasText: 'Ana' }).click({ button: 'right' });
  await page.click(t('profile-delete'));
  await page.locator('.modal .btn-danger').click();
  check('deleting the profile in use returns to first-run setup', await eventually(page, () => document.querySelector('.wizard-title')?.textContent === 'Where is your music?'));
  check('the profile button leaves the title bar with it', (await page.locator(t('profile-chip')).count()) === 0);
  check('no errors in the window', errors.length === 0, errors.join(' | '));
  await app.close();
}

async function damagedDataFile() {
  console.log('Damaged data file');
  const dataDir = temp('localfm-edge-corrupt-');
  fs.writeFileSync(path.join(dataDir, 'data.json'), '{"profiles": [ this is not json');
  const { app, page } = await launch(dataDir, library);
  await page.waitForSelector('.wizard');
  check('a damaged data file falls back to setup', (await text(page, '.wizard-title')) === 'Where is your music?');
  check('the damaged file is kept aside', fs.readdirSync(dataDir).some((name) => name.startsWith('data.json.corrupt-')));
  await app.close();
}

async function interruptedSetup() {
  console.log('Interrupted setup');
  const dataDir = temp('localfm-edge-resume-');
  offlineData(dataDir);
  let { app, page } = await launch(dataDir, path.join(library, 'Albums'));
  await page.click(t('choose-folder'));
  await page.waitForSelector(t('scan-result'));
  await app.close();
  ({ app, page } = await launch(dataDir, library));
  await page.waitForSelector(t('scan-result'));
  check(
    'setup resumes with the folder already chosen',
    (await text(page, '.folder-box-path')).endsWith('Albums') && (await text(page, t('scan-result'))).includes('Found 3 songs'),
    await text(page, t('scan-result')),
  );
  check('it is still the first-run setup', (await page.locator('.wizard-foot .btn', { hasText: 'Cancel' }).count()) === 0);
  await app.close();
}

async function bigLibrary() {
  console.log('3,000-song library');
  const COUNT = 3000;
  const dataDir = temp('localfm-edge-bigdata-');
  const music = temp('localfm-edge-bigmusic-');
  offlineData(dataDir);
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const body = Buffer.concat([frame, frame, frame, frame]);
  for (let i = 1; i <= COUNT; i++) {
    const folder = path.join(music, `Album ${String(Math.ceil(i / 100)).padStart(2, '0')}`);
    if (i % 100 === 1) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `Band ${String((i % 40) + 1).padStart(2, '0')} - Track ${String(i).padStart(4, '0')}.mp3`), body);
  }

  const { app, page, errors } = await launch(dataDir, music);
  const started = Date.now();
  await page.click(t('choose-folder'));
  await page.waitForSelector(t('scan-result'), { timeout: 120000 });
  const scanMs = Date.now() - started;
  console.log(`  info first scan of ${COUNT} files: ${(scanMs / 1000).toFixed(1)} s`);
  check('first scan finishes in reasonable time', scanMs < 60000, `${scanMs} ms`);
  check('every file is found', (await text(page, t('scan-result'))).includes('Found 3,000 songs'), await text(page, t('scan-result')));
  await page.click(t('wizard-continue'));
  await page.click(t('playlist-yes'));
  await page.fill(t('playlist-name'), 'Everything');
  await page.click(t('playlist-next'));
  await page.click(t('playlist-next'));
  await page.locator('.pe-songs-tools .btn', { hasText: 'Add all' }).click();
  check('"Add all" selects the whole library', (await text(page, t('selected-count'))) === '3,000 songs added', await text(page, t('selected-count')));
  await page.click(t('playlist-submit'));
  await page.fill(t('profile-name'), 'Big');
  await page.click(t('wizard-add-another'));
  await page.waitForFunction(() => document.querySelector('.wizard-step.is-active')?.textContent.includes('Music folder'));
  check('"Save and add another profile" starts a second setup', (await page.locator('.wizard-foot .btn', { hasText: 'Cancel' }).count()) === 1);
  await page.locator('.wizard-foot .btn', { hasText: 'Cancel' }).click();
  await page.waitForSelector('.shell');
  check('cancelling it opens the profile that was saved', (await page.getAttribute(t('profile-chip'), 'data-profile')) === 'Big');
  await page.waitForFunction(() => !document.querySelector('.scan-status'), null, { timeout: 60000 });
  check('all 3,000 songs are in the list', (await text(page, t('songs-count'))).startsWith('3,000 songs'), await text(page, t('songs-count')));
  const rendered = await page.locator('.song-row').count();
  check('only the visible rows are in the page', rendered > 0 && rendered < 80, `${rendered} rows`);
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  check('the end of the list is reachable', await eventually(page, () => [...document.querySelectorAll('.song-title')].some((el) => el.textContent.includes('Track 3000'))));
  const searchStarted = Date.now();
  await page.fill(t('songs-search'), 'track 2999');
  await page.waitForFunction(() => document.querySelectorAll('.song-row').length === 1);
  console.log(`  info search across ${COUNT} songs: ${Date.now() - searchStarted} ms`);
  await page.fill(t('songs-search'), '');
  await page.click(t('nav-playlist'));
  await page.waitForSelector('.pl-hero');
  check('a 3,000-song playlist opens', (await text(page, '.pl-text .view-sub')).startsWith('3,000 songs'), await text(page, '.pl-text .view-sub'));
  await page.click(t('playlist-play'));
  check('and plays', await playLabelBecomes(page, 'Pause'));

  // Second launch: unchanged files come from the cache instead of being re-read.
  await app.close();
  const again = await launch(dataDir, music);
  const relaunched = Date.now();
  await again.page.waitForSelector('.shell');
  await again.page.waitForFunction(() => !document.querySelector('.scan-status'), null, { timeout: 60000 });
  console.log(`  info relaunch until library is checked: ${((Date.now() - relaunched) / 1000).toFixed(1)} s`);
  check('library is intact after relaunch', (await text(again.page, t('songs-count'))).startsWith('3,000 songs'));
  check('no errors in the window', errors.length === 0 && again.errors.length === 0, [...errors, ...again.errors].join(' | '));
  await again.app.close();
}

try {
  await everydayEdges();
  await profileMenu();
  await damagedDataFile();
  await interruptedSetup();
  await bigLibrary();
} catch (error) {
  crash(error);
} finally {
  temps.forEach(removeDir);
}
finish();
