/**
 * IDM Clone Extension - Popup Script
 * Controls the popup UI for enabling/disabling interception and viewing recent captures.
 */

// Elements
const toggleEl = document.getElementById('toggle');
const toggleLabelEl = document.getElementById('toggle-label');
const statusDotEl = document.getElementById('status-dot');
const statusTextEl = document.getElementById('status-text');
const downloadListEl = document.getElementById('download-list');
const testBtnEl = document.getElementById('test-btn');
const minSizeEl = document.getElementById('min-size');
const interceptAllToggleEl = document.getElementById('intercept-all-toggle');

// ─── Load Status ─────────────────────────────────────────────────────────────

function loadStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (!response) return;

    // Toggle state
    updateToggle(response.enabled);

    // Connection status
    updateConnectionStatus(response.connected);

    // Recent downloads
    renderDownloadList(response.recentDownloads || []);
  });

  // Load settings
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
    if (!response) return;

    minSizeEl.value = Math.round((response.minFileSize || 1048576) / 1048576);

    if (response.interceptAll) {
      interceptAllToggleEl.classList.add('active');
    }
  });
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

function updateToggle(enabled) {
  if (enabled) {
    toggleEl.classList.add('active');
    toggleLabelEl.textContent = 'Active';
  } else {
    toggleEl.classList.remove('active');
    toggleLabelEl.textContent = 'Disabled';
  }
}

toggleEl.addEventListener('click', () => {
  const isActive = toggleEl.classList.contains('active');
  const newState = !isActive;

  chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: newState }, () => {
    updateToggle(newState);
  });
});

// ─── Connection Status ───────────────────────────────────────────────────────

function updateConnectionStatus(connected) {
  statusDotEl.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
  statusTextEl.textContent = connected ? 'Connected to IDM Clone' : 'Not connected';
}

// ─── Test Connection ─────────────────────────────────────────────────────────

testBtnEl.addEventListener('click', () => {
  testBtnEl.textContent = 'Testing...';
  testBtnEl.disabled = true;

  chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' }, (response) => {
    updateConnectionStatus(response?.connected || false);
    testBtnEl.textContent = response?.connected
      ? '✓ Connection successful!'
      : '✕ Connection failed';

    setTimeout(() => {
      testBtnEl.textContent = 'Test Connection to IDM Clone';
      testBtnEl.disabled = false;
    }, 2000);
  });
});

// ─── Settings ────────────────────────────────────────────────────────────────

minSizeEl.addEventListener('change', () => {
  const mb = parseInt(minSizeEl.value) || 1;
  chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { minFileSize: mb * 1048576 }
  });
});

interceptAllToggleEl.addEventListener('click', () => {
  const isActive = interceptAllToggleEl.classList.contains('active');
  const newState = !isActive;

  if (newState) {
    interceptAllToggleEl.classList.add('active');
  } else {
    interceptAllToggleEl.classList.remove('active');
  }

  chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { interceptAll: newState }
  });
});

// ─── Download List ───────────────────────────────────────────────────────────

function renderDownloadList(downloads) {
  if (downloads.length === 0) {
    downloadListEl.innerHTML = '<div class="empty-state">No downloads captured yet</div>';
    return;
  }

  downloadListEl.innerHTML = downloads.map(dl => {
    const filename = dl.filename || extractFilename(dl.url) || 'Unknown file';
    const timeAgo = getTimeAgo(dl.timestamp);

    return `
      <div class="download-item" title="${escapeHtml(dl.url)}">
        <span class="download-icon">📄</span>
        <div class="download-info">
          <div class="download-filename">${escapeHtml(filename)}</div>
          <div class="download-url">${escapeHtml(dl.url)}</div>
        </div>
        <span class="download-time">${timeAgo}</span>
        <span class="download-status ${dl.sent ? 'sent' : 'failed'}">${dl.sent ? 'Sent' : 'Failed'}</span>
      </div>
    `;
  }).join('');
}

function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : '';
  } catch {
    return '';
  }
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Init ────────────────────────────────────────────────────────────────────

loadStatus();
