/**
 * IDM Clone Native Messaging Host
 *
 * This is a lightweight standalone script that bridges Chrome's native messaging
 * protocol to the IDM Clone Electron app via a Windows named pipe.
 *
 * Chrome communicates with this host using length-prefixed JSON over stdin/stdout.
 * This host forwards messages to the Electron app over \\.\pipe\idm-clone.
 *
 * Compile to .exe with: npx pkg dist/host.js --targets node18-win-x64 --output dist/idm-native-host.exe
 */

import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';

const PIPE_NAME = '\\\\.\\pipe\\idm-clone';
const LOG_FILE = path.join(process.env.LOCALAPPDATA || '', 'idm-clone-host.log');

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, entry);
  } catch {
    // Ignore logging errors
  }
}
log('Native host started');

// ─── Native Messaging Protocol ───────────────────────────────────────────────

/**
 * Read a native messaging message from stdin.
 * Format: 4-byte uint32 LE length + JSON body
 */
function readMessage(): Promise<any> {
  return new Promise((resolve, reject) => {
    // Read 4-byte length header
    const readLength = () => {
      const lengthBuf = process.stdin.read(4);
      if (!lengthBuf) {
        // No data available yet - wait for readable
        process.stdin.once('readable', readLength);
        return;
      }

      const msgLength = lengthBuf.readUInt32LE(0);
      if (msgLength <= 0 || msgLength > 1024 * 1024) {
        reject(new Error(`Invalid message length: ${msgLength}`));
        return;
      }

      // Read the JSON body
      const readBody = () => {
        const body = process.stdin.read(msgLength);
        if (!body) {
          process.stdin.once('readable', readBody);
          return;
        }

        try {
          const message = JSON.parse(body.toString('utf-8'));
          resolve(message);
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err}`));
        }
      };

      readBody();
    };

    readLength();
  });
}

/**
 * Write a native messaging message to stdout.
 * Format: 4-byte uint32 LE length + JSON body
 */
function writeMessage(message: object): void {
  const json = JSON.stringify(message);
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(json.length, 0);

  process.stdout.write(buf);
  process.stdout.write(json);
}

// ─── Pipe Communication ──────────────────────────────────────────────────────

/**
 * Send a message to the IDM Clone app via named pipe.
 * Returns the app's response.
 */
function sendToPipe(message: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = net.connect(PIPE_NAME, () => {
      const json = JSON.stringify(message) + '\n';
      client.write(json);
    });

    let responseData = '';

    client.on('data', (data) => {
      responseData += data.toString('utf-8');
    });

    client.on('end', () => {
      try {
        const lines = responseData.trim().split('\n');
        const lastLine = lines[lines.length - 1];
        resolve(JSON.parse(lastLine));
      } catch {
        resolve({ success: true });
      }
      client.destroy();
    });

    client.on('error', (err: any) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        // IDM Clone app is not running — try to launch it
        log('Named pipe connection refused - app might not be running');
        reject(new Error('IDM Clone is not running'));
      } else {
        log(`Pipe connection error: ${err.message}`);
        reject(err);
      }
    });

    // Timeout after 10 seconds
    client.setTimeout(10000, () => {
      client.destroy();
      log('Pipe connection timeout');
      reject(new Error('Pipe connection timeout'));
    });
  });
}

/**
 * Try to launch the IDM Clone Electron app.
 */
function launchElectronApp(): void {
  // Look for the app in common locations
  const possiblePaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'download-manager', 'Download Manager.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Download Manager', 'Download Manager.exe'),
    path.join(path.dirname(process.execPath), 'Download Manager.exe'),
    path.join(path.dirname(process.execPath), '..', 'Download Manager.exe'),
    path.join(path.dirname(process.execPath), '..', '..', 'Download Manager.exe')
  ];

  log(`Searching for Electron app in ${possiblePaths.length} locations...`);

  for (const appPath of possiblePaths) {
    if (fs.existsSync(appPath)) {
      try {
        log(`Launching Electron app at: ${appPath}`);
        execFile(appPath, { detached: true, stdio: 'ignore' } as any).unref();
        return;
      } catch (err: any) {
        log(`Failed to launch ${appPath}: ${err.message}`);
      }
    }
  }
  log('Could not find Electron app executable');
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Set stdin to raw binary mode
  process.stdin.resume();

  // Continuously read messages from Chrome
  while (true) {
    try {
      const message = await readMessage();

      // Handle PING message for connection testing
      if (message.type === 'PING') {
        writeMessage({ success: true, status: 'pong' });
        continue;
      }

      try {
        const response = await sendToPipe(message);
        writeMessage(response);
      } catch (pipeErr: any) {
        // App might not be running — try to launch it
        if (pipeErr.message.includes('not running')) {
          launchElectronApp();

          // Wait 3 seconds for the app to start, then retry
          await new Promise(r => setTimeout(r, 3000));

          try {
            const response = await sendToPipe(message);
            writeMessage(response);
          } catch {
            writeMessage({ success: false, error: 'IDM Clone app is not running. Please start it manually.' });
          }
        } else {
          writeMessage({ success: false, error: pipeErr.message });
        }
      }
    } catch (readErr: any) {
      // stdin closed or error — exit gracefully
      process.exit(0);
    }
  }
}

main().catch(() => process.exit(1));
