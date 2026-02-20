import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import path from 'path';
import log from 'electron-log';
import { QueueManager } from './download-engine/queue-manager';

let tray: Tray | null = null;

export function createTray(
  mainWindow: BrowserWindow,
  queueManager: QueueManager
): Tray {
  // In packaged builds the extraResources copies favicon.ico to resourcesPath.
  // In dev builds we resolve from the project root's resources directory.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'favicon.ico')
    : path.join(__dirname, '../../resources/favicon.ico');

  let trayIcon = nativeImage.createFromPath(iconPath);
  if (!trayIcon || trayIcon.isEmpty()) {
    log.warn('[Tray] Tray icon failed to load from: ' + iconPath);
    trayIcon = nativeImage.createEmpty();
  } else {
    // Resize to standard tray size (16x16) for crisp rendering
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
    log.info('[Tray] Loaded tray icon from: ' + iconPath);
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
