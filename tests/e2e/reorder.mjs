// Dragging songs into a new order in a playlist:  npm run test:reorder
//
// Starts with a profile whose playlist holds every song in the practice
// library plus one song whose file is missing. Drags songs up and down,
// cancels with Esc, scrolls by holding near the edge, uses Alt+Up / Alt+Down
// and the right-click menu, then restarts and checks the order was kept.
// Screenshots land in tests/e2e/output/reorder. Cover lookups are off.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { library, ensureTestLibrary, tempDir, removeDir, outputDir, launch, t, eventually, reporter } from './harness.mjs';
import { moveInPlaylist } from '../../src/renderer/js/reorder.js';

ensureTestLibrary();
const outDir = outputDir('reorder');
const dataDir = tempDir('localfm-reorder-');
const { check, crash, finish } = reporter();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const ROW = 56;
const PROFILE = 'd'.repeat(16);
const MISSING = '0123456789abcdef';

// Same id rule as library.js, so seeded playlists point at real songs.
const trackId = (file) => crypto.createHash('sha1').update(path.normalize(file).toLowerCase()).digest('hex').slice(0, 16);
function songsIn(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) songsIn(full, out);
    else if (entry.name.endsWith('.mp3')) out.push(trackId(full));
  }
  return out;
}
const songs = songsIn(library);
// The missing song sits fourth, between real ones.
let expectedAll = [...songs.slice(0, 3), MISSING, ...songs.slice(3)];
const visibleOf = (all) => all.filter((id) => id !== MISSING);

function seed() {
  fs.writeFileSync(
    path.join(dataDir, 'data.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: PROFILE,
      settings: { onlineArt: false },
      profiles: [
        {
          id: PROFILE,
          name: 'Kim',
          color: '#ff8fa3',
          picture: null,
          setupComplete: true,
          folders: [library],
          playlists: [
            { id: 'a'.repeat(16), name: 'Everything', image: null, banner: null, trackIds: expectedAll, createdAt: 1, updatedAt: 1 },
            { id: 'b'.repeat(16), name: 'Just one', image: null, banner: null, trackIds: [songs[0]], createdAt: 2, updatedAt: 2 },
          ],
          player: { volume: 0, shuffle: false, repeat: 'off' },
          createdAt: 1,
        },
      ],
    }),
  );
}

const onScreen = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.vlist > .song-row:not(.is-lifted)')]
      .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
      .map((row) => ({ id: row.dataset.id, index: Math.round(parseFloat(row.style.top) / 56) })),
  );
// The ids shown at positions [start, start + n).
const shownIds = async (page, start, n) => {
  const rows = await onScreen(page);
  return rows.filter((row) => row.index >= start && row.index < start + n).map((row) => row.id);
};
const savedIds = (page) => page.evaluate(async () => (await window.api.getState()).profiles[0].playlists[0].trackIds);
const savedMatches = (page) => eventually(page, (want) => window.api.getState().then((s) => JSON.stringify(s.profiles[0].playlists[0].trackIds) === want), JSON.stringify(expectedAll));
const rowAt = (page, index) => page.locator(`.vlist > .song-row:not(.is-lifted)[style*="top: ${index * ROW}px"]`);
// Scrolls so the list's first row sits just under the column headings.
const scrollToList = (page) =>
  page.locator('.view-scroller').evaluate((el) => {
    const rows = document.querySelector('.vlist').getBoundingClientRect().top;
    const head = document.querySelector('.list-head').offsetHeight;
    el.scrollTop += rows - (el.getBoundingClientRect().top + head + 4);
  });

async function pressRow(page, index) {
  const box = await rowAt(page, index).boundingBox();
  // Grab the title area: the cover is a button and is not a handle.
  const x = box.x + 160;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { x, y };
}

async function dragRow(page, from, to, { release = true } = {}) {
  const { x, y } = await pressRow(page, from);
  const steps = 8;
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, y + ((to - from) * ROW * i) / steps);
  await page.waitForTimeout(160);
  if (release) await page.mouse.up();
}

