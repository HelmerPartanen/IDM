import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Verify if the native messaging host is correctly registered in the registry.
 */
function verifyRegistry() {
    const keys = [
        'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.idm.clone',
        'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.idm.clone'
    ];

    console.log('--- Registry Verification ---');
    for (const key of keys) {
        try {
            const output = execSync(`reg query "${key}" /ve`).toString();
            console.log(`[PASS] ${key} exists`);
            console.log(output);
        } catch (err: any) {
            console.log(`[FAIL] ${key} not found or error: ${err.message}`);
        }
    }
}

/**
 * Verify if the manifest file exists and has correct content (placeholder check).
 */
function verifyManifest() {
    const manifestPath = './native-host/com.idm.clone.json';
    console.log('\n--- Manifest Verification ---');
    if (fs.existsSync(manifestPath)) {
        const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        console.log(`[PASS] Manifest found at ${manifestPath}`);
        console.log(`Path: ${content.path}`);
        console.log(`Allowed Origins: ${content.allowed_origins}`);
    } else {
        console.log(`[FAIL] Manifest not found at ${manifestPath}`);
    }
}

verifyRegistry();
verifyManifest();
