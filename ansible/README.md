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

The update check, package upgrade and reboot playbooks explicitly use `sudo` to become `root` and verify the effective UID before making changes. Configure the inventory's Become Key in Semaphore, or provide a tested `NOPASSWD` rule for the dedicated SSH account.
