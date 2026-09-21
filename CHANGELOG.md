# Changelog

All notable changes to this project will be documented in this file.

## [1.4.1] - 2026-09-21

### Bug fixes
- Preserve valid per-server update-check results when another host makes the overall Semaphore task fail.
- Send per-server Ansible limits in both the current `params.limit` format and the legacy top-level format so **Check now** targets only the selected server across supported Semaphore versions.
- Parse copied or decorated multiline Semaphore result records that repeat a timestamp on continuation lines.

## [1.4.0] - 2026-09-17

### New features
- Added the Servers workspace: a local server catalogue with groups, tags, location, role, operating system, management addresses and Ansible connection settings.
- Added optional Semaphore integration for publishing a Rakit-managed static inventory and running explicitly mapped update-check, update and reboot templates.
- Added server update state, security update counts, reboot-required status, operation history and direct Cockpit, Semaphore and SSH links.
- Added ready-to-import Semaphore project backup, setup documentation and Ansible playbooks for update checks, controlled upgrades, reboot and health facts.

### Improvements
- Rakit is the source of truth for managed servers. Server and group management remains fully available without a configured or reachable Semaphore instance.
- Servers entered before enabling Semaphore are retained locally and included when the generated inventory is first reviewed and published.
- Semaphore API tokens are encrypted at rest and never exposed to the frontend after saving; SSH and privilege-escalation credentials remain in Semaphore Key Store.
- Inventory publication detects out-of-band changes and requires an explicit review before adopting or replacing a Semaphore inventory.
- Runtime base packages receive current Debian security fixes during image builds; the full Trivy runtime scan now runs monthly or on demand and reports findings without blocking image publication.
- Semaphore tasks launched from Rakit are reconciled in the backend even when the Servers screen is closed, and unfinished actions resume visible polling when the inspector is reopened.
- Server health checks can now be launched from Rakit; successful health or update checks set the host online and retain kernel and uptime facts.
- Added per-server managed-inventory synchronization indicators and the timestamp/result of the latest package update.
- Added an independent per-server network reachability signal, refreshed with one ICMP echo to the management address every minute; TCP probing remains available only as an explicit opt-in.
- Separated health from package checks: only health tasks now update the Health state and Last health timestamp.
- Scheduled Semaphore tasks now import per-host health, update-check, package-update and reboot results, while tasks launched manually in Semaphore remain external to Rakit.
- Improved the Servers mobile layout with compact server cards, responsive controls and a full-width inspector without edge shadows.
- Updated snapshot export module names to match the current navigation and added a detailed Servers worksheet.
- Added a bidirectional first inventory synchronization choice: keep and publish the Rakit catalogue, or safely import a compatible remote Semaphore inventory as the initial local source of truth.
- Added sortable Servers columns with visible direction indicators, consistent last-event timestamps, and lighter Health/Network labels.
- Inventory-changing server and group edits synchronize automatically and briefly confirm success in the toolbar; unavailable Semaphore instances leave the complete local projection pending for a safe manual retry, while metadata-only edits do not create a false pending state.
- Added an optional per-server SSH user used by the Management shortcut and included in Servers snapshot exports.
- Added a versioned portable Rakit catalog inside Semaphore inventory comments, preserving display group names, full server metadata, group membership and unmanaged catalogue entries across Rakit instances without changing Ansible behavior.
- Rakit instances sharing one managed inventory now pull newer remote catalogue revisions automatically when their local copy is clean; genuinely concurrent local edits still stop as an explicit conflict instead of silently losing data.

