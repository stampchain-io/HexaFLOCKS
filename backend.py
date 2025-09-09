import base64
import io
import logging
import math
import os
import random
from dataclasses import asdict, dataclass
from typing import Tuple, List
import re
import hashlib

import numpy as np
from PIL import Image, ImageDraw
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

# Optional deps (IPFS, PDF)
try:  # pragma: no cover - optional
    import ipfshttpclient  # type: ignore
except Exception:  # pragma: no cover - optional
    ipfshttpclient = None  # type: ignore

try:  # pragma: no cover - optional
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
except Exception:  # pragma: no cover - optional
    letter = None  # type: ignore
    canvas = None  # type: ignore

from stamps import StampService
import json


load_dotenv()

# Logging
os.makedirs("logs", exist_ok=True)
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("logs/app.log"),
        logging.StreamHandler()
    ],
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)


# Config
USE_IPFS = os.getenv("USE_IPFS", "false").lower() == "true"
BITCOIN_NETWORK = os.getenv("BITCOIN_NETWORK", "testnet")
WALLET_PRIVATE_KEY = os.getenv("WALLET_PRIVATE_KEY")

stamp_service = StampService(private_key=WALLET_PRIVATE_KEY, network=BITCOIN_NETWORK)

ipfs_client = None
if USE_IPFS:
    if ipfshttpclient is None:
        logger.warning("USE_IPFS=true but ipfshttpclient is not installed. Skipping IPFS.")
    else:
        try:  # pragma: no cover - requires running daemon
            ipfs_node = os.getenv("IPFS_NODE", "http://127.0.0.1:5001")
            ipfs_client = ipfshttpclient.connect(ipfs_node)
            logger.info(f"Connected IPFS node: {ipfs_node}")
        except Exception as e:  # pragma: no cover
            logger.warning(f"Failed to connect IPFS node, skipping: {e}")
            ipfs_client = None


@dataclass
class Traits:
    body_color: str
    eye_color: str
    snout_color: str
    wool_density: int
    wool_shape: str  # hex|block
    edge_jitter: int  # 0..2
    ear_tilt: str  # up|neutral|down
    leg_pose: str  # static|step1|step2
    accessory: str  # none|scarf|bell|hat|gold


def _upscale(img: Image.Image, size: int = 64) -> Image.Image:
    return img.resize((size, size), Image.NEAREST)


def _load_style() -> tuple[List[str], dict]:
    base_dir = os.path.dirname(__file__)
    with open(os.path.join(base_dir, "style", "palette.json"), "r") as f:
        palette = json.load(f)["palette"]
    with open(os.path.join(base_dir, "style", "masks.json"), "r") as f:
        masks = json.load(f)
    return palette, masks


_PALETTE, _MASKS = _load_style()


def _palette_image() -> Image.Image:
    pimg = Image.new("P", (1, 1))
    # Build 256*3 palette list
    pal = []
    for hexc in _PALETTE:
        hexc = hexc.strip()
        if hexc.startswith("#"):
            hexc = hexc[1:]
        r = int(hexc[0:2], 16)
        g = int(hexc[2:4], 16)
        b = int(hexc[4:6], 16)
        pal.extend([r, g, b])
    # Fill remaining
    pal.extend([0, 0, 0] * (256 - len(_PALETTE)))
    pimg.putpalette(pal)
    return pimg


def _enforce_palette(img_rgb: Image.Image) -> Image.Image:
    pimg = _palette_image()
    return img_rgb.convert("RGB").quantize(palette=pimg, dither=Image.Dither.NONE)


def _encode_png(img: Image.Image) -> Tuple[io.BytesIO, str]:
    buff = io.BytesIO()
    img.save(buff, format="PNG")
    b64 = base64.b64encode(buff.getvalue()).decode()
    buff.seek(0)
    return buff, b64


def resolve_traits(seed: int) -> Traits:
    random.seed(seed)
    np.random.seed(seed)
    body_color = random.choice(["#FF8C00", "#FFA500", "#FF4500"])  # oranges
    eye_color = random.choice(["#00FF00", "#32CD32"])               # greens
    snout_color = random.choices(["#FF0000", "#DC143C", "#FFD700"], weights=[89, 10, 1])[0]  # rare gold
    wool_density = random.randint(3, 7)
    wool_shape = random.choice(["hex", "block"])  # edge style
    edge_jitter = random.randint(0, 2)
    ear_tilt = random.choice(["up", "neutral", "down"]) 
    leg_pose = random.choice(["static", "step1", "step2"]) 
    accessory = random.choices(["none", "scarf", "bell", "hat"], weights=[92, 4, 3, 1])[0]
    return Traits(body_color, eye_color, snout_color, wool_density, wool_shape, edge_jitter, ear_tilt, leg_pose, accessory)


