import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Api } from '../../api';
import { ModalBase } from '../modals/ModalBase';
import { SoftButton } from '../SoftButton';
import { useAppStore } from '../../store';

type ProfileForm = {
  name: string;
  location: string;
  host: string;
  mode: 'proxy' | 'direct' | 'local-offline';
  apiKey: string;
  siteId: string;
};

type Profile = {
  id: number;
  name: string;
  location?: string | null;
  host: string;
  mode: 'proxy' | 'direct' | 'local-offline';
  siteId?: string | null;
};

type SiteOption = {
  id: string;
  name: string;
};

const emptyForm: ProfileForm = {
  name: '',
  location: '',
  host: '',
  mode: 'proxy',
  apiKey: '',
  siteId: '',
};

export function IpDashProfileModal() {
  const open = useAppStore((s) => s.ipDashProfileModalOpen);
  const closeModal = useAppStore((s) => s.closeIpDashProfileModal);
  const activeProfileId = useAppStore((s) => s.ipDashActiveProfileId);
  const setActiveProfileId = useAppStore((s) => s.setIpDashActiveProfileId);
  const qc = useQueryClient();
  const profilesQuery = useQuery({ queryKey: ['ipdash-profiles'], queryFn: Api.ipdash.profiles.list, enabled: open });
  const profiles = (profilesQuery.data?.profiles ?? []) as Profile[];
  const encryptionKeyMismatch = Boolean(profilesQuery.data?.encryptionKeyMismatch);
  const encryptionMessage =
    (profilesQuery.data?.encryptionMessage as string) || 'Encryption key changed. Reset encrypted profiles to continue.';
  const appEncKeyConfigured = profilesQuery.data?.appEncKeyConfigured ?? true;
  const formLockedMessage = encryptionKeyMismatch
    ? encryptionMessage
    : !appEncKeyConfigured
    ? 'Set APP_ENC_KEY in docker-compose.yml before adding IP Dash profiles.'
    : '';
  const formLocked = Boolean(formLockedMessage);
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<number | null>(null);
  const isLocalOffline = form.mode === 'local-offline';
  const [modeHelpOpen, setModeHelpOpen] = useState(false);
  const modeHelpRef = useRef<HTMLDivElement | null>(null);
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([]);
  const [siteFeedback, setSiteFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const combinedSiteOptions = useMemo(() => {
    if (!form.siteId || siteOptions.some((site) => site.id === form.siteId)) {
      return siteOptions;
    }
    return [...siteOptions, { id: form.siteId, name: form.siteId }];
  }, [siteOptions, form.siteId]);

  useEffect(() => {
    if (!open) {
      setForm(emptyForm);
      setEditingId(null);
      setStatus(null);
      setConfirmRemoveId(null);
      setModeHelpOpen(false);
      setSiteOptions([]);
      setSiteFeedback(null);
    }
  }, [open]);

  useEffect(() => {
    if (!modeHelpOpen) return;
    const handler = (event: MouseEvent) => {
      if (modeHelpRef.current && !modeHelpRef.current.contains(event.target as Node)) {
        setModeHelpOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modeHelpOpen]);

  useEffect(() => {
    if (isLocalOffline) {
      setSiteOptions([]);
      setSiteFeedback(null);
      if (form.siteId) {
        setForm((prev) => ({ ...prev, siteId: '' }));
      }
    }
  }, [isLocalOffline, form.siteId]);

  const createOrUpdate = useMutation({
    mutationFn: async () => {
      if (formLocked) {
        throw new Error(formLockedMessage);
      }
      const payload: Record<string, any> = {
        name: form.name.trim(),
        location: form.location.trim(),
        mode: form.mode,
      };
      if (!isLocalOffline) {
        payload.host = form.host.trim();
        if (form.siteId.trim()) {
          payload.siteId = form.siteId.trim();
        }
      }
      if (!payload.name) {
        throw new Error('Profile name is required.');
      }
      if (!isLocalOffline && !payload.host) {
        throw new Error('Controller host is required.');
      }
      const trimmedKey = form.apiKey.trim();
      if (!isLocalOffline && !editingId && !trimmedKey) {
        throw new Error('API key is required for new profiles.');
      }
      if (!isLocalOffline && trimmedKey) {
        payload.apiKey = trimmedKey;
      }
      if (payload.location === '') payload.location = null;
      if (editingId) {
        return Api.ipdash.profiles.update(editingId, payload);
      }
      return Api.ipdash.profiles.create(payload);
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['ipdash-profiles'] });
      setStatus({ tone: 'success', text: 'Profile saved.' });
      setForm(emptyForm);
      setEditingId(null);
      if (!activeProfileId) {
        setActiveProfileId(data?.profile?.id ?? null);
      }
    },
    onError: (err: any) => {
      setStatus({ tone: 'error', text: err?.message || 'Failed to save profile.' });
    },
  });

  const removeProfile = useMutation({
    mutationFn: (id: number) => {
      if (formLocked) {
        return Promise.reject(new Error(formLockedMessage));
      }
      return Api.ipdash.profiles.remove(id);
    },
    onSuccess: (_data, removedId) => {
      qc.invalidateQueries({ queryKey: ['ipdash-profiles'] });
      setConfirmRemoveId(null);
      if (activeProfileId === removedId) {
        setActiveProfileId(null);
      }
    },
    onError: (err: any) => setStatus({ tone: 'error', text: err?.message || 'Failed to remove profile.' }),
  });

  const testProfile = useMutation({
    mutationFn: () => {
      if (formLocked) {
        throw new Error(formLockedMessage);
      }
      if (!form.host.trim() || !form.apiKey.trim()) {
        throw new Error('Host and API key required for testing.');
      }
      return Api.ipdash.profiles.test({ host: form.host.trim(), apiKey: form.apiKey.trim(), mode: form.mode });
    },
    onSuccess: () => setStatus({ tone: 'success', text: 'Connection successful.' }),
    onError: (err: any) => setStatus({ tone: 'error', text: err?.message || 'Connection test failed.' }),
  });

  const loadSites = useMutation({
    mutationFn: async () => {
      if (formLocked) {
        throw new Error(formLockedMessage);
      }
      if (isLocalOffline) {
        throw new Error('Local Offline profiles do not use controller sites.');
      }
      if (!form.host.trim() || !form.apiKey.trim()) {
        throw new Error('Enter controller host and API key first.');
      }
      return Api.ipdash.sites.preview({ host: form.host.trim(), apiKey: form.apiKey.trim() });
    },
    onSuccess: (data: any) => {
      const options = Array.isArray(data?.sites) ? (data.sites as SiteOption[]) : [];
      setSiteOptions(options);
      if (options.length === 1) {
        setForm((prev) => ({ ...prev, siteId: options[0].id }));
      } else if (!options.some((site) => site.id === form.siteId)) {
        setForm((prev) => ({ ...prev, siteId: '' }));
      }
      setSiteFeedback({
        tone: options.length ? 'success' : 'error',
        text: options.length ? `Loaded ${options.length} site${options.length === 1 ? '' : 's'}.` : 'No sites returned.',
      });
    },
    onError: (err: any) => {
      setSiteFeedback({ tone: 'error', text: err?.message || 'Failed to load sites.' });
    },
  });

  const editingProfile = useMemo(() => profiles.find((profile) => profile.id === editingId) || null, [profiles, editingId]);

  const startEdit = (profile: Profile) => {
    setEditingId(profile.id);
    setStatus(null);
    setForm({
      name: profile.name,
      location: profile.location || '',
      host: profile.host,
      mode: profile.mode,
      apiKey: '',
      siteId: profile.siteId || '',
    });
    if (profile.siteId) {
      setSiteOptions((prev) => {
        if (prev.some((site) => site.id === profile.siteId)) return prev;
        return [...prev, { id: profile.siteId!, name: profile.siteId! }];
      });
    }
  };
  const cancelEditing = () => {
    setEditingId(null);
    setStatus(null);
    setForm(emptyForm);
    setSiteOptions([]);
    setSiteFeedback(null);
  };

  return (
    <ModalBase
      open={open}
      title={editingProfile ? `Edit profile – ${editingProfile.name}` : 'IP Dash profiles'}
      onClose={closeModal}
      size="lg"
    >
      <div className="stack gap-4">
        {formLocked && <div className="alert alert-error">{formLockedMessage}</div>}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="stack-sm">
            <div ref={modeHelpRef} className="label relative inline-flex items-center gap-2">
              Mode
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs font-normal text-primary hover:bg-surfaceStrong"
                onClick={() => setModeHelpOpen((prev) => !prev)}
                aria-expanded={modeHelpOpen}
                aria-haspopup="dialog"
                aria-label="Show connection mode info"
              >
                ?
              </button>
              {modeHelpOpen && (
                <div className="absolute left-0 top-full z-10 mt-2 w-80 rounded border border-border bg-white p-3 text-sm text-text shadow-xl">
                  <p className="mb-2 text-xs uppercase tracking-wide text-textSec">Info</p>
                  <p className="mb-2">
                    Connections are integrated with the UniFi API and currently work only with UniFi devices; other vendor
                    APIs are not supported yet.
                  </p>
                  <p className="mb-2">
                    <strong>Local proxy:</strong> Use this when your UniFi device does not have a trusted SSL certificate.
                    Requests are proxied through the internal service to avoid HTTPS/CORS issues and certificate warnings.
                  </p>
                  <p className="mb-2">
                    <strong>Direct device:</strong> Use this when your UniFi device has a signed SSL certificate so the app
                    can connect straight to it without using the internal proxy.
                  </p>
                  <p>
                    <strong>Local Offline:</strong> Use this without a UniFi device to manually create scopes and reserved
                    IPs. All data is saved locally in the database and no external APIs are called.
                  </p>
                </div>
              )}
            </div>
            <select
              className="input"
              value={form.mode}
              onChange={(e) => setForm((prev) => ({ ...prev, mode: e.target.value as ProfileForm['mode'] }))}
            >
              <option value="proxy">Local proxy</option>
              <option value="direct">Direct device</option>
              <option value="local-offline">Local Offline</option>
            </select>
          </label>

          <label className="stack-sm">
            <span className="label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Profile name"
            />
          </label>
          <label className="stack-sm">
            <span className="label">Host</span>
            <input
              className="input"
              disabled={isLocalOffline}
              value={form.host}
              onChange={(e) => setForm((prev) => ({ ...prev, host: e.target.value }))}
              placeholder={isLocalOffline ? 'Not required for Local Offline' : 'https://192.168.68.1'}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              name="ipdash-host"
            />
          </label>

          <label className="stack-sm">
            <span className="label">API key</span>
            <input
              className="input"
              type="password"
              disabled={isLocalOffline}
              value={form.apiKey}
              onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              name="ipdash-api-key"
              placeholder={
                isLocalOffline
                  ? 'Local Offline profiles do not use API keys'
                  : editingProfile
                  ? 'Leave blank to keep existing key'
                  : 'Enter API key'
              }
            />
          </label>

          {!isLocalOffline && (
            <label className="stack-sm md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label">Controller site</span>
                <SoftButton
                  variant="ghost"
                  onClick={() => loadSites.mutate()}
                  disabled={formLocked || loadSites.isPending || !form.host.trim() || !form.apiKey.trim()}
                >
                  {loadSites.isPending ? 'Loading…' : 'Load sites'}
                </SoftButton>
              </div>
              <select
                className="input"
                value={form.siteId}
                onChange={(e) => setForm((prev) => ({ ...prev, siteId: e.target.value }))}
              >
                <option value="">Select site (optional)</option>
                {combinedSiteOptions.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              {siteFeedback && (
                <p className={`text-sm ${siteFeedback.tone === 'error' ? 'text-error' : 'text-success'}`}>
                  {siteFeedback.text}
                </p>
              )}
            </label>
          )}

          <label className="stack-sm md:col-span-2">
            <span className="label">Location</span>
            <input
              className="input"
              value={form.location}
              onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="Optional description"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <SoftButton variant="ghost" onClick={() => setForm(emptyForm)} disabled={createOrUpdate.isPending}>
            Reset
          </SoftButton>
          <SoftButton
            variant="ghost"
            onClick={() => !isLocalOffline && testProfile.mutate()}
            disabled={testProfile.isPending || isLocalOffline || formLocked}
          >
            {isLocalOffline ? 'Unavailable in Local Offline' : testProfile.isPending ? 'Testing…' : 'Test connection'}
          </SoftButton>
          <SoftButton onClick={() => createOrUpdate.mutate()} disabled={createOrUpdate.isPending || formLocked}>
            {createOrUpdate.isPending ? 'Saving…' : editingProfile ? 'Save changes' : 'Add profile'}
          </SoftButton>
        </div>

        {status && (
          <div className={`alert ${status.tone === 'error' ? 'alert-error' : 'alert-success'}`}>{status.text}</div>
        )}

        <div className="stack gap-2">
          <h4 className="type-title-sm">Saved profiles</h4>
          {profiles.length === 0 && <p className="type-body-sm text-textSec">No profiles added yet.</p>}
          <div className="saved-profiles-grid">
            {profiles.map((profile) => {
              const active = profile.id === activeProfileId;
              const modeLabel = profile.mode === 'direct' ? 'Direct' : profile.mode === 'local-offline' ? 'Local Offline' : 'Proxy';
              return (
                <div key={profile.id} className={`profile-card ${active ? 'active' : ''}`}>
                  <div className="profile-card-text">
                    <span className="profile-card-name">{profile.name}</span>
                    {profile.location ? <span className="profile-card-meta">{profile.location}</span> : null}
                    <span className="profile-card-meta">Host: {profile.host}</span>
                    <span className="profile-card-meta">Mode: {modeLabel}</span>
                  </div>
                  <div className="profile-card-actions">
                    <SoftButton
                      className={`profile-use-btn ${active ? 'is-active' : ''}`}
                      onClick={() => {
                        setActiveProfileId(profile.id);
                        closeModal();
                      }}
                    >
                      {active ? 'Using now' : 'Activate'}
                    </SoftButton>
                    <SoftButton
                      variant="ghost"
                      className="profile-action-btn"
                      onClick={() =>
                        editingProfile?.id === profile.id
                          ? cancelEditing()
                          : startEdit(profile)
                      }
                      disabled={formLocked}
                    >
                      {editingProfile?.id === profile.id ? 'Cancel edit' : 'Edit'}
                    </SoftButton>
                    <SoftButton
                      variant="danger"
                      className="profile-action-btn"
                      onClick={() => {
                        if (confirmRemoveId === profile.id) {
                          removeProfile.mutate(profile.id);
                        } else {
                          setConfirmRemoveId(profile.id);
                        }
                      }}
                      disabled={formLocked || removeProfile.isPending}
                    >
                      {confirmRemoveId === profile.id ? 'Confirm' : 'Remove'}
                    </SoftButton>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ModalBase>
  );
}