### Bug fixes
- Fixed explicit `Ports per row` layouts using odd/even port placement instead of filling each row sequentially.
- Fixed successful Semaphore tasks remaining indefinitely in Running when the user navigated away before completion.
- Fixed update results being missed when Semaphore wraps the `RAKIT_RESULT_V1` JSON across multiple output lines.
- Fixed update and health result collection by reading Semaphore's plain-text task log endpoint, removing terminal colour codes and retaining a compatibility fallback to the structured output endpoint.
- Added an explicit root privilege preflight to update-check, package-update and reboot playbooks so missing Semaphore sudo credentials fail before APT or reboot operations.
- Fixed multi-host scheduled task results updating only one server, and use the Semaphore completion time for imported results.
- Normalized common backslash variants of IANA time zones such as `europe\\warsaw` to `Europe/Warsaw`.
- Fixed the Servers list omitting persisted health-check and package-update timestamps, and corrected the Ansible inventory icon in light mode.

## [1.3.0]

### New features
- New Operations Console interface with a collapsible left navigation, clearer workspace layout, Tabler-based icons, keyboard access to module search ('/')
- New Overview dashboard with infrastructure counters
- New rack capabilities: manage multiple cabinets, choose top-down or bottom-up U numbering, show front and rear together, use front/rear placement, and place compatible devices side by side in one rack unit.
- New Port Map workspace for viewing several devices at once, mapping physical port connections, filtering the connection list, and editing both connection and port metadata from one place.
- New Wake on LAN workspace for managing machines, checking their status, sending wake packets, and creating optional recurring wake schedules.
- New Audit Log workspace with filtering, pagination and CSV export.
- Local IP Addressing now supports offline scopes and reservations alongside UniFi controller data.
- Rakit can now be installed as a PWA with a complete cached application shell and dedicated guidance for Android, desktop browsers and iOS.

### Improvements
- Racks now present cabinet capacity, device placement, device status, model and management IP in a denser, more readable operations-focused layout.
- Rack editing has been streamlined: cabinet actions stay in the cabinet header, device actions stay with the rack, front is always visible, and rear can be shown when needed.
- Device and cabinet forms, port editing, IP Dash profiles, WOL and export notifications now use one consistent Rakit dialog and control style.
- Port layouts are more legible, with configurable ports-per-row for devices that use one or two physical port rows.
- Every workspace search can now be reached with the `/` key; the shortcut focuses the search field for the currently open module.
- Racks now include a dedicated device search that filters by device name, model, management IP, asset tag or note while keeping occupied rack units visible.
- Overview and Audit Log now include more useful operation details, such as affected device names, cabinets, models, port endpoints and WOL targets.
- Destructive actions use an in-place confirmation on the same button, helping prevent accidental removal without browser confirmation pop-ups.
- Improved readability across the application with larger text, clearer spacing, stronger status colours and better light-theme contrast.
- Added a complete mobile layout for current phone screens, including a drawer-style navigation, touch-friendly controls, compact rack management, card-based IP and audit data, responsive dialogs, and safe-area support.
- UniFi controller connections verify TLS certificates by default, support an explicit exception for trusted self-signed controllers, and can use private CA certificates supplied to the container.
- Runtime and release process improvements make the container smaller, run as an unprivileged user, preserve time-zone settings, and provide safer session handling and encrypted UniFi profile secrets.
- GitHub build and security workflows now use Node 24-compatible action runtimes and keep incompatible major React and Tailwind migrations out of automatic dependency updates.
- PWA updates now wait for confirmation before reloading, installation requirements are explained in the interface, and offline status clearly identifies which functions still require the Rakit server.

