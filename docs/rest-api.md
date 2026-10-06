# REST API and command line

The REST API runs under `/api/v1`. The full machine-readable description is at `/api/v1/openapi.json`.

## Keys

1. In Settings > API Keys, create a key. Choose **Full access** to change things, or **Read only** for scripts that only read.
2. Send it on every request:

   ```
   Authorization: Bearer <key>
   ```

   HTTP Basic auth also works, with the key as the password. The user name is ignored.

Each key belongs to the user who created it. A key can only see that user's monitors.

| Limit | Value |
| --- | --- |
| Requests per key | 60 per minute. Set `UK_API_RATE_LIMIT` on the server to change it. Over the limit: `429` with `Retry-After`. |
| Failed key attempts | Share one limit across all clients. Over the limit: `429`. |
| Read-only key, any change | `403` |

## Errors

Every error is JSON: `{ "ok": false, "msg": "..." }`.

| Status | Meaning |
| --- | --- |
| 400 | Bad input. The message says what to fix. |
| 401 | Missing or wrong key. |
| 403 | Read-only key used for a change. |
| 404 | Monitor not found, or not yours. |
| 429 | Rate limit reached. |
| 500 | Server fault. The details are in the server log, not the response. |

## Monitors

| Method and path | What it does |
| --- | --- |
| `GET /monitors` | List. Filters: `q`, `type`, `active`. Paging: `limit` (1-500), `offset`. Total in `X-Total-Count`. |
| `POST /monitors` | Create. Only `name` is required. The body uses the same fields as the monitor form. |
| `GET /monitors/{id}` | One monitor. |
| `PATCH /monitors/{id}` | Change some fields. The rest stay as they are. |
| `DELETE /monitors/{id}` | Delete. `?deleteChildren=true` also deletes a group's children. |
| `POST /monitors/{id}/pause` / `resume` | Pause or resume. |
| `POST /monitors/bulk` | Change many at once: `{ "monitorIDs": [1, 2], "changes": { "interval": 60, "parent": 5, "addTag": { "tagID": 1, "value": "eu" } } }`. Nothing changes if any check fails. |

## Analytics and checks

| Method and path | What it does |
| --- | --- |
| `GET /monitors/{id}/analytics?period=` | Summary, series and incidents. `period` is 24, 168, 720 (30 days), 2160 (90 days) or 8760 (365 days). Over 90 days only daily uptime and ping are kept, so incident figures are `null`. |
| `GET /monitors/{id}/heartbeats?hours=` | Raw checks, up to 8760 hours. Add `&format=csv` for CSV. |

Status codes in checks: 0 down, 1 up, 2 pending, 3 maintenance.

## Backup

| Method and path | What it does |
| --- | --- |
| `GET /backup` | Plain backup: monitors, notifications, tags and status pages. Status page passwords are never included. |
| `POST /backup/export` | Encrypted backup. Body: `{ "passphrase": "at least 8 characters" }`. |
| `POST /backup` | Restore. For an encrypted file, send the passphrase in the `x-backup-passphrase` header. |

Items that already exist (same monitor name, notification name, tag name or status page slug) are skipped, so restoring twice is safe.

Keep the passphrase. An encrypted file cannot be restored without it.

## Command line

The CLI uses the same API and needs no extra packages (Node.js 18 or newer).

```
set UK_URL=http://localhost:3001
set UK_API_KEY=<key>
npm run uk-cli -- list
npm run uk-cli -- analytics 3 --period 168
npm run uk-cli -- checks 3 --hours 720 --csv > checks.csv
npm run uk-cli -- bulk --ids 1,2,3 --interval 120
npm run uk-cli -- backup backup.json
# with UK_BACKUP_PASSPHRASE set, the file is encrypted: npm run uk-cli -- backup backup.json
npm run uk-cli -- restore backup.json
```

In Git Bash, macOS or Linux, use `export` instead of `set`.
