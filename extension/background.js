/**
 * IDM Clone - Chrome Extension Background Service Worker
 *
 * Intercepts browser downloads and forwards them to the IDM Clone desktop app
 * via Chrome Native Messaging. Supports enable/disable toggle, file type filtering,
 * and minimum file size filtering.
 */

const NATIVE_HOST_NAME = 'com.idm.clone';
const STORAGE_KEY = 'idm_clone_settings';
const HISTORY_KEY = 'idm_clone_history';
const MAX_HISTORY = 50;

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  minFileSize: 1048576, // 1 MB
  fileTypes: [
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    '.exe', '.msi', '.dmg', '.iso', '.img',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
    '.mp3', '.flac', '.wav', '.aac', '.ogg',
    '.apk', '.deb', '.rpm', '.appimage',
    '.bin', '.dat', '.torrent'
  ],
  interceptAll: false // If true, intercept all downloads regardless of file type
};

// ─── State ───────────────────────────────────────────────────────────────────

let nativePort = null;
let settings = { ...DEFAULT_SETTINGS };
let recentDownloads = [];

// ─── Initialize ──────────────────────────────────────────────────────────────

// Load saved settings on startup
chrome.storage.local.get([STORAGE_KEY, HISTORY_KEY], (result) => {
  if (result[STORAGE_KEY]) {
    settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
  }
  if (result[HISTORY_KEY]) {
    recentDownloads = result[HISTORY_KEY];
  }
});

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEY].newValue };
  }
});

// ─── Native Messaging ───────────────────────────────────────────────────────

/**
 * Connect to the native messaging host.
 * Uses connectNative for persistent connection (keeps service worker alive).
 */
function connectNative() {
  if (nativePort) return nativePort;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);

    nativePort.onMessage.addListener((response) => {
      console.log('[IDM Clone] Native host response:', response);
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      console.log('[IDM Clone] Native host disconnected:', error?.message || 'unknown');
      nativePort = null;
    });

    console.log('[IDM Clone] Connected to native host');

    // Perform initial ping
    nativePort.postMessage({ type: 'PING' });

    return nativePort;
  } catch (err) {
    console.error('[IDM Clone] Failed to connect to native host:', err);
    nativePort = null;
    return null;
  }
}

/**
 * Perform a one-shot ping to verify host is alive
 */
function checkConnection(callback) {
  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { type: 'PING' }, (response) => {
      if (chrome.runtime.lastError || !response || response.status !== 'pong') {
        callback(false);
      } else {
        callback(true);
      }
    });
  } catch {
    callback(false);
  }
}

/**
 * Send a download request to the IDM Clone app via native messaging.
 */
function sendToIDM(downloadInfo) {
  const message = {
    url: downloadInfo.url,
    filename: downloadInfo.filename || null,
    referrer: downloadInfo.referrer || null,
    fileSize: downloadInfo.fileSize || 0,
    mime: downloadInfo.mime || null
  };

  // Try persistent connection first
  let port = connectNative();
  if (port) {
    try {
      port.postMessage(message);
      console.log('[IDM Clone] Sent to native host:', message.url);
      return true;
    } catch (err) {
      console.error('[IDM Clone] Failed to send via port:', err);
      nativePort = null;
    }
  }

  // Fall back to one-shot message
  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[IDM Clone] sendNativeMessage error:', chrome.runtime.lastError.message);
        showNotification('IDM Clone Error', 'Cannot connect to IDM Clone. Make sure the app is installed and the native host is registered.');
      } else {
        console.log('[IDM Clone] sendNativeMessage response:', response);
      }
    });
    return true;
  } catch (err) {
    console.error('[IDM Clone] Failed sendNativeMessage:', err);
    return false;
  }
}

// ─── Download Interception ───────────────────────────────────────────────────

/**
 * Main download interception via chrome.downloads API.
 */
