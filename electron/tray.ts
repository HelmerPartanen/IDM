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
  const iconNames = process.platform === 'win32'
    ? ['favicon.ico', 'icon.ico']
    : ['icon.png', 'favicon.png'];

  // Candidate locations to look for the icon when packaged or in dev.
  const candidates: string[] = [];
  for (const name of iconNames) {
    candidates.push(
      path.join(process.resourcesPath, name),
      path.join(process.resourcesPath, 'resources', name),
      path.join(process.resourcesPath, 'app.asar', 'resources', name),
      path.join(__dirname, '../../resources', name), // development
      path.join(__dirname, '../resources', name)      // fallback
    );
  }

  let resolvedIconPath: string | null = null;
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        resolvedIconPath = candidate;
        log.info('[Tray] Found tray icon at: ' + candidate);
        break;
      }
    } catch (e) {
      // ignore and try next
    }
  }

  if (!resolvedIconPath) {
    // If none found, fallback to first candidate as a last resort
    resolvedIconPath = path.join(process.resourcesPath, iconNames[0]);
    log.warn('[Tray] No icon found, falling back to: ' + resolvedIconPath);
  }

  let trayIcon: Electron.NativeImage = nativeImage.createFromPath(resolvedIconPath as string);
  if (!trayIcon || trayIcon.isEmpty()) {
    log.warn('[Tray] Tray icon is empty or failed to load: ' + resolvedIconPath);
    trayIcon = nativeImage.createEmpty();
  } else {
    log.info('[Tray] Loaded tray icon successfully');
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Download Manager');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Download Manager',
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
