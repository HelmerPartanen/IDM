import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownToLine } from 'lucide-react';
import { useDownloadStore } from '../store/useDownloadStore';
import { DownloadRow } from './DownloadRow';

export function DownloadList() {
  const filteredDownloads = useDownloadStore(s => s.filteredDownloads);
  const downloads = filteredDownloads();
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: downloads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 5
  });

  if (downloads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center animate-fade-in">
        <div className="text-center max-w-[280px]">
          <div className="w-16 h-16 rounded-3xl bg-surface-2 mx-auto mb-5 flex items-center justify-center">
            <ArrowDownToLine size={28} className="text-label-quaternary" />
          </div>
          <p className="text-[15px] font-semibold text-label-primary mb-1.5 font-display">No downloads yet</p>
          <p className="text-[13px] text-label-tertiary leading-relaxed">
            Click "Add URL" to start a download, or install the Chrome extension to capture them automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Column headers */}
      <div className="flex items-center px-4 py-2 border-b border-surface-glass-border
        text-[11px] text-label-quaternary font-medium uppercase tracking-widest flex-shrink-0 font-display">
        <div className="w-9 mr-3 flex-shrink-0" /> {/* icon space */}
        <div className="flex-1 min-w-0">Name</div>
        <div className="w-[180px] px-3 flex-shrink-0">Progress</div>
        <div className="w-[80px] text-right px-2 flex-shrink-0">Speed</div>
        <div className="w-[64px] text-right px-2 flex-shrink-0">ETA</div>
        <div className="w-[72px] px-2 flex-shrink-0">Status</div>
        <div className="w-[80px] pl-1 flex-shrink-0" />
      </div>

      {/* Virtualized list */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`
              }}
            >
              <DownloadRow item={downloads[virtualItem.index]} />
              {virtualItem.index < downloads.length - 1 && (
                <div className="mx-6 h-px bg-surface-3 my-0" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
