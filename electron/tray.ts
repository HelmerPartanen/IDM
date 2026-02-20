import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import path from 'path';
import log from 'electron-log';
import { QueueManager } from './download-engine/queue-manager';

let tray: Tray | null = null;

export function createTray(
  mainWindow: BrowserWindow,
  queueManager: QueueManager
): Tray {
  // Use a simple icon — in production, use a proper .ico file from resources
  const iconPath = path.join(__dirname, '../../resources/icon.png');
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch {
    // Create a simple 16x16 icon as fallback
    trayIcon = nativeImage.createEmpty();
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
