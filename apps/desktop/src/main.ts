import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  BrowserWindow,
  Menu,
  app,
  ipcMain,
  nativeTheme,
  protocol,
  session,
} from 'electron';

import { Backend } from './backend.ts';
import { type DesktopState, hostOrigin, isPageTool } from './desktop-api.ts';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cc-host',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName('Context Compiler');
const userData = join(
  homedir(),
  'Library/Application Support/Context Compiler/Desktop',
);
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', userData);

if (app.requestSingleInstanceLock()) void launch();
else app.quit();

async function launch() {
  let window: BrowserWindow | undefined;
  let quitting = false;
  let quitComplete = false;
  const calls = new Map<string, AbortController>();
  const backend = new Backend(
    app.isPackaged
      ? join(process.resourcesPath, 'server/main.mjs')
      : resolve(app.getAppPath(), '../server/dist/server/main.mjs'),
    publish,
  );
  const state = (): DesktopState => ({
    ...backend.state,
    theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  });
  function publish() {
    if (window !== undefined && !window.webContents.isDestroyed())
      window.webContents.send('desktop:state', state());
  }
  function validateSender(
    event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  ) {
    if (
      quitting ||
      window === undefined ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== `${hostOrigin}/index.html`
    )
      throw new Error('Only the Context Compiler host can use this API.');
  }
  function abortCalls() {
    for (const call of calls.values()) call.abort();
    calls.clear();
  }

  ipcMain.handle('desktop:state', (event) => {
    validateSender(event);
    return state();
  });
  ipcMain.handle('desktop:retry', async (event) => {
    validateSender(event);
    if (backend.state.status !== 'failed') return;
    abortCalls();
    await backend.start();
  });
  ipcMain.handle(
    'desktop:tool',
    async (event, id: unknown, input: unknown, timeout: unknown) => {
      validateSender(event);
      if (
        typeof id !== 'string' ||
        id.length === 0 ||
        id.length > 128 ||
        calls.has(id)
      )
        throw new Error('Invalid tool request ID.');
      const { params } = CallToolRequestSchema.parse({
        method: 'tools/call',
        params: input,
      });
      if (!isPageTool(params.name))
        throw new Error('Tool is not available to this page.');
      if (
        typeof timeout !== 'number' ||
        !Number.isFinite(timeout) ||
        timeout <= 0 ||
        timeout > 1_800_000
      )
        throw new Error('Invalid tool timeout.');
      const controller = new AbortController();
      calls.set(id, controller);
      try {
        return await backend.callTool(
          { name: params.name, arguments: params.arguments },
          controller.signal,
          timeout,
        );
      } finally {
        calls.delete(id);
      }
    },
  );
  ipcMain.on('desktop:cancel', (event, id: unknown) => {
    // send() has no rejection channel; an untrusted frame must not crash main.
    try {
      validateSender(event);
    } catch {
      return;
    }
    if (typeof id === 'string') calls.get(id)?.abort();
  });

  app.on('before-quit', (event) => {
    if (quitComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    abortCalls();
    void backend.quit().then(() => {
      quitComplete = true;
      app.quit();
    });
  });
  app.on('window-all-closed', () => {});
  app.on('activate', () => {
    if (!quitting) showWindow();
  });
  app.on('second-instance', () => {
    if (!quitting && app.isReady()) showWindow();
  });
  nativeTheme.on('updated', publish);

  await app.whenReady();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${hostOrigin}/`) });
  });
  const renderer = resolve(import.meta.dirname, '../renderer');
  protocol.handle('cc-host', async (request) => {
    if (!request.url.startsWith(`${hostOrigin}/`))
      return new Response(null, { status: 404 });
    const file = resolve(
      renderer,
      `.${decodeURIComponent(new URL(request.url).pathname)}`,
    );
    if (relative(renderer, file).startsWith('..'))
      return new Response(null, { status: 404 });
    // Main serves local files through its own session; the renderer's session
    // rejects file requests as well as remote requests.
    const response = await session
      .fromPartition('frontend-assets')
      .fetch(pathToFileURL(file).href);
    response.headers.set(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'",
    );
    response.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=(), usb=(), serial=(), bluetooth=()',
    );
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
  showWindow();
  await backend.start();

  function showWindow() {
    if (window !== undefined) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return;
    }
    window = new BrowserWindow({
      title: 'Context Compiler',
      width: 1050,
      height: 760,
      minWidth: 640,
      minHeight: 480,
      webPreferences: {
        preload: resolve(import.meta.dirname, '../preload/preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-frame-navigate', (event) =>
      event.preventDefault(),
    );
    window.webContents.on('will-attach-webview', (event) =>
      event.preventDefault(),
    );
    window.webContents.on('render-process-gone', abortCalls);
    window.on('closed', () => {
      abortCalls();
      window = undefined;
    });
    void window.loadURL(`${hostOrigin}/index.html`);
  }
}
