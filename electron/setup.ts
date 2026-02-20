import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import log from 'electron-log';
import { getSettings } from './ipc/settings-handlers';

/**
 * Setup utility to ensure the app and extension work automatically after installation.
 */
export async function runSetup(): Promise<void> {
    const isDev = !app.isPackaged;

    try {
        const appPath = app.getPath('exe');
        const appDir = path.dirname(appPath);

        // Determine the root directory for resources
        // In dev: appDir is usually IDM/node_modules/electron/dist/ or similar, but electron-vite might change this
        // In prod: appDir is the installation folder, resources are in appDir/resources/
        let resourcesDir: string;
        if (isDev) {
            // In development, resources are typically in the project root
            resourcesDir = path.join(process.cwd());
        } else {
            resourcesDir = path.join(appDir, 'resources');
        }

        log.info(`[Setup] Detected resources directory: ${resourcesDir}`);

        // 1. Update Native Messaging Host Manifest
        // The manifest name is always com.idm.clone.json
        const manifestPath = path.join(resourcesDir, 'native-host', 'com.idm.clone.json');

        // The host executable name is fixed
        const possibleHostPaths = [
            path.join(resourcesDir, 'native-host', 'idm-native-host.exe'),
            path.join(resourcesDir, 'native-host', 'dist', 'idm-native-host.exe'), // Legacy/Dev fallback
        ];

        let hostExePath = '';
        for (const p of possibleHostPaths) {
            if (fs.existsSync(p)) {
                hostExePath = p;
                break;
            }
        }

        if (!hostExePath) {
            log.error('[Setup] Native messaging host executable NOT found in any expected location:', possibleHostPaths);
        } else if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

                // Ensure name is correct
                manifest.name = 'com.idm.clone';

                // Update path to absolute path
                if (manifest.path !== hostExePath) {
                    manifest.path = hostExePath;
                    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                    log.info('[Setup] Updated native messaging manifest path:', hostExePath);
                }
            } catch (e: any) {
                log.error('[Setup] Failed to parse/write manifest:', e.message);
            }
        } else {
            log.warn('[Setup] Native messaging manifest not found at:', manifestPath);
        }


        // 2. Register Native Messaging Host in Registry (if not in dev or if forced)
        // We update registry even in dev to help with testing, but only if paths exist
        if (fs.existsSync(manifestPath)) {
            const registryPaths = [
                'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.idm.clone',
                'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.idm.clone'
            ];

            for (const regPath of registryPaths) {
                try {
                    // Check if registry key already points to the correct location
                    let alreadyRegistered = false;
                    try {
                        const currentReg = execSync(`reg query "${regPath}" /ve`).toString();
                        if (currentReg.includes(manifestPath)) {
                            alreadyRegistered = true;
                        }
                    } catch { /* ignore error if key doesn't exist */ }

                    if (!alreadyRegistered) {
                        execSync(`reg add "${regPath}" /ve /t REG_SZ /d "${manifestPath}" /f`);
                        log.info(`[Setup] Registered native host at ${regPath}`);
                    }
                } catch (err: any) {
                    log.error(`[Setup] Failed to register native host at ${regPath}:`, err.message);
                }
            }
        }

        // 3. Ensure Auto-Start is enabled if settings say so
        const settings = getSettings();
        if (settings.autoStartOnBoot && !isDev) {
            const loginSettings = app.getLoginItemSettings();
            if (!loginSettings.openAtLogin) {
                app.setLoginItemSettings({
                    openAtLogin: true,
                    path: appPath
                });
                log.info('[Setup] Enabled auto-start at login');
            }
        }

    } catch (error: any) {
        log.error('[Setup] Automatic setup failed:', error.message);
    }
}
