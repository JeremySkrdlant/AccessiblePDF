"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs/promises");
function registerIpcHandlers() {
  electron.ipcMain.handle("save-file", async (_event, defaultName, bytes) => {
    const { filePath } = await electron.dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "PDF Files", extensions: ["pdf"] }]
    });
    if (!filePath) return null;
    await fs.writeFile(filePath, Buffer.from(bytes));
    return filePath;
  });
  electron.ipcMain.handle("open-file", async () => {
    const { filePaths } = await electron.dialog.showOpenDialog({
      title: "Open PDF",
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      properties: ["openFile"]
    });
    if (!filePaths[0]) return null;
    const buf = await fs.readFile(filePaths[0]);
    return { path: filePaths[0], buffer: buf.buffer };
  });
  electron.ipcMain.handle("get-platform", () => process.platform);
  electron.ipcMain.handle("get-resources-path", () => process.resourcesPath);
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "PDF Accessibility Tagger",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
