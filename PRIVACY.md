# Privacy Policy

**Last updated: November 2026**

## Summary

SessionForge is a local-first desktop application. No data leaves your machine by default.

## Data Collection

SessionForge collects **no data**, and there is no setting to turn collection on. There are:

- No analytics or usage statistics
- No crash reports
- No telemetry
- No update checks
- No user accounts
- No cloud sync

SessionForge's network traffic is the pages you (or an agent you connected) open in its sessions. The only request it makes on its own is when an AI agent you connected through the Agent Bridge calls `send_request_as`: it then sends that request, to the URL the agent chose, with the cookies of the sessions the agent named.

Sign in with Chrome opens one URL in your browser. SessionForge sends nothing itself; the extension sends the cookies of the requested domains to SessionForge on 127.0.0.1 only.

## Data Storage

All session data (cookies, localStorage, IndexedDB, cache) is stored locally:

- **Linux**: `~/.config/sessionforge/`
- **macOS**: `~/Library/Application Support/sessionforge/`
- **Windows**: `%APPDATA%\sessionforge\`

Session metadata (names, colors, tabs) is stored in a local SQLite database.

Closing a session (the `×` in the session bar) keeps its cookies and storage on disk, so `Cmd/Ctrl+Shift+T` can reopen it logged in; the URLs of its tabs and of recently closed tabs are kept in the same database. A closed session's data is removed when more than 10 sessions are closed (the oldest goes first) or when you choose **Delete permanently**. Closing tabs never removes it: the URLs of the 25 most recently closed tabs are kept, and older tab URLs are dropped.

Agent Bridge: the on/off setting and the per-session agent access levels are stored in the same local database. The bearer token is stored encrypted with the OS keyring in `agent-bridge/token.bin` inside the data folder (or kept in memory only when no keyring is available). The activity log and the console and network logs that agents read live in memory only and are cleared when the bridge stops. None of this is sent anywhere. The bridge listens only on 127.0.0.1, and its only outbound requests are the `send_request_as` calls described above.

## Data Sharing

SessionForge does not share data with third parties. There are no:

- Advertising networks
- Analytics services
- Third-party trackers
- Cloud providers (for session data)

## Exported Files

SessionForge can write a session to a Playwright `storageState` file (internal API only for now; there is no export button yet). Such a `.json` file contains:

- Cookies (including auth tokens)
- localStorage values

This file is **your responsibility** to protect. Add it to `.gitignore` and do not commit it.

## Updates

SessionForge does not check for updates. New versions are published on [GitHub Releases](https://github.com/Hamzasohail123/sessionforge/releases).

## Children's Privacy

SessionForge is a developer tool not directed at children. We do not knowingly collect data from users under 13.

## Changes

Changes to this policy will be announced in release notes and committed to this file.

## Contact

Questions about privacy? Open an issue: https://github.com/Hamzasohail123/sessionforge/issues
