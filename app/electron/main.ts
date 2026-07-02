import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Sidecar configuration (override via env) ---------------------------- //
const SIDECAR_PORT = Number(process.env.PDF2MIDI_PORT || 8765);
const API_BASE = `http://127.0.0.1:${SIDECAR_PORT}`;
const PYTHON = process.env.PDF2MIDI_PYTHON || 'python';
// Dev: sibling ../sidecar. Packaged: bundled under resources/sidecar.
const SIDECAR_DIR =
  process.env.PDF2MIDI_SIDECAR_DIR ||
  (app.isPackaged
    ? path.join(process.resourcesPath, 'sidecar')
    : path.resolve(process.cwd(), '..', 'sidecar'));

let win: BrowserWindow | null = null;
let sidecar: ChildProcess | null = null;

function pingHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`${API_BASE}/`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForSidecar(timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingHealth()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startSidecar(): Promise<void> {
  // Reuse an already-running sidecar (e.g. started manually) if present.
  if (await pingHealth()) return;

  sidecar = spawn(
    PYTHON,
    ['-m', 'uvicorn', 'app.main:app', '--port', String(SIDECAR_PORT), '--log-level', 'warning'],
    { cwd: SIDECAR_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  sidecar.stdout?.on('data', (d) => console.log('[sidecar]', String(d).trimEnd()));
  sidecar.stderr?.on('data', (d) => console.log('[sidecar]', String(d).trimEnd()));
  sidecar.on('exit', (code) => console.log('[sidecar] exited', code));

  await waitForSidecar();
}

function stopSidecar(): void {
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
    sidecar = null;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    title: 'PDF2MIDI',
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

ipcMain.handle('pick-pdf', async () => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Оберіть нотний PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('api-base', () => API_BASE);

// Export the corrected MIDI / MusicXML / JSON to a user-chosen folder.
ipcMain.handle('export-document', async (_e, args: { docId: string; baseName: string }) => {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Оберіть теку для експорту',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };

  const dir = res.filePaths[0];
  const safe = (args.baseName || 'score').replace(/[<>:"/\\|?*\n\r]+/g, '_').trim() || 'score';
  const written: string[] = [];
  const targets: { url: string; ext: string; binary?: boolean }[] = [
    { url: `${API_BASE}/documents/${args.docId}/midi`, ext: 'mid', binary: true },
    { url: `${API_BASE}/documents/${args.docId}/musicxml.xml`, ext: 'musicxml' },
    { url: `${API_BASE}/documents/${args.docId}`, ext: 'json' },
  ];
  try {
    for (const t of targets) {
      const r = await fetch(t.url);
      if (!r.ok) continue;
      const out = path.join(dir, `${safe}.${t.ext}`);
      if (t.binary) await writeFile(out, Buffer.from(await r.arrayBuffer()));
      else await writeFile(out, await r.text(), 'utf-8');
      written.push(out);
    }
    return { ok: true, dir, files: written };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

app.whenReady().then(async () => {
  await startSidecar();
  createWindow();
});

app.on('window-all-closed', () => {
  stopSidecar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopSidecar);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
