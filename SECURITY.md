# Security Policy

## Supported versions

Only the latest commit on the default branch is supported.

## Reporting a vulnerability

Open an issue on the repository, or contact the maintainers privately if the
issue involves secrets. Please include:

- the affected version / commit,
- a description of the impact,
- reproduction steps.

## Security posture of this plugin

- The reverse proxy binds to `127.0.0.1` only and rejects any non-loopback
  client (defense in depth: remote peers get no response path).
- The management API is served on the DSH web server under
  `/api/opencodego-multikey/*` and is guarded by the same loopback fence; it
  is meant for the local dashboard only and is never exposed to the WAN.
- API keys are masked in every public view (web UI, overview API, README
  examples). Raw keys exist only in memory and in the state file
  `<DSH_HOME>/storages/opencodego-multikey.json` — keep that file
  permissions-restricted, do not commit it, and never paste keys into chat
  logs or issues.
- The model body is forwarded as-is; only the `model` field may be rewritten
  by an explicit `fallbacks` configuration, and only when the selected key's
  remaining quota is below `fallbackThresholdPct`.
- Requests are proxied with the upstream scheme of `upstreamBaseURL` (`https`
  by default); there is never a cleartext hop to the real endpoint.