def _draw_sheep(traits: Traits) -> Image.Image:
    grid = int(_MASKS.get("grid", 24))
    img = Image.new("RGB", (grid, grid), "black")
    draw = ImageDraw.Draw(img)

    # Head
    for x, y in _MASKS["head"]:
        draw.point((x, y), fill=traits.body_color)

    # Eyes
    lx, ly = _MASKS["eyes"]["left"]
    rx, ry = _MASKS["eyes"]["right"]
    draw.point((lx, ly), fill=traits.eye_color)
    draw.point((rx, ry), fill=traits.eye_color)

    # Snout
    sx, sy = _MASKS["snout"]
    draw.point((sx, sy), fill=traits.snout_color)

    # Legs (pose)
    legs = _MASKS["legs"]
    for i, (lx, ly) in enumerate(legs):
        dx = 0
        if traits.leg_pose == "step1" and i == 0:
            dx = -1
        elif traits.leg_pose == "step2" and i == 1:
            dx = 1
        draw.point((max(0, min(grid-1, lx + dx)), ly), fill="#6B4E3D")

    # Wool: start from seeds, expand by density in hex/block pattern with jitter
    seeds = [tuple(p) for p in _MASKS["wool_seeds"]]
    wool = set(seeds)
    neighbors_hex = [(1,0), (0,1), (-1,1), (-1,0), (0,-1), (1,-1)]
    neighbors_block = [(1,0),(-1,0),(0,1),(0,-1)]
    neigh = neighbors_hex if traits.wool_shape == "hex" else neighbors_block
    for _ in range(traits.wool_density):
        new_pts = set()
        for (x, y) in list(wool):
            for (dx, dy) in neigh:
                jx = dx + random.randint(-traits.edge_jitter, traits.edge_jitter)
                jy = dy + random.randint(-traits.edge_jitter, traits.edge_jitter)
                nx, ny = x + jx, y + jy
                if 0 <= nx < grid and 8 <= ny < grid-4:  # keep vertical bounds
                    # Avoid overriding head area
                    if (nx, ny) not in wool and [nx, ny] not in _MASKS["head"]:
                        new_pts.add((nx, ny))
        wool.update(new_pts)

    for (x, y) in wool:
        draw.point((x, y), fill="#FFFFFF")

    # Accessory
    if traits.accessory == "scarf":
        # a small band under the head
        for x in range(4, 10):
            draw.point((x, 14), fill="#FF0000")
    elif traits.accessory == "bell":
        draw.point((6, 14), fill="#FFD700")
    elif traits.accessory == "hat":
        for x in range(2, 6):
            draw.point((x, 9), fill="#000000")

    return img


def generate_hexa_flock(seed: int = 42, size: int = 64):
    if not isinstance(seed, int) or seed < 1:
        raise ValueError("seed must be a positive integer")

    traits = resolve_traits(seed)
    base_rgb = _draw_sheep(traits)
    paletted = _enforce_palette(base_rgb)
    img_bytes, image_b64 = _encode_png(paletted)

    metadata = {
        "seed": seed,
        "traits": asdict(traits),
        "description": "Pixel sheep variant with controlled wool and pose.",
        "image_uri": f"data:image/png;base64,{image_b64}",
        "size": 24,
        "palette": _PALETTE,
    }
    logger.info(f"Generated sheep seed={seed}")
    return img_bytes, metadata


def _maybe_upload_ipfs(image_b64: str) -> str | None:
    if not (USE_IPFS and ipfs_client):
        return None
    try:  # pragma: no cover - requires daemon
        raw = base64.b64decode(image_b64)
        cid = ipfs_client.add_bytes(raw)  # type: ignore
        if isinstance(cid, dict) and "Hash" in cid:
            return f"ipfs://{cid['Hash']}"
        if isinstance(cid, str):
            return f"ipfs://{cid}"
    except Exception as e:
        logger.warning(f"IPFS upload failed, embedding base64: {e}")
    return None


