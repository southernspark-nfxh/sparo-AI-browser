# Security

Sparo is a local browser. Treat this repository as **client source**, not a place for secrets.

## Never commit

- `.env`, API keys, JWT, payment merchant keys
- `%APPDATA%\sparo-store` (`settings.json`, `mcp-auth.json`, `cloud-session.bin`, cookies)
- Page dumps, QA scratch, Steam/store session HTML

Cloud model keys stay on the **server**. The client only stores an encrypted login token via Electron `safeStorage`.

## Report

If you find a vulnerability in this client, email the address on [southernspark.dev](https://southernspark.dev) — do not open a public issue with tokens or cookies.
