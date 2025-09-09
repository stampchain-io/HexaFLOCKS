# HexaFlock – Generative Pixel Sheep with Bitcoin Stamps Integration

HexaFlock is an open-source generative art project that creates pixel sheep variants based on a small 24×24 reference style: orange head/body, green eyes, red snout, and a white wool “block” rendered with hex/blocky edges. It optionally mints images as Bitcoin Stamps. The repo runs locally with mock stamping by default and supports real stamping when you install `btc_stamps` and provide a funded wallet key.

## Quick Start

Fastest path (pure static, no installs):

- Open `static_site/index.html` in a browser.
- Paste a 64-hex Bitcoin TXID and click Generate.
- Download PNG or copy metadata JSON. No backend required.

For backend/API usage (optional):

Prereqs: Python 3.10+. Node 18+ optional for the React demo.

1) Create a virtualenv and install Python deps

```
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

2) Run the backend (mock stamping by default)

```
python backend.py
# API at http://localhost:5000
```

3) Try API generation (TXID-first)

```
curl -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{"txid":"<64-hex-bitcoin-txid>"}'
```

4) Mint (mock) – returns a simulated tx hash and writes a PDF if ReportLab is installed

```
curl -X POST http://localhost:5000/mint \
  -H "Content-Type: application/json" \
-d '{"image_base64":"<from /generate>","metadata":{"source_txid":"<same-txid>","seed":123,"description":"...","traits":{}}}'
```

## Real Bitcoin Stamping (optional)

To stamp on testnet for real:

- Clone and install `btc_stamps` into your environment (editable install recommended):

```
git clone https://github.com/stampchain-io/btc_stamps.git external/btc_stamps
pip install -e external/btc_stamps
```

- Set your `.env`:

```
WALLET_PRIVATE_KEY=your_testnet_wif
BITCOIN_NETWORK=testnet
ALLOW_MOCK_STAMP=false
```

If `btc_stamps` imports cleanly, the backend will attempt to use it. Otherwise it falls back to mock (unless you’ve disabled it).

## Optional IPFS

If you want image bytes uploaded to an IPFS node before stamping (to keep the on-chain payload smaller):

- Install `ipfshttpclient` and run a local IPFS daemon, then set in `.env`:

```
USE_IPFS=true
IPFS_NODE=http://127.0.0.1:5001
```

If IPFS is not available, the backend logs a warning and stamps with the embedded base64 instead.

## Frontend Options

1) Static site (no build):

- Open `static_site/index.html` in a browser (assumes backend at `http://localhost:5000`).

2) React app (Vite):

```
cd frontend
npm install
npm run dev
# Vite dev server at http://localhost:5173
```

Set `VITE_API_URL` if your backend isn’t on localhost:5000. The React app is optional; the static page does everything client-side.

## Batch Generation

```
python batch_generate.py --num 5 --processes 2
# Writes flocks/flock_<seed>.png and flocks/meta_<seed>.json
```

## Tests

```
pytest -q
```

Tests cover generator basics and the mock stamping service. They do not broadcast transactions.

## Docker

```
docker build -t hexaflock-backend .
docker run -p 5000:5000 --env-file .env hexaflock-backend
```

## Cloudflare Worker API (cheapest, no Docker)

Use the included Worker to provide PSBT and Broadcast endpoints for the static site. Users sign in their own wallet; your creator cut (0.00021 BTC) is included as an extra output.

1) Create a Worker

```
npm i -g wrangler
wrangler login
cd cloudflare-worker
cp wrangler.example.toml wrangler.toml
wrangler kv:namespace create MINTED
# Put the returned id into wrangler.toml under [[kv_namespaces]]
```

2) Configure `wrangler.toml` vars: `TX_BUILDER_URL`, `BITCOIN_NETWORK`, `CREATOR_ADDRESS`, `CREATOR_TIP_SATS=21000`, `MAX_FLOCKS=10000`.

3) Deploy

```
wrangler deploy
```

4) In your live page, paste the Worker URL in the “Backend API URL” box. Buttons for Estimate Fee, Stamp, Build PSBT, and Broadcast will work.

## Project Structure

```
.
├── backend.py            # Flask API (generate, mint, traits, fee_estimate), CORS, logging
├── stamps.py             # Stamping wrapper (real via btc_stamps or mock)
├── batch_generate.py     # Batch generation + stamping
├── style/
│   ├── palette.json      # Frozen palette used in output
│   └── masks.json        # Base pixel masks (head/eyes/snout/legs/wool seed)
├── static_site/          # Simple HTML-only interface
├── frontend/             # Vite React app
├── tests/                # Pytests
├── external/             # Place external repos here (btc_stamps, stamps_sdk)
├── flocks/               # Output images + metadata
├── logs/                 # App logs
├── requirements.txt
├── Dockerfile
├── .env.example
└── README.md
```

## Notes

- Mock stamping returns `mock_tx_<seed>_<random>` so you can validate the flow offline.
- If ReportLab is not installed, PDF creation is skipped with a warning.
- The stamping wrapper attempts to call `create_stamp` or `inscribe` on `btc_stamps` if found. Adjust the method name in `stamps.py` if the external API differs.
- Images are rendered at 24×24 using a fixed palette and saved as paletted PNG to keep size small for canonical Stamps.
