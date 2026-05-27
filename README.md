# Halo NetSapiens Click-To-Call

Standalone Cloudflare Worker for starting a NetSapiens bridge call from a Halo ticket/contact context and immediately logging the call attempt back to the Halo ticket.

This project is intentionally separate from Halo Dispatch. It exposes a small endpoint that can be called from a Halo custom integration, custom button, workflow, or another trusted UI.

## API

`POST /api/click-to-call`

Headers:

```http
Authorization: Bearer <INTEGRATION_SHARED_TOKEN>
Content-Type: application/json
```

Body:

```json
{
  "ticketId": 12345,
  "phoneNumber": "(555) 123-4567",
  "haloAgentId": "4",
  "ticketTitle": "Printer issue",
  "contactName": "A. Customer",
  "clientName": "Example Co"
}
```

The Worker:

- normalizes the phone number
- maps `haloAgentId` to a NetSapiens `{ domain, user, callOrigUser }`
- calls `POST /ns-api/v2/domains/{domain}/users/{user}/calls`
- writes a Halo ticket note through `POST /api/Actions`

## Configuration

Copy `wrangler.toml.example` to `wrangler.toml` or edit the included `wrangler.toml`.
For this public repo, keep live variable values in the Cloudflare dashboard rather than committing them.

Set secrets:

```powershell
wrangler secret put HALO_CLIENT_ID
wrangler secret put HALO_CLIENT_SECRET
wrangler secret put NETSAPIENS_API_KEY
wrangler secret put INTEGRATION_SHARED_TOKEN
```

Set Worker vars:

- `HALO_AUTH_URL`
- `HALO_RESOURCE_SERVER`
- `HALO_SCOPE`
- `HALO_NETSAPIENS_CALL_OUTCOME`
- `NETSAPIENS_BASE_URL`
- `NETSAPIENS_AGENT_MAP_JSON`
- `NETSAPIENS_DIAL_RULE_APPLICATION`
- `NETSAPIENS_DEFAULT_CALLER_ID`
- `NETSAPIENS_DEFAULT_CALLBACK_CALLER_ID`

Example `NETSAPIENS_AGENT_MAP_JSON`:

```json
{
  "4": {
    "domain": "example.com",
    "user": "1004",
    "callOrigUser": "1004@example.com",
    "callerIdNumber": "15551234567"
  }
}
```

If `callOrigUser` is omitted, the Worker uses `{user}@{domain}`.

## Local Checks

```powershell
npm test
npm run check
npx wrangler deploy --dry-run --keep-vars
```

## Deploy

```powershell
npx wrangler deploy --keep-vars
```

Use `--keep-vars` when variables are managed in the Cloudflare dashboard so a deploy does not replace them with local placeholder values from `wrangler.toml`.

## Halo Custom Integration Shape

Configure Halo to call the deployed Worker URL:

```text
https://halo-netsapiens-clicktocall.<subdomain>.workers.dev/api/click-to-call
```

Send `ticketId`, `phoneNumber`, and `haloAgentId` from the Halo context. Include `ticketTitle`, `contactName`, and `clientName` when available so the ticket note is more useful.
