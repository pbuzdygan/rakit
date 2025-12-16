import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Api } from '../api';
import { useAppStore } from '../store';
import { DropdownMenu, DropdownItem } from './DropdownMenu';
import { SoftButton } from './SoftButton';
import { Surface } from './Surface';
import { IpDashProfileMenu } from './ipdash/IpDashProfileMenu';
import { VersionIndicator } from './VersionIndicator';

type ViewId = 'cabinet' | 'ipdash' | 'porthub';

const VIEW_TABS: Array<{ id: ViewId; label: string }> = [
  { id: 'cabinet', label: 'IT Cabinet' },
  { id: 'ipdash', label: 'IP Dash' },
  { id: 'porthub', label: 'Port Hub' },
];

const VIEW_COPY: Record<ViewId, { title: string; caption?: string }> = {
  cabinet: {
    title: 'IT Cabinet overview',
    caption: '',
  },
  ipdash: {
    title: 'IP Dash workspace',
    caption: '',
  },
  porthub: {
    title: 'Port Hub workspace',
    caption: '',
  },
};

export function MainBar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setPinSession = useAppStore((s) => s.setPinSession);
  const openModal = useAppStore((s) => s.openModal);
  const selectedCabinetId = useAppStore((s) => s.selectedCabinetId);
  const setSelectedCabinetId = useAppStore((s) => s.setSelectedCabinetId);
  const setEditingCabinetId = useAppStore((s) => s.setEditingCabinetId);
  const ipDashViewMode = useAppStore((s) => s.ipDashViewMode);
  const setIpDashViewMode = useAppStore((s) => s.setIpDashViewMode);
  const triggerIpDashRefresh = useAppStore((s) => s.triggerIpDashRefresh);
  const openIpDashProfileModal = useAppStore((s) => s.openIpDashProfileModal);

  const cabinetsQuery = useQuery({ queryKey: ['cabinets'], queryFn: Api.cabinets.list });
  const cabinets = (cabinetsQuery.data?.cabinets ?? []) as Array<{ id: number; name: string }>;

  const meta = VIEW_COPY[view];
  const caption = view === 'ipdash' ? '' : meta.caption;

  useEffect(() => {
    if (view !== 'cabinet') return;
    if (!cabinets.length) return;
    if (!selectedCabinetId || !cabinets.some((cab) => cab.id === selectedCabinetId)) {
      setSelectedCabinetId(cabinets[0].id);
    }
  }, [view, cabinets, selectedCabinetId, setSelectedCabinetId]);

  if (view === 'cabinet' && cabinets.length && selectedCabinetId && !cabinets.some((c) => c.id === selectedCabinetId)) {
    setSelectedCabinetId(cabinets[0].id);
  }

  const lockSession = () => {
    sessionStorage.removeItem('pin-ok');
    setPinSession(false);
  };

  return (
    <div className="py-3">
      <Surface className="stack gap-4 mainbar-shell">
        <div className="mainbar-desktop stack gap-3">
          <div className="mainbar-head">
            <div className="stack-sm mainbar-title-block">
              <h2 className="type-title-xl">{meta.title}</h2>
              {caption ? <p className="type-body-sm text-textSec">{caption}</p> : null}
            </div>
            <div className="rakit-emblem hidden md:flex">
              <img
                src="/icon-128x128.png"
                alt="Rakit"
                className="h-[76px] w-auto object-contain drop-shadow-lg"
              />
            </div>
            <div className="flex items-center utility-group">
              <SoftButton
                variant="ghost"
                className="utility-button"
                aria-label="Lock session"
                onClick={lockSession}
              >
                🔒
              </SoftButton>
              <SoftButton
                variant="ghost"
                className="utility-button"
                aria-label="Toggle theme"
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                <span key={theme} className="theme-icon inline-block">
                  {theme === 'light' ? '🌙' : '☀️'}
                </span>
              </SoftButton>
            </div>
          </div>

          <div className="mainbar-tabs-row">
            <div className="chip-group mainbar-tabs" role="tablist" aria-label="Rakit views">
              {VIEW_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  className={`chip-button ${view === item.id ? 'active' : ''}`}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mainbar-tab-actions">
              <DropdownMenu label="Menu" align="right" buttonClassName="utility-menu-btn">
                {({ close }) => (
                  <>
                    <DropdownItem
                      onSelect={() => {
                        openModal('export');
                        close();
                      }}
                    >
                      Export snapshot
                    </DropdownItem>
                    <DropdownItem
                      onSelect={() => {
                        openIpDashProfileModal();
                        close();
                      }}
                    >
                      Manage profiles
                    </DropdownItem>
                    <DropdownItem
                      onSelect={() => {
                        openModal('settings');
                        close();
                      }}
                    >
                      Settings
                    </DropdownItem>
                  </>
                )}
              </DropdownMenu>
            </div>
          </div>

          {view === 'ipdash' && (
            <div className="ipdash-toolbar">
              <div className="ipdash-toolbar-left">
                <SoftButton
                  variant={ipDashViewMode === 'table' ? 'solid' : 'ghost'}
                  onClick={() => setIpDashViewMode('table')}
                >
                  Table View
                </SoftButton>
                <SoftButton
                  variant={ipDashViewMode === 'grid' ? 'solid' : 'ghost'}
                  onClick={() => setIpDashViewMode('grid')}
                >
                  Grid View
                </SoftButton>
                <SoftButton variant="ghost" onClick={() => triggerIpDashRefresh()}>
                  Refresh
                </SoftButton>
              </div>
              <div className="ipdash-toolbar-right">
                <IpDashProfileMenu />
                <VersionIndicator compact />
              </div>
            </div>
          )}

          {view === 'porthub' && (
            <div className="ipdash-toolbar justify-end">
              <div className="ipdash-toolbar-right">
                <VersionIndicator compact />
              </div>
            </div>
          )}

          {view === 'cabinet' && (
            <div className="mainbar-action-bar">
              <div className="mainbar-action-controls">
                <SoftButton
                  onClick={() => {
                    setEditingCabinetId(null);
                    openModal('addCabinet');
                  }}
                >
                  Add cabinet
                </SoftButton>
                <DropdownMenu
                  label={
                    cabinetsQuery.isFetching
                      ? 'Loading cabinets...'
                      : `Cabinet: ${cabinets.find((c) => c.id === selectedCabinetId)?.name ?? 'Select'}`
                  }
                  buttonClassName="cabinet-selector"
                >
                  {({ close }) => (
                    <>
                      {cabinets.length === 0 && <DropdownItem disabled>No cabinets yet</DropdownItem>}
                      {cabinets.map((cabinet) => (
                        <DropdownItem
                          key={cabinet.id}
                          onSelect={() => {
                            setSelectedCabinetId(cabinet.id);
                            close();
                          }}
                        >
                          {cabinet.name}
                        </DropdownItem>
                      ))}
                    </>
                  )}
                </DropdownMenu>
              </div>
              <VersionIndicator compact />
            </div>
          )}
        </div>

        <div className="mainbar-mobile">
          <div className="mobile-tabs-row">
            <div className="chip-group mainbar-tabs" role="tablist" aria-label="Rakit views">
              {VIEW_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  className={`chip-button ${view === item.id ? 'active' : ''}`}
                  onClick={() => setView(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mobile-utility-row">
            <DropdownMenu label="Menu" align="left" buttonClassName="utility-menu-btn mobile-menu-btn">
              {({ close }) => (
                <>
                  <DropdownItem
                    onSelect={() => {
                      openModal('export');
                      close();
                    }}
                  >
                    Export snapshot
                  </DropdownItem>
                  <DropdownItem
                    onSelect={() => {
                      openIpDashProfileModal();
                      close();
                    }}
                  >
                    Manage profiles
                  </DropdownItem>
                  <DropdownItem
                    onSelect={() => {
                      openModal('settings');
                      close();
                    }}
                  >
                    Settings
                  </DropdownItem>
                </>
              )}
            </DropdownMenu>
            <SoftButton
              variant="ghost"
              aria-label="Lock session"
              onClick={lockSession}
              className="utility-button mobile-compact-button"
            >
              🔒
            </SoftButton>
            <SoftButton
              variant="ghost"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="utility-button mobile-compact-button"
            >
              <span key={theme} className="theme-icon inline-block">
                {theme === 'light' ? '🌙' : '☀️'}
              </span>
            </SoftButton>
            <VersionIndicator compact />
          </div>

          {view === 'ipdash' && (
            <>
              <div className="mobile-ipdash-actions">
                <SoftButton
                  variant={ipDashViewMode === 'table' ? 'solid' : 'ghost'}
                  onClick={() => setIpDashViewMode('table')}
                  className="mobile-compact-button"
                >
                  Table
                </SoftButton>
                <SoftButton
                  variant={ipDashViewMode === 'grid' ? 'solid' : 'ghost'}
                  onClick={() => setIpDashViewMode('grid')}
                  className="mobile-compact-button"
                >
                  Grid
                </SoftButton>
                <SoftButton
                  variant="ghost"
                  onClick={() => triggerIpDashRefresh()}
                  className="mobile-compact-button"
                >
                  Refresh
                </SoftButton>
              </div>
              <div className="mobile-ipdash-profile">
                <IpDashProfileMenu />
              </div>
            </>
          )}

          {view === 'cabinet' && (
            <div className="mobile-cabinet-actions">
              <SoftButton
                block
                onClick={() => {
                  setEditingCabinetId(null);
                  openModal('addCabinet');
                }}
              >
                Add cabinet
              </SoftButton>
              <DropdownMenu
                label={
                  cabinetsQuery.isFetching
                    ? 'Loading cabinets...'
                    : `Cabinet: ${cabinets.find((c) => c.id === selectedCabinetId)?.name ?? 'Select'}`
                }
                block
                buttonClassName="cabinet-selector"
              >
                {({ close }) => (
                  <>
                    {cabinets.length === 0 && <DropdownItem disabled>No cabinets yet</DropdownItem>}
                    {cabinets.map((cabinet) => (
                      <DropdownItem
                        key={cabinet.id}
                        onSelect={() => {
                          setSelectedCabinetId(cabinet.id);
                          close();
                        }}
                      >
                        {cabinet.name}
                      </DropdownItem>
                    ))}
                  </>
                )}
              </DropdownMenu>
            </div>
          )}
        </div>
      </Surface>
    </div>
  );
}
