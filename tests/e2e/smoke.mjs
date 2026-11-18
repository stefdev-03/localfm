// End-to-end check of the real app:  npm run test:e2e
//
// Drives Electron through first-run setup, playlist creation with cropping,
// playback controls, a second profile, and a restart, using a throwaway data
// folder and the generated test library. Screenshots land in
// tests/e2e/output/smoke.

import fs from 'node:fs';
import path from 'node:path';
import { library, pictures, ensureTestLibrary, tempDir, removeDir, outputDir, launch as launchApp, t, text, chooseFile, reporter } from './harness.mjs';

ensureTestLibrary();
const outDir = outputDir('smoke');
const dataDir = tempDir('localfm-e2e-');
const SONG_COUNT = 36;
const { check, crash, finish } = reporter();
const launch = () => launchApp(dataDir, library);
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name + '.png') });

async function run() {
  console.log(`data folder: ${dataDir}`);
  let { app, page, errors } = await launch();

  // ---- first run: folder -------------------------------------------------
  console.log('First-run setup');
  await page.waitForSelector('.wizard');
  check('wizard opens on first launch', (await text(page, '.wizard-title')) === 'Where is your music?');
  check('continue is disabled before a folder is chosen', await page.locator(t('wizard-continue')).isDisabled());
  const notesBetween = (list, step) => page.evaluate(([l, s]) => [...document.querySelectorAll(`${l} > li`)].map((li) => li.querySelectorAll(`.step-notes svg`).length + (getComputedStyle(li, '::after').content === 'none' ? '' : '+line')).join(','), [list, step]);
  check('setup steps are linked by runs of three notes, not lines', (await notesBetween('.wizard-steps')) === '3,3,0', await notesBetween('.wizard-steps'));
  await shot(page, '01-wizard-folder-empty');
  await page.click(t('choose-folder'));
  await page.waitForSelector(t('scan-result'));
  check('scan finds every song', (await text(page, t('scan-result'))).includes(`Found ${SONG_COUNT} songs`), await text(page, t('scan-result')));
  const previewRows = await page.locator('.preview-row').allInnerTexts();
  check('artist and title are separated', previewRows.some((row) => /Billie Jean\s+Michael Jackson/.test(row)), previewRows.slice(0, 3).join(' | '));
  check('upload noise is removed from titles', !previewRows.join('\n').includes('Official'));
  await page.locator('.wizard-preview').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(150);
  const embeddedRow = page.locator('.preview-row', { hasText: 'Sunday Riff' });
  check('tags win over the file name', (await embeddedRow.innerText()).includes('The Test Tones'));
  check('embedded cover art is shown', (await embeddedRow.locator('.cover img[src^="media://art/e-"]').count()) === 1);
  await page.locator('.wizard-preview').evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(6000); // give online cover lookups a moment (needs internet)
  await shot(page, '02-wizard-folder-scanned');
  await page.click(t('wizard-continue'));

  // ---- first run: playlist -----------------------------------------------
  await page.waitForSelector(t('playlist-yes'));
  check('playlist step offers a skip button', await page.locator(t('playlist-skip')).isVisible());
  await shot(page, '03-wizard-playlist-ask');
  await page.click(t('playlist-yes'));
  check('next is disabled without a name', await page.locator(t('playlist-next')).isDisabled());
  check('playlist steps use the same notes', (await notesBetween('.pe-steps')) === '3,3,0', await notesBetween('.pe-steps'));
  await page.fill(t('playlist-name'), 'Road Trip');
  await page.click(t('playlist-next'));

  await chooseFile(page, t('pick-image'), path.join(pictures, 'large-photo.png'));
  await page.waitForSelector('.crop-stage');
  check('oversized picture opens the cropper', (await text(page, '.modal .modal-text')).includes('1600 × 1200'));
  await shot(page, '04-crop-picture');
  await page.click(t('crop-apply'));
  await page.waitForSelector('.pe-preview-tile img');

  await chooseFile(page, t('pick-banner'), path.join(pictures, 'wide-photo.png'));
  await page.waitForSelector('.crop-stage');
  const stage = await page.locator('.crop-stage').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 - 120, stage.y + stage.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await shot(page, '05-crop-banner');
  await page.click(t('crop-apply'));
  await page.waitForSelector('.pe-preview-banner img');
  await shot(page, '06-playlist-pictures');
  await page.click(t('playlist-next'));

  await page.waitForSelector('.pick-row');
  for (let i = 0; i < 4; i++) await page.locator(t('pick-add')).first().click();
  check('+ adds songs', (await text(page, t('selected-count'))) === '4 songs added', await text(page, t('selected-count')));
  await page.locator(t('pick-remove')).first().click();
  check('− takes a song back out', (await text(page, t('selected-count'))) === '3 songs added', await text(page, t('selected-count')));
  await shot(page, '07-playlist-songs');
  await page.click(t('playlist-submit'));

  // ---- first run: profile ------------------------------------------------
  await page.waitForSelector(t('profile-name'));
  check('finish is disabled without a profile name', await page.locator(t('wizard-finish')).isDisabled());
  await page.fill(t('profile-name'), 'Alex');
  await shot(page, '08-wizard-profile');
  await page.click(t('wizard-finish'));

  // ---- main window ---------------------------------------------------------
  console.log('Main window');
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !document.querySelector('.scan-status'));
  check('all songs are listed', (await text(page, t('songs-count'))).startsWith(`${SONG_COUNT} songs`), await text(page, t('songs-count')));
  check('playlist appears in the sidebar', (await text(page, `${t('nav-playlist')} .nav-label`)) === 'Road Trip');
  check('profile button shows the profile', (await page.getAttribute(t('profile-chip'), 'data-profile')) === 'Alex');
  const chipBox = await page.locator(t('profile-chip')).boundingBox();
  const windowWidth = await page.evaluate(() => window.innerWidth);
  check(
    'profile button sits at the top right, beside the window buttons',
    chipBox.y + chipBox.height <= 40 && windowWidth - (chipBox.x + chipBox.width) < 220 && (await page.locator(`.sidebar ${t('profile-chip')}`).count()) === 0,
    JSON.stringify({ chipBox, windowWidth }),
  );
  await shot(page, '09-all-songs');

  const savedImages = fs.readdirSync(path.join(dataDir, 'images'));
  check('cropped pictures are saved', savedImages.length === 2, savedImages.join(', '));

  // ---- playback --------------------------------------------------------------
  console.log('Playback');
  const playPause = page.locator(t('play-pause'));
  const title = () => text(page, '.pb-title');
  await page.click(t('play-all'));
  await page.waitForFunction(() => document.querySelector('[data-test="play-pause"]')?.getAttribute('aria-label') === 'Pause');
  const first = await title();
  check('play all starts the first song', first === (await text(page, '.song-row .song-title')), first);
  await page.waitForFunction(() => document.querySelector('.pb-time')?.textContent !== '0:00', null, { timeout: 8000 }).catch(() => {});
  check('playback position advances', (await text(page, '.pb-time')) !== '0:00', await text(page, '.pb-time'));
  check('playing song is highlighted', (await page.locator('.song-row.is-current').count()) === 1);

  // The button follows the audio element's own play/pause events, so wait for them.
  const labelBecomes = (label) =>
    page
      .waitForFunction((wanted) => document.querySelector('[data-test="play-pause"]')?.getAttribute('aria-label') === wanted, label, { timeout: 3000 })
      .then(() => true, () => false);
  await playPause.click();
  check('pause works', await labelBecomes('Play'));
  const pausedAt = await text(page, '.pb-time');
  await page.waitForTimeout(1200);
  check('position holds while paused', (await text(page, '.pb-time')) === pausedAt);
  await playPause.click();
  check('resume works', await labelBecomes('Pause'));

  await page.click(t('next'));
  const second = await title();
  check('next moves to the following song', second !== first && second === (await page.locator('.song-row .song-title').nth(1).innerText()), second);
  await page.click(t('prev'));
  check('previous goes back', (await title()) === first, await title());

  await page.click(t('shuffle'));
  check('shuffle turns on', (await page.locator(t('shuffle')).getAttribute('aria-pressed')) === 'true');
  const seen = new Set([await title()]);
  for (let i = 0; i < SONG_COUNT - 1; i++) {
    await page.click(t('next'));
    seen.add(await title());
  }
  check('shuffle plays every song once before repeating', seen.size === SONG_COUNT, `${seen.size} distinct`);
  await page.click(t('shuffle'));

  await page.click(t('repeat'));
  check('repeat cycles to "all"', (await page.locator(t('repeat')).getAttribute('data-mode')) === 'all');
  await page.click(t('repeat'));
  check('repeat cycles to "one"', (await page.locator(t('repeat')).getAttribute('data-mode')) === 'one');
  await page.click(t('repeat'));
  check('repeat cycles back to off', (await page.locator(t('repeat')).getAttribute('data-mode')) === 'off');

  // Repeat-all wraps from the last song to the first.
  await page.click(t('repeat'));
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  // Rows are drawn as the list scrolls; wait for the last one to exist.
  const lastRow = page.locator(`.song-row[style*="top: ${(SONG_COUNT - 1) * 56}px"]`);
  await lastRow.waitFor();
  await lastRow.dblclick();
  const last = await title();
  await page.click(t('next'));
  check('repeat all wraps to the first song', (await title()) === first && last !== first, `${last} -> ${await title()}`);
  await page.click(t('repeat'));
  await page.click(t('repeat'));
  await page.locator('.view-scroller').evaluate((el) => (el.scrollTop = 0));

  // Seeking: jump to the middle and confirm the clock follows.
  const seek = page.locator(t('seek'));
  const box = await seek.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.waitForTimeout(400);
  check('seeking moves the playback position', (await text(page, '.pb-time')) !== '0:00', await text(page, '.pb-time'));
  await shot(page, '10-playing');

  // A song ending on its own moves on to the next one.
  await page.locator('.song-row').nth(SONG_COUNT - 1 < 8 ? SONG_COUNT - 1 : 0).dblclick();
  const before = await title();
  const seekBox = await seek.boundingBox();
  await page.mouse.click(seekBox.x + seekBox.width * 0.97, seekBox.y + seekBox.height / 2);
  await page.waitForFunction((previous) => document.querySelector('.pb-title')?.textContent !== previous, before, { timeout: 8000 }).catch(() => {});
  check('next song starts automatically when one ends', (await title()) !== before, `${before} -> ${await title()}`);

  // ---- search ------------------------------------------------------------------
  await page.fill(t('songs-search'), 'queen');
  check('search filters the list', (await page.locator('.song-row').count()) === 1 && (await text(page, '.song-row .song-artist')) === 'Queen');
  await page.fill(t('songs-search'), '');

  // ---- playlist page -----------------------------------------------------------
  console.log('Playlists');
  await page.click(t('nav-playlist'));
  await page.waitForSelector('.pl-hero');
  check('playlist shows its songs', (await page.locator('.song-row').count()) === 3);
  check('playlist shows banner and picture', (await page.locator('.pl-banner img').count()) === 1 && (await page.locator('.pl-tile img').count()) === 1);
  await shot(page, '11-playlist');
  await page.click(t('playlist-play'));
  await page.waitForFunction(() => document.querySelector('.song-row.is-current'));
  check('playlist plays', (await title()) === (await text(page, '.song-row .song-title')));

  await page.locator('.song-row').first().hover();
  await page.locator(t('song-action')).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.song-row').length === 2);
  check('− removes a song from the playlist', true);
  await page.click('.toast-action');
  await page.waitForFunction(() => document.querySelectorAll('.song-row').length === 3);
  check('undo puts it back', true);

  // Create a second playlist from the sidebar, skipping the pictures.
  await page.click(t('nav-create-playlist'));
  await page.fill(t('playlist-name'), 'Quiet Evening');
  await page.click(t('playlist-next'));
  await page.click(t('playlist-next'));
  await page.locator(t('pick-add')).first().click();
  await page.locator(t('pick-add')).first().click();
  await page.click(t('playlist-submit'));
  await page.waitForFunction(() => document.querySelectorAll('[data-test="nav-playlist"]').length === 2);
  check('sidebar "Create playlist" makes a playlist', (await page.locator('.pl-text h1').innerText()) === 'Quiet Evening');
  check('new playlist has the picked songs', (await page.locator('.song-row').count()) === 2);
  await shot(page, '12-second-playlist');

  // Add to a playlist straight from All songs.
  await page.click(t('nav-songs'));
  await page.locator('.song-row').nth(5).hover();
  await page.locator('.song-row').nth(5).locator(t('song-action')).click();
  await page.waitForSelector('.menu');
  await page.waitForTimeout(250); // let the menu finish fading in
  await shot(page, '13-add-to-playlist-menu');
  await page.locator('.menu-item', { hasText: 'Quiet Evening' }).click();
  await page.locator(t('nav-playlist')).nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.song-row').length === 3);
  check('+ in All songs adds to a playlist', true);

  // ---- settings ------------------------------------------------------------------
  await page.click(t('nav-settings'));
  await page.waitForSelector('.settings-section');
  check('settings lists the music folder', (await text(page, '.folder-row-text')).includes('test-library'));
  await shot(page, '14-settings');
  await page.keyboard.press('Escape');

  // ---- second profile --------------------------------------------------------------
  console.log('Profiles');
  await page.click(t('profile-chip'));
  await page.waitForSelector('.menu');
  await page.waitForTimeout(400); // let the menu finish dropping down
  await shot(page, '15-profile-menu');
  await page.locator('.menu-item', { hasText: 'Add profile' }).click();
  await page.waitForSelector('.wizard');
  check('adding a profile stops playback and opens setup', (await text(page, '.wizard-title')) === 'Where is your music?');
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, path.join(library, 'Albums'));
  await page.click(t('choose-folder'));
  await page.waitForSelector(t('scan-result'));
  check('second profile scans its own folder', (await text(page, t('scan-result'))).includes('Found 3 songs'), await text(page, t('scan-result')));
  await page.click(t('wizard-continue'));
  await page.click(t('playlist-skip'));
  await page.fill(t('profile-name'), 'Sam');
  await page.locator('.swatch').nth(1).click();
  await page.click(t('wizard-finish'));
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !document.querySelector('.scan-status'));
  check('second profile has only its own songs', (await text(page, t('songs-count'))).startsWith('3 songs'), await text(page, t('songs-count')));
  check('second profile has no playlists', (await page.locator(t('nav-playlist')).count()) === 0);
  await shot(page, '16-second-profile');

  // Switch back through the menu.
  await page.click(t('profile-chip'));
  await page.locator('.menu-item', { hasText: 'Alex' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-test="nav-playlist"]').length === 2);
  check('switching profile brings back its playlists', (await text(page, t('songs-count'))).startsWith(`${SONG_COUNT} songs`));
  check('no errors in the window', errors.length === 0, errors.join(' | '));

  // ---- restart: everything persists -----------------------------------------------
  console.log('Restart');
  await app.close();
  ({ app, page, errors } = await launch());
  await page.waitForSelector('.picker');
  check('profile picker opens when there are several profiles', (await page.locator(t('profile-tile')).count()) === 2);
  await shot(page, '17-profile-picker');
  await page.locator(t('profile-tile'), { hasText: 'Alex' }).click();
  await page.waitForSelector('.shell');
  check('playlists survive a restart', (await page.locator(t('nav-playlist')).count()) === 2);
  await page.locator(t('nav-playlist')).first().click();
  await page.waitForSelector('.pl-hero');
  check('playlist songs and pictures survive a restart', (await page.locator('.song-row').count()) === 3 && (await page.locator('.pl-banner img').count()) === 1);
  const withArt = await page.locator('.song-row .cover img').count();
  console.log(`  info covers showing on this playlist: ${withArt} of 3`);
  check('no errors after restart', errors.length === 0, errors.join(' | '));

  // The window reopens at the size it was closed with.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700));
  await app.close();
  ({ app, page, errors } = await launch());
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  // Windows rounds sizes to whole device pixels, so allow a few pixels either way.
  check('window size is remembered', Math.abs(size[0] - 1100) <= 6 && Math.abs(size[1] - 700) <= 6, size.join(' x '));
  await page.waitForSelector('.picker');
  await page.locator(t('profile-tile'), { hasText: 'Sam' }).click();
  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !document.querySelector('.scan-status'));
  await shot(page, '18-narrow-window');
  await app.close();
}

try {
  await run();
} catch (error) {
  crash(error);
} finally {
  removeDir(dataDir);
}
finish();
