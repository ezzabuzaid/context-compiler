import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopApi, DesktopState } from './desktop-api.ts';

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('desktop', {
    state: () => ipcRenderer.invoke('desktop:state'),
    retry: () => ipcRenderer.invoke('desktop:retry'),
    callTool: (id, params, timeout) =>
      ipcRenderer.invoke('desktop:tool', id, params, timeout),
    cancelTool: (id) => ipcRenderer.send('desktop:cancel', id),
    onState: (listener) => {
      const receive = (
        _event: Electron.IpcRendererEvent,
        state: DesktopState,
      ) => listener(state);
      ipcRenderer.on('desktop:state', receive);
      return () => {
        ipcRenderer.removeListener('desktop:state', receive);
      };
    },
  } satisfies DesktopApi);
}
