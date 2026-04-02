import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName: string, bytes: Uint8Array): Promise<string | null> =>
    ipcRenderer.invoke('save-file', defaultName, Array.from(bytes)),

  openFile: (): Promise<{ path: string; buffer: ArrayBuffer } | null> =>
    ipcRenderer.invoke('open-file'),

  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke('get-platform'),

  getResourcesPath: (): Promise<string> =>
    ipcRenderer.invoke('get-resources-path')
})
