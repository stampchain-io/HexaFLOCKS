import os
import re

import pytest

from backend import generate_hexa_flock, resolve_traits
from PIL import Image
import io
from stamps import StampService


def test_generate_valid_seed():
    img_bytes, meta = generate_hexa_flock(42)
    assert meta["seed"] == 42
    assert "traits" in meta and isinstance(meta["traits"], dict)
    assert img_bytes.getvalue()  # Non-empty
    assert meta["image_uri"].startswith("data:image/png;base64,")
    # PNG size budget check (paletted 24x24 should be small)
    assert len(img_bytes.getvalue()) < 2048


def test_png_is_paletted_mode():
    img_bytes, _ = generate_hexa_flock(77)
    img = Image.open(io.BytesIO(img_bytes.getvalue()))
    assert img.mode == 'P'


def test_generate_invalid_seed():
    with pytest.raises(ValueError):
        generate_hexa_flock(0)


def test_mock_stamp_returns_txid(monkeypatch):
    monkeypatch.setenv("ALLOW_MOCK_STAMP", "true")
    svc = StampService(private_key=None, network="testnet")
    tx = svc.create_stamp({"attributes": {"seed": 99}})
    assert re.match(r"^mock_tx_99_\d{6}$", tx)


def test_traits_determinism():
    t1 = resolve_traits(123)
    t2 = resolve_traits(123)
    assert t1.__dict__ == t2.__dict__
