import net from 'net';
import log from 'electron-log';
import { DownloadEngine } from '../download-engine/engine';
import { QueueManager } from '../download-engine/queue-manager';
import type { NativeMessage } from '../../shared/types';

const PIPE_NAME = '\\\\.\\pipe\\idm-clone';

/**
 * Named pipe server that receives download requests from the native messaging host.
 * On Windows, uses \\.\pipe\idm-clone.
 */
export class PipeServer {
  private server: net.Server | null = null;
  private engine: DownloadEngine;
  private queueManager: QueueManager;

  constructor(engine: DownloadEngine, queueManager: QueueManager) {
    this.engine = engine;
    this.queueManager = queueManager;
  }

  start(): void {
    if (this.server) return;

    this.server = net.createServer((socket) => {
      log.info('[PipeServer] Client connected');

      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString('utf-8');

        // Try to parse complete JSON messages (newline-delimited)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep any incomplete line

        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(line.trim(), socket);
          }
        }
      });

      socket.on('end', () => {
        // Process any remaining data in buffer
        if (buffer.trim()) {
          this.handleMessage(buffer.trim(), socket);
        }
        log.info('[PipeServer] Client disconnected');
      });

      socket.on('error', (err) => {
        log.error('[PipeServer] Socket error:', err.message);
      });
    });

    this.server.listen(PIPE_NAME, () => {
      log.info(`[PipeServer] Listening on ${PIPE_NAME}`);
    });

    this.server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Another instance is running — try to clean up stale pipe
        log.warn('[PipeServer] Pipe already in use, attempting cleanup...');
        const client = net.connect(PIPE_NAME, () => {
          // Pipe is actively used by another process
          client.end();
          log.error('[PipeServer] Another instance is already running');
        });
        client.on('error', () => {
          // Pipe is stale — remove and retry
          this.server?.close();
          setTimeout(() => this.start(), 1000);
        });
      } else {
        log.error('[PipeServer] Server error:', err.message);
      }
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      log.info('[PipeServer] Stopped');
    }
  }

  private async handleMessage(raw: string, socket: net.Socket): Promise<void> {
    try {
      const message: NativeMessage = JSON.parse(raw);
      log.info(`[PipeServer] Received download request: ${message.url}`);

      // Add the download
      const item = await this.engine.addDownload({
        url: message.url,
        filename: message.filename,
        referrer: message.referrer
      });

      // Enqueue for download
      await this.queueManager.enqueue(item.id);

      // Send acknowledgment back
      const ack = JSON.stringify({ success: true, id: item.id, filename: item.filename });
      socket.write(ack + '\n');
    } catch (error: any) {
      log.error('[PipeServer] Failed to handle message:', error.message);
      try {
        socket.write(JSON.stringify({ success: false, error: error.message }) + '\n');
      } catch { /* ignore */ }
    }
  }
}
