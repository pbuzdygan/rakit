import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore } from './store';
import { PinGuard } from './components/PinGuard';
import { ExportModal } from './components/modals/ExportModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { AddCabinetModal } from './components/modals/AddCabinetModal';
import { AddDeviceModal } from './components/modals/AddDeviceModal';
import { CabinetView } from './components/CabinetView';
import { OperationsIpamView } from './components/ipdash/OperationsIpamView';
import { PortHubView } from './components/porthub/PortHubView';
import { IpDashProfileModal } from './components/ipdash/ProfileModal';
import { CommentModal } from './components/modals/CommentModal';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { OperationsSidebar, OperationsTopbar } from './components/OperationsShell';
import { OverviewView } from './components/OverviewView';
import { WolView } from './components/WolView';
import { AuditView } from './components/AuditView';
import './styles/global.css';
import './styles/operations.css';

export default function App() {
  const queryClient = useQueryClient();
  const theme = useAppStore((s) => s.theme);
  const view = useAppStore((s) => s.view);
  const pinSession = useAppStore((s) => s.pinSession);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-changing');
    root.setAttribute('data-theme', theme);
    document
      .querySelector<HTMLMetaElement>('#rakit-theme-color')
      ?.setAttribute('content', theme === 'light' ? '#eef2f6' : '#020617');
    const tm = setTimeout(() => {
      root.classList.remove('theme-changing');
    }, 350);
    return () => clearTimeout(tm);
  }, [theme]);

  useEffect(() => {
    if (!pinSession) queryClient.clear();
  }, [pinSession, queryClient]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 820px)');
    const closeMobileNavigation = (event?: MediaQueryListEvent) => {
      if ((event?.matches ?? mobile.matches) && !useAppStore.getState().sidebarCollapsed) {
        useAppStore.setState({ sidebarCollapsed: true });
      }
    };
    closeMobileNavigation();
    mobile.addEventListener('change', closeMobileNavigation);
    return () => mobile.removeEventListener('change', closeMobileNavigation);
  }, []);

  const renderView = useMemo(() => {
    if (view === 'overview') return <OverviewView />;
    if (view === 'ipdash') return <OperationsIpamView />;
    if (view === 'porthub') return <PortHubView />;
    if (view === 'wol') return <WolView />;
    if (view === 'audit') return <AuditView />;
    return <CabinetView />;
  }, [view]);

  return (
    <div className="ops-app">
      <PinGuard />
      {pinSession ? (
        <>
          <OperationsSidebar />
          <button
            type="button"
            className={`ops-sidebar-scrim ${sidebarCollapsed ? '' : 'is-visible'}`}
            aria-label="Close navigation"
            tabIndex={sidebarCollapsed ? -1 : 0}
            onClick={toggleSidebar}
          />
          <div className="ops-workspace">
            <OperationsTopbar />
            <main className={`ops-main ops-main--${view}`}>{renderView}</main>
          </div>

          <ExportModal />
          <SettingsModal />
          <AddCabinetModal />
          <AddDeviceModal />
          <CommentModal />
          <IpDashProfileModal />
        </>
      ) : null}
      <PwaInstallPrompt />
    </div>
  );
}
