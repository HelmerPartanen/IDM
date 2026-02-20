import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import log from 'electron-log';

/**
 * Setup utility to ensure the app and extension work automatically after installation.
 */
export async function runSetup(): Promise<void> {
    const isDev = !app.isPackaged;
    if (isDev) {
        log.info('[Setup] Skipping setup in development mode');
        return;
    }

    try {
        const appPath = app.getPath('exe');
        const appDir = path.dirname(appPath);

        // 1. Update Native Messaging Host Manifest
        const manifestPath = path.join(appDir, 'native-host', 'com.idm.clone.json');
        const hostExePath = path.join(appDir, 'native-host', 'idm-native-host.exe');

        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifest.path = hostExePath;
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            log.info('[Setup] Updated native messaging manifest path');
        } else {
            log.warn('[Setup] Native messaging manifest not found at:', manifestPath);
        }

        // 2. Register Native Messaging Host in Registry
        const registryPaths = [
            'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.idm.clone',
            'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.idm.clone'
        ];

        for (const regPath of registryPaths) {
            try {
                execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`);
                log.info(`[Setup] Registered native host at ${regPath}`);
            } catch (err: any) {
                log.error(`[Setup] Failed to register native host at ${regPath}:`, err.message);
            }
        }

        // 3. Ensure Auto-Start is enabled by default if not set
        const { getSettings } = await import('./ipc/settings-handlers');
        const settings = getSettings();

        if (settings.autoStartOnBoot) {
            app.setLoginItemSettings({
                openAtLogin: true,
                path: appPath
            });
            log.info('[Setup] Auto-start at login confirmed');
        }

    } catch (error: any) {
        log.error('[Setup] Automatic setup failed:', error.message);
    }
}
