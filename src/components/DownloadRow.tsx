import React from 'react';
import {
  Pause, Play, RotateCcw, FolderOpen, X, Trash2,
  ArrowDownToLine
} from 'lucide-react';
import type { DownloadItem } from '../../shared/types';
import { useDownloadActions } from '../hooks/useIpc';
import { useDownloadStore } from '../store/useDownloadStore';
import {
  formatBytes, formatSpeed, formatEta, getProgress,
  getFileTypeInfo, getStatusDisplay
} from '../utils/format';
import { FileIcon } from './FileIcon';



interface DownloadRowProps {
  item: DownloadItem;
  style?: React.CSSProperties;
}

export function DownloadRow({ item, style }: DownloadRowProps) {
  const { pauseDownload, resumeDownload, cancelDownload, retryDownload, deleteDownload, openFile, openFolder } = useDownloadActions();
  const selectedIds = useDownloadStore(s => s.selectedIds);
  const toggleSelected = useDownloadStore(s => s.toggleSelected);

  const isSelected = selectedIds.has(item.id);
  const isCompleted = item.status === 'completed';
  const progress = isCompleted ? 100 : getProgress(item.downloadedBytes, item.totalSize);
  const statusDisplay = getStatusDisplay(item.status);
  const fileType = getFileTypeInfo(item.filename);

  const isActive = item.status === 'downloading';
  const isPaused = item.status === 'paused';
  const isError = item.status === 'error';

  return (
    <div
      style={style}
      className={`
        group flex items-center px-4 py-3 mx-2 my-1 rounded-xl transition-apple cursor-pointer
        ${isSelected
          ? 'bg-surface-3'
          : 'hover:bg-surface-glass-hover'
        }
      `}
      onClick={() => toggleSelected(item.id)}
      onDoubleClick={() => isCompleted && openFile(item.id)}
    >
      {/* File type icon */}
      <div className="w-6 h-6 rounded-xl flex items-center justify-center flex-shrink-0 mr-3">
        <FileIcon filename={item.filename} url={item.url} size={36} />
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-[13px] font-medium text-label-primary truncate leading-tight" title={item.filename}>
          {item.filename}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-label-quaternary truncate max-w-[200px]" title={item.url}>
            {item.url.replace(/^https?:\/\//, '').split('/')[0]}
          </span>
          {item.totalSize > 0 && (
            <>
              <span className="text-label-quaternary text-[10px]">·</span>
              <span className="text-[11px] text-label-tertiary tabular-nums">
                {formatBytes(item.downloadedBytes)}{' / '}{formatBytes(item.totalSize)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Progress column */}
      <div className="w-[180px] px-3 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-[5px] rounded-full bg-surface-4 overflow-hidden relative">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-apple
                ${isActive ? 'progress-active' :
                  isCompleted ? 'bg-semantic-success' :
                    isPaused ? 'bg-semantic-warning' :
                      isError ? 'bg-semantic-error' :
                        'bg-label-quaternary'
                }
              `}
              style={{ width: `${progress}%` }}
            />
            {isActive && (
              <div className="absolute inset-0 rounded-full opacity-30 blur-[3px]"
                style={{
                  background: `linear-gradient(90deg, transparent, #0A84FF ${progress}%, transparent ${progress}%)`,
                }}
              />
            )}
          </div>
          <span className="text-[11px] font-medium text-label-secondary tabular-nums w-[34px] text-right">
            {progress}%
          </span>
        </div>
      </div>

      {/* Speed */}
      <div className="w-[80px] text-right flex-shrink-0 px-2">
        {isActive ? (
          <span className="text-[12px] font-medium text-accent tabular-nums flex items-center justify-end gap-1">
            <ArrowDownToLine size={11} />
            {formatSpeed(item.speed)}
          </span>
        ) : (
          <span className="text-[12px] text-label-quaternary">—</span>
        )}
      </div>

      {/* ETA */}
      <div className="w-[64px] text-right flex-shrink-0 px-2">
        <span className="text-[12px] text-label-tertiary tabular-nums">
          {isActive ? formatEta(item.eta) : '—'}
        </span>
      </div>

      {/* Status */}
      <div className="w-[72px] flex-shrink-0 px-2">
        <span className={`
          inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] font-medium
          ${statusDisplay.color} ${statusDisplay.bgColor}
        `}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDisplay.dotColor} ${isActive ? 'animate-pulse-glow' : ''}`} />
          {statusDisplay.label}
        </span>
      </div>

      {/* Actions — appear on hover */}
      <div
        className="flex items-center gap-0.5 pl-1 opacity-0 group-hover:opacity-100 transition-apple"
        onClick={(e) => e.stopPropagation()}
      >
        {isActive && (
          <ActionBtn onClick={() => pauseDownload(item.id)} title="Pause">
            <Pause size={14} />
          </ActionBtn>
        )}
        {isPaused && (
          <ActionBtn onClick={() => resumeDownload(item.id)} title="Resume" accent>
            <Play size={14} />
          </ActionBtn>
        )}
        {isError && (
          <ActionBtn onClick={() => retryDownload(item.id)} title="Retry" accent>
            <RotateCcw size={14} />
          </ActionBtn>
        )}
        {isCompleted && (
          <ActionBtn onClick={() => openFolder(item.id)} title="Show in Folder">
            <FolderOpen size={14} />
          </ActionBtn>
        )}
        {(isActive || isPaused) && (
          <ActionBtn onClick={() => cancelDownload(item.id)} title="Cancel" danger>
            <X size={14} />
          </ActionBtn>
        )}
        {(isCompleted || isError) && (
          <ActionBtn onClick={() => deleteDownload(item.id)} title="Remove" danger>
            <Trash2 size={13} />
          </ActionBtn>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  onClick, title, children, accent, danger
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`
        p-1.5 rounded-lg transition-apple active:scale-90
        ${danger
          ? 'text-label-tertiary hover:text-semantic-error hover:bg-semantic-error-subtle'
          : accent
            ? 'text-label-tertiary hover:text-accent hover:bg-accent-subtle'
            : 'text-label-tertiary hover:text-label-primary hover:bg-surface-glass-hover'
        }
      `}
    >
      {children}
    </button>
  );
}
