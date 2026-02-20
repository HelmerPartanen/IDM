import React from 'react';
import {
  Plus, PauseCircle, PlayCircle, Trash2, Search, X,
  Settings, ArrowDown, Minus
} from 'lucide-react';
import { useDownloadStore } from '../store/useDownloadStore';
import { useDownloadActions } from '../hooks/useIpc';
import { formatSpeed } from '../utils/format';

export function Toolbar() {
  const setShowAddDialog = useDownloadStore(s => s.setShowAddDialog);
  const setShowSettings = useDownloadStore(s => s.setShowSettings);
  const downloads = useDownloadStore(s => s.downloads);
  const searchQuery = useDownloadStore(s => s.searchQuery);
  const setSearchQuery = useDownloadStore(s => s.setSearchQuery);
  const globalSpeed = useDownloadStore(s => s.globalSpeed);
  const { pauseDownload, resumeDownload, deleteDownload } = useDownloadActions();

  const activeDownloads = downloads.filter(d => d.status === 'downloading' || d.status === 'queued');
  const pausedDownloads = downloads.filter(d => d.status === 'paused');
  const completedDownloads = downloads.filter(d => d.status === 'completed');

  const handlePauseAll = async () => {
    for (const d of activeDownloads) {
      await pauseDownload(d.id);
    }
  };

  const handleResumeAll = async () => {
    for (const d of pausedDownloads) {
      await resumeDownload(d.id);
    }
  };

  const handleDeleteCompleted = async () => {
    for (const d of completedDownloads) {
      await deleteDownload(d.id);
    }
  };

  return (
    <div className="h-12 pl-4 pr-[140px] flex items-center gap-2">
      {/* Add button — primary CTA */}
      <button
        onClick={() => setShowAddDialog(true)}
        className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover active:scale-[0.97]
          text-black pl-2.5 pr-3.5 py-[6px] rounded-lg text-[13px] font-semibold
          transition-apple shadow-glass-sm"
      >
        <Plus size={15} strokeWidth={2.5} />
        Add URL
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-surface-glass-border mx-1" />

      {/* Action group */}
      <ToolbarButton
        onClick={handlePauseAll}
        disabled={activeDownloads.length === 0}
        icon={<PauseCircle size={15} />}
        label="Pause All"
      />
      <ToolbarButton
        onClick={handleResumeAll}
        disabled={pausedDownloads.length === 0}
        icon={<PlayCircle size={15} />}
        label="Resume All"
      />
      <ToolbarButton
        onClick={handleDeleteCompleted}
        disabled={completedDownloads.length === 0}
        icon={<Trash2 size={14} />}
        label="Clear Done"
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Speed pill */}
      {globalSpeed > 0 && (
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-accent
          bg-accent-subtle px-3 py-1 rounded-full tabular-nums">
          <ArrowDown size={12} strokeWidth={2.5} />
          {formatSpeed(globalSpeed)}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-label-quaternary pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search…"
          className="bg-surface-glass border border-surface-glass-border rounded-lg
            pl-8 pr-7 py-[5px] text-[13px] text-label-primary placeholder-label-quaternary
            w-44 focus:w-56 focus:border-accent/40 focus:bg-surface-glass-hover
            transition-all duration-300 ease-apple outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-label-quaternary
              hover:text-label-secondary transition-apple p-0.5 rounded"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Settings */}
      <button
        onClick={() => setShowSettings(true)}
        className="p-1.5 rounded-lg text-label-tertiary hover:text-label-primary
          hover:bg-surface-glass-hover transition-apple active:scale-95"
        title="Settings"
      >
        <Settings size={16} strokeWidth={1.8} />
      </button>

      {/* Minimize */}
      <button
        onClick={() => window.api.minimizeToTray()}
        className="p-1.5 rounded-lg text-label-quaternary hover:text-label-secondary
          hover:bg-surface-glass-hover transition-apple active:scale-95 ml-1"
        title="Minimize to Tray"
      >
        <Minus size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

function ToolbarButton({
  onClick, disabled, icon, label
}: {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 text-[13px] font-medium text-label-secondary
        hover:text-label-primary disabled:text-label-quaternary
        disabled:cursor-not-allowed px-2.5 py-[5px] rounded-lg
        hover:bg-surface-glass-hover active:bg-surface-glass-active
        active:scale-[0.97] transition-apple"
      title={label}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}
