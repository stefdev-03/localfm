// "Who's listening?" against the real app:  npm run test:picker
//
// The cover wall behind the profiles (tinted tiles when there is no art, the
// user's covers once there is, the drift, the blur and the veil, staying out
// of the title bar), and the restyled profiles in front of it.
// Screenshots land in tests/e2e/output/picker.

import fs from 'node:fs';
import path from 'node:path';
import { library, ensureTestLibrary, tempDir, removeDir, outputDir, launch, t, text, eventually, reporter } from './harness.mjs';

ensureTestLibrary();
const outDir = outputDir('picker');
const { check, crash, finish } = reporter();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

const profile = (id, name, color, folders) => ({ id, name, color, setupComplete: true, folders, playlists: [], player: { volume: 0.8, shuffle: false, repeat: 'off' }, createdAt: 1 });

// What the wall is showing, read from the page.
const wallFacts = (page) =>
  page.evaluate(() => {
    const wall = document.querySelector('.wall');
    if (!wall) return null;
    const cols = [...wall.querySelectorAll('.wall-col')];
    const ids = (col) => [...col.children].map((tile) => tile.querySelector('img')?.getAttribute('src') ?? tile.style.background);
    // Down a column, including where its repeat begins, no tile meets itself.
    const repeatsInColumn = cols.some((col) => ids(col).some((id, i, all) => i > 0 && all[i - 1] === id));
    const anims = cols.map((col) => col.getAnimations()[0]).filter(Boolean);
    const tileHeight = cols[0]?.children[0].getBoundingClientRect().height ?? 0;
    const perColumn = (cols[0]?.children.length ?? 0) / 2;
    const box = wall.getBoundingClientRect();
    const inner = wall.querySelector('.wall-inner').getBoundingClientRect();
    return {
      ready: wall.classList.contains('is-ready'),
      hidden: wall.getAttribute('aria-hidden'),
      pointer: getComputedStyle(document.querySelector('.picker-wall')).pointerEvents,
      columns: cols.length,
      perColumn,
      covers: new Set(wall.querySelectorAll('.wall-tile img').values().map((img) => img.getAttribute('src'))).size,
      images: wall.querySelectorAll('.wall-tile img').length,
      tinted: [...wall.querySelectorAll('.wall-tile')].filter((tile) => !tile.querySelector('img')).length,
      repeatsInColumn,
      running: anims.length === cols.length && anims.every((a) => a.playState === 'running'),
      directions: cols.map((col) => col.classList.contains('is-down')),
      // Seconds for a tile to travel its own height, per column.
      secondsPerTile: cols.map((col) => parseFloat(col.style.animationDuration) / perColumn),
      tileHeight,
      wallTop: box.top,
      wallBottom: box.bottom,
      covered: inner.left <= 0 && inner.top <= box.top && inner.right >= window.innerWidth && inner.bottom >= window.innerHeight,
      blur: getComputedStyle(wall.querySelector('.wall-inner')).filter,
      focusable: wall.querySelectorAll('button, a, [tabindex]').length,
    };
  });

