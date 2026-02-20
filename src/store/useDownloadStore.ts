import { create } from 'zustand';
import type { DownloadItem, AppSettings, DownloadProgressUpdate, DownloadStatus } from '../../shared/types';

export type FilterCategory = 'all' | 'downloading' | 'completed' | 'paused' | 'queued' | 'error' | 'scheduled';

interface DownloadStore {
  // State
  downloads: DownloadItem[];
  settings: AppSettings | null;
  filter: FilterCategory;
  searchQuery: string;
  selectedIds: Set<string>;
  showSettings: boolean;
  showAddDialog: boolean;
  showScheduleDialog: boolean;
  globalSpeed: number;

  // Actions
  setDownloads: (downloads: DownloadItem[]) => void;
  addDownload: (item: DownloadItem) => void;
  updateProgress: (updates: DownloadProgressUpdate[]) => void;
  updateStatus: (id: string, status: DownloadStatus) => void;
  removeDownload: (id: string) => void;
  setSettings: (settings: AppSettings) => void;
  setFilter: (filter: FilterCategory) => void;
  setSearchQuery: (query: string) => void;
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setShowSettings: (show: boolean) => void;
  setShowAddDialog: (show: boolean) => void;
  setShowScheduleDialog: (show: boolean) => void;

  // Computed
  filteredDownloads: () => DownloadItem[];
  getCounts: () => Record<FilterCategory, number>;
}

export const useDownloadStore = create<DownloadStore>((set, get) => ({
  downloads: [],
  settings: null,
  filter: 'all',
  searchQuery: '',
  selectedIds: new Set(),
  showSettings: false,
  showAddDialog: false,
  showScheduleDialog: false,
  globalSpeed: 0,

  setDownloads: (downloads) => set({ downloads }),

  addDownload: (item) => set((state) => {
    // Avoid duplicates
    if (state.downloads.some(d => d.id === item.id)) return state;
    return { downloads: [item, ...state.downloads] };
  }),

  updateProgress: (updates) => set((state) => {
    if (updates.length === 0) return state;

    let totalSpeed = 0;
    let anyChanged = false;
    const downloads = state.downloads;
    const newDownloads: DownloadItem[] = new Array(downloads.length);

    // Build a lookup of updates by id for O(1) access
    const updateMap = new Map<string, DownloadProgressUpdate>();
    for (const u of updates) {
      updateMap.set(u.id, u);
      totalSpeed += u.speed;
    }

    for (let i = 0; i < downloads.length; i++) {
      const d = downloads[i];
      const u = updateMap.get(d.id);
      if (u && (d.downloadedBytes !== u.downloadedBytes || d.speed !== u.speed ||
                d.eta !== u.eta || d.status !== u.status)) {
        newDownloads[i] = { ...d, downloadedBytes: u.downloadedBytes, speed: u.speed, eta: u.eta, status: u.status };
        anyChanged = true;
      } else {
        newDownloads[i] = d;
      }
    }

    if (!anyChanged && state.globalSpeed === totalSpeed) return state;
    return { downloads: anyChanged ? newDownloads : downloads, globalSpeed: totalSpeed };
  }),

  updateStatus: (id, status) => set((state) => ({
    downloads: state.downloads.map(d =>
      d.id === id ? { ...d, status } : d
    )
  })),

  removeDownload: (id) => set((state) => ({
    downloads: state.downloads.filter(d => d.id !== id),
    selectedIds: new Set([...state.selectedIds].filter(sid => sid !== id))
  })),

  setSettings: (settings) => set({ settings }),
  setFilter: (filter) => set({ filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  toggleSelected: (id) => set((state) => {
    const newSelected = new Set(state.selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    return { selectedIds: newSelected };
  }),

  selectAll: () => set((state) => ({
    selectedIds: new Set(get().filteredDownloads().map(d => d.id))
  })),

  deselectAll: () => set({ selectedIds: new Set() }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAddDialog: (show) => set({ showAddDialog: show }),
  setShowScheduleDialog: (show) => set({ showScheduleDialog: show }),

  filteredDownloads: () => {
    const { downloads, filter, searchQuery } = get();

    let filtered = downloads;

    // Apply status filter
    if (filter !== 'all') {
      const statusMap: Record<FilterCategory, DownloadStatus[]> = {
        all: [],
        downloading: ['downloading', 'queued'],
        completed: ['completed'],
        paused: ['paused'],
        queued: ['queued', 'pending'],
        error: ['error'],
        scheduled: ['scheduled']
      };
      const statuses = new Set(statusMap[filter]);
      filtered = filtered.filter(d => statuses.has(d.status));
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(d =>
        d.filename.toLowerCase().includes(q) ||
        d.url.toLowerCase().includes(q)
      );
    }

    return filtered;
  },

  getCounts: () => {
    const { downloads } = get();
    return {
      all: downloads.length,
      downloading: downloads.filter(d => d.status === 'downloading' || d.status === 'queued').length,
      completed: downloads.filter(d => d.status === 'completed').length,
      paused: downloads.filter(d => d.status === 'paused').length,
      queued: downloads.filter(d => d.status === 'queued' || d.status === 'pending').length,
      error: downloads.filter(d => d.status === 'error').length,
      scheduled: downloads.filter(d => d.status === 'scheduled').length
    };
  }
}));
