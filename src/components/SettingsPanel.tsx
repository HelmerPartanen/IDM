import React, { useState, useEffect } from 'react';
import {
  X, FolderOpen, Gauge, Zap, Bell, RotateCcw, Power, MonitorDown, Loader2
} from 'lucide-react';
import { useDownloadStore } from '../store/useDownloadStore';
import type { AppSettings } from '../../shared/types';
import { formatBytes } from '../utils/format';

export function SettingsPanel() {
  const showSettings = useDownloadStore(s => s.showSettings);
  const setShowSettings = useDownloadStore(s => s.setShowSettings);
  const settings = useDownloadStore(s => s.settings);
  const setSettings = useDownloadStore(s => s.setSettings);

  const [localSettings, setLocalSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setLocalSettings({ ...settings });
    }
  }, [settings]);

  if (!showSettings || !localSettings) return null;

  const handleSave = async () => {
    if (!localSettings) return;
    setSaving(true);

    try {
      const result = await window.api.updateSettings(localSettings);
      if (result.success && result.settings) {
        setSettings(result.settings);
        setShowSettings(false);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectFolder = async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      setLocalSettings({ ...localSettings, downloadFolder: folder });
    }
  };

  const update = (updates: Partial<AppSettings>) => {
    setLocalSettings({ ...localSettings, ...updates });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in"
      onClick={() => setShowSettings(false)}>
      <div
        className="bg-surface-2 border border-surface-glass-border rounded-2xl shadow-glass-lg
          w-[520px] max-w-[90vw] max-h-[85vh] flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-label-primary">Settings</h2>
          <button onClick={() => setShowSettings(false)}
            className="p-1 rounded-lg text-label-tertiary hover:text-label-primary hover:bg-surface-glass-hover transition-apple">
            <X size={16} />
          </button>
        </div>

        <div className="h-px bg-surface-glass-border mx-6 flex-shrink-0" />

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Download Location */}
          <Section icon={<FolderOpen size={14} />} title="Download Location">
            <div className="flex gap-2">
              <input
                type="text"
                value={localSettings.downloadFolder}
                onChange={(e) => update({ downloadFolder: e.target.value })}
                className="flex-1 bg-surface-glass border border-surface-glass-border rounded-xl px-3.5 py-2.5
                  text-[13px] text-label-primary focus:border-accent/40 transition-apple outline-none"
              />
              <button
                onClick={handleSelectFolder}
                className="px-3.5 py-2.5 bg-surface-glass border border-surface-glass-border rounded-xl
                  text-[13px] text-label-secondary hover:text-label-primary hover:bg-surface-glass-hover transition-apple active:scale-[0.97]"
              >
                Browse
              </button>
            </div>
          </Section>

          {/* Performance */}
          <Section icon={<Gauge size={14} />} title="Performance">
            <div className="space-y-5">
              <SliderField
                label="Connections per download"
                value={localSettings.maxThreadsPerDownload}
                min={1} max={32}
                onChange={(v) => update({ maxThreadsPerDownload: v })}
                marks={['1', '8', '16', '32']}
              />
              <SliderField
                label="Concurrent downloads"
                value={localSettings.maxConcurrentDownloads}
                min={1} max={10}
                onChange={(v) => update({ maxConcurrentDownloads: v })}
                marks={['1', '5', '10']}
              />
            </div>
          </Section>

          {/* Speed Limit */}
          <Section icon={<Zap size={14} />} title="Speed Limit">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] text-label-secondary">Limit download speed</span>
              <Toggle
                checked={localSettings.speedLimitEnabled}
                onChange={(v) => update({ speedLimitEnabled: v })}
              />
            </div>
            {localSettings.speedLimitEnabled && (
              <SliderField
                label={`Limit: ${formatBytes(localSettings.speedLimitBytesPerSec)}/s`}
                value={localSettings.speedLimitBytesPerSec}
                min={102400} max={104857600} step={102400}
                onChange={(v) => update({ speedLimitBytesPerSec: v })}
                marks={['100 KB/s', '50 MB/s', '100 MB/s']}
                hideValue
              />
            )}
          </Section>

          {/* Behavior */}
          <Section icon={<Power size={14} />} title="Behavior">
            <div className="space-y-0">
              <ToggleRow
                label="Auto-start on system boot"
                icon={<Power size={14} />}
                checked={localSettings.autoStartOnBoot}
                onChange={(v) => update({ autoStartOnBoot: v })}
              />
              <ToggleRow
                label="Minimize to system tray"
                icon={<MonitorDown size={14} />}
                checked={localSettings.minimizeToTray}
                onChange={(v) => update({ minimizeToTray: v })}
              />
              <ToggleRow
                label="Show notifications"
                icon={<Bell size={14} />}
                checked={localSettings.showNotifications}
                onChange={(v) => update({ showNotifications: v })}
              />
              <ToggleRow
                label="Auto-retry on failure"
                icon={<RotateCcw size={14} />}
                checked={localSettings.autoRetryFailed}
                onChange={(v) => update({ autoRetryFailed: v })}
              />
              {localSettings.autoRetryFailed && (
                <div className="pt-2 pl-8">
                  <SliderField
                    label="Max retries"
                    value={localSettings.maxRetries}
                    min={1} max={10}
                    onChange={(v) => update({ maxRetries: v })}
                  />
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-surface-glass-border">
          <div className="flex justify-end gap-2.5">
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 text-[13px] font-medium text-label-secondary hover:text-label-primary
                rounded-xl hover:bg-surface-glass-hover transition-apple"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold
                rounded-xl transition-apple shadow-glass-sm active:scale-[0.97]
                disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ────────────────────────────────────────── */

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[11px] font-semibold text-label-quaternary uppercase tracking-widest mb-3">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-[22px] w-[40px] items-center rounded-full transition-all duration-300 ease-apple flex-shrink-0
        ${checked ? 'bg-accent' : 'bg-surface-5'}
      `}
    >
      <span
        className={`
          inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-300 ease-apple-spring
          shadow-sm
          ${checked ? 'translate-x-[20px]' : 'translate-x-[2px]'}
        `}
      />
    </button>
  );
}

function ToggleRow({ label, icon, checked, onChange }: {
  label: string; icon: React.ReactNode; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 group">
      <span className="flex items-center gap-2.5 text-[13px] text-label-secondary group-hover:text-label-primary transition-apple">
        <span className="text-label-tertiary">{icon}</span>
        {label}
      </span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange, marks, hideValue }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; marks?: string[]; hideValue?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] text-label-secondary">{label}</span>
        {!hideValue && <span className="text-[12px] font-semibold text-accent tabular-nums">{value}</span>}
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full"
      />
      {marks && (
        <div className="flex justify-between text-[10px] text-label-quaternary mt-1 px-0.5">
          {marks.map(m => <span key={m}>{m}</span>)}
        </div>
      )}
    </div>
  );
}
