import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Api } from '../../api';
import { useAppStore } from '../../store';
import { OperationsIcon } from '../OperationsIcon';

type Profile = {
  id: number;
  name: string;
  location?: string | null;
  mode: 'proxy' | 'direct' | 'local-offline';
};

export function IpDashProfileMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeProfileId = useAppStore((s) => s.ipDashActiveProfileId);
  const setActiveProfileId = useAppStore((s) => s.setIpDashActiveProfileId);
  const profilesQuery = useQuery({ queryKey: ['ipdash-profiles'], queryFn: Api.ipdash.profiles.list });
  const profiles = (profilesQuery.data?.profiles ?? []) as Profile[];
  const encryptionMismatch = Boolean(profilesQuery.data?.encryptionKeyMismatch);
  const encryptionMessage =
    (profilesQuery.data?.encryptionMessage as string) || 'Encryption key changed. Reset encrypted profiles to continue.';
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="ops-profile-dropdown" ref={menuRef}>
      <button
        type="button"
        className="ops-profile-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={encryptionMismatch ? encryptionMessage : undefined}
      >
        <span>Profile</span><strong>{activeProfile?.name ?? (profilesQuery.isFetching ? 'Loading…' : 'Select profile')}</strong><OperationsIcon name="chevron" className={open ? 'is-open' : ''} />
      </button>
      {open ? <div className="ops-profile-dropdown-panel" role="menu">
        {encryptionMismatch ? <div className="ops-profile-dropdown-note"><strong>Encryption key changed</strong><span>{encryptionMessage}</span></div> : null}
        {!profiles.length && !profilesQuery.isFetching ? <div className="ops-profile-dropdown-note"><span>No profiles configured.</span></div> : null}
        {profiles.map((profile) => {
          const active = profile.id === activeProfileId;
          const mode = profile.mode === 'local-offline' ? 'Local offline' : profile.mode === 'direct' ? 'Direct' : 'Proxy';
          return <button key={profile.id} type="button" role="menuitemradio" aria-checked={active} className={`ops-profile-option ${active ? 'is-active' : ''}`} onClick={() => { setActiveProfileId(profile.id); setOpen(false); }}><span><strong>{profile.name}</strong><small>{[profile.location, mode].filter(Boolean).join(' · ')}</small></span>{active ? <OperationsIcon name="check" /> : null}</button>;
        })}
      </div> : null}
    </div>
  );
}
