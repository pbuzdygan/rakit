# Changelog

All notable changes to this project will be documented in this file.

## [1.1] - 2024-03-10

### Added
- Application-wide encryption for IP Dash controller API keys powered by the new `APP_ENC_KEY` secret and AES-256-GCM at rest.
- Automatic detection of encryption key mismatches with UI messaging, guarded backend routes, and a secure reset workflow that requires typing `RESET` (plus the optional PIN) before clearing encrypted profiles.
- Container log signals that describe the encryption state, making it clear when the key is missing, mismatched, or ready.
- GitHub Actions release build that installs dependencies, builds the frontend, and runs a Docker build every time a GitHub Release is published.
