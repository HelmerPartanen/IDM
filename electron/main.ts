import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import log from 'electron-log';
import fs from 'fs';

import { initDatabase, closeDatabase } from './db/database';
import { DownloadEngine, httpsAgent, httpAgent } from './download-engine/engine';
import { ProgressTracker } from './download-engine/progress-tracker';
import { QueueManager } from './download-engine/queue-manager';
import { Scheduler } from './download-engine/scheduler';
import { registerDownloadHandlers } from './ipc/download-handlers';
import { registerSettingsHandlers, getSettings } from './ipc/settings-handlers';
import { registerScheduleHandlers } from './ipc/schedule-handlers';
import { createTray, destroyTray } from './tray';
import { PipeServer } from './native-messaging/pipe-server';
import { runSetup } from './setup';
import { IPC } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let engine: DownloadEngine;
let progressTracker: ProgressTracker;
let queueManager: QueueManager;
let scheduler: Scheduler;
let pipeServer: PipeServer;

/** Timer that destroys the renderer after the window has been hidden with no active downloads. */
let idleSuspendTimer: NodeJS.Timeout | null = null;
const IDLE_SUSPEND_DELAY_MS = 30_000; // 30 seconds hidden with no activity → destroy renderer

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#000000',
      symbolColor: '#e2e8f0',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: true   // throttle timers/animations when hidden
    },
    backgroundColor: '#000000',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'favicon.ico')
      : join(__dirname, '../../resources/favicon.ico')
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Minimize to tray instead of closing (if setting enabled)
  mainWindow.on('close', (event) => {
    const settings = getSettings();
    if (settings.minimizeToTray && !(app as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      scheduleIdleSuspend();
    }
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Wire up progress tracker to this window
  progressTracker.setWindow(mainWindow);

  return mainWindow;
}

/** Show the main window, recreating the renderer if it was destroyed during idle. */
function showWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    cancelIdleSuspend();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // Renderer was destroyed to save memory — recreate it
    cancelIdleSuspend();
    const win = createWindow();
    log.info('[Main] Renderer recreated from idle suspension');
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
  }
}

/**
 * Schedule the renderer for destruction if no downloads are active.
 * Called when the window is hidden to the tray.
 */
function scheduleIdleSuspend(): void {
  cancelIdleSuspend();
  idleSuspendTimer = setTimeout(() => {
    idleSuspendTimer = null;
    // Don't destroy if downloads are running or window is visible
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      if (engine.getActiveDownloadIds().length === 0) {
        log.info('[Main] No active downloads — suspending renderer to free memory');
        progressTracker.clearWindow();
        mainWindow.destroy();
        mainWindow = null;
      }
    }
  }, IDLE_SUSPEND_DELAY_MS);
}

function cancelIdleSuspend(): void {
  if (idleSuspendTimer) {
    clearTimeout(idleSuspendTimer);
    idleSuspendTimer = null;
  }
}

async function initializeApp(): Promise<void> {
  // Initialize database
  initDatabase();

  // Load settings
  const settings = getSettings();

  // Run automatic setup (registry, manifest path, etc.)
  await runSetup();

  // Ensure download folder exists
  if (!fs.existsSync(settings.downloadFolder)) {
    fs.mkdirSync(settings.downloadFolder, { recursive: true });
  }

  // Initialize download engine
  engine = new DownloadEngine(settings);

  // Initialize queue manager
  queueManager = new QueueManager(engine, settings.maxConcurrentDownloads, settings);

  // Initialize progress tracker
  progressTracker = new ProgressTracker(engine);

  // Initialize scheduler
  scheduler = new Scheduler(engine, queueManager);
  scheduler.initialize();

  // Initialize pipe server for native messaging
  pipeServer = new PipeServer(engine, queueManager);
  pipeServer.start();

  // Register IPC handlers
  registerDownloadHandlers(engine, queueManager);
  registerSettingsHandlers();
  registerScheduleHandlers(scheduler);

  // Forward engine events to renderer
  engine.on('download-added', (item) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.DOWNLOAD_ADDED, item);
    }
    // Show window if hidden (recreates renderer if needed)
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
      showWindow();
    }
  });

  engine.on('status-changed', (id, status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.DOWNLOAD_STATUS_CHANGED, id, status);
    }
  });

  engine.on('download-complete', (item) => {
    const settings = getSettings();
    if (settings.showNotifications) {
      const { Notification } = require('electron');
      new Notification({
        title: 'Download Complete',
        body: `${item.filename} has been downloaded successfully.`
      }).show();
    }
  });

  // Favicon IPC — fetches a website's favicon and returns it as a data URL
  ipcMain.handle(IPC.GET_FAVICON, async (_event, domain: string) => {
    try {
      // Use Google's high-quality favicon service
      const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
      const { net } = require('electron') as typeof import('electron');
      return new Promise<string | null>((resolve) => {
        const request = net.request(url);
        const chunks: Buffer[] = [];
        request.on('response', (response) => {
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            try {
              const buffer = Buffer.concat(chunks);
              // Check we got a real image (not a tiny 1x1 default)
              if (buffer.length < 100) {
                resolve(null);
                return;
              }
              const contentType = response.headers['content-type'];
              const mime = Array.isArray(contentType) ? contentType[0] : contentType || 'image/png';
              const b64 = buffer.toString('base64');
              resolve(`data:${mime};base64,${b64}`);
            } catch {
              resolve(null);
            }
          });
        });
        request.on('error', () => resolve(null));
        request.end();
      });
    } catch (err: any) {
      log.warn('[IPC] get-favicon failed:', err.message);
      return null;
    }
  });

  // App control IPC
  ipcMain.on(IPC.APP_MINIMIZE_TO_TRAY, () => {
    mainWindow?.hide();
    scheduleIdleSuspend();
  });

  ipcMain.on(IPC.APP_QUIT, () => {
    app.quit();
  });

  log.info('[Main] Application initialized');
}

// Custom property on app to track quit state
(app as any).isQuitting = false;

// ─── APP LIFECYCLE ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId('com.idm.clone');

  // Optimize for development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  await initializeApp();

  const window = createWindow();
  progressTracker.start();

  // Create system tray
  createTray(showWindow, queueManager);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
});

app.on('window-all-closed', () => {
  // On Windows, keep running in tray
  const settings = getSettings();
  if (!settings.minimizeToTray) {
    app.quit();
  }
});

app.on('will-quit', () => {
  log.info('[Main] Application shutting down');

  cancelIdleSuspend();
  progressTracker?.stop();
  pipeServer?.stop();
  scheduler?.destroy();
  destroyTray();
  closeDatabase();

  // Destroy persistent HTTP agents
  httpsAgent?.destroy();
  httpAgent?.destroy();
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}
