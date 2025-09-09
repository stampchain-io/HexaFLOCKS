HexaFlock Stamping – Minimal Cloudflare Setup

A minimal, no‑server setup to get stamping live using a Cloudflare Worker proxying a PSBT/broadcast builder (e.g., dev.bitcoinstamps).

Prerequisites
- Cloudflare account (free)
- Node 18+
- Wrangler CLI: `npm i -g wrangler`

TL;DR
1) Configure + deploy the Worker
2) Point your static site to the Worker URL
3) Use the two‑step flow: choose fee → build PSBT → sign → broadcast

1) Configure the Worker

From repo root:

```
cd cloudflare-worker
# If you prefer OAuth, use `wrangler login` instead of API token
# Configure Wrangler with an API token (recommended non-interactive)
export CLOUDFLARE_API_TOKEN=<your-api-token>

# Verify auth
wrangler whoami
```

Create KV and wire its id:

```
# Create KV namespace for supply tracking
wrangler kv namespace create MINTED
# Copy the `id` it prints into wrangler.toml under [[kv_namespaces]] → binding = "MINTED"
# Optional: initialize counter
wrangler kv key put --binding=MINTED minted 0
```

Configure `wrangler.toml`:

```
name = "hexaflock-worker"
account_id = "<your-account-id>"
main = "src/index.js"
compatibility_date = "2025-01-01"
workers_dev = true

[[kv_namespaces]]
binding = "MINTED"
id = "<kv-id-from-create>"

[vars]
BITCOIN_NETWORK = "testnet" # or "mainnet"
TX_BUILDER_URL = "https://dev.bitcoinstamps.xyz"
TX_BUILDER_PSBT_PATH = "/api/psbt"
TX_BUILDER_BROADCAST_PATH = "/api/broadcast"
FEE_RATE_SAT_VB = "5"
MAX_FLOCKS = "10000"
CREATOR_ADDRESS = "bc1q..."
CREATOR_TIP_SATS = "21000"
# Optional: limit CORS to your site
# ALLOWED_ORIGIN = "https://your-site.example.com"
```

Deploy:

```
wrangler deploy
# Copy the URL it prints, e.g. https://hexaflock-worker.<account>.workers.dev
```

2) Wire the Static Site

Open `static_site/index.html` in a browser. In the Stamp panel:
- Backend API URL: set to your Worker URL (it defaults to workers.dev and persists)
- You should see “Supply: X / 10,000” under the title

The UI supports:
- Fee rate: set sat/vB in the Stamp panel, persisted locally
- Build PSBT (stamp): prepares a PSBT for your wallet and returns a session id
- Broadcast: paste signed transaction hex to broadcast and increment supply (uses the session id to count)

3) End‑to‑End Test

- Health: `GET /health` → `{ ok: true, kv: true, upstream: true }`
- Supply: `GET /supply` → `{ minted, remaining, max }`
- PSBT: `POST /psbt` with `{ image_base64, metadata }`
- Broadcast: `POST /broadcast` with `{ tx_hex }`
- Mint convenience: `POST /mint` with `{ image_base64, metadata }` → returns `{ psbt }`

Example curl (replace URL):

```
curl https://<worker>.workers.dev/health
curl https://<worker>.workers.dev/supply
```

Notes & Limitations
- No custodial signing. The Worker never holds keys. Users must sign PSBTs in their wallet.
- Supply counter is best‑effort (KV is eventually consistent). For strict accounting or concurrent mints, consider a Durable Object.
 - CORS defaults to `*`. Set `ALLOWED_ORIGIN` in `wrangler.toml` to lock it to your site domain. Supports comma‑separated list of origins.
- If the upstream builder schema differs, adjust `TX_BUILDER_*` paths or payload fields in `cloudflare-worker/src/index.js`.

Color Derivation (Front‑end)
- The flock shape/layout is fixed (matching your uploaded design).
- Colors are derived deterministically from the TXID:
  - Body color: HSL from txid[0..7]
  - Eye color: HSL from txid[8..15]
  - Snout color: HSL from txid[16..23]
- See `static_site/index.html` functions `colorFromHash`, `hslToHex`, and `resolveTraits`.

Production Notes
- Network is set to mainnet in `cloudflare-worker/wrangler.toml`.
- Default fee rate is configured via env `FEE_RATE_SAT_VB`, but the UI can override per request.
- To harden CORS in production, set `ALLOWED_ORIGIN = "https://your-site.example.com"` under `[vars]` and redeploy.

Files of Interest
- Worker: `cloudflare-worker/src/index.js`
- Config: `cloudflare-worker/wrangler.toml`
- Static site: `static_site/index.html`

Minimal Troubleshooting
- OAuth port busy: `wrangler login --callback-host 127.0.0.1 --callback-port 8787`
- Use API token: create a token with Account → Workers Scripts:Edit, Workers KV Storage:Edit, Account:Read
- Force token for commands: `CLOUDFLARE_API_TOKEN=<token> wrangler <cmd>`
