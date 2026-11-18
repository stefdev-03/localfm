// The playlist rows in the sidebar:  npm run test:sidebar
//
// Starts with a profile that already has thirty playlists (one with a very
// long name, some with pictures), then checks the row sizes, that the list
// scrolls while "Create playlist" and Settings stay put, and the equaliser on
// the playlist that is playing. Screenshots in both themes at three window
// sizes land in tests/e2e/output/sidebar. Cover lookups are off.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { library, pictures, ensureTestLibrary, tempDir, removeDir, outputDir, launch, t, eventually, playLabelBecomes, reporter } from './harness.mjs';

ensureTestLibrary();
const outDir = outputDir('sidebar');
const dataDir = tempDir('localfm-sidebar-');
const { check, crash, finish } = reporter();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

// Same id rule as library.js, so seeded playlists point at real songs.
const trackId = (file) => crypto.createHash('sha1').update(path.normalize(file).toLowerCase()).digest('hex').slice(0, 16);
const songs = fs
  .readdirSync(library)
  .filter((name) => name.endsWith('.mp3'))
  .map((name) => trackId(path.join(library, name)));

const LONG_NAME = 'A very long playlist name that cannot possibly fit in the sidebar';
const PROFILE = 'f'.repeat(16);

function seed() {
  fs.mkdirSync(path.join(dataDir, 'images'), { recursive: true });
  fs.copyFileSync(path.join(pictures, 'exact-square.png'), path.join(dataDir, 'images', 'cover-one.png'));
  const playlists = Array.from({ length: 30 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(16, '0'),
    name: i === 1 ? LONG_NAME : `Playlist ${i + 1}`,
    image: i % 3 === 0 ? 'cover-one.png' : null,
    banner: null,
    trackIds: songs.slice(0, i === 0 ? 1 : (i % songs.length) + 1),
    createdAt: i,
    updatedAt: i,
  }));
  fs.writeFileSync(
    path.join(dataDir, 'data.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: PROFILE,
      settings: { onlineArt: false },
      profiles: [
        {
          id: PROFILE,
          name: 'Sam',
          color: '#60cdff',
          picture: null,
          setupComplete: true,
          folders: [library],
          playlists,
          player: { volume: 0.8, shuffle: false, repeat: 'off' },
          createdAt: 1,
        },
      ],
    }),
  );
}

const box = (page, selector) => page.locator(selector).first().boundingBox();
const style = (page, selector, prop, pseudo = null) =>
  page.locator(selector).first().evaluate((el, [p, ps]) => getComputedStyle(el, ps).getPropertyValue(p), [prop, pseudo]);
const setSize = (app, width, height) =>
  app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
