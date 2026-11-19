# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via GitHub Security Advisories:

https://github.com/Hamzasohail123/sessionforge/security/advisories/new

You should receive a response within 48 hours. If the issue is confirmed, we will:

1. Work on a fix
2. Release a patched version
3. Publicly disclose the vulnerability after the fix is released

## Disclosure Policy

- We follow a 90-day disclosure timeline
- Security fixes are released as soon as possible
- Critical vulnerabilities may be fast-tracked

## Security Best Practices

When using SessionForge:

1. **Keep it updated** – Check [GitHub Releases](https://github.com/Hamzasohail123/sessionforge/releases) for new versions (SessionForge has no auto-update)
2. **Don't export production tokens** – Playwright exports contain live login tokens
3. **Add storageState files to .gitignore** – Never commit exported session files
4. **Use OS-level disk encryption** – Protects session data if your device is stolen
5. **Log out of production sessions** – When not actively testing

## Editor permission files
Settings → Agent Bridge → Editors → Approvals can edit `~/.cursor/permissions.json`, `~/.claude/settings.json` and `~/.codex/config.toml`, and only when you click **Apply** and confirm the preview. Before it writes, SessionForge:
- copies the file to `<file>.bak-YYYYMMDD-HHmmss` (when the file exists);
- changes only SessionForge entries (`sessionforge:*`, `mcp__sessionforge…`, or `default_tools_approval_mode` in `[mcp_servers.sessionforge]`), keeps comments, and refuses (falling back to copy-paste) when the file can't be parsed or edited safely, or is a symlink;
- never writes the Agent Bridge token, and redacts tokens and other secrets from the preview;
- writes through a temporary file and an atomic rename.
The renderer can only send an editor id and a preset id; main picks the fixed path. Auto-run presets make your editor skip its own prompts for SessionForge tools; SessionForge's per-session access, read-only production sessions and Stop still apply.
## Known Limitations

- Local malware with user-level access can read session data
- Exported Playwright files contain plaintext cookies and tokens
- Cookie encryption relies on OS keychain (can be bypassed by privileged malware)
- Agent Bridge: AI agents act with the session's real cookies, so anything an agent does is done as that logged-in user
- Agent Bridge: Read access allows GET/HEAD/OPTIONS through `send_request_as`, and a GET can still have side effects (for example `/logout`)
- Agent Bridge: closed shadow DOM and cross-origin iframes are not inspected by `snapshot`
- Sign in with Chrome creates a one-time request (random id, one session, fixed cookie domains, 10-minute expiry). The extension reads it from 127.0.0.1 (`GET /pending` returns only the id, session name and colour, cookie domains and expiry) and can only add cookies for those domains to that session; the client never chooses the session or the return URL. Any program running as you, and any extension in your Chrome, can do the same while a request is open, just as they can already create sessions through the import server

We document these honestly. SessionForge is designed to protect sessions from
cross-contamination and accidental leaks, not from OS-level malware.

## Contact

Report vulnerabilities privately through GitHub: https://github.com/Hamzasohail123/sessionforge/security/advisories/new