async function run() {
  const dataDir = tempDir('localfm-picker-data-');
  const empty = tempDir('localfm-picker-empty-');
  fs.writeFileSync(
    path.join(dataDir, 'data.json'),
    JSON.stringify({
      version: 1,
      activeProfileId: null,
      settings: { onlineArt: false },
      profiles: [profile('aaaaaaaaaaaaaaaa', 'Ana', '#4fd8c4', [library]), profile('bbbbbbbbbbbbbbbb', 'Cy', '#ff8fb1', [empty])],
    }),
  );

  let { app, page, errors } = await launch(dataDir);
  try {
    // ---- before any music has been read: tinted tiles ----------------------
    console.log('No covers yet');
    await page.waitForSelector('.picker');
    check('the heading and the line under it are kept', (await text(page, '.picker-title')) === 'Who’s listening?' && (await page.locator('.picker-sub').count()) === 1);
    check('keyboard focus starts on the first profile', await page.evaluate(() => document.activeElement?.dataset.test === 'profile-tile' && document.activeElement.textContent.includes('Ana')));
    check('the wall fades in', await eventually(page, () => document.querySelector('.wall.is-ready'), null, 5000));
    let wall = await wallFacts(page);
    check('with no art the wall is made of tinted tiles', wall.images === 0 && wall.tinted > 0, JSON.stringify(wall));
    check('the wall is never empty: at least eight different tiles', new Set(await page.$$eval('.wall-col:first-child .wall-tile', (tiles) => tiles.map((tile) => tile.style.background))).size >= Math.min(8, wall.perColumn));
    check('no tile sits next to itself down a column', !wall.repeatsInColumn);
    check('it is decoration: hidden from screen readers, no clicks, nothing to focus', wall.hidden === 'true' && wall.pointer === 'none' && wall.focusable === 0);
    await page.waitForTimeout(700);
    await shot(page, '01-tinted');

    // ---- with covers ------------------------------------------------------
    console.log('Covers');
    await page.locator(t('profile-tile'), { hasText: 'Ana' }).click();
    await page.waitForSelector('.shell');
    await page.waitForFunction(() => !document.querySelector('.scan-status'), null, { timeout: 30000 });
    await page.click(t('profile-chip'));
    await page.locator('.menu-item', { hasText: 'Choose a profile' }).click();
    await page.waitForSelector('.picker');
    await eventually(page, () => document.querySelector('.wall.is-ready'), null, 5000);
    wall = await wallFacts(page);
    check('the wall shows the covers from the music (four here, topped up to eight with tints)', wall.covers === 4 && wall.images > 0 && wall.images === wall.tinted, JSON.stringify({ covers: wall.covers, images: wall.images, tinted: wall.tinted }));
    check('no cover sits next to itself down a column', !wall.repeatsInColumn);
    check('every column drifts', wall.running);
    check('neighbouring columns move in opposite directions', wall.directions.every((down, i) => i === 0 || down !== wall.directions[i - 1]), wall.directions.join());
    check('a tile takes 15 to 20 seconds to travel its own height', wall.secondsPerTile.every((s) => s >= 15 && s <= 20), wall.secondsPerTile.map((s) => s.toFixed(1)).join());
    check('columns run at different speeds', new Set(wall.secondsPerTile.map((s) => s.toFixed(2))).size > 1);
    check('tiles are 110 to 190 pixels as seen (tilted, so a little taller)', wall.tileHeight >= 110 && wall.tileHeight <= 215, String(wall.tileHeight));
    check('the wall stays out of the title bar', wall.wallTop >= 40, String(wall.wallTop));
    check('the tilted wall covers the whole screen area', wall.covered);
    check('it is blurred', /blur\(3px\)/.test(wall.blur), wall.blur);
    // It really moves: a column is somewhere else a second later.
    const where = () => page.$eval('.wall-col', (col) => new DOMMatrix(getComputedStyle(col).transform).m42);
    const first = await where();
    await page.waitForTimeout(1000);
    check('it moves, slowly', Math.abs((await where()) - first) > 0.05 && Math.abs((await where()) - first) < 5, `${first} → ${await where()}`);

    // Cheap while it idles: the drift is composited, so over two seconds
    // nothing is painted again (what DevTools' paint flashing would show).
    // Hovering a profile, which must repaint, shows the trace would catch it.
    const cdp = await page.context().newCDPSession(page);
    async function paintsDuring(action) {
      const events = [];
      const collect = ({ value }) => events.push(...value);
      cdp.on('Tracing.dataCollected', collect);
      const traced = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
      await action();
      await cdp.send('Tracing.end');
      await traced;
      cdp.off('Tracing.dataCollected', collect);
      return events.filter((event) => event.name === 'Paint').length;
    }
    await page.mouse.move(5, 300);
    await page.waitForTimeout(300);
    const idlePaints = await paintsDuring(() => page.waitForTimeout(2000));
    const hoverPaints = await paintsDuring(async () => {
      await page.locator(t('profile-tile'), { hasText: 'Cy' }).hover();
      await page.waitForTimeout(400);
      await page.mouse.move(5, 300);
      await page.waitForTimeout(400);
    });
    check('nothing repaints while the wall drifts', idlePaints === 0 && hoverPaints > 0, `${idlePaints} paints idle, ${hoverPaints} while hovering`);

    // ---- the profiles in front ----------------------------------------------
    console.log('Profiles');
    const avatarSize = await page.$eval(`${t('profile-tile')} .avatar`, (el) => el.getBoundingClientRect().width);
    check('pictures are 120px', Math.round(avatarSize) === 120, String(avatarSize));
    const ana = page.locator(t('profile-tile'), { hasText: 'Ana' });
    await ana.hover();
    await page.waitForTimeout(200);
    const hover = await ana.locator('.avatar').evaluate((el) => {
      const style = getComputedStyle(el);
      return { outline: style.outlineColor, width: style.outlineWidth, offset: style.outlineOffset, transform: style.transform, card: getComputedStyle(el.closest('.profile-tile')).backgroundColor };
    });
    check('hovering rings the picture in the profile’s own colour', hover.outline === 'rgb(79, 216, 196)' && hover.width === '2px' && hover.offset === '3px', JSON.stringify(hover));
    check('and grows it a little, with no card behind', /matrix\(1\.03/.test(hover.transform) && hover.card === 'rgba(0, 0, 0, 0)', JSON.stringify(hover));
    check('the pencil shows at the picture’s top right', await page.locator('.profile-tile-wrap', { has: ana }).locator('.profile-tile-edit').evaluate((el) => getComputedStyle(el).opacity === '1'));
    await shot(page, '02-covers-hover');
    const addBg = await page.$eval(`${t('profile-add')} .avatar`, (el) => getComputedStyle(el).backgroundColor);
    check('"Add profile" is filled so its dashes show over the wall', addBg !== 'rgba(0, 0, 0, 0)', addBg);

    // Both themes at the three window sizes.
    const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [w, h]);
    await page.mouse.move(5, 300);
    for (const [w, h] of [[940, 620], [1280, 820], [1900, 1030]]) {
      await setSize(w, h);
      for (const theme of ['dark', 'light']) {
        await page.evaluate((light) => (light ? (document.documentElement.dataset.theme = 'light') : delete document.documentElement.dataset.theme), theme === 'light');
        await page.waitForTimeout(400);
        await shot(page, `03-${w}-${theme}`);
      }
      const facts = await wallFacts(page);
      check(`at ${w} × ${h} the wall still covers the screen area`, facts.covered && facts.running);
    }
    await page.evaluate(() => delete document.documentElement.dataset.theme);
    await setSize(1280, 820);
    await page.waitForTimeout(400); // the wall re-lays itself out for the new size

    // Hidden window: nothing animates.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const paused = await page.$eval('.wall-col', (col) => ({ hidden: document.hidden, state: col.getAnimations()[0]?.playState, css: getComputedStyle(col).animationPlayState }));
    check('the drift stops while the window is hidden', paused.css === 'paused', JSON.stringify(paused));
    await page.evaluate(() => {
      delete document.hidden;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check('and starts again when it is back', await page.$eval('.wall-col', (col) => getComputedStyle(col).animationPlayState === 'running'));

    // Reduced motion: the wall stays, standing still.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check('with reduced motion the wall is there but still', (await page.locator('.wall-tile').count()) > 0 && (await page.$eval('.wall-col', (col) => col.getAnimations().length === 0)));
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Choosing still works, and leaving stops the wall.
    await page.locator(t('profile-tile'), { hasText: 'Cy' }).click();
    await page.waitForSelector('.shell');
    check('choosing a profile still opens it, and the wall is gone', (await page.locator('.wall').count()) === 0);
    check('no errors in the window', errors.length === 0, errors.join(' | '));
  } finally {
    await app.close().catch(() => {});
    removeDir(dataDir);
    removeDir(empty);
  }
}

run().catch(crash).finally(finish);
