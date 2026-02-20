import React from 'react';
import {
  LayoutList, ArrowDownToLine, CheckCircle2, Pause, Clock,
  AlertCircle, ArrowDown
} from 'lucide-react';
import { useDownloadStore, FilterCategory } from '../store/useDownloadStore';
import { formatSpeed } from '../utils/format';

const categories: { key: FilterCategory; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All Downloads', icon: <LayoutList size={16} /> },
  { key: 'downloading', label: 'Active', icon: <ArrowDownToLine size={16} /> },
  { key: 'completed', label: 'Completed', icon: <CheckCircle2 size={16} /> },
  { key: 'paused', label: 'Paused', icon: <Pause size={16} /> },
  { key: 'queued', label: 'Queued', icon: <Clock size={16} /> },
  { key: 'error', label: 'Failed', icon: <AlertCircle size={16} /> },
];

export function Sidebar() {
  const filter = useDownloadStore(s => s.filter);
  const setFilter = useDownloadStore(s => s.setFilter);
  const getCounts = useDownloadStore(s => s.getCounts);
  const globalSpeed = useDownloadStore(s => s.globalSpeed);

  const counts = getCounts();

  return (
    <aside className="w-[230px] bg-surface-1 border-r border-surface-3 flex flex-col h-full overflow-hidden">
      {/* Brand */}
      <div className="px-5 pt-6 pb-4 drag-region">
        <div className="no-drag flex items-center gap-2.5">
          <div className="flex items-center justify-center">
            <img src="./favicon.ico" alt="" className="w-8 h-8" draggable={false} />
          </div>
          <div>
            <p className="text-[13px] font-bold text-label-primary tracking-tight leading-none font-display">Download Manager</p>
            {globalSpeed > 0 && (
              <p className="text-[10px] text-accent font-bold mt-1.5 flex items-center gap-1 uppercase tracking-wider">
                <ArrowDown size={10} strokeWidth={3} />
                {formatSpeed(globalSpeed)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 px-3 py-2 overflow-y-auto">
        <div className="space-y-0.5">
          {categories.map(cat => {
            const isActive = filter === cat.key;
            const count = counts[cat.key];

            return (
              <SidebarItem
                key={cat.key}
                isActive={isActive}
                icon={cat.icon}
                label={cat.label}
                count={count}
                onClick={() => setFilter(cat.key)}
              />
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-surface-3 bg-surface-1">
        <p className="text-[11px] text-label-quaternary tracking-wide font-medium flex items-center justify-between">
          <span>v1.0.0</span>
          <span className="w-2 h-2 rounded-full bg-semantic-success shadow-pulse animate-pulse-glow" />
        </p>
      </div>
    </aside>
  );
}

function SidebarItem({
  isActive, icon, label, count, onClick, isNew
}: {
  isActive: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
  isNew?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center justify-between px-3 py-[8px] rounded-xl text-[13px]
        transition-apple group relative
        ${isActive
          ? 'bg-accent/10 text-accent shadow-sm'
          : 'text-label-secondary hover:bg-surface-glass-hover hover:text-label-primary'
        }
      `}
    >
      <span className="flex items-center gap-3">
        <span className={`${isActive ? 'text-accent' : 'text-label-tertiary group-hover:text-label-secondary'} transition-apple`}>
          {icon}
        </span>
        <span className="font-semibold tracking-tight font-display">{label}</span>
      </span>
      {isNew && !isActive && (
        <span className="px-1.5 py-0.5 rounded-md bg-accent text-black text-[9px] font-black uppercase">New</span>
      )}
      {count !== undefined && count > 0 && (
        <span className={`
          text-[10px] font-bold tabular-nums min-w-[20px] text-center
          px-1.5 py-px rounded-full
          ${isActive
            ? 'bg-accent text-black'
            : 'bg-surface-glass-active text-label-secondary'
          }
        `}>
          {count}
        </span>
      )}
    </button>
  );
}
