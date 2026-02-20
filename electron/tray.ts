import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import log from 'electron-log';
import { QueueManager } from './download-engine/queue-manager';

let tray: Tray | null = null;

export function createTray(
  mainWindow: BrowserWindow,
  queueManager: QueueManager
): Tray {
  // Choose proper icon depending on platform.
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';

  // Candidate locations to look for the icon when packaged or in dev.
  const candidates = [
    path.join(process.resourcesPath, iconName), // resources/iconName
    path.join(process.resourcesPath, 'app.asar', iconName),
    path.join(process.resourcesPath, 'app.asar', 'resources', iconName),
    path.join(process.resourcesPath, 'app', 'resources', iconName),
    path.join(__dirname, '../../resources', iconName), // repository resources during dev
    path.join(__dirname, '../resources', iconName)
  ];

  let resolvedIconPath: string | null = null;
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        resolvedIconPath = candidate;
        break;
      }
    } catch (e) {
      // ignore and try next
    }
  }

  if (!resolvedIconPath) {
    // If none found, still try the first packaged candidate (may work with asar paths)
    resolvedIconPath = candidates[0];
  }

  log.info('[Tray] Trying tray icon at: ' + resolvedIconPath);

  let trayIcon: Electron.NativeImage = nativeImage.createFromPath(resolvedIconPath as string);
  if (!trayIcon || trayIcon.isEmpty()) {
    log.warn('[Tray] Tray icon is empty or failed to load: ' + resolvedIconPath);
    trayIcon = nativeImage.createEmpty();
  } else {
    log.info('[Tray] Loaded tray icon successfully');
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('IDM Clone - Download Manager');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show IDM Clone',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Pause All Downloads',
      click: async () => {
        await queueManager.pauseAll();
      }
    },
    {
      label: 'Resume All Downloads',
      click: async () => {
        await queueManager.resumeAll();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  log.info('[Tray] System tray created');
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