def create_stamped_pdf(image_bytes: io.BytesIO, metadata: dict, output_path: str = "certificate.pdf") -> None:
    if not (canvas and letter):
        logger.warning("ReportLab not installed; skipping PDF generation")
        return
    try:  # pragma: no cover - requires reportlab
        c = canvas.Canvas(output_path, pagesize=letter)
        page_w, page_h = letter

        # Persist an image temp
        tmp_path = "temp_flock.png"
        with open(tmp_path, "wb") as f:
            f.write(image_bytes.getvalue())

        c.setFont("Helvetica-Bold", 14)
        c.drawString(50, page_h - 50, f"HexaFlock Certificate - Seed: {metadata['seed']}")
        c.setFont("Helvetica", 10)
        c.drawString(50, page_h - 70, metadata.get("description", ""))
        c.drawImage(tmp_path, 50, page_h - 320, width=256, height=256, preserveAspectRatio=True, anchor='nw')

        c.setFont("Helvetica", 9)
        c.drawString(50, page_h - 340, f"Network: {BITCOIN_NETWORK}")
        c.save()
        try:
            os.remove(tmp_path)
        except Exception:
            pass
        logger.info("PDF created: %s", output_path)
    except Exception as e:  # pragma: no cover
        logger.warning(f"PDF generation failed: {e}")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


def _txid_to_seed(txid: str) -> int:
    txid = txid.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", txid):
        raise ValueError("Invalid txid format: must be 64 hex chars")
    # Mix the halves with xor then map to a positive 31-bit space
    parts = [int(txid[i:i+16], 16) for i in range(0, 64, 16)]
    mixed = parts[0] ^ parts[1] ^ parts[2] ^ parts[3]
    seed = mixed % 2147483647
    return seed or 1


@app.route("/generate", methods=["POST"])
def api_generate():
    try:
        payload = request.get_json(force=True)
        txid = payload.get("txid")
        if not txid:
            return jsonify({"error": "txid is required"}), 400
        seed = _txid_to_seed(txid)
        img_bytes, meta = generate_hexa_flock(seed)
        image_base64 = meta["image_uri"].split(",", 1)[1]
        meta["source_txid"] = txid
        return jsonify({"metadata": meta, "image_base64": image_base64})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception("/generate failed: %s", e)
        return jsonify({"error": "Internal error"}), 500


@app.route("/mint", methods=["POST"])
def api_mint():
    try:
        data = request.get_json(force=True)
        image_b64 = data.get("image_base64")
        metadata = data.get("metadata") or {}
        if not image_b64 or not isinstance(metadata, dict):
            return jsonify({"error": "Missing image_base64 or metadata"}), 400
        txid = metadata.get("source_txid")
        if not txid:
            return jsonify({"error": "source_txid required in metadata"}), 400
        try:
            _ = _txid_to_seed(txid)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

        # Prepare stamp payload
        ipfs_uri = _maybe_upload_ipfs(image_b64)
        image_uri = ipfs_uri or f"data:image/png;base64,{image_b64}"
        stamp_data = {
            "name": f"HexaFlock #{metadata.get('seed', '?')}",
            "description": metadata.get("description", "HexaFlock"),
            "image": image_uri,
            "image_base64": image_b64,  # some libs expect raw b64
            "attributes": {**(metadata.get("traits") or {}), "seed": metadata.get("seed"), "source_txid": txid},
            "external_url": f"https://example.com/hexaflock/{metadata.get('seed', '0')}",
        }

        tx_hash = stamp_service.create_stamp(stamp_data)

        # PDF output (best-effort)
        img_bytes = io.BytesIO(base64.b64decode(image_b64))
        create_stamped_pdf(img_bytes, metadata)

        return jsonify({"tx_hash": tx_hash, "pdf_path": "certificate.pdf"})
    except Exception as e:
        logger.exception("/mint failed: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/traits/<int:seed>", methods=["GET"])
def api_traits(seed: int):
    try:
        if seed < 1:
            return jsonify({"error": "Invalid seed"}), 400
        t = resolve_traits(seed)
        return jsonify({"seed": seed, "traits": asdict(t)})
    except Exception as e:
        logger.exception("/traits failed: %s", e)
        return jsonify({"error": "Internal error"}), 500


@app.route("/traits_tx/<string:txid>", methods=["GET"])
def api_traits_tx(txid: str):
    try:
        seed = _txid_to_seed(txid)
        t = resolve_traits(seed)
        return jsonify({"txid": txid, "seed": seed, "traits": asdict(t)})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception("/traits_tx failed: %s", e)
        return jsonify({"error": "Internal error"}), 500


@app.route("/fee_estimate", methods=["POST"])  # optional support, uses StampService if available
def api_fee_estimate():
    try:
        data = request.get_json(force=True) or {}
        image_b64 = data.get("image_base64")
        if not image_b64:
            return jsonify({"error": "image_base64 required"}), 400
        ipfs_uri = _maybe_upload_ipfs(image_b64)
        payload = {"image": ipfs_uri or f"data:image/png;base64,{image_b64}"}
        fee = stamp_service.estimate_fee(payload)
        return jsonify({"estimated_sats": fee})
    except Exception as e:
        logger.exception("/fee_estimate failed: %s", e)
        return jsonify({"error": "Internal error"}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
