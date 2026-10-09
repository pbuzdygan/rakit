import { useEffect, useRef, useState } from 'react';
import { ModalBase } from './ModalBase';
import { useAppStore } from '../../store';
import { MODULES } from '../../modules';
import { OperationsIcon } from '../OperationsIcon';
import { Api } from '../../api';
import { formatDateTime } from '../../utils/dateTime';

const TABS = ['General', 'Modules', 'About'] as const;
type Tab = typeof TABS[number];

export function SettingsModal() {
  const state = useAppStore();
  const open = state.modals.settings;
  const [tab, setTab] = useState<Tab>('General');
  const content = useRef<HTMLDivElement>(null);
  const close = () => useAppStore.getState().closeModal('settings');

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => content.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus(), 0);
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const dialog = content.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]') ?? []).filter((el) => el.tabIndex >= 0 && el.getClientRects().length);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', keyboard);
      // The mobile drawer is closed when Settings opens.
      const mobile = window.matchMedia('(max-width: 820px)').matches;
      const target = mobile ? document.querySelector<HTMLElement>('[aria-controls="ops-primary-navigation"]') : opener;
      target?.focus();
    };
  }, [open]);

  const status = state.releaseCheckStatus;
  const checkMessage = status === 'checking' ? 'Checking for updates…'
    : status === 'unavailable' ? 'Update check unavailable.'
    : status === 'no-release' ? 'No release found for this channel.'
    : status === 'development' ? 'Development build: release comparison is unavailable.'
    : status === 'success' ? state.updateAvailable ? 'Update available' : 'You are up to date.'
    : 'Updates have not been checked yet.';
  const repoUrl = `https://github.com/${state.repoSlug}`;
  const releaseUrl = state.latestVersion ? `${repoUrl}/releases/tag/${encodeURIComponent(state.latestVersion)}` : `${repoUrl}/releases`;

  return <ModalBase open={open} title="Settings" eyebrow="System" onClose={close} size="md">
    <div className="ops-settings" ref={content}>
      <div className="ops-settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((item, index) => <button key={item} type="button" role="tab" id={`settings-tab-${item}`} aria-controls={`settings-panel-${item}`} aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
          if (next === null) return;
          event.preventDefault(); setTab(TABS[next]); document.getElementById(`settings-tab-${TABS[next]}`)?.focus();
        }}>{item}</button>)}
      </div>
      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="ops-settings-panel">
        {tab === 'General' ? <>
          <section><h3>Appearance</h3><p>Choose the theme for this browser.</p><div className="ops-settings-row"><span>Current theme: <strong>{state.theme}</strong></span><button type="button" className="ops-button ops-button--secondary" onClick={() => state.setTheme(state.theme === 'light' ? 'dark' : 'light')}><OperationsIcon name={state.theme === 'light' ? 'moon' : 'sun'} />Switch to {state.theme === 'light' ? 'dark' : 'light'}</button></div></section>
          <section><h3>Session</h3><p>Lock the application and return to the sign-in screen.</p><button type="button" className="ops-button ops-button--secondary" onClick={() => { void Api.session.logout().finally(() => { close(); useAppStore.getState().setPinSession(false); }); }}><OperationsIcon name="lock" />Lock application</button></section>
        </> : null}
        {tab === 'Modules' ? <>
          <h3>Visible modules</h3><p>Choose what appears in the sidebar and Overview. Changes are saved automatically in this browser. Hiding a module keeps its data and scheduled tasks.</p>
          <div className="ops-settings-modules">{MODULES.map((module) => <label key={module.id} className="ops-settings-module"><OperationsIcon name={module.icon} /><span>{module.label}</span><input type="checkbox" role="switch" aria-label={module.label} className="ops-settings-switch" checked={state.moduleVisibility[module.id]} onChange={(event) => state.setModuleVisible(module.id, event.target.checked)} /></label>)}</div>
          <button type="button" className="ops-button ops-button--secondary" onClick={state.resetModuleVisibility}>Restore defaults</button>
        </> : null}
        {tab === 'About' ? <>
          <h3>RAKIT</h3><p>Infrastructure management</p>
          <dl className="ops-settings-details"><div><dt>Current version</dt><dd>{state.appVersion || (state.metaStatus === 'loading' ? 'Loading…' : 'Unavailable')}</dd></div><div><dt>Release channel</dt><dd>{state.releaseChannel || '—'}</dd></div><div><dt>Latest checked version</dt><dd>{state.latestVersion || '—'}</dd></div><div><dt>Last successful check</dt><dd>{state.releaseCheckedAt ? formatDateTime(state.releaseCheckedAt, state.timeZone) : 'Not yet checked'}</dd></div></dl>
          <p className={state.updateAvailable ? 'ops-settings-update-message' : ''} role="status">{checkMessage}</p>
          <div className="ops-settings-links"><a className="ops-button ops-button--secondary" href={releaseUrl} target="_blank" rel="noreferrer">{state.updateAvailable ? 'View update' : 'View releases'}<OperationsIcon name="link" /></a><a href={repoUrl} target="_blank" rel="noreferrer">GitHub repository</a></div>
        </> : null}
      </div>
      <div className="ops-settings-footer"><button type="button" className="ops-button ops-button--secondary" onClick={close}>Close</button></div>
    </div>
  </ModalBase>;
}