chrome.downloads.onCreated.addListener((downloadItem) => {
  if (!settings.enabled) return;

  const url = downloadItem.url;
  const filename = downloadItem.filename || extractFilename(url);

  // Skip certain URLs
  if (shouldSkipUrl(url)) return;

  // Check file type filter
  if (!settings.interceptAll && !matchesFileType(filename)) return;

  // Check minimum file size (if known)
  if (downloadItem.fileSize > 0 && downloadItem.fileSize < settings.minFileSize) return;

  // Cancel Chrome's built-in download
  chrome.downloads.cancel(downloadItem.id, () => {
    // Remove from Chrome's download list
    chrome.downloads.erase({ id: downloadItem.id });
  });

  // Forward to IDM Clone
  const success = sendToIDM({
    url: url,
    filename: filename,
    referrer: downloadItem.referrer || '',
    fileSize: downloadItem.fileSize || 0,
    mime: downloadItem.mime || ''
  });

  // Add to history
  addToHistory({
    url,
    filename,
    timestamp: Date.now(),
    sent: success
  });

  console.log(`[IDM Clone] Intercepted: ${filename} (${url})`);
});

/**
 * Secondary interception via webRequest API.
 * Catches downloads triggered by Content-Disposition: attachment headers.
 */
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!settings.enabled) return;
    if (details.type !== 'main_frame' && details.type !== 'sub_frame') return;

    const headers = details.responseHeaders || [];

    // Check for Content-Disposition: attachment
    const contentDisp = headers.find(h => h.name.toLowerCase() === 'content-disposition');
    if (!contentDisp || !contentDisp.value) return;

    if (!contentDisp.value.toLowerCase().includes('attachment')) return;

    // Extract filename from Content-Disposition
    let filename = '';
    const filenameMatch = contentDisp.value.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
    if (filenameMatch) {
      filename = decodeURIComponent(filenameMatch[1]);
    }

    // Check file type
    if (!settings.interceptAll && filename && !matchesFileType(filename)) return;

    // Get content length
    const contentLen = headers.find(h => h.name.toLowerCase() === 'content-length');
    const fileSize = contentLen ? parseInt(contentLen.value || '0', 10) : 0;

    // Check min size
    if (fileSize > 0 && fileSize < settings.minFileSize) return;

    // Get MIME type
    const contentType = headers.find(h => h.name.toLowerCase() === 'content-type');
    const mime = contentType?.value?.split(';')[0]?.trim() || '';

    // Send to IDM
    sendToIDM({
      url: details.url,
      filename,
      referrer: details.initiator || '',
      fileSize,
      mime
    });

    addToHistory({
      url: details.url,
      filename: filename || extractFilename(details.url),
      timestamp: Date.now(),
      sent: true
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shouldSkipUrl(url) {
  // Skip blob:, data:, and chrome:// URLs
  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('chrome')) return true;
  // Skip very short URLs
  if (url.length < 10) return true;
  return false;
}

function matchesFileType(filename) {
  if (!filename) return false;
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return settings.fileTypes.includes(ext);
}

function extractFilename(url) {
  try {
    const parsedUrl = new URL(url);
    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      return decodeURIComponent(segments[segments.length - 1]);
    }
  } catch { /* ignore */ }
  return '';
}

function addToHistory(entry) {
  recentDownloads.unshift(entry);
  if (recentDownloads.length > MAX_HISTORY) {
    recentDownloads = recentDownloads.slice(0, MAX_HISTORY);
  }
  chrome.storage.local.set({ [HISTORY_KEY]: recentDownloads });
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message
  });
}

// ─── Message Handler (from popup) ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'TEST_CONNECTION':
      checkConnection((connected) => {
        sendResponse({ connected });
      });
      break;

    case 'GET_STATUS':
      checkConnection((connected) => {
        sendResponse({
          enabled: settings.enabled,
          connected: connected,
          recentDownloads: recentDownloads.slice(0, 10)
        });
      });
      break;

    case 'SET_ENABLED':
      settings.enabled = message.enabled;
      chrome.storage.local.set({ [STORAGE_KEY]: settings });
      sendResponse({ success: true });
      break;

    case 'GET_SETTINGS':
      sendResponse(settings);
      break;

    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message.settings };
      chrome.storage.local.set({ [STORAGE_KEY]: settings });
      sendResponse({ success: true });
      break;

    case 'TEST_CONNECTION':
      const port = connectNative();
      sendResponse({ connected: port !== null });
      break;
  }

  return true; // Keep message channel open for async responses
});
