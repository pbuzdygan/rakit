import { useQuery } from '@tanstack/react-query';
import { Api } from '../../api';
import { DropdownItem, DropdownMenu } from '../DropdownMenu';
import { useAppStore } from '../../store';

type Profile = {
  id: number;
  name: string;
  location?: string | null;
  mode: 'proxy' | 'direct';
};

export function IpDashProfileMenu() {
  const activeProfileId = useAppStore((s) => s.ipDashActiveProfileId);
  const setActiveProfileId = useAppStore((s) => s.setIpDashActiveProfileId);
  const profilesQuery = useQuery({ queryKey: ['ipdash-profiles'], queryFn: Api.ipdash.profiles.list });
  const profiles = (profilesQuery.data?.profiles ?? []) as Profile[];
  const encryptionMismatch = Boolean(profilesQuery.data?.encryptionKeyMismatch);
  const encryptionMessage =
    (profilesQuery.data?.encryptionMessage as string) || 'Encryption key changed. Reset encrypted profiles to continue.';
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) || null;
  const label = activeProfile ? `Profile: ${activeProfile.name}` : 'Profile';

  return (
    <div className="ipdash-profile-menu-shell">
      <DropdownMenu label={label} align="right" variant="ghost" buttonClassName="ipdash-profile-btn">
        {({ close }) => (
          <div className="ipdash-profile-menu">
            {encryptionMismatch && (
              <div className="dropdown-note">
                <strong>Encryption key changed.</strong>
                <br />
                {encryptionMessage}
              </div>
            )}
            {profilesQuery.isFetching && profiles.length === 0 && (
              <div className="dropdown-note">Loading profiles…</div>
            )}
            {profiles.length === 0 && !profilesQuery.isFetching && (
              <div className="dropdown-note">No profiles yet. Add one to connect.</div>
            )}
            {profiles.map((profile) => (
              <DropdownItem
                key={profile.id}
                onSelect={() => {
                  setActiveProfileId(profile.id);
                  close();
                }}
              >
                <div className="ipdash-profile-option">
                  <div className="ipdash-profile-text">
                    <span className="ipdash-profile-name">{profile.name}</span>
                    {profile.location ? <span className="ipdash-profile-location">{profile.location}</span> : null}
                  </div>
                </div>
              </DropdownItem>
            ))}
          </div>
        )}
      </DropdownMenu>
    </div>
  );
}
