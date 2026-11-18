// Profile pictures and the light theme against the real app:
//   npm run test:appearance
//
// Sets up a profile with a picture (too small, cropped, exact size, removed),
// changes it again from "Edit profile", then switches to the light theme and
// back, restarting in between. Cover lookups are off, so no internet is needed.
// Screenshots land in tests/e2e/output/appearance.

import fs from 'node:fs';
import path from 'node:path';
import { library, pictures, ensureTestLibrary, tempDir, removeDir, outputDir, launch as launchApp, t, text, chooseFile, eventually, reporter } from './harness.mjs';

ensureTestLibrary();
const outDir = outputDir('appearance');
const dataDir = tempDir('localfm-appearance-');
const { check, crash, finish } = reporter();
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const launch = () => launchApp(dataDir, path.join(library, 'Albums'));
const picture = (name) => path.join(pictures, name);
const imageFiles = () => fs.readdirSync(path.join(dataDir, 'images'));
const PROFILE_COLORS = ['#ffb454', '#60cdff', '#6ccb5f', '#ff8fa3', '#b4a0ff', '#4fd8c4'];

const gone = (page, selector) => eventually(page, (s) => !document.querySelector(s), selector);
const shown = (page, selector) => eventually(page, (s) => document.querySelector(s) !== null, selector);
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'dark');
const pageColor = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const savedProfile = (page) => page.evaluate(async () => (await window.api.getState()).profiles[0]);
const savedTheme = (page) => page.evaluate(async () => (await window.api.getState()).settings.theme);
const windowColor = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor().toLowerCase());
const nativeSource = (app) => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
// The picture in an avatar, as { src, width, height }, or null when it shows an initial.
const avatarImage = (page, selector) =>
  page.evaluate(async (s) => {
    const img = document.querySelector(`${s} img`);
    if (!img) return null;
    await img.decode().catch(() => {});
    return { src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight };
  }, selector);

async function openProfileEditor(page) {
  await page.click(t('profile-chip'));
  await page.locator(t('profile-option')).first().click({ button: 'right' });
  await page.click(t('profile-edit'));
  await page.waitForSelector('.modal .avatar-edit');
}

