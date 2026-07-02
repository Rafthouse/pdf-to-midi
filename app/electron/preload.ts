import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('pdf2midi', {
  platform: process.platform,
  /** Open a native file dialog and return the chosen PDF path (or null). */
  pickPdf: (): Promise<string | null> => ipcRenderer.invoke('pick-pdf'),
  /** Base URL of the Python sidecar HTTP API. */
  apiBase: (): Promise<string> => ipcRenderer.invoke('api-base'),
  /** Resolve the absolute filesystem path of a drag-dropped File. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Export corrected MIDI/MusicXML/JSON to a user-chosen folder. */
  exportDocument: (docId: string, baseName: string): Promise<{
    ok: boolean; canceled?: boolean; dir?: string; files?: string[]; error?: string;
  }> => ipcRenderer.invoke('export-document', { docId, baseName }),
});
