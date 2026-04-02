import { ipcMain, dialog } from 'electron'
import fs from 'fs/promises'

export function registerIpcHandlers(): void {
  ipcMain.handle('save-file', async (_event, defaultName: string, bytes: number[]) => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (!filePath) return null
    await fs.writeFile(filePath, Buffer.from(bytes))
    return filePath
  })

  ipcMain.handle('open-file', async () => {
    const { filePaths } = await dialog.showOpenDialog({
      title: 'Open PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (!filePaths[0]) return null
    const buf = await fs.readFile(filePaths[0])
    return { path: filePaths[0], buffer: buf.buffer }
  })

  ipcMain.handle('get-platform', () => process.platform)

  ipcMain.handle('get-resources-path', () => process.resourcesPath)
}