async function run() {
  seed();
  let { app, page, errors } = await launch(dataDir, library);
  await page.waitForSelector(t('nav-playlist'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  await page.locator(t('nav-playlist')).first().click();
  await page.waitForSelector('.pl-hero');
  await eventually(page, (n) => document.querySelectorAll('.vlist > .song-row').length > 0 && document.querySelector('.pl-text .view-sub')?.textContent.startsWith(`${n} songs`), songs.length, 15000);
  // The notice about the missing song appears once the library has been
  // re-read; wait for it so the list does not move under the pointer.
  check('the missing song is explained', await eventually(page, () => document.querySelector('.notice')?.textContent.includes('can’t be found'), null, 15000));
  await page.waitForFunction(() => !document.querySelector('.scan-status'));
  await scrollToList(page);
  await page.waitForTimeout(150);
  check('the playlist shows its songs, not the missing one', (await shownIds(page, 0, 6)).join() === visibleOf(expectedAll).slice(0, 6).join());

  console.log('Dragging up');
  await dragRow(page, 5, 1, { release: false });
  check('the dragged row is lifted as a copy', (await page.locator(t('drag-ghost')).count()) === 1);
  check('the badge shows the place it would take', (await page.locator(t('drag-position')).innerText()) === '2');
  const slid = await page.evaluate(() => [...document.querySelectorAll('.vlist > .song-row:not(.is-lifted)')].filter((row) => row.style.transform === 'translateY(56px)').length);
  check('the rows in between slide down to open a gap', slid === 4, `${slid} rows moved`);
  check('the original row is empty while it is dragged', (await page.locator('.song-row.is-drag-source').count()) === 1);
  const ghostBox = await page.locator(t('drag-ghost')).boundingBox();
  check('the lifted row has a shadow', (await page.locator(t('drag-ghost')).evaluate((el) => getComputedStyle(el).boxShadow)) !== 'none');
  check('it follows the pointer only up and down', Math.abs(ghostBox.x - (await rowAt(page, 0).boundingBox()).x) < 1);
  await shot(page, 'dragging-dark');
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await page.waitForTimeout(150);
  await shot(page, 'dragging-light');
  await page.evaluate(() => delete document.documentElement.dataset.theme);
  await page.mouse.up();
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 5, 1);
  check('dropping puts the song in its new place', (await shownIds(page, 0, 7)).join() === visibleOf(expectedAll).slice(0, 7).join());
  check('the new order is saved at once', await savedMatches(page), JSON.stringify(await savedIds(page)));
  check('no toast announces the move', (await page.locator('.toast').count()) === 0);
  check('the lifted copy is gone', (await page.locator(t('drag-ghost')).count()) === 0 && (await page.locator('.song-row.is-drag-source').count()) === 0);

  console.log('Dragging down');
  await dragRow(page, 0, 5);
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 0, 5);
  check('a song dragged down lands in its new place', (await shownIds(page, 0, 7)).join() === visibleOf(expectedAll).slice(0, 7).join());
  check('and is saved', await savedMatches(page));
  check('the missing song keeps its place between its neighbours', (await savedIds(page)).includes(MISSING));

  console.log('Cancelling');
  const beforeCancel = await shownIds(page, 0, 7);
  await dragRow(page, 1, 4, { release: false });
  await page.keyboard.press('Escape');
  check('Esc puts the row back', (await page.locator(t('drag-ghost')).count()) === 0 && (await shownIds(page, 0, 7)).join() === beforeCancel.join());
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('and letting go afterwards changes nothing', (await shownIds(page, 0, 7)).join() === beforeCancel.join() && JSON.stringify(await savedIds(page)) === JSON.stringify(expectedAll), `${(await shownIds(page, 0, 7)).join()} vs ${beforeCancel.join()} | ghost ${await page.locator(t('drag-ghost')).count()}`);
  await dragRow(page, 1, 4, { release: false });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.dispatchEvent(new Event("blur"))'));
  check('the window losing focus cancels too', await eventually(page, () => !document.querySelector('[data-test="drag-ghost"]')));
  await page.mouse.up();

  console.log('A press without moving');
  const plain = await pressRow(page, 2);
  await page.mouse.up();
  check('is not a drag', (await page.locator(t('drag-ghost')).count()) === 0 && JSON.stringify(await savedIds(page)) === JSON.stringify(expectedAll));
  await page.mouse.dblclick(plain.x, plain.y);
  check('double-click still plays', await eventually(page, (id) => document.querySelector('.song-row.is-current')?.dataset.id === id, visibleOf(expectedAll)[2]));
  await page.click(t('play-pause'));

  console.log('Scrolling while dragging');
  await scrollToList(page);
  await page.waitForTimeout(100);
  const scrollBefore = await page.locator('.view-scroller').evaluate((el) => el.scrollTop);
  const { x } = await pressRow(page, 0);
  const box = await page.locator('.view-scroller').boundingBox();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, box.y + box.height - 60 + i * 5);
  await page.waitForTimeout(1500);
  const scrollAfter = await page.locator('.view-scroller').evaluate((el) => el.scrollTop);
  check('holding near the bottom edge scrolls the list', scrollAfter > scrollBefore + 200, `${scrollBefore} -> ${scrollAfter}`);
  const landing = Number(await page.locator(t('drag-position')).innerText());
  check('the badge counts on as it scrolls', landing > 10, String(landing));
  await page.mouse.up();
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 0, landing - 1);
  check('the song lands at the number the badge showed', await savedMatches(page));
  const scrollEnd = await page.locator('.view-scroller').evaluate((el) => el.scrollTop);
  await page.mouse.move(x, box.y + 150);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x, box.y + 150 - i * 12);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  const scrollUp = await page.locator('.view-scroller').evaluate((el) => el.scrollTop);
  check('holding near the column headings scrolls back up', scrollUp < scrollEnd - 100, `${scrollEnd} -> ${scrollUp}`);
  check('and cancelling there saves nothing', JSON.stringify(await savedIds(page)) === JSON.stringify(expectedAll));

  console.log('Without a mouse');
  await scrollToList(page);
  await page.waitForTimeout(100);
  const movedId = visibleOf(expectedAll)[2];
  await rowAt(page, 2).locator('.song-play').focus();
  await page.keyboard.press('Alt+ArrowDown');
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 2, 3);
  check('Alt+Down moves the song one place down', await savedMatches(page));
  check('and keeps focus on it', await eventually(page, (id) => document.activeElement?.closest('.song-row')?.dataset.id === id, movedId));
  await page.keyboard.press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 3, 2);
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 2, 1);
  check('Alt+Up moves it back up', await savedMatches(page), JSON.stringify(await savedIds(page)));
  check('still with focus on it', await eventually(page, (id) => document.activeElement?.closest('.song-row')?.dataset.id === id, movedId));

  await rowAt(page, 4).click({ button: 'right', position: { x: 160, y: 28 } });
  await page.click(t('move-top'));
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 4, 0);
  check('right-click → Move to top', await savedMatches(page));
  await scrollToList(page);
  await page.waitForTimeout(100);
  await rowAt(page, 0).click({ button: 'right', position: { x: 160, y: 28 } });
  await page.click(t('move-bottom'));
  expectedAll = moveInPlaylist(expectedAll, visibleOf(expectedAll), 0, visibleOf(expectedAll).length - 1);
  check('right-click → Move to bottom', await savedMatches(page));
  await scrollToList(page);
  await page.waitForTimeout(100);
  await rowAt(page, 0).click({ button: 'right', position: { x: 160, y: 28 } });
  check('the top song offers no "Move to top"', (await page.locator(t('move-top')).count()) === 0 && (await page.locator(t('move-bottom')).count()) === 1);
  await page.keyboard.press('Escape');

  console.log('One song');
  await page.locator(t('nav-playlist')).nth(1).click();
  await page.waitForSelector('.pl-hero');
  await scrollToList(page);
  await dragRow(page, 0, 2, { release: false });
  check('a playlist with one song does not start a drag', (await page.locator(t('drag-ghost')).count()) === 0);
  await page.mouse.up();
  await rowAt(page, 0).click({ button: 'right', position: { x: 160, y: 28 } });
  check('nor offer moves', (await page.locator(t('move-top')).count()) === 0 && (await page.locator(t('move-bottom')).count()) === 0);
  await page.keyboard.press('Escape');

  check('no errors in the window', errors.length === 0, errors.join(' | '));
  await app.close();

  console.log('After a restart');
  ({ app, page, errors } = await launch(dataDir, library));
  await page.waitForSelector(t('nav-playlist'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  await page.locator(t('nav-playlist')).first().click();
  await page.waitForSelector('.pl-hero');
  await eventually(page, () => document.querySelector('.notice'), null, 15000);
  await scrollToList(page);
  await page.waitForTimeout(200);
  check('the order is the same after closing and reopening', (await shownIds(page, 0, 8)).join() === visibleOf(expectedAll).slice(0, 8).join());
  check('and the saved list still holds the missing song in its place', JSON.stringify(await savedIds(page)) === JSON.stringify(expectedAll));
  check('no errors after the restart', errors.length === 0, errors.join(' | '));
  await app.close();
}

run()
  .catch(crash)
  .finally(() => {
    removeDir(dataDir);
    finish();
  });
