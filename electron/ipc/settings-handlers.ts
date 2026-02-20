import { ipcMain, app } from 'electron';
import Store from 'electron-store';
import log from 'electron-log';
import path from 'path';
import { IPC, DEFAULT_SETTINGS } from '../../shared/types';
import type { AppSettings } from '../../shared/types';

const store = new Store<{ settings: AppSettings }>({
  defaults: {
    settings: {
      ...DEFAULT_SETTINGS,
      downloadFolder: path.join(app.getPath('downloads'), 'IDM Clone')
    }
  }
});

export function getSettings(): AppSettings {
  return store.get('settings');
}

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    try {
      return { success: true, settings: getSettings() };
    } catch (error: any) {
      log.error('[IPC] settings:get failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(IPC.SETTINGS_UPDATE, async (_event, updates: Partial<AppSettings>) => {
    try {
      const current = getSettings();
      const updated = { ...current, ...updates };
      store.set('settings', updated);

      // Handle auto-start on boot
      if (updates.autoStartOnBoot !== undefined) {
        app.setLoginItemSettings({
          openAtLogin: updates.autoStartOnBoot,
          path: app.getPath('exe')
        });
      }

      log.info('[IPC] Settings updated:', Object.keys(updates).join(', '));
      return { success: true, settings: updated };
    } catch (error: any) {
      log.error('[IPC] settings:update failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  log.info('[IPC] Settings handlers registered');
}
