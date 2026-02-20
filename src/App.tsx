import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { DownloadList } from './components/DownloadList';
import { StatusBar } from './components/StatusBar';
import { AddDownloadDialog } from './components/AddDownloadDialog';
import { SettingsPanel } from './components/SettingsPanel';
import { ScheduleDialog } from './components/ScheduleDialog';
import { useIpc } from './hooks/useIpc';

function App() {
    // Initialize IPC connection and load initial data
    useIpc();

    return (
        <div className="h-screen flex bg-surface-0">
            {/* Sidebar */}
            <Sidebar />

            {/* Main content area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Top toolbar with drag region */}
                <div className="drag-region flex-shrink-0">
                    <div className="no-drag">
                        <Toolbar />
                    </div>
                </div>

                {/* Download list */}
                <DownloadList />

                {/* Status bar */}
                <StatusBar />
            </div>

            {/* Modal dialogs */}
            <AddDownloadDialog />
            <SettingsPanel />
            <ScheduleDialog />
        </div>
    );
}

export default App;
