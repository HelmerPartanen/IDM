import { useEffect, useCallback } from 'react';
import { useDownloadStore } from '../store/useDownloadStore';

/**
 * Hook that sets up IPC listeners and loads initial data from the main process.
 */
export function useIpc() {
  const { setDownloads, addDownload, updateProgress, updateStatus, setSettings } = useDownloadStore();

  // Load initial data
  useEffect(() => {
    const loadInitial = async () => {
      const [dlResult, settingsResult] = await Promise.all([
        window.api.listDownloads(),
        window.api.getSettings()
      ]);

      if (dlResult.success && dlResult.downloads) {
        setDownloads(dlResult.downloads);
      }

      if (settingsResult.success && settingsResult.settings) {
        setSettings(settingsResult.settings);
      }
    };

    loadInitial();
  }, [setDownloads, setSettings]);

  // Subscribe to real-time progress updates
  useEffect(() => {
    const unsubProgress = window.api.onProgressBatch((updates) => {
      updateProgress(updates);
    });

    const unsubAdded = window.api.onDownloadAdded((item) => {
      addDownload(item);
    });

    const unsubStatus = window.api.onStatusChanged((id, status) => {
      updateStatus(id, status as any);
    });

    return () => {
      unsubProgress();
      unsubAdded();
      unsubStatus();
    };
  }, [updateProgress, addDownload, updateStatus]);
}

/**
 * Helper functions for calling IPC methods.
 */
export function useDownloadActions() {
  const removeDownload = useDownloadStore(s => s.removeDownload);

  const addDownload = useCallback(async (url: string, filename?: string, savePath?: string) => {
    return window.api.addDownload({ url, filename, savePath });
  }, []);

  const pauseDownload = useCallback(async (id: string) => {
    return window.api.pauseDownload(id);
  }, []);

  const resumeDownload = useCallback(async (id: string) => {
    return window.api.resumeDownload(id);
  }, []);

  const cancelDownload = useCallback(async (id: string) => {
    return window.api.cancelDownload(id);
  }, []);

  const retryDownload = useCallback(async (id: string) => {
    return window.api.retryDownload(id);
  }, []);

  const deleteDownload = useCallback(async (id: string) => {
    await window.api.removeDownload(id);
    removeDownload(id);
  }, [removeDownload]);

  const openFile = useCallback(async (id: string) => {
    return window.api.openFile(id);
  }, []);

  const openFolder = useCallback(async (id: string) => {
    return window.api.openFolder(id);
  }, []);

  const selectFolder = useCallback(async () => {
    return window.api.selectFolder();
  }, []);

  return {
    addDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    retryDownload,
    deleteDownload,
    openFile,
    openFolder,
    selectFolder
  };
}
