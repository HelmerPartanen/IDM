import React, { useState } from 'react';
import { X, Link2, FileText, FolderOpen, Layers, AlertCircle, Loader2 } from 'lucide-react';
import { useDownloadStore } from '../store/useDownloadStore';

export function AddDownloadDialog() {
  const showAddDialog = useDownloadStore(s => s.showAddDialog);
  const setShowAddDialog = useDownloadStore(s => s.setShowAddDialog);
  const settings = useDownloadStore(s => s.settings);

  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [savePath, setSavePath] = useState('');
  const [threads, setThreads] = useState(settings?.maxThreadsPerDownload || 8);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!showAddDialog) return null;

  const handleSelectFolder = async () => {
    const folder = await window.api.selectFolder();
    if (folder) setSavePath(folder);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    try {
      new URL(url.trim());
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await window.api.addDownload({
        url: url.trim(),
        filename: filename.trim() || undefined,
        savePath: savePath.trim() || undefined,
        threads
      });

      if (result.success) {
        setUrl('');
        setFilename('');
        setSavePath('');
        setShowAddDialog(false);
      } else {
        setError(result.error || 'Failed to add download');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add download');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setFilename('');
    setSavePath('');
    setError('');
    setShowAddDialog(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={handleClose}>
      <div
        className="bg-surface-2 border border-surface-glass-border rounded-2xl shadow-glass-lg w-[480px] max-w-[90vw] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-[15px] font-bold text-label-primary font-display">New Download</h2>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-label-tertiary hover:text-label-primary hover:bg-surface-glass-hover transition-apple"
          >
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-surface-glass-border mx-6" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <InputField
            icon={<Link2 size={15} />}
            label="Download URL"
            value={url}
            onChange={setUrl}
            placeholder="https://example.com/file.zip"
            autoFocus
          />

          <InputField
            icon={<FileText size={15} />}
            label="Filename"
            value={filename}
            onChange={setFilename}
            placeholder="Auto-detected from URL"
            optional
          />

          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-1.5">
              <FolderOpen size={13} className="text-label-tertiary" />
              Save to
              <span className="text-label-quaternary font-normal">· optional</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder={settings?.downloadFolder || 'Default folder'}
                className="flex-1 bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
                  text-[13px] text-label-primary placeholder-label-quaternary
                  focus:border-accent/40 focus:bg-surface-glass-hover transition-apple outline-none"
              />
              <button
                type="button"
                onClick={handleSelectFolder}
                className="px-3.5 py-2.5 bg-surface-glass border border-surface-glass-border rounded-xl
                  text-[13px] text-label-secondary hover:text-label-primary hover:bg-surface-glass-hover
                  hover:border-surface-glass-border-hover transition-apple active:scale-[0.97]"
              >
                Browse
              </button>
            </div>
          </div>

          {/* Threads slider */}
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-2.5">
              <Layers size={13} className="text-label-tertiary" />
              Connections
              <span className="ml-auto text-accent font-semibold tabular-nums">{threads}</span>
            </label>
            <input
              type="range"
              min={1}
              max={32}
              value={threads}
              onChange={(e) => setThreads(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-label-quaternary mt-1.5 px-0.5">
              <span>1</span>
              <span>8</span>
              <span>16</span>
              <span>32</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-[13px] text-semantic-error bg-semantic-error-subtle px-3.5 py-2.5 rounded-xl">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-[13px] font-medium text-label-secondary hover:text-label-primary
                rounded-xl hover:bg-surface-glass-hover transition-apple"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-accent hover:bg-accent-hover text-black text-[13px] font-semibold
                rounded-xl transition-apple shadow-glass-sm active:scale-[0.97]
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center gap-2"
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isSubmitting ? 'Starting…' : 'Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InputField({
  icon, label, value, onChange, placeholder, autoFocus, optional
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-1.5">
        <span className="text-label-tertiary">{icon}</span>
        {label}
        {optional && <span className="text-label-quaternary font-normal">· optional</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
          text-[13px] text-label-primary placeholder-label-quaternary
          focus:border-accent/40 focus:bg-surface-glass-hover transition-apple outline-none"
      />
    </div>
  );
}
