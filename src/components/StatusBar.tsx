import React from 'react';
import { ArrowDown, CheckCircle2, Clock, Database } from 'lucide-react';
import { useDownloadStore } from '../store/useDownloadStore';
import { formatSpeed } from '../utils/format';

function Stat({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} className={color || 'text-label-tertiary'} />
      <span className="text-label-tertiary">{label}</span>
      <span className={`tabular-nums font-medium ${color || 'text-label-secondary'}`}>{value}</span>
    </div>
  );
}

export function StatusBar() {
  const downloads = useDownloadStore(s => s.downloads);
  const globalSpeed = useDownloadStore(s => s.globalSpeed);

  const active = downloads.filter(d => d.status === 'downloading').length;
  const queued = downloads.filter(d => d.status === 'queued' || d.status === 'pending').length;
  const completed = downloads.filter(d => d.status === 'completed').length;
  const total = downloads.length;

  return (
    <div className="bg-surface-1 border-t border-surface-glass-border px-4 py-1.5 flex items-center justify-between text-[11px]">
      <div className="flex items-center gap-4">
        <Stat icon={Database} label="Total" value={total} />
        {active > 0 && <Stat icon={ArrowDown} label="Active" value={active} color="text-accent" />}
        {queued > 0 && <Stat icon={Clock} label="Queued" value={queued} color="text-semantic-warning" />}
        <Stat icon={CheckCircle2} label="Done" value={completed} color="text-semantic-success" />
      </div>
      {globalSpeed > 0 && (
        <div className="flex items-center gap-1.5 text-accent font-medium tabular-nums">
          <ArrowDown size={12} />
          {formatSpeed(globalSpeed)}
        </div>
      )}
    </div>
  );
}