async function run() {
  fs.writeFileSync(
    path.join(dataDir, 'data.json'),
    JSON.stringify({ version: 1, activeProfileId: null, profiles: [], settings: { onlineArt: false } }),
  );
  let { app, page, errors } = await launch();

  // ---- setup: the profile step ---------------------------------------------
  console.log('Profile picture during setup');
  await page.waitForSelector('.wizard');
  check('the app starts dark', (await theme(page)) === 'dark' && (await pageColor(page)) === 'rgb(32, 32, 32)', await pageColor(page));
  await page.click(t('choose-folder'));
  await page.waitForSelector(t('scan-result'));
  await page.click(t('wizard-continue'));
  await page.click(t('playlist-skip'));
  await page.waitForSelector(t('profile-name'));

  const pick = page.locator(t('pick-avatar'));
  check('the avatar is a button for adding a picture', (await pick.getAttribute('aria-label')) === 'Add a profile picture');
  check('it starts as the "?" initial', (await text(page, '.avatar-edit .avatar')) === '?');
  check('the pencil is hidden until the avatar is hovered', (await page.locator('.avatar-edit-hover').evaluate((el) => getComputedStyle(el).opacity)) === '0');
  await pick.hover();
  check('hovering the avatar shows the pencil', await eventually(page, () => getComputedStyle(document.querySelector('.avatar-edit-hover')).opacity === '1'));
  check('the pencil is drawn inside the avatar', (await page.locator('.avatar-edit-hover svg').count()) === 1);
  await shot(page, '01-wizard-avatar-hover');
  await page.mouse.move(5, 300);
  await page.locator(t('profile-name')).focus();
  await page.keyboard.press('Shift+Tab');
  check('keyboard focus shows the pencil too', await eventually(page, () => document.activeElement?.dataset.test === 'pick-avatar' && getComputedStyle(document.querySelector('.avatar-edit-hover')).opacity === '1'));

  await chooseFile(page, t('pick-avatar'), picture('small-photo.png'));
  check('a picture that is too small is refused with a message', await eventually(page, () => /too small: 300 × 240 pixels.*at least 320 × 320/.test(document.querySelector('[data-test="avatar-error"]')?.textContent ?? '')), await text(page, t('avatar-error')).catch(() => ''));
  check('no cropper opens for it', (await page.locator('.crop-stage').count()) === 0);
  check('the avatar stays as it was', (await avatarImage(page, '.avatar-edit')) === null);
  await shot(page, '02-wizard-avatar-too-small');

  await chooseFile(page, t('pick-avatar'), path.join(library, 'notes.txt'));
  check('a file that is not a picture gets its own message', await eventually(page, () => document.querySelector('[data-test="avatar-error"]')?.textContent.includes('could not be opened as a picture')));

  await chooseFile(page, t('pick-avatar'), picture('large-photo.png'));
  await page.waitForSelector('.crop-stage');
  check('a larger picture opens the cropper', (await text(page, '.modal-head h2')) === 'Crop profile picture' && (await text(page, '.modal .modal-text')).includes('1600 × 1200'), await text(page, '.modal .modal-text'));
  check('the cropper can zoom', !(await page.locator('.crop-controls .slider').isDisabled()));
  await page.waitForTimeout(250);
  await shot(page, '03-crop-profile-picture');
  await page.keyboard.press('Escape');
  check('cancelling the crop leaves the avatar alone', (await gone(page, '.crop-stage')) && (await avatarImage(page, '.avatar-edit')) === null);

  await chooseFile(page, t('pick-avatar'), picture('large-photo.png'));
  await page.waitForSelector('.crop-stage');
  const stage = await page.locator('.crop-stage').boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 - 90, stage.y + stage.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -400);
  await page.click(t('crop-apply'));
  await shown(page, '.avatar-edit .avatar img');
  const cropped = await avatarImage(page, '.avatar-edit');
  check('the cropped picture is exactly 320 × 320', cropped?.width === 320 && cropped?.height === 320, JSON.stringify(cropped));
  check('the message goes away once a picture is accepted', await page.locator(t('avatar-error')).isHidden());
  check('the button now offers to change it', (await pick.getAttribute('aria-label')) === 'Change profile picture');
  check('nothing is saved before Finish', imageFiles().length === 0, imageFiles().join(', '));

  await page.fill(t('profile-name'), 'Pia');
  check('typing the name keeps the picture', (await avatarImage(page, '.avatar-edit'))?.src === cropped.src);
  await page.locator('.swatch').nth(4).click();
  await shot(page, '04-wizard-avatar-picture');

  await page.locator('.avatar-edit').hover();
  await page.click(t('remove-avatar'));
  check('the picture can be removed again', (await avatarImage(page, '.avatar-edit')) === null && (await text(page, '.avatar-edit .avatar')) === 'P' && (await page.locator(t('remove-avatar')).count()) === 0);

  await chooseFile(page, t('pick-avatar'), picture('exact-avatar.png'));
  await shown(page, '.avatar-edit .avatar img');
  check('a picture of exactly 320 × 320 skips the cropper', (await page.locator('.crop-stage').count()) === 0);

  // Going back a step and returning must not lose the chosen picture.
  await page.locator('.wizard-foot .btn', { hasText: 'Back' }).click();
  await page.click(t('playlist-skip'));
  await page.waitForSelector(t('profile-name'));
  check('the picture survives going back a step', (await avatarImage(page, '.avatar-edit')) !== null && (await page.inputValue(t('profile-name'))) === 'Pia');
  await page.click(t('wizard-finish'));

  await page.waitForSelector('.shell');
  await page.waitForFunction(() => !document.querySelector('.scan-status'));
  const chip = await avatarImage(page, t('profile-chip'));
  check('the title-bar button shows the picture', chip?.width === 320 && /^media:\/\/img\/[\w-]+\.jpg$/.test(chip?.src ?? ''), JSON.stringify(chip));
  check('one picture file is saved', imageFiles().length === 1, imageFiles().join(', '));
  check('the profile remembers its picture', (await savedProfile(page)).picture === imageFiles()[0]);
  await page.click(t('profile-chip'));
  await page.waitForSelector('.menu');
  check('the profile menu shows it too', (await avatarImage(page, t('profile-option'))) !== null);
  await page.waitForTimeout(400);
  await shot(page, '05-profile-menu-picture');
  await page.keyboard.press('Escape');

  // ---- Edit profile ----------------------------------------------------------
  console.log('Profile picture in "Edit profile"');
  const firstFile = imageFiles()[0];
  await openProfileEditor(page);
  check('"Edit profile" shows the current picture', (await avatarImage(page, '.modal .avatar-edit'))?.src === `media://img/${firstFile}`);
  await page.locator('.modal .avatar-edit-btn').hover();
  check('hovering it shows the pencil', await eventually(page, () => getComputedStyle(document.querySelector('.modal .avatar-edit-hover')).opacity === '1'));
  await page.waitForTimeout(200);
  await shot(page, '06-edit-profile-hover');

  await chooseFile(page, t('pick-avatar'), picture('small-photo.png'));
  check('a too-small picture is refused here as well', await eventually(page, () => document.querySelector('.modal [data-test="avatar-error"]')?.textContent.includes('too small')));
  check('and the current picture stays', (await avatarImage(page, '.modal .avatar-edit'))?.src === `media://img/${firstFile}`);
  await shot(page, '07-edit-profile-too-small');

  await chooseFile(page, t('pick-avatar'), picture('tall-strip.png'));
  await page.waitForSelector('.crop-stage');
  check('a picture with nothing to spare cannot be zoomed, only moved', (await page.locator('.crop-controls .slider').isDisabled()) && (await text(page, '.crop-hint')) === 'Drag to move');
  await page.click(t('crop-apply'));
  await gone(page, '.crop-stage');
  await page.locator('.modal .btn', { hasText: 'Cancel' }).click();
  check('Cancel discards the new picture', (await gone(page, '.modal')) && imageFiles().join() === firstFile && (await avatarImage(page, t('profile-chip')))?.src === `media://img/${firstFile}`);

  await openProfileEditor(page);
  await chooseFile(page, t('pick-avatar'), picture('large-photo.png'));
  await page.waitForSelector('.crop-stage');
  await page.click(t('crop-apply'));
  await gone(page, '.crop-stage');
  await page.click(t('profile-save'));
  await gone(page, '.modal');
  check('Save swaps the picture on the title-bar button', await eventually(page, (old) => { const src = document.querySelector('[data-test="profile-chip"] img')?.getAttribute('src'); return Boolean(src) && src !== `media://img/${old}`; }, firstFile));
  check('the replaced picture file is deleted', await eventually(page, () => true) && imageFiles().length === 1 && imageFiles()[0] !== firstFile, imageFiles().join(', '));

  // The picture is still there after a restart.
  await app.close();
  ({ app, page, errors } = await launch());
  await page.waitForSelector('.shell');
  check('the picture survives a restart', (await avatarImage(page, t('profile-chip')))?.width === 320 && imageFiles().length === 1, imageFiles().join(', '));

  await openProfileEditor(page);
  await page.locator('.modal .avatar-edit').hover();
  await page.click(t('remove-avatar'));
  await page.fill('.modal input[type="text"]', 'Pia B');
  await page.click(t('profile-save'));
  await gone(page, '.modal');
  check('removing the picture brings the initial back', (await eventually(page, () => document.querySelector('[data-test="profile-chip"] .avatar')?.textContent === 'P')) && (await avatarImage(page, t('profile-chip'))) === null);
  check('its file is deleted and the profile forgets it', imageFiles().length === 0 && (await savedProfile(page)).picture === null, imageFiles().join(', '));
  check('the rename saved alongside', (await page.getAttribute(t('profile-chip'), 'data-profile')) === 'Pia B');

  // ---- light theme --------------------------------------------------------------
  console.log('Light theme');
  await page.click(t('nav-settings'));
  await page.waitForSelector('.settings-section');
  const headings = await page.locator('.settings-section h3').allInnerTexts();
  check('"Appearance" sits under "Cover art" in Settings', headings.join(' > ') === 'Music folders > Cover art > Appearance', headings.join(' > '));
  const toggle = page.locator(t('setting-light-theme'));
  check('the light theme is off to begin with', !(await toggle.isChecked()) && (await savedTheme(page)) === 'dark');
  await page.waitForTimeout(200);
  await shot(page, '08-settings-dark');

  await toggle.click();
  check('switching it on turns the app light at once', (await eventually(page, () => document.documentElement.dataset.theme === 'light')) && (await pageColor(page)) === 'rgb(241, 241, 241)', await pageColor(page));
  check('the choice is saved', await eventually(page, async () => (await window.api.getState()).settings.theme === 'light'));
  check('the window frame follows', (await windowColor(app)) === '#f1f1f1' && (await nativeSource(app)) === 'light', `${await windowColor(app)} / ${await nativeSource(app)}`);
  const textColor = await page.evaluate(() => getComputedStyle(document.body).color);
  check('text turns dark', textColor === 'rgb(26, 26, 26)', textColor);
  await page.waitForTimeout(200);
  await shot(page, '09-settings-light');

  // Every profile colour must stay readable as text on the light panel.
  const contrasts = await page.evaluate((colors) => {
    const root = document.documentElement;
    const before = root.style.getPropertyValue('--profile-color');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent)';
    document.body.append(probe);
    const luminance = ([r, g, b]) => {
      const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const panel = luminance([251, 251, 251]);
    const result = colors.map((color) => {
      root.style.setProperty('--profile-color', color);
      ctx.fillStyle = getComputedStyle(probe).color;
      ctx.fillRect(0, 0, 1, 1);
      const rgb = [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      return { color, accent: rgb.join(','), contrast: Number(((panel + 0.05) / (luminance(rgb) + 0.05)).toFixed(2)) };
    });
    root.style.setProperty('--profile-color', before);
    probe.remove();
    return result;
  }, PROFILE_COLORS);
  console.log(`  info light-theme accents: ${contrasts.map((c) => `${c.color} -> rgb(${c.accent}) ${c.contrast}:1`).join(' | ')}`);
  check('every profile colour is readable on white in the light theme', contrasts.every((c) => c.contrast >= 4.5), JSON.stringify(contrasts));

  await page.keyboard.press('Escape');
  await shot(page, '10-all-songs-light');
  await page.click(t('play-all'));
  await page.waitForFunction(() => document.querySelector('.song-row.is-current'));
  await page.waitForTimeout(600);
  await shot(page, '11-playing-light');
  await page.click(t('play-pause'));
  await page.click(t('profile-chip'));
  await page.waitForSelector('.menu');
  await page.waitForTimeout(400);
  await shot(page, '12-profile-menu-light');
  await page.keyboard.press('Escape');
  await openProfileEditor(page);
  await page.waitForTimeout(200);
  await shot(page, '13-edit-profile-light');
  await page.keyboard.press('Escape');
  await page.click(t('nav-create-playlist'));
  await page.waitForSelector('.modal');
  await page.waitForTimeout(200);
  await shot(page, '15-create-playlist-light');
  await page.keyboard.press('Escape');
  check('no errors in the window', errors.length === 0, errors.join(' | '));

  // A restart opens light straight away, before the saved data has been read.
  await app.close();
  ({ app, page, errors } = await launch());
  const early = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, query: location.search }));
  check('a restart opens in the light theme', early.theme === 'light' && early.query.includes('theme=light') && (await windowColor(app)) === '#f1f1f1', JSON.stringify(early));
  await page.waitForSelector('.shell');
  await page.click(t('profile-chip'));
  await page.locator('.menu-item', { hasText: 'Add profile' }).click();
  await page.waitForSelector('.wizard');
  await page.waitForTimeout(300);
  await shot(page, '16-wizard-light');
  await page.locator('.wizard-foot .btn', { hasText: 'Cancel' }).click();
  await page.waitForSelector('.shell');

  await page.click(t('nav-settings'));
  await page.waitForSelector('.settings-section');
  check('the switch shows the light theme is on', await page.locator(t('setting-light-theme')).isChecked());
  await page.locator(t('setting-light-theme')).click();
  check('switching it off goes back to dark', (await eventually(page, () => !('theme' in document.documentElement.dataset))) && (await pageColor(page)) === 'rgb(32, 32, 32)', await pageColor(page));
  check('dark is saved and the window frame follows', (await eventually(page, async () => (await window.api.getState()).settings.theme === 'dark')) && (await windowColor(app)) === '#202020' && (await nativeSource(app)) === 'dark');
  check('the accent is the profile colour again', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#b4a0ff');
  await page.keyboard.press('Escape');
  check('no errors after restart', errors.length === 0, errors.join(' | '));
  await app.close();

  ({ app, page, errors } = await launch());
  const again = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme ?? 'dark', query: location.search }));
  check('and the next start is dark', again.theme === 'dark' && again.query.includes('theme=dark'), JSON.stringify(again));
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