const setTheme = (page, theme) =>
  page.evaluate((value) => {
    if (value === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }, theme);

async function run() {
  seed();
  const { app, page, errors } = await launch(dataDir, library);
  await page.waitForSelector(t('nav-playlist'));
  await eventually(page, () => !document.querySelector('.scan-status'), null, 15000);
  await setSize(app, 1280, 820);
  await page.waitForTimeout(200);

  console.log('Row sizes');
  const row = `${t('nav-playlist')}`;
  const rowBox = await box(page, row);
  check('a playlist row is 56px tall', Math.round(rowBox.height) === 56, `${rowBox.height}px`);
  const picBox = await box(page, `${row} .cover-nav`);
  check('its picture is 44px', Math.round(picBox.width) === 44 && Math.round(picBox.height) === 44, `${picBox.width}×${picBox.height}`);
  check('the picture has a 6px radius', (await style(page, `${row} .cover-nav`, 'border-radius')) === '6px');
  check('the picture is centred in the row', Math.abs(picBox.y + picBox.height / 2 - (rowBox.y + rowBox.height / 2)) <= 1);
  check('the name is 14px at weight 600', (await style(page, `${row} .nav-label`, 'font-size')) === '14px' && (await style(page, `${row} .nav-label`, 'font-weight')) === '600');
  const firstSub = await page.locator(`${row} .nav-sub`).first().innerText();
  check('the second line is the song count', firstSub === '1 song', firstSub);
  check('the second line is 12px', (await style(page, `${row} .nav-sub`, 'font-size')) === '12px');
  check('the second line counts several songs', (await page.locator(`${row} .nav-sub`).nth(2).innerText()) === '3 songs', await page.locator(`${row} .nav-sub`).nth(2).innerText());
  check('a playlist without a picture shows a 20px icon', (await page.locator(`${row} .cover-nav .icon`).first().evaluate((el) => el.getBoundingClientRect().width)) === 20);
  check('a playlist with a picture shows it', (await page.locator(`${row} .cover-nav img`).count()) === 10);

  const create = t('nav-create-playlist');
  const createBox = await box(page, create);
  check('"Create playlist" is 56px tall', Math.round(createBox.height) === 56, `${createBox.height}px`);
  const plusBox = await box(page, `${create} .nav-plus`);
  check('its dashed box is 44px', Math.round(plusBox.width) === 44 && Math.round(plusBox.height) === 44);
  check('its dashed box keeps the dashed line', (await style(page, `${create} .nav-plus`, 'border-top-style')) === 'dashed');
  check('its plus is 20px', (await page.locator(`${create} .nav-plus .icon`).evaluate((el) => el.getBoundingClientRect().width)) === 20);
  check('its label is weight 600 with no second line', (await style(page, `${create} .nav-label`, 'font-weight')) === '600' && (await page.locator(`${create} .nav-sub`).count()) === 0);
  check('the top rows stay 36px', Math.round((await box(page, t('nav-songs'))).height) === 36 && Math.round((await box(page, t('nav-settings'))).height) === 36);
  check('pictures line up with the "Create playlist" box', Math.round(picBox.x) === Math.round(plusBox.x), `${picBox.x} vs ${plusBox.x}`);

  console.log('Active marker');
  await page.locator(row).first().click();
  await page.waitForSelector('.pl-hero');
  const marker = await page.locator(`${row}.is-active`).evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { top: s.top, bottom: s.bottom };
  });
  check('the active marker sits 16px from top and bottom', marker.top === '16px' && marker.bottom === '16px', JSON.stringify(marker));

  console.log('Long names and scrolling');
  for (const [width, height] of [
    [940, 620],
    [1280, 820],
    [1900, 1030],
  ]) {
    await setSize(app, width, height);
    await page.waitForTimeout(200);
    const sidebar = await box(page, '.sidebar');
    const longRow = page.locator(row).nth(1);
    const longBox = await longRow.boundingBox();
    const overflow = await longRow.locator('.nav-label').evaluate((el) => el.scrollWidth > el.clientWidth);
    check(`at ${width}×${height} a long name is cut with an ellipsis`, overflow && (await longRow.locator('.nav-label').evaluate((el) => getComputedStyle(el).textOverflow)) === 'ellipsis');
    check(`at ${width}×${height} the long row stays inside the sidebar`, longBox.x + longBox.width <= sidebar.x + sidebar.width + 0.5, `${longBox.x + longBox.width} > ${sidebar.x + sidebar.width}`);
    const list = await page.locator('.nav-playlists').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    check(`at ${width}×${height} thirty playlists scroll inside the list`, list.scroll > list.client, JSON.stringify(list));
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme);
      await page.waitForTimeout(150);
      await shot(page, `sidebar-${width}x${height}-${theme}`);
    }
    await setTheme(page, 'dark');
  }
  await setSize(app, 940, 620);
  const before = { create: await box(page, create), settings: await box(page, t('nav-settings')) };
  await page.locator('.nav-playlists').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.waitForTimeout(150);
  const after = { create: await box(page, create), settings: await box(page, t('nav-settings')) };
  check('"Create playlist" stays put while the list scrolls', before.create.y === after.create.y);
  check('Settings stays put while the list scrolls', before.settings.y === after.settings.y);
  const lastBox = await box(page, `${row} >> nth=29`);
  check('the last playlist can be scrolled into view above Settings', lastBox.y + lastBox.height <= after.settings.y);
  await page.locator('.nav-playlists').evaluate((el) => (el.scrollTop = 0));
  await setSize(app, 1280, 820);

  console.log('The playing playlist');
  await page.locator(row).nth(2).click();
  await page.waitForSelector('.pl-hero');
  check('nothing playing: no equaliser in the sidebar', (await page.locator('.sidebar .eq').count()) === 0);
  const sidebarHtml = await page.locator('.nav-playlists').evaluate((el) => {
    window.__firstRow = el.firstElementChild;
    return el.childElementCount;
  });
  await page.click(t('playlist-play'));
  await playLabelBecomes(page, 'Pause');
  check('the playing playlist shows the equaliser', await eventually(page, () => document.querySelectorAll('.sidebar .eq').length === 1 && document.querySelectorAll('[data-test="nav-playlist"]')[2].querySelector('.eq') !== null));
  const eqBox = await box(page, '.sidebar .eq');
  const thirdBox = await page.locator(row).nth(2).boundingBox();
  check('the equaliser sits at the right end of the row', thirdBox.x + thirdBox.width - (eqBox.x + eqBox.width) <= 12, `${thirdBox.x + thirdBox.width - (eqBox.x + eqBox.width)}px from the end`);
  check('it animates while playing', (await style(page, '.sidebar .eq i', 'animation-play-state')) === 'running');
  await shot(page, 'playing-dark');
  await page.click(t('play-pause'));
  await playLabelBecomes(page, 'Play');
  check('it stays while paused, standing still', await eventually(page, () => document.querySelector('.sidebar .eq.is-paused') !== null));
  check('it is the same sidebar, not a redraw', await page.evaluate(() => document.querySelector('.nav-playlists').firstElementChild === window.__firstRow) && sidebarHtml === 30);
  await setTheme(page, 'light');
  await page.waitForTimeout(150);
  await shot(page, 'paused-light');
  await setTheme(page, 'dark');

  // Playing from All songs is not a playlist, so the bars go away.
  await page.click(t('nav-songs'));
  await page.locator('.song-row').first().dblclick();
  await playLabelBecomes(page, 'Pause');
  check('playing from All songs clears the equaliser', await eventually(page, () => !document.querySelector('.sidebar .eq')));
  await page.click(t('play-pause'));

  check('no errors in the window', errors.length === 0, errors.join(' | '));
  await app.close();
}

run()
  .catch(crash)
  .finally(() => {
    removeDir(dataDir);
    finish();
  });
