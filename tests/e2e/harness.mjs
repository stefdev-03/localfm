// Shared plumbing for the end-to-end scripts: launching the real app against
// a throwaway data folder, and a tiny check/report helper.

import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const library = path.join(root, 'test-library');
export const pictures = path.join(library, '_pictures');
const electronPath = createRequire(import.meta.url)('electron');

// Builds the practice library when it is missing or predates the newest
// addition to it (the made-up albums).
export function ensureTestLibrary() {
  if (!fs.existsSync(path.join(library, 'Collection', 'Low Tide', 'cover.png'))) {
    execFileSync(process.execPath, [path.join(root, 'scripts/make-test-library.mjs')], { stdio: 'inherit' });
  }
}

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export function outputDir(name) {
  const dir = path.join(root, 'tests/e2e/output', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Points the native "choose folder" dialog, which a script cannot click, at a folder.
export function setDialogFolder(app, folder) {
  return app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, folder);
}

export async function launch(dataDir, dialogFolder) {
  const env = { ...process.env, LOCALFM_USER_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE; // set by some editors; it stops Electron starting as an app
  // Set LOCALFM_EXE to the installed or unpacked Local.fm.exe to test a built app
  // instead of the source tree.
  const packaged = process.env.LOCALFM_EXE;
  const app = await electron.launch({
    executablePath: packaged || electronPath,
    args: packaged ? [] : ['.'],
    cwd: root,
    env,
  });
  if (dialogFolder) await setDialogFolder(app, dialogFolder);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  return { app, page, errors };
}

export const t = (name) => `[data-test="${name}"]`;
export const text = (page, selector) => page.locator(selector).first().innerText();

export async function chooseFile(page, trigger, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(trigger)]);
  await chooser.setFiles(file);
}

// True once the condition holds, false if it never does within the timeout.
export function eventually(page, fn, arg, timeout = 5000) {
  return page.waitForFunction(fn, arg, { timeout }).then(
    () => true,
    () => false,
  );
}

export const playLabelBecomes = (page, label) =>
  eventually(page, (wanted) => document.querySelector('[data-test="play-pause"]')?.getAttribute('aria-label') === wanted, label);

export function reporter() {
  let passed = 0;
  const failures = [];
  return {
    check(name, condition, detail = '') {
      if (condition) {
        passed += 1;
        console.log(`  ok   ${name}`);
      } else {
        failures.push(name);
        console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
      }
    },
    crash(error) {
      failures.push(`crashed: ${error.message}`);
      console.error(error);
    },
    finish() {
      console.log(`\n${passed} passed, ${failures.length} failed`);
      if (failures.length) {
        console.log(failures.map((name) => ` - ${name}`).join('\n'));
        process.exit(1);
      }
    },
  };
}
