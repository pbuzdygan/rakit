# Rakit Ansible playbooks

This directory is intended to be mounted read-only into Semaphore, for example:

```yaml
volumes:
  - ./ansible:/opt/semaphore/ansible:ro
```

Create a local Semaphore repository pointing to `/opt/semaphore/ansible`, then create Ansible task templates for:

| Template | Playbook | Required prompt |
| --- | --- | --- |
| Check updates | `playbooks/check-updates.yml` | Limit |
| Update packages | `playbooks/update-packages.yml` | Limit |
| Reboot | `playbooks/reboot.yml` | Limit |
| Health check | `playbooks/health-check.yml` | Limit |

All templates must use the dedicated inventory managed by Rakit. Enable the **Limit** prompt on every template before mapping it in Rakit.

The check playbook currently targets Debian-family systems using APT. Unsupported operating systems fail explicitly instead of reporting a misleading zero update count.

The update check, package upgrade and reboot playbooks explicitly use `sudo` to become `root` and verify the effective UID before gathering facts or making changes. Configure the inventory's Sudo Credentials / Become Key in Semaphore for password-based escalation.

Copy the entire `ansible/` directory, including `playbooks/tasks/`. The shared preflight detects `sudo-rs` without escalation and uses `/usr/bin/sudo.ws` when it is available and executable, avoiding incompatible password prompts without changing system alternatives or sudoers. Explicit `ansible_become_exe` and `ansible_sudo_exe` variables take precedence over detection. If classic sudo is absent, the default sudo remains in use and the log explains how to diagnose compatibility. See [the setup guide](../semaphore/SETUP.pl.md#diagnostyka-timeout-przy-sudo-z-hasłem) for verification and alternatives.
