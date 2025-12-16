import { useEffect, useMemo } from 'react';
import { useAppStore } from './store';
import { MainBar } from './components/MainBar';
import { PinGuard } from './components/PinGuard';
import { ExportModal } from './components/modals/ExportModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { AddCabinetModal } from './components/modals/AddCabinetModal';
import { AddDeviceModal } from './components/modals/AddDeviceModal';
import { CabinetView } from './components/CabinetView';
import { IpDashView } from './components/ipdash/IpDashView';
import { PortHubView } from './components/porthub/PortHubView';
import { IpDashProfileModal } from './components/ipdash/ProfileModal';
import { CommentModal } from './components/modals/CommentModal';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import './styles/global.css';

export default function App() {
  const theme = useAppStore((s) => s.theme);
  const view = useAppStore((s) => s.view);

  useEffect(() => {
    const header = document.querySelector('.sticky-glass');
    if (!header) return;
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-changing');
    root.setAttribute('data-theme', theme);
    const tm = setTimeout(() => {
      root.classList.remove('theme-changing');
    }, 350);
    return () => clearTimeout(tm);
  }, [theme]);

  const renderView = useMemo(() => {
    if (view === 'ipdash') return <IpDashView />;
    if (view === 'porthub') return <PortHubView />;
    return <CabinetView />;
  }, [view]);

  const containerClass = view === 'ipdash' || view === 'porthub' ? 'app-container ipdash-full' : 'app-container';

  return (
    <div className="min-h-screen bg-tech">
      <PinGuard />

      <header className="sticky-glass">
        <div className="app-container">
          <MainBar />
        </div>
      </header>

      <main className="py-4 lg:py-6">
        <div className={containerClass}>{renderView}</div>
      </main>

      <ExportModal />
      <SettingsModal />
      <AddCabinetModal />
      <AddDeviceModal />
      <CommentModal />
      <IpDashProfileModal />
      <PwaInstallPrompt />
    </div>
  );
}
