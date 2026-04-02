"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  saveFile: (defaultName, bytes) => electron.ipcRenderer.invoke("save-file", defaultName, Array.from(bytes)),
  openFile: () => electron.ipcRenderer.invoke("open-file"),
  getPlatform: () => electron.ipcRenderer.invoke("get-platform"),
  getResourcesPath: () => electron.ipcRenderer.invoke("get-resources-path")
});
