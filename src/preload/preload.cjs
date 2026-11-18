// The only bridge between the window and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  getState: call('app:getState'),

  createProfile: call('profiles:create'),
  updateProfile: call('profiles:update'),
  deleteProfile: call('profiles:delete'),
  setActiveProfile: call('profiles:setActive'),

  pickFolder: call('dialog:pickFolder'),
  getLibrary: call('library:get'),
  scanLibrary: call('library:scan'),
  getArtistPictures: call('artists:pictures'),
  getWallCovers: call('library:covers'),

  savePlaylist: call('playlists:save'),
  deletePlaylist: call('playlists:delete'),
  saveImage: call('images:save'),

  updateSettings: call('settings:update'),
  showTrackInFolder: call('shell:showTrack'),

  onScanProgress: listen('library:progress'),
  onTrackUpdated: listen('track:updated'),
  onArtistPicture: listen('artist:picture'),
});
