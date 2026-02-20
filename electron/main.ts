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
      webSecurity: true
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

  return mainWindow;
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
    mainWindow?.webContents.send(IPC.DOWNLOAD_ADDED, item);
    // Show window if hidden
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  engine.on('status-changed', (id, status) => {
    mainWindow?.webContents.send(IPC.DOWNLOAD_STATUS_CHANGED, id, status);
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
  progressTracker.setWindow(window);
  progressTracker.start();

  // Create system tray
  createTray(window, queueManager);

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
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}
