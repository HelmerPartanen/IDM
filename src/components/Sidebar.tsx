import React from 'react';
import {
  LayoutList, ArrowDownToLine, CheckCircle2, Pause, Clock,
  AlertCircle, CalendarClock, Zap, ArrowDown
} from 'lucide-react';
import { useDownloadStore, FilterCategory } from '../store/useDownloadStore';
import { formatSpeed } from '../utils/format';

const categories: { key: FilterCategory; label: string; icon: React.ReactNode }[] = [
  { key: 'all',         label: 'All Downloads',  icon: <LayoutList size={16} /> },
  { key: 'downloading', label: 'Active',          icon: <ArrowDownToLine size={16} /> },
  { key: 'completed',   label: 'Completed',       icon: <CheckCircle2 size={16} /> },
  { key: 'paused',      label: 'Paused',          icon: <Pause size={16} /> },
  { key: 'queued',      label: 'Queued',           icon: <Clock size={16} /> },
  { key: 'error',       label: 'Failed',           icon: <AlertCircle size={16} /> },
  { key: 'scheduled',   label: 'Scheduled',        icon: <CalendarClock size={16} /> },
];

export function Sidebar() {
  const filter = useDownloadStore(s => s.filter);
  const setFilter = useDownloadStore(s => s.setFilter);
  const getCounts = useDownloadStore(s => s.getCounts);
  const globalSpeed = useDownloadStore(s => s.globalSpeed);

  const counts = getCounts();

  return (
    <aside className="w-[220px] bg-surface-1/80 backdrop-blur-glass border-r border-surface-glass-border flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 pt-5 pb-4 drag-region">
        <div className="no-drag flex items-center gap-2.5">
          <img src="/favicon.ico" alt="" className="w-7 h-7" draggable={false} />
          <div>
            <p className="text-[13px] font-semibold text-label-primary tracking-tight leading-none">Download Manager</p>
            {globalSpeed > 0 && (
              <p className="text-[11px] text-accent font-medium mt-1 flex items-center gap-1">
                <ArrowDown size={10} />
                {formatSpeed(globalSpeed)}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-1 overflow-y-auto">
        <div className="space-y-0.5">
          {categories.map(cat => {
            const isActive = filter === cat.key;
            const count = counts[cat.key];

            return (
              <button
                key={cat.key}
                onClick={() => setFilter(cat.key)}
                className={`
                  w-full flex items-center justify-between px-3 py-[7px] rounded-lg text-[13px]
                  transition-apple group relative
                  ${isActive
                    ? 'bg-surface-glass-active text-label-primary shadow-glass-sm'
                    : 'text-label-secondary hover:bg-surface-glass-hover hover:text-label-primary'
                  }
                `}
              >
                <span className="flex items-center gap-2.5">
                  <span className={`${isActive ? 'text-accent' : 'text-label-tertiary group-hover:text-label-secondary'} transition-apple`}>
                    {cat.icon}
                  </span>
                  <span className="font-medium">{cat.label}</span>
                </span>
                {count > 0 && (
                  <span className={`
                    text-[11px] font-medium tabular-nums min-w-[20px] text-center
                    px-1.5 py-px rounded-full
                    ${isActive
                      ? 'bg-accent/15 text-accent'
                      : 'text-label-quaternary'
                    }
                  `}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-surface-glass-border">
        <p className="text-[11px] text-label-quaternary tracking-wide">v1.0.0</p>
      </div>
    </aside>
  );
}
