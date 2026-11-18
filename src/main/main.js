import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, newId } from './store.js';
import { Library } from './library.js';
import { Artwork } from './artwork.js';
import { registerMediaScheme, handleMediaProtocol } from './protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

// Lets tests (and portable setups) keep all app data in a folder of their choice.
if (process.env.LOCALFM_USER_DATA) app.setPath('userData', path.resolve(process.env.LOCALFM_USER_DATA));

registerMediaScheme();

let win = null;
let store;
let library;
let artwork;
let imageDir;
let artDir;
const MAX_WALL_COVERS = 120;

// What Windows draws around the page: the window's own background (seen for a
// moment while it opens) and the minimise / maximise / close buttons.
const WINDOW_COLORS = {
  dark: { background: '#202020', symbols: '#f3f3f3' },
  light: { background: '#f1f1f1', symbols: '#1a1a1a' },
};
const currentTheme = () => (store.state.settings.theme === 'light' ? 'light' : 'dark');

function applyWindowTheme() {
  const theme = currentTheme();
  const colors = WINDOW_COLORS[theme];
  nativeTheme.themeSource = theme; // native parts follow too: drop-down lists, scroll bars
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(colors.background);
  win.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbols, height: 40 });
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function createWindow() {
  // Reopen at the size the window was last closed with.
  const saved = store.state.window ?? {};
  const theme = currentTheme();
  const colors = WINDOW_COLORS[theme];
  nativeTheme.themeSource = theme;
  const size = (value, min, fallback) => (Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), 10000) : fallback);
  win = new BrowserWindow({
    width: size(saved.width, 940, 1280),
    height: size(saved.height, 620, 820),
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: colors.background,
    title: 'Local.fm',
    icon: path.join(here, '../renderer/assets/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbols, height: 40 },
    webPreferences: {
      preload: path.join(here, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => {
    const { width, height } = win.getNormalBounds();
    store.state.window = { width, height, maximized: win.isMaximized() };
    store.flush(); // written straight away: when the app is quitting there is no later
  });
  win.on('closed', () => {
    win = null;
  });

  // The window only ever shows the app itself.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
  // The theme rides along in the address so the page can dress itself before
  // it is first drawn, instead of flashing dark and then turning light.
  win.loadFile(path.join(here, '../renderer/index.html'), { query: { theme } });
}

function removeImage(name) {
  if (typeof name === 'string' && /^[\w-]+\.(jpg|png)$/.test(name)) {
    fs.rmSync(path.join(imageDir, name), { force: true });
  }
}

// Deletes pictures that no playlist or profile points to any more.
function collectUnusedImages() {
  const used = store.referencedImages();
  for (const name of fs.readdirSync(imageDir)) {
    if (!used.has(name)) removeImage(name);
  }
}

const publicState = () => ({
  profiles: store.state.profiles,
  activeProfileId: store.state.activeProfileId,
  settings: store.state.settings,
  version: app.getVersion(),
});

function registerIpc() {
  ipcMain.handle('app:getState', () => publicState());

  ipcMain.handle('profiles:create', (_e, input) => store.createProfile(input ?? {}));
  ipcMain.handle('profiles:update', (_e, id, patch) => {
    const before = store.profile(id)?.picture;
    const profile = store.updateProfile(id, patch ?? {});
    // A replaced or removed profile picture has no further use.
    if (profile && before && before !== profile.picture && !store.referencedImages().has(before)) removeImage(before);
    return profile;
  });
  ipcMain.handle('profiles:setActive', (_e, id) => {
    store.setActive(id);
    artwork.clearQueue();
    return store.state.activeProfileId;
  });
  ipcMain.handle('profiles:delete', (_e, id) => {
    const removed = store.deleteProfile(id);
    if (removed) {
      library.forget(id);
      collectUnusedImages();
    }
    return removed;
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your music folder',
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });

  ipcMain.handle('library:get', (_e, profileId) => (store.profile(profileId) ? library.get(profileId) : []));
  ipcMain.handle('library:scan', async (_e, profileId) => {
    const profile = store.profile(profileId);
    if (!profile) return { tracks: [], missingFolders: [] };
    return library.scan(profileId, profile.folders, (progress) => send('library:progress', { profileId, ...progress }));
  });

  // Cover pictures for the wall behind "Who's listening?": names only, never
  // track lists, drawn from every finished profile, shuffled and checked to
  // still be on disk.
  ipcMain.handle('library:covers', () => {
    const names = new Set();
    for (const profile of store.state.profiles) {
      if (!profile.setupComplete) continue;
      for (const track of library.get(profile.id)) if (track.art) names.add(track.art);
    }
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const covers = [];
    for (const name of shuffled) {
      if (covers.length >= MAX_WALL_COVERS) break;
      if (/^[\w.-]+$/.test(name) && fs.existsSync(path.join(artDir, name))) covers.push(name);
    }
    return covers;
  });

  // The window sends the artist names it is about to show and gets back the
  // pictures already saved; the rest arrive later as 'artist:picture'. Only
  // names are accepted, never addresses.
  ipcMain.handle('artists:pictures', (_e, names) => {
    if (!Array.isArray(names)) return {};
    const clean = [
      ...new Set(
        names
          .slice(0, 5000)
          .filter((name) => typeof name === 'string')
          .map((name) => name.replace(/\s+/g, ' ').trim())
          .filter((name) => name && name.length <= 200),
      ),
    ];
    return artwork.artistPictures(clean);
  });

  ipcMain.handle('playlists:save', (_e, profileId, input) => {
    const result = store.savePlaylist(profileId, input ?? {});
    if (!result) return null;
    const used = store.referencedImages();
    for (const name of result.replacedImages) if (!used.has(name)) removeImage(name);
    return result.playlist;
  });
  ipcMain.handle('playlists:delete', (_e, profileId, playlistId) => {
    const removed = store.deletePlaylist(profileId, playlistId);
    if (!removed) return false;
    const used = store.referencedImages();
    for (const name of [removed.image, removed.banner]) if (name && !used.has(name)) removeImage(name);
    return true;
  });

  // The window crops pictures itself and hands over the finished JPEG or PNG bytes.
  ipcMain.handle('images:save', async (_e, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes.length > MAX_IMAGE_BYTES) return null;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!isJpeg && !isPng) return null;
    const name = `${newId()}.${isJpeg ? 'jpg' : 'png'}`;
    await fs.promises.writeFile(path.join(imageDir, name), bytes);
    return name;
  });

  ipcMain.handle('settings:update', (_e, patch) => {
    const themeBefore = currentTheme();
    const settings = store.updateSettings(patch ?? {});
    if (currentTheme() !== themeBefore) applyWindowTheme();
    if (!settings.onlineArt) artwork.clearQueue();
    else if (store.state.activeProfileId) artwork.enqueue(library.get(store.state.activeProfileId));
    return settings;
  });

  ipcMain.handle('shell:showTrack', (_e, trackId) => {
    const filePath = library.pathFor(trackId);
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    artDir = path.join(dataDir, 'art');
    imageDir = path.join(dataDir, 'images');
    fs.mkdirSync(imageDir, { recursive: true });

    store = new Store(dataDir);
    artwork = new Artwork({
      dir: artDir,
      cacheFile: path.join(dataDir, 'art-lookups.json'),
      isOnlineEnabled: () => store.state.settings.onlineArt,
      onFound: (trackId, file) => {
        if (library.setArt(trackId, file)) send('track:updated', { id: trackId, art: file });
      },
      onArtistFound: (name, file) => send('artist:picture', { name, file }),
    });
    library = new Library({ dir: dataDir, artwork });
    collectUnusedImages();

    Menu.setApplicationMenu(null);
    handleMediaProtocol({ library, artDir, imageDir });
    registerIpc();
    createWindow();
  });

  // Pending writes are debounced; make sure none are lost on the way out.
  const flushAll = () => {
    store?.flush();
    library?.flush();
    artwork?.flush();
  };
  app.on('before-quit', flushAll);
  app.on('will-quit', flushAll);

  app.on('window-all-closed', () => app.quit());
}
