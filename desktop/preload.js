'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('johnOrb', {
  onCommand: (cb) => ipcRenderer.on('orb', (_e, cmd) => cb(cmd)),
  setClickThrough: (on) => ipcRenderer.send('click-through', on),
  wake: () => ipcRenderer.send('wake'),
});
