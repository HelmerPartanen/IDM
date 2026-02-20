/**
 * Format bytes into human-readable string (e.g. "1.50 GB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (!bytes || isNaN(bytes)) return '—';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format speed in bytes/sec into human-readable string (e.g. "12.5 MB/s").
 */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return formatBytes(bytesPerSec) + '/s';
}

/**
 * Format seconds into human-readable ETA string (e.g. "1h 23m 45s").
 */
export function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '—';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format a timestamp into a readable date string.
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Get progress percentage (0-100).
 */
export function getProgress(downloaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

/**
 * Get file extension from filename.
 */
export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(dot + 1).toLowerCase() : '';
}

/**
 * Get icon name and color for a file extension category.
 */
export function getFileTypeInfo(filename: string): { icon: string; color: string; bgColor: string } {
  const ext = getFileExtension(filename);

  const categories: Record<string, { icon: string; color: string; bgColor: string }> = {
    // Archives
    zip:  { icon: 'archive', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
    rar:  { icon: 'archive', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
    '7z': { icon: 'archive', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
    tar:  { icon: 'archive', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
    gz:   { icon: 'archive', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
    // Executables
    exe:  { icon: 'app', color: 'text-accent', bgColor: 'bg-accent-subtle' },
    msi:  { icon: 'app', color: 'text-accent', bgColor: 'bg-accent-subtle' },
    dmg:  { icon: 'app', color: 'text-accent', bgColor: 'bg-accent-subtle' },
    // Documents
    pdf:  { icon: 'doc', color: 'text-semantic-error', bgColor: 'bg-semantic-error-subtle' },
    doc:  { icon: 'doc', color: 'text-accent', bgColor: 'bg-accent-subtle' },
    docx: { icon: 'doc', color: 'text-accent', bgColor: 'bg-accent-subtle' },
    xls:  { icon: 'doc', color: 'text-semantic-success', bgColor: 'bg-semantic-success-subtle' },
    xlsx: { icon: 'doc', color: 'text-semantic-success', bgColor: 'bg-semantic-success-subtle' },
    // Video
    mp4:  { icon: 'video', color: 'text-semantic-purple', bgColor: 'bg-semantic-purple-subtle' },
    mkv:  { icon: 'video', color: 'text-semantic-purple', bgColor: 'bg-semantic-purple-subtle' },
    avi:  { icon: 'video', color: 'text-semantic-purple', bgColor: 'bg-semantic-purple-subtle' },
    mov:  { icon: 'video', color: 'text-semantic-purple', bgColor: 'bg-semantic-purple-subtle' },
    webm: { icon: 'video', color: 'text-semantic-purple', bgColor: 'bg-semantic-purple-subtle' },
    // Audio
    mp3:  { icon: 'audio', color: 'text-pink-400', bgColor: 'bg-pink-400/10' },
    flac: { icon: 'audio', color: 'text-pink-400', bgColor: 'bg-pink-400/10' },
    wav:  { icon: 'audio', color: 'text-pink-400', bgColor: 'bg-pink-400/10' },
    // Images
    jpg:  { icon: 'image', color: 'text-semantic-info', bgColor: 'bg-semantic-info-subtle' },
    jpeg: { icon: 'image', color: 'text-semantic-info', bgColor: 'bg-semantic-info-subtle' },
    png:  { icon: 'image', color: 'text-semantic-info', bgColor: 'bg-semantic-info-subtle' },
    gif:  { icon: 'image', color: 'text-semantic-info', bgColor: 'bg-semantic-info-subtle' },
    svg:  { icon: 'image', color: 'text-semantic-info', bgColor: 'bg-semantic-info-subtle' },
    webp: { icon: 'image', color: 'text-semantic-info', bgColor: 'bg-semantic-info-subtle' },
    // Disc images
    iso:  { icon: 'disc', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
    img:  { icon: 'disc', color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle' },
  };

  return categories[ext] || { icon: 'file', color: 'text-label-tertiary', bgColor: 'bg-surface-glass' };
}

/**
 * Get status display properties.
 */
export function getStatusDisplay(status: string): { label: string; color: string; bgColor: string; dotColor: string } {
  const map: Record<string, { label: string; color: string; bgColor: string; dotColor: string }> = {
    pending:     { label: 'Pending',     color: 'text-label-tertiary',   bgColor: 'bg-surface-glass',           dotColor: 'bg-label-quaternary' },
    queued:      { label: 'Queued',      color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle', dotColor: 'bg-semantic-warning' },
    downloading: { label: 'Active',      color: 'text-accent',          bgColor: 'bg-accent-subtle',           dotColor: 'bg-accent' },
    paused:      { label: 'Paused',      color: 'text-semantic-warning', bgColor: 'bg-semantic-warning-subtle', dotColor: 'bg-semantic-warning' },
    completed:   { label: 'Done',        color: 'text-semantic-success', bgColor: 'bg-semantic-success-subtle', dotColor: 'bg-semantic-success' },
    error:       { label: 'Failed',      color: 'text-semantic-error',   bgColor: 'bg-semantic-error-subtle',   dotColor: 'bg-semantic-error' },
    merging:     { label: 'Merging',     color: 'text-semantic-purple',  bgColor: 'bg-semantic-purple-subtle',  dotColor: 'bg-semantic-purple' },
    verifying:   { label: 'Verifying',   color: 'text-semantic-info',    bgColor: 'bg-semantic-info-subtle',    dotColor: 'bg-semantic-info' },
    scheduled:   { label: 'Scheduled',   color: 'text-semantic-purple',  bgColor: 'bg-semantic-purple-subtle',  dotColor: 'bg-semantic-purple' },
  };
  return map[status] || { label: status, color: 'text-label-tertiary', bgColor: 'bg-surface-glass', dotColor: 'bg-label-quaternary' };
}
