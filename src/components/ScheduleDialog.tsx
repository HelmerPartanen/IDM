import React, { useState } from 'react';
import { X, Link2, CalendarDays, Clock, Repeat, Power, AlertCircle, Loader2 } from 'lucide-react';
import { useDownloadStore } from '../store/useDownloadStore';

export function ScheduleDialog() {
  const showScheduleDialog = useDownloadStore(s => s.showScheduleDialog);
  const setShowScheduleDialog = useDownloadStore(s => s.setShowScheduleDialog);

  const [url, setUrl] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly'>('none');
  const [autoShutdown, setAutoShutdown] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!showScheduleDialog) return null;

  const handleClose = () => {
    setUrl('');
    setScheduledDate('');
    setScheduledTime('');
    setRepeat('none');
    setAutoShutdown(false);
    setError('');
    setShowScheduleDialog(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    if (!scheduledDate || !scheduledTime) {
      setError('Please select a date and time');
      return;
    }

    const scheduledTimestamp = new Date(`${scheduledDate}T${scheduledTime}`).getTime();
    if (scheduledTimestamp <= Date.now()) {
      setError('Scheduled time must be in the future');
      return;
    }

    setIsSubmitting(true);
    try {
      const dlResult = await window.api.addDownload({
        url: url.trim(),
        scheduledTime: scheduledTimestamp
      });

      if (!dlResult.success || !dlResult.item) {
        setError(dlResult.error || 'Failed to add download');
        return;
      }

      const schedResult = await window.api.addSchedule({
        downloadId: dlResult.item.id,
        scheduledTime: scheduledTimestamp,
        repeat,
        autoShutdown,
        enabled: true
      });

      if (schedResult.success) {
        handleClose();
      } else {
        setError(schedResult.error || 'Failed to schedule');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={handleClose}>
      <div className="bg-surface-2 border border-surface-glass-border rounded-2xl shadow-glass-lg w-[460px] max-w-[90vw] animate-scale-in"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-[15px] font-bold text-label-primary font-display">Schedule Download</h2>
          <button onClick={handleClose}
            className="p-1 rounded-lg text-label-tertiary hover:text-label-primary hover:bg-surface-glass-hover transition-apple">
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-surface-glass-border mx-6" />

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* URL */}
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-1.5">
              <Link2 size={13} className="text-label-tertiary" />
              URL
            </label>
            <input
              type="text" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/file.zip"
              className="w-full bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
                text-[13px] text-label-primary placeholder-label-quaternary
                focus:border-accent/40 focus:bg-surface-glass-hover transition-apple outline-none"
              autoFocus
            />
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-1.5">
                <CalendarDays size={13} className="text-label-tertiary" />
                Date
              </label>
              <input
                type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                className="w-full bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
                  text-[13px] text-label-primary focus:border-accent/40 transition-apple outline-none"
              />
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-1.5">
                <Clock size={13} className="text-label-tertiary" />
                Time
              </label>
              <input
                type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)}
                className="w-full bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
                  text-[13px] text-label-primary focus:border-accent/40 transition-apple outline-none"
              />
            </div>
          </div>

          {/* Repeat */}
          <div>
            <label className="flex items-center gap-1.5 text-[12px] font-medium text-label-secondary mb-1.5">
              <Repeat size={13} className="text-label-tertiary" />
              Repeat
            </label>
            <select
              value={repeat} onChange={e => setRepeat(e.target.value as any)}
              className="w-full bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
                text-[13px] text-label-primary focus:border-accent/40 transition-apple outline-none"
            >
              <option value="none">No repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          {/* Auto-shutdown */}
          <div className="flex items-center gap-3 py-1">
            <input
              type="checkbox" id="auto-shutdown" checked={autoShutdown}
              onChange={e => setAutoShutdown(e.target.checked)}
            />
            <label htmlFor="auto-shutdown" className="flex items-center gap-1.5 text-[13px] text-label-secondary cursor-pointer">
              <Power size={13} className="text-label-tertiary" />
              Shutdown after completion
            </label>
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
            <button type="button" onClick={handleClose}
              className="px-4 py-2 text-[13px] font-medium text-label-secondary hover:text-label-primary
                rounded-xl hover:bg-surface-glass-hover transition-apple">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-5 py-2 bg-accent hover:bg-accent-hover text-black text-[13px] font-semibold
                rounded-xl transition-apple shadow-glass-sm active:scale-[0.97]
                disabled:opacity-50 flex items-center gap-2">
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isSubmitting ? 'Scheduling…' : 'Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