### Bug fixes
- Fixed cabinet device updates that did not save changes such as height or status.
- Fixed rack placement and reordering for left/right half-width devices, including moving devices between sides and sharing a rack unit.
- Fixed the navigation toggle so a collapsed menu can always be opened again.
- Fixed front/rear rack placement workflow so a device face can be changed directly while reordering.
- Fixed inaccurate or stretched port rendering in earlier rack and Port Map layouts.
- Fixed incomplete audit entries for removed devices and port connections; new entries retain useful identification details.
- Fixed status colours and controls that were difficult to read in light mode, including active and destructive buttons.
- Fixed theme transitions so the navigation and workspace change consistently.
- Fixed container startup permissions after the hardened runtime changes.
- Fixed the UniFi self-signed certificate setting so it is applied directly to the selected profile connection, including connections made by IP address.
- Fixed mobile detail panels so port, connection, rack device, WOL and IP information opens as a usable full-height sheet, and ensured rear rack views always appear below the front view on phones.
- Fixed mobile Racks scrolling so the full front elevation remains reachable when the rear view is hidden.
- Fixed the mobile PIN screen so focusing the PIN field no longer zooms and leaves the login button outside the visible area.
- Fixed mobile PIN submission so the first tap on Enter logs in instead of only dismissing the software keyboard.
- Fixed first-launch PWA caching, install prompts missed before PIN login, stale service-worker delivery and automatic reloads that could interrupt unsaved work.
- Removed automatic demo rack seeding so a new or deliberately emptied database stays empty after restarting Rakit.
- Fixed Compose configuration so `APP_PIN` and `APP_ENC_KEY` are read explicitly from `.env` instead of being shadowed by example values.

## [1.2.0] - 2025-12-16

### Added
- Port aware devices can now be configured while adding/editing hardware, including a `Number of ports` field (max 48), data-preserving export, and safety confirmations when shrinking or disabling the feature.
- New Port Hub workspace sits next to IT Cabinet/IP Dash to list every port-aware device, visualize LAN ports in 24-wide rows, and edit Patch Panel/VLAN/IP/comment metadata per port with persistent storage.

### Improved
- Device cards across Cabinet and Port Hub share the same compact iconography, clearer LAN indicators, inline comment/edit/delete controls, and consistent confirmation flows.
- Port Hub editing now keeps Tag/VLAN/IP/Comment inputs on a single row, exposes inline Save/Clear actions (with orange “dirty” and green “Saved” states), and adds Link mode controls that sync and pulse across all selected devices.
- Version Info honours the running channel and only surfaces releases from the matching stream, while the Docker publish workflow now tags `latest` solely for main releases and `dev_latest` solely for dev to prevent cross-branch upgrades.

## [1.1.3] - 2025-12-16

### Added
- Version Awareness now surfaces the current build/channel inside the bar, tracks GitHub releases for both stable and the new dedicated `dev` line, and raises a call-to-action whenever a fresher dev build appears.
- The PWA install banner now follows Rakit style.

### Improved
- Rack management on phones now uses a compact list that still shows multi-U spans, so every device stays readable without wasting screen space.
- Drag-and-drop reordering is clearer thanks to a dedicated toggle that works across form factors and disables conflicting actions until changes are saved.
- Device cards highlight stored comments, use sharper edit/remove affordances, and keep confirm/cancel prompts aligned with their intent (red delete, neutral cancel) to reduce mistakes.

## [1.1.2] - 2025-12-01

### Fixed
- Improved mobile responsiveness across Main Bar, IT Cabinet, and IP Dash dropdowns, ensuring menus stay visible, stack correctly, and can be selected on touch devices.
- Relocated the IP Dash connection banner to the controls card and aligned its status pill with the connection text.
- Adjusted rack header layout and action buttons for smaller screens to keep cabinet info readable and actions accessible.

## [1.1.1] - 2025-12-01

### Fixed
- Container now exits with `Error: APP_PIN must be provided (4-8 digits)` when the PIN is missing or invalid, preventing the app from starting without a proper secret.

## [1.1] - 2024-03-10

### Added
- Application-wide encryption for IP Dash controller API keys powered by the new `APP_ENC_KEY` secret and AES-256-GCM at rest.
- Automatic detection of encryption key mismatches with UI messaging, guarded backend routes, and a secure reset workflow that requires typing `RESET` (plus the optional PIN) before clearing encrypted profiles.
- Container log signals that describe the encryption state, making it clear when the key is missing, mismatched, or ready.
- GitHub Actions release build that installs dependencies, builds the frontend, and runs a Docker build every time a GitHub Release is published.
