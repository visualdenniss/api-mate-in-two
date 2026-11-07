# API rate limits

The defaults target the current single-process Render Free service:

| Scope | Limit |
| --- | --- |
| All clients combined | 25 requests per second and 300 per minute |
| Each client | 10 requests per 10 seconds and 60 per minute |
| Puzzle batches (`GET /`) per client | 10 requests per minute |

The first per-client violation starts a one-minute cooldown. Further violations
within an hour increase it to 2, 4, 8, then 15 minutes. Requests during a cooldown
return immediately and do not extend the cooldown or consume the global quota.
A quiet hour clears the strike history. Global overload does not give visitors
individual strikes.

Responses include `429`, `Retry-After`, and a JSON `retryAfter` value in seconds.
Successful requests include standard rate-limit headers. CORS exposes those
headers to the frontend. Count all requests, including failures and HEAD requests;
do not refund failed requests. OPTIONS preflights finish in CORS middleware.
The frontend should respect `Retry-After` on `429` and stop automatic retries on
`400`. Its exclusion list must also stay within the existing 500-ID input limit.

On Render (`RENDER=true`), identification uses Cloudflare's overwritten
`CF-Connecting-IP` header. This assumes Render's public Cloudflare ingress;
do not use that mode for a directly reachable server or private ingress without
reviewing its proxy boundary. Missing or invalid addresses return `503` instead
of sharing an accidental proxy bucket. Outside Render, use the socket address
and ignore all supplied forwarding headers. IPv4-mapped IPv6 addresses are
normalized; IPv6 addresses share a /56 bucket to reduce address-rotation bypasses.

The global admission limits bound new identities reaching the per-client stores.
Strike history also has a fixed capacity and expires after an hour. State is
in memory and resets on restart or spin-down. Multiple processes or instances
require a shared store and shared cooldown state before scaling.

Tune `DEFAULT_LIMITS` in `rateLimit.js` against observed legitimate traffic.
People sharing a public IP also share a quota. These application limits protect
database work; Render's edge protection handles network floods.

Run `npm test` from the server directory. The tests use mocked database access
and local HTTP servers; they do not access the deployed application or credentials.

The backend targets Node 24. `npm run dev` uses Node's built-in watch mode, so
Nodemon is not needed. Render's `NODE_VERSION` setting takes precedence over
the package's `engines` range; remove an old override or set it to `24.x`.